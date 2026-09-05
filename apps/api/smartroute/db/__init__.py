"""Database package — re-exports session helpers from smartroute/db.py."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from smartroute.db.repository import GatewayRepository

_db_path = Path(__file__).resolve().parent.parent / "db.py"
_spec = importlib.util.spec_from_file_location("smartroute_db_module", _db_path)
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)

AsyncSessionLocal = _mod.AsyncSessionLocal
Base = _mod.Base
engine = _mod.engine
get_db = _mod.get_db

__all__ = ["AsyncSessionLocal", "Base", "engine", "get_db", "GatewayRepository"]
