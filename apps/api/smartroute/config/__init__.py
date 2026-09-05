import importlib.util
from pathlib import Path

from smartroute.config.database import SessionLocal as SessionLocal
from smartroute.config.database import engine as engine
from smartroute.config.database import get_session as get_session
from smartroute.config.logger import logger as logger
from smartroute.config.metrics import *
from smartroute.config.redis import disconnect_redis as disconnect_redis
from smartroute.config.redis import get_redis as get_redis

__all__ = [
    "SessionLocal",
    "disconnect_redis",
    "engine",
    "get_redis",
    "get_session",
    "get_settings",
    "logger",
    "settings",
]

# Prefer smartroute/config.py (uppercase settings) over config/env.py when both exist.
_settings_path = Path(__file__).resolve().parent.parent / "config.py"
_spec = importlib.util.spec_from_file_location("smartroute_app_config", _settings_path)
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)
settings = _mod.settings
get_settings = _mod.get_settings
