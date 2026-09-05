"""Transactional email delivery via SMTP."""

from __future__ import annotations

import logging
import re

import aiosmtplib
from email.message import EmailMessage

from smartroute.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    @property
    def is_configured(self) -> bool:
        return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASS and settings.EMAIL_FROM)

    async def send(self, to: str, subject: str, html: str, text: str | None = None) -> bool:
        if not self.is_configured:
            logger.debug("Email skipped — SMTP not configured: to=%s subject=%s", to, subject)
            return False

        message = EmailMessage()
        message["From"] = settings.EMAIL_FROM
        message["To"] = to
        message["Subject"] = subject
        plain = text or re.sub(r"<[^>]+>", "", html)
        message.set_content(plain)
        message.add_alternative(html, subtype="html")

        try:
            await aiosmtplib.send(
                message,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USER,
                password=settings.SMTP_PASS,
                use_tls=settings.SMTP_PORT == 465,
                start_tls=settings.SMTP_PORT != 465,
            )
            logger.info("Email sent to=%s subject=%s", to, subject)
            return True
        except Exception:
            logger.exception("Email send failed to=%s", to)
            return False

    async def send_budget_alert(
        self,
        to: str,
        data: dict[str, object],
    ) -> bool:
        severity = str(data["severity"])
        workspace_name = str(data["workspaceName"])
        message = str(data["message"])
        spend = float(data["spend"])
        limit = float(data["limit"])
        icon = "🚨" if severity == "CRITICAL" else "⚠️"
        return await self.send(
            to,
            f"[SmartRoute] {severity} budget alert — {workspace_name}",
            f"""
        <h2>{icon} Budget Alert</h2>
        <p><strong>Workspace:</strong> {workspace_name}</p>
        <p>{message}</p>
        <p>Current spend: <strong>${spend:.2f}</strong> / ${limit:.2f}</p>
        <p><a href="{settings.web_base_url}/notifications">View in dashboard</a></p>
      """,
        )

    async def send_email_verification(self, to: str, data: dict[str, str]) -> bool:
        return await self.send(
            to,
            "Verify your SmartRoute AI email",
            f"""
        <h2>Verify your email</h2>
        <p>Hi {data['name']},</p>
        <p>Thanks for signing up. Click below to verify your email — link expires in 24 hours.</p>
        <p><a href="{data['verifyUrl']}">Verify email</a></p>
      """,
        )

    async def send_password_reset(self, to: str, data: dict[str, str]) -> bool:
        return await self.send(
            to,
            "Reset your SmartRoute AI password",
            f"""
        <h2>Password reset</h2>
        <p>Hi {data['name']},</p>
        <p>We received a request to reset your password. Click the link below — it expires in 1 hour.</p>
        <p><a href="{data['resetUrl']}">Reset password</a></p>
        <p>If you did not request this, you can ignore this email.</p>
      """,
        )

    async def send_member_invite(self, to: str, data: dict[str, str]) -> bool:
        return await self.send(
            to,
            f"You've been invited to {data['workspaceName']} on SmartRoute AI",
            f"""
        <h2>Workspace Invitation</h2>
        <p><strong>{data['inviterName']}</strong> invited you to join <strong>{data['workspaceName']}</strong> as <strong>{data['role']}</strong>.</p>
        <p><a href="{data['acceptUrl']}">Accept invitation</a></p>
        <p>This link expires in 7 days.</p>
      """,
        )


email_service = EmailService()
