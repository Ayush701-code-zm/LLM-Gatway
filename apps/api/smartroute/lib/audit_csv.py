"""Audit log CSV helpers."""

from __future__ import annotations


def audit_slug_columns(metadata: object) -> dict[str, str]:
    if not metadata or not isinstance(metadata, dict):
        return {"previousSlug": "", "newSlug": ""}

    return {
        "previousSlug": metadata["previousSlug"] if isinstance(metadata.get("previousSlug"), str) else "",
        "newSlug": metadata["newSlug"] if isinstance(metadata.get("newSlug"), str) else "",
    }
