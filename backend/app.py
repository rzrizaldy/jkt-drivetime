"""FastAPI shim in front of Valhalla: caching, CORS, simple rate limit."""

from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cache import cache_key, get_json, set_json
from valhalla_client import get_valhalla, post_valhalla

app = FastAPI(title="Jakarta Valhalla shim", version="0.1.0")

_origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_RATE_WINDOW = int(os.environ.get("RATE_WINDOW_SEC", "60"))
_RATE_MAX = int(os.environ.get("RATE_MAX_PER_WINDOW", "120"))
_buckets: dict[str, deque[float]] = defaultdict(deque)
_lock = asyncio.Lock()


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    async with _lock:
        dq = _buckets[client]
        while dq and now - dq[0] > _RATE_WINDOW:
            dq.popleft()
        if len(dq) >= _RATE_MAX:
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        dq.append(now)
    return await call_next(request)


@app.get("/health")
async def health():
    code, body = await get_valhalla("/status")
    ok = code == 200
    return {"valhalla_reachable": ok, "status_code": code, "body": body if ok else None}


@app.post("/v1/isochrone")
async def isochrone(body: dict[str, Any]):
    key = cache_key("iso", body)
    cached = get_json(key)
    if cached is not None:
        return JSONResponse(cached, headers={"X-Cache": "hit"})
    code, data = await post_valhalla("/isochrone", body)
    if code != 200:
        raise HTTPException(status_code=code, detail=data)
    set_json(key, data, expire=int(os.environ.get("CACHE_TTL_ISOCHRONE", "3600")))
    return JSONResponse(data, headers={"X-Cache": "miss"})


@app.post("/v1/route")
async def route(body: dict[str, Any]):
    key = cache_key("route", body)
    cached = get_json(key)
    if cached is not None:
        return JSONResponse(cached, headers={"X-Cache": "hit"})
    code, data = await post_valhalla("/route", body)
    if code != 200:
        raise HTTPException(status_code=code, detail=data)
    set_json(key, data, expire=int(os.environ.get("CACHE_TTL_ROUTE", "1800")))
    return JSONResponse(data, headers={"X-Cache": "miss"})


@app.post("/v1/matrix")
async def matrix(body: dict[str, Any]):
    key = cache_key("matrix", body)
    cached = get_json(key)
    if cached is not None:
        return JSONResponse(cached, headers={"X-Cache": "hit"})
    code, data = await post_valhalla("/sources_to_targets", body)
    if code != 200:
        raise HTTPException(status_code=code, detail=data)
    set_json(key, data, expire=int(os.environ.get("CACHE_TTL_MATRIX", "86400")))
    return JSONResponse(data, headers={"X-Cache": "miss"})
