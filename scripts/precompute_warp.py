#!/usr/bin/env python3
"""Warm travel-time grids for popular origins (for optional static cache).

Requires a running Valhalla stack reachable at SHIM_URL (FastAPI) or VALHALLA_URL.
Writes JSON under public/data/warp/ suitable for offline inspection; the web app
recomputes the grid on demand when Time warp is enabled.
"""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTDIR = ROOT / "public" / "data" / "warp"
SHIM = os.environ.get("SHIM_URL", "http://127.0.0.1:8000").rstrip("/")

ORIGINS = [
    {"name": "monas", "lat": -6.1754, "lon": 106.8272, "mode": "drive"},
    {"name": "sudirman", "lat": -6.2146, "lon": 106.8178, "mode": "drive"},
    {"name": "kelapa_gading", "lat": -6.1588, "lon": 106.9088, "mode": "drive"},
    {"name": "bsd", "lat": -6.3024, "lon": 106.6527, "mode": "drive"},
    {"name": "bekasi", "lat": -6.2383, "lon": 106.9756, "mode": "drive"},
    {"name": "depok", "lat": -6.4025, "lon": 106.7942, "mode": "drive"},
    {"name": "bogor", "lat": -6.5971, "lon": 106.8060, "mode": "drive"},
    {"name": "manggarai", "lat": -6.2097, "lon": 106.8507, "mode": "drive"},
    {"name": "cawang", "lat": -6.2463, "lon": 106.8737, "mode": "drive"},
    {"name": "kota_tua", "lat": -6.1352, "lon": 106.8132, "mode": "drive"},
]

BBOX = [106.32, -6.78, 107.22, -5.92]
COLS, ROWS = 24, 24


def costing(mode: str) -> str:
    return {
        "motorcycle": "motor_scooter",
        "bicycle": "bicycle",
        "walk": "pedestrian",
    }.get(mode, "auto")


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read().decode("utf-8"))


def sample_targets():
    west, south, east, north = BBOX
    out = []
    for j in range(ROWS):
        lat = south + (j / max(1, ROWS - 1)) * (north - south)
        for i in range(COLS):
            lon = west + (i / max(1, COLS - 1)) * (east - west)
            out.append({"lat": lat, "lon": lon})
    return out


def parse_times(matrix: dict, n: int) -> list:
    out = [None] * n
    raw = matrix.get("sources_to_targets") or matrix.get("sourcesToTargets") or []
    flat = raw[0] if raw and isinstance(raw[0], list) else raw
    for cell in flat:
        if not cell:
            continue
        if cell.get("from_index", 0) != 0:
            continue
        to = cell.get("to_index")
        t = cell.get("time")
        if to is not None and isinstance(t, (int, float)) and t >= 0:
            out[to] = t
    return out


def main() -> None:
    OUTDIR.mkdir(parents=True, exist_ok=True)
    targets = sample_targets()
    for origin in ORIGINS:
        times: list = []
        batch = 80
        for start in range(0, len(targets), batch):
            slice_t = targets[start : start + batch]
            body = {
                "sources": [{"lat": origin["lat"], "lon": origin["lon"]}],
                "targets": slice_t,
                "costing": costing(origin["mode"]),
                "units": "kilometers",
            }
            resp = post_json(f"{SHIM}/v1/matrix", body)
            times.extend(parse_times(resp, len(slice_t)))
        payload = {
            "origin": {"lat": origin["lat"], "lon": origin["lon"], "mode": origin["mode"]},
            "bbox": BBOX,
            "cols": COLS,
            "rows": ROWS,
            "times": times,
        }
        path = OUTDIR / f"{origin['name']}.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
