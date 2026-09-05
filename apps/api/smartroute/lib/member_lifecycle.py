"""Member lifecycle validation helpers."""

from __future__ import annotations

from smartroute.errors import AppError


def assert_owner_can_leave(other_member_count: int, workspace_name: str) -> None:
    if other_member_count > 0:
        raise AppError.conflict(
            f'Transfer ownership of "{workspace_name}" before leaving the workspace',
        )
