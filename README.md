# Greater Jakarta drive-time cartogram

[CommuteTimeMap](https://commutetimemap.com/map)-style reachability UI plus a **time-warp** view inspired by [nyc-cartogram](https://github.com/AntCas/nyc-cartogram): the map can be redrawn so displacement from the origin is driven by **estimated drive time** from OpenStreetMap via **[Valhalla](https://valhalla.github.io/valhalla/)**, not by geographic kilometers.

## Stack

- **Frontend:** Vite, [MapLibre GL JS](https://maplibre.org/), [@turf/turf](https://turfjs.org/)
- **Routing / isochrones / matrix:** Self-hosted **Valhalla** (Docker) + thin **FastAPI** shim with disk cache and rate limits
- **Geocoding:** [Nominatim](https://nominatim.org/) (bounded to Jabodetabek)
- **POIs:** [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) (amenity search in viewport bbox), with mock data when `VITE_USE_MOCK=true`
- **Context layers:** Curated + optional refresh from **Satu Data Jakarta** (`scripts/fetch_satudata.py`)

Coverage is **not** live TomTom-style traffic: it is **OSM topology + static speeds** (and Jakarta open-data overlays for context).

## Quick start (UI only, mock)

```bash
npm install
VITE_USE_MOCK=true npm run dev
```

Open the printed URL. Isochrones, matrix warp, routes, and places use deterministic local geometry (no Docker).

## Full stack (Valhalla + shim)

1. **Build clipped OSM for Jabodetabek** (optional but recommended; needs [`osmium-tool`](https://osmcode.org/osmium-tool/) for a smaller extract):

   ```bash
   chmod +x infra/build_tiles.sh
   ./infra/build_tiles.sh
   ```

   This writes `valhalla_tiles/jabodetabek.osm.pbf`. The first Valhalla container boot can take a long time while it builds tiles.

2. **Start Valhalla + FastAPI** (from repo root):

   ```bash
   cd infra
   docker compose up --build
   ```

   - Valhalla: `http://127.0.0.1:8002`
   - Shim: `http://127.0.0.1:8000`

3. **Frontend** (separate terminal; proxies `/v1` and `/health` to the shim):

   ```bash
   npm install
   npm run dev
   ```

   Do **not** set `VITE_USE_MOCK` (or set it to `false`).

Optional: `VITE_VALHALLA_SHIM_URL=https://your.api.host` for a remote shim (no proxy).

## Environment

| Variable | Purpose |
|---------|---------|
| `VITE_USE_MOCK` | `true` → no backend; local mock Valhalla responses |
| `VITE_VALHALLA_SHIM_URL` | FastAPI base (e.g. `https://api.example.com`). Empty → same-origin + Vite dev proxy |
| Docker: `VALHALLA_URL` | Internal URL to Valhalla (default `http://valhalla:8002`) |
| Docker: `CORS_ORIGINS` | Allowed browser origins for the shim |

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/fetch_satudata.py` | Refreshes traffic-light rows from Satu Data Jakarta and syncs `public/data/context/jabodetabek_boundary.geojson` from `infra/jabodetabek.geojson` |
| `scripts/precompute_warp.py` | Optional: warm `public/data/warp/*.json` matrices via `SHIM_URL` (defaults to `http://127.0.0.1:8000`) |

## Tests

```bash
npm test
```

Covers URL/body builders, matrix parsing, cartogram sampling/warp, Jakarta context JSON, and boundary file presence.

## License / attribution

- Maps: © OpenStreetMap contributors
- Glyphs (demo): MapLibre demo tile/font endpoints (swap for production if needed)
