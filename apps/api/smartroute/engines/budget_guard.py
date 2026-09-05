"""Workspace budget guard."""

from __future__ import annotations

from smartroute.config.logger import logger
from smartroute.db.repository import GatewayRepository
from smartroute.errors import AppError
from smartroute.queues import dispatch_webhook_event
from smartroute.lib.constants import BUDGET_THRESHOLDS


class BudgetGuardEngine:
    async def check(
        self,
        workspace_id: str,
        estimated_cost_usd: float,
        repo: GatewayRepository,
    ) -> None:
        budgets = await repo.get_active_budgets(workspace_id)

        for budget in budgets:
            projected = float(budget.current_spend) + estimated_cost_usd
            percentage = projected / float(budget.limit_usd)

            if percentage >= BUDGET_THRESHOLDS["BLOCKED"] and budget.block_at_100:
                logger.warn(
                    "budget_exceeded",
                    workspace_id=workspace_id,
                    budget_id=str(budget.id),
                    percentage=percentage,
                )
                raise AppError.budget_exceeded(
                    f'Budget "{budget.name}" has been exhausted (${float(budget.limit_usd):.2f} limit)',
                )

            if percentage >= BUDGET_THRESHOLDS["CRITICAL"] and budget.alert_at_90:
                await self._queue_alert(workspace_id, str(budget.id), "CRITICAL", percentage, repo)
                await dispatch_webhook_event(
                    workspace_id,
                    "budget.critical",
                    {
                        "budgetId": str(budget.id),
                        "budgetName": budget.name,
                        "percentUsed": round(percentage * 100),
                        "limitUsd": float(budget.limit_usd),
                    },
                )
            elif percentage >= BUDGET_THRESHOLDS["WARNING"] and budget.alert_at_80:
                await self._queue_alert(workspace_id, str(budget.id), "WARNING", percentage, repo)
                await dispatch_webhook_event(
                    workspace_id,
                    "budget.warning",
                    {
                        "budgetId": str(budget.id),
                        "budgetName": budget.name,
                        "percentUsed": round(percentage * 100),
                        "limitUsd": float(budget.limit_usd),
                    },
                )

    async def record_spend(
        self,
        workspace_id: str,
        cost_usd: float,
        repo: GatewayRepository,
    ) -> None:
        await repo.update_budget_spend(workspace_id, cost_usd)

    async def _queue_alert(
        self,
        workspace_id: str,
        budget_id: str,
        severity: str,
        percentage: float,
        repo: GatewayRepository,
    ) -> None:
        existing = await repo.find_pending_budget_alert(workspace_id, budget_id, severity)
        if existing:
            return

        await repo.create_budget_alert(
            {
                "workspace_id": workspace_id,
                "budget_id": budget_id,
                "severity": severity,
                "threshold": 0.8 if severity == "WARNING" else 0.9,
                "spend_at_alert": 0,
                "message": f"Budget has reached {percentage * 100:.1f}% of limit",
            }
        )


budget_guard = BudgetGuardEngine()
