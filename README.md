# Greater Jakarta drive-time cartogram

[CommuteTimeMap](https://commutetimemap.com/map)-style reachability UI plus a **time-warp** view inspired by [nyc-cartogram](https://github.com/AntCas/nyc-cartogram): the map can be redrawn so displacement from the origin is driven by **estimated drive time** from OpenStreetMap via **[Valhalla](https://valhalla.github.io/valhalla/)**, not by geographic kilometers.

## Stack

- **Frontend:** Vite, [MapLibre GL JS](https://maplibre.org/), [@turf/turf](https://turfjs.org/)
- **Routing / isochrones / matrix:** Self-hosted **Valhalla** (Docker) + thin **FastAPI** shim with disk cache and rate limits
- **Geocoding:** [Nominatim](https://nominatim.org/) (bounded to Jabodetabek)
- **POIs:** [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) (amenity search in viewport bbox), with curated local fallback places
- **Context layers:** Curated + optional refresh from **Satu Data Jakarta** (`scripts/fetch_satudata.py`)

Coverage is **not** live TomTom-style traffic: default v1 is **Valhalla free-flow / OSM-based drive-time reachability** with Jakarta open-data overlays for context and QA. The historical Jakarta model remains as an explicit fallback via `VITE_USE_LIVE_ROUTING=false`.

## Quick start (prototype Valhalla)

```bash
npm install
npm run dev
```

Open the printed URL. During local development the frontend proxies `/api/valhalla` to the public FOSSGIS Valhalla demo so the map shows real Valhalla isochrone polygons immediately. That public endpoint is fair-use only; use the self-hosted stack below for anything beyond prototyping.

## Full stack (Valhalla + shim)

1. **Build clipped OSM for Jabodetabek** (optional but recommended; needs [`osmium-tool`](https://osmcode.org/osmium-tool/) for a smaller extract):

   ```bash
   chmod +x infra/build_tiles.sh
   ./infra/build_tiles.sh
   ```

   This writes `valhalla_tiles/jabodetabek.osm.pbf`. For the broader Java extract instead, place `java-latest.osm.pbf` from Geofabrik in `valhalla_tiles/`. The first Valhalla container boot can take a long time while it builds tiles.

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
   VITE_VALHALLA_SHIM_URL=/v1 npm run dev
   ```

   `VITE_VALHALLA_SHIM_URL=/v1` routes frontend calls through the FastAPI shim instead of the public demo.

Optional: `VITE_VALHALLA_SHIM_URL=https://your.api.host` for a remote shim (no proxy).

## Environment

| Variable | Purpose |
|---------|---------|
| `VITE_USE_LIVE_ROUTING` | Default `true` → use Valhalla isochrones. Set `false` for the local historical Jakarta speed fallback |
| `VITE_VALHALLA_SHIM_URL` | Valhalla/shim base. Empty → `/api/valhalla` public demo proxy in dev. Use `/v1` for the local FastAPI shim |
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
