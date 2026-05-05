"""Disk-backed response cache for Valhalla proxy."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

import diskcache

_CACHE_DIR = Path(os.environ.get("SHIM_CACHE_DIR", Path(__file__).resolve().parent / ".cache"))
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_cache = diskcache.Cache(str(_CACHE_DIR))


def cache_key(prefix: str, payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()[:48]
    return f"{prefix}:{digest}"


def get_json(key: str) -> Any | None:
    return _cache.get(key, default=None)


def set_json(key: str, value: Any, expire: int | None = None) -> None:
    _cache.set(key, value, expire=expire)
