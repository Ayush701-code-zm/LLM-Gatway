"""PostgreSQL ENUM types (created by Prisma migrations — do not create_type)."""

from __future__ import annotations

import enum

from sqlalchemy.dialects.postgresql import ENUM


def pg_enum(enum_cls: type[enum.Enum]) -> ENUM:
    return ENUM(
        enum_cls,
        name=enum_cls.__name__,
        create_type=False,
        values_callable=lambda x: [member.value for member in x],
    )
