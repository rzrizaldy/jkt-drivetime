# jkt-drivetime

Greater Jakarta road-time map for Jabodetabek. The app lets a user pin an origin, search or click a destination, and read drive-time reachability from real OpenStreetMap road data through Valhalla.

Live app: <https://rzrizaldy.github.io/jkt-drivetime/>

Repository: <https://github.com/rzrizaldy/jkt-drivetime>

## Current Product

- MapLibre GL map focused on Jabodetabek.
- Origin search through Nominatim, with local fallback places for common Jakarta/Depok/Tangerang/Bekasi queries.
- Click-to-pin origin, click again for destination, drag origin or destination markers, and click an active marker to reset it.
- Point-to-point cards for from, to, minutes, distance, and mode.
- Valhalla isochrone polygons for 10, 20, 30, 45, 60, 75, and 90 minute bands.
- Time-color legend stays on the map so the contour colors are readable.
- Peak/off-peak adjustment defaults to peak. Walk is not adjusted. Motorcycle and bicycle use lighter multipliers than car.
- Basemap toggle between the clearer Carto-style map and OpenStreetMap.
- Jakarta context layers from local open-data files under `public/data`.
- Browser favicon and touch icons included.

## Data And Accuracy

The public app is API-backed by the FOSSGIS Valhalla demo endpoint:

```text
https://valhalla1.openstreetmap.de
```

Valhalla uses OpenStreetMap routing data. It is not live traffic. The peak/off-peak control applies a simple product-level adjustment on top of Valhalla route and isochrone results:

| Mode | Peak | Off-peak |
|------|------|----------|
| Drive | 1.8x | 1.15x |
| Motorcycle | 1.6x | 1.05x |
| Bicycle | 1.4x | 1.0x |
| Walk | 1.0x | 1.0x |

For a durable public product, use the self-hosted Valhalla stack below instead of relying on the public demo endpoint.

## Stack

- Frontend: Vite, MapLibre GL JS, Turf
- Routing and isochrones: Valhalla
- Optional routing gateway: FastAPI shim with disk cache and rate limiting
- Geocoding: Nominatim search and reverse geocoding
- Context data: local Jabodetabek boundary and Jakarta open-data layers

## Local Development

```bash
npm install
npm run dev
```

Open the printed Vite URL, usually:

```text
http://127.0.0.1:5173/
```

By default the Vite dev server proxies `/api/valhalla` to the public Valhalla demo, so local development works without a local routing server.

## Self-hosted Valhalla

Use this when the app needs reliable public traffic, larger usage, or control over the routing graph.

1. Build or download the OSM extract.

```bash
chmod +x infra/build_tiles.sh
./infra/build_tiles.sh
```

This downloads the Geofabrik Java extract and clips it to Jabodetabek when `osmium` is installed. Output goes to `valhalla_tiles/jabodetabek.osm.pbf`.

2. Start Valhalla and the FastAPI shim.

```bash
cd infra
docker compose up --build
```

Services:

```text
Valhalla: http://127.0.0.1:8002
Shim:     http://127.0.0.1:8000
```

3. Point the frontend at the shim.

```bash
VITE_VALHALLA_SHIM_URL=/v1 npm run dev
```

## Environment

| Variable | Purpose |
|----------|---------|
| `VITE_VALHALLA_SHIM_URL` | Valhalla or shim base URL. Empty uses `/api/valhalla` in dev. Use `/v1` for the local FastAPI shim. Use `https://valhalla1.openstreetmap.de` for GitHub Pages demo builds. |
| `VITE_USE_LIVE_ROUTING` | Default `true`. Set `false` to use the local historical/fallback surface. |
| `VITE_USE_MOCK` | Set `true` only for mocked development responses. |
| `GITHUB_PAGES_BASE` | Vite base path for Pages. Use `/jkt-drivetime/`. |
| `VALHALLA_URL` | Docker shim target. Default is `http://valhalla:8002`. |
| `CORS_ORIGINS` | Allowed browser origins for the FastAPI shim. |

## Build And Test

```bash
npm run build
npm test
```

The test suite covers Valhalla body builders, route parsing, cartogram/warp math, Jakarta context data, and boundary file presence.

## Deploy To GitHub Pages

Build with the Pages base path and the public Valhalla endpoint:

```bash
GITHUB_PAGES_BASE=/jkt-drivetime/ \
VITE_VALHALLA_SHIM_URL=https://valhalla1.openstreetmap.de \
npm run build
```

Publish `dist/` to the `gh-pages` branch:

```bash
tmpdir=$(mktemp -d)
cp -R dist/. "$tmpdir"/
cd "$tmpdir"
git init
git checkout -b gh-pages
touch .nojekyll
git add .
git commit -m "Deploy GitHub Pages"
git remote add origin https://github.com/rzrizaldy/jkt-drivetime.git
git push -f origin gh-pages
```

GitHub Pages should be configured to serve from the `gh-pages` branch root.

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/fetch_satudata.py` | Refreshes local Jakarta context data and syncs the Jabodetabek boundary into `public/data/context`. |
| `scripts/precompute_warp.py` | Optional matrix precomputation helper against the FastAPI shim. |
| `infra/build_tiles.sh` | Downloads and clips the Java OSM extract for Valhalla. |

## Attribution

- Map and routing data: OpenStreetMap contributors.
- Routing engine: Valhalla.
- Public demo endpoint: FOSSGIS Valhalla demo, fair-use only.
- Frontend map rendering: MapLibre GL JS.
