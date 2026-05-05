#!/usr/bin/env python3
"""Refresh a compact Jakarta open-traffic context file from Satu Data Jakarta.

The frontend ships with a small curated seed so it can run offline. This script is
intentionally conservative: it fetches only public API rows and writes a compact
JSON shape that the app already understands.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "data" / "jakarta_open_layers.json"
BOUNDARY_OUT = ROOT / "public" / "data" / "context" / "jabodetabek_boundary.geojson"
INFRA_CLIP = ROOT / "infra" / "jabodetabek.geojson"
BASE = "https://satudata.jakarta.go.id/backend/api/v2/satudata"


def post_json(path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{BASE}/{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def table(slug: str, limit: int = 500) -> list[dict]:
    response = post_json(
        "get-table-data",
        {
            "page_url": slug,
            "kategori": "dataset",
            "page": 1,
            "per_page": limit,
            "sort_field": None,
            "sort_order": "asc",
            "filters": {},
        },
    )
    return response.get("data") or response.get("filedata") or []


def as_float(value: str | int | float | None) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None


def sync_boundary() -> None:
    BOUNDARY_OUT.parent.mkdir(parents=True, exist_ok=True)
    if INFRA_CLIP.exists():
        feat = json.loads(INFRA_CLIP.read_text(encoding="utf-8"))
        fc = {"type": "FeatureCollection", "features": [feat]}
        BOUNDARY_OUT.write_text(json.dumps(fc, indent=2), encoding="utf-8")
        print(f"Wrote {BOUNDARY_OUT}")


def main() -> None:
    traffic_lights = []
    for row in table("data-sebaran-lampu-lalu-lintas", 300):
        lat = as_float(row.get("latitude"))
        lon = as_float(row.get("longitude"))
        if lat is None or lon is None:
            continue
        traffic_lights.append({"name": row.get("lokasi") or "Traffic light", "lat": lat, "lon": lon})

    congestion_points = []
    for row in table("data-titik-rawan-kemacetan-di-dki-jakarta", 100):
        congestion_points.append(
            {
                "name": row.get("lokasi") or row.get("wilayah") or "Congestion point",
                "lat": -6.2088,
                "lon": 106.8456,
                "note": row.get("keterangan") or row.get("jenis_kendaraan") or "Satu Data Jakarta congestion record",
            }
        )

    existing = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {}
    existing["traffic_lights"] = traffic_lights[:250]
    if congestion_points:
        existing["congestion_points"] = existing.get("congestion_points", [])[:5] + congestion_points[:20]
    OUTPUT.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT}")
    sync_boundary()


if __name__ == "__main__":
    main()
