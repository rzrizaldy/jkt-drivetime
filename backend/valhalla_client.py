"""Forward JSON requests to Valhalla HTTP service."""

from __future__ import annotations

import os
from typing import Any

import httpx

VALHALLA_URL = os.environ.get("VALHALLA_URL", "http://127.0.0.1:8002").rstrip("/")
TIMEOUT = float(os.environ.get("VALHALLA_TIMEOUT", "120"))


async def get_valhalla(path: str) -> tuple[int, Any]:
    url = f"{VALHALLA_URL}{path}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get(url)
        try:
            data = response.json()
        except Exception:
            data = {"error": response.text}
        return response.status_code, data


async def post_valhalla(path: str, body: dict) -> tuple[int, Any]:
    url = f"{VALHALLA_URL}{path}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(url, json=body)
        try:
            data = response.json()
        except Exception:
            data = {"error": response.text}
        return response.status_code, data
