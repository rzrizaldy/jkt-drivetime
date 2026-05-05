import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import maplibregl from "maplibre-gl";

import { nominatimReverse, nominatimSearch } from "./api/nominatim.js";
import { buildOsrmGrid } from "./api/isochroneOsrm.js";
import { osrmRoute }     from "./api/osrm.js";
import { JAKARTA_CENTER, JABODETABEK_BBOX, useMockMode } from "./config.js";
import { renderHeatmap } from "./heatmap.js";
import { sampleTimeSeconds, transformGeoJSON, warpLngLat } from "./map/cartogram.js";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  origin:     null,   // { lat, lon, label }
  mode:       "drive",
  maxMinutes: 60,
  showWarp:   true,
  showHeatmap:true,
  showRings:  false,
  grid:       null,   // TravelGrid (OSRM)
  boundaryFc: null,
  routeGeo:   null,
};

// ── DOM ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  searchForm:     $("searchForm"),
  addressInput:   $("addressInput"),
  searchMeta:     $("searchMeta"),
  searchResults:  $("searchResults"),
  statusText:     $("statusText"),
  warpToggle:     $("warpToggle"),
  heatmapToggle:  $("heatmapToggle"),
  ringsToggle:    $("ringsToggle"),
  modeSelect:     $("modeSelect"),
  maxTimeRange:   $("maxTimeRange"),
  maxTimeLabel:   $("maxTimeLabel"),
  shareBtn:       $("shareBtn"),
  heatmapCanvas:  $("heatmapCanvas"),
  heatmapLegend:  $("heatmapLegend"),
  legendMax:      $("legendMax"),
  originLabel:    $("originLabel"),
  timeTooltip:    $("timeTooltip"),
  tooltipMin:     $("tooltipMin"),
  loadingOverlay: $("loadingOverlay"),
  zoomInBtn:      $("zoomInBtn"),
  zoomOutBtn:     $("zoomOutBtn"),
  apiBadge:       $("apiBadge"),
  reachCard:      $("reachCard"),
  reachArea:      $("reachArea"),
};

// ── Map ────────────────────────────────────────────────────────────────────
const [bw, bs, be, bn] = JABODETABEK_BBOX;
const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
      },
    },
    layers: [
      { id: "osm-bg", type: "raster", source: "osm", paint: { "raster-opacity": 1 } },
    ],
  },
  center: [...JAKARTA_CENTER],
  zoom: 9,
  maxBounds: [[bw - 0.5, bs - 0.5], [be + 0.5, bn + 0.5]],
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

// ── Boot ───────────────────────────────────────────────────────────────────
map.on("load", () => {
  setupMapLayers();
  attachEvents();
  updateBadge();
  loadBoundary();

  if (!restoreUrl()) {
    // Default: Monas, Jakarta Pusat
    pinOrigin(106.8272, -6.1754, "Monas, Jakarta Pusat", { pushUrl: false });
  }
});

// ── Map layers ─────────────────────────────────────────────────────────────
function setupMapLayers() {
  // Origin marker
  map.addSource("origin-src", { type: "geojson", data: empty() });
  map.addLayer({ id: "origin-halo", type: "circle", source: "origin-src",
    paint: { "circle-radius": 13, "circle-color": "transparent",
      "circle-stroke-color": "rgba(23,48,77,0.85)", "circle-stroke-width": 3 } });
  map.addLayer({ id: "origin-dot", type: "circle", source: "origin-src",
    paint: { "circle-radius": 5, "circle-color": "#fff8ef" } });

  // Jabodetabek boundary
  map.addSource("boundary-src", { type: "geojson", data: empty() });
  map.addLayer({ id: "boundary-line", type: "line", source: "boundary-src",
    paint: { "line-color": "rgba(95,111,127,0.45)", "line-width": 1.5, "line-dasharray": [5, 3] } });

  // Route line
  map.addSource("route-src", { type: "geojson", data: empty() });
  map.addLayer({ id: "route-line", type: "line", source: "route-src",
    paint: { "line-color": "rgba(23,48,77,0.7)", "line-width": 2, "line-dasharray": [3, 2] } });
}

// ── Pin origin ─────────────────────────────────────────────────────────────
async function pinOrigin(lon, lat, label, { pushUrl = true } = {}) {
  state.origin = { lon, lat, label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  state.grid   = null;
  state.routeGeo = null;

  updateOriginMarker(lon, lat);
  el.originLabel.textContent = state.origin.label;
  el.originLabel.hidden = false;
  el.statusText.textContent = `Pinned near ${state.origin.label}`;
  el.timeTooltip.hidden = true;
  el.reachCard.hidden = true;
  clearCanvas();
  clearRoute();

  showLoading("Computing drive times…");

  try {
    if (useMockMode()) {
      state.grid = mockGrid(lat, lon);
    } else {
      state.grid = await buildOsrmGrid({ lat, lon });
    }
    redraw();
    showReach();
  } catch (err) {
    el.searchMeta.textContent = `Error: ${err.message}`;
    console.error(err);
  } finally {
    hideLoading();
  }

  if (pushUrl) writeUrl();
}

// ── Redraw heatmap + layers ────────────────────────────────────────────────
function redraw() {
  if (!state.grid) return;

  const warp = state.showWarp;
  setBasemapOpacity(warp ? 0.07 : 1);

  // Boundary
  const bndSrc = map.getSource("boundary-src");
  if (bndSrc && state.boundaryFc) {
    bndSrc.setData(warp && state.grid
      ? transformGeoJSON(structuredClone(state.boundaryFc), state.grid)
      : state.boundaryFc
    );
  }

  // Heatmap canvas
  if (state.showHeatmap) {
    const gridToRender = warp ? warpedGrid(state.grid) : state.grid;
    renderHeatmap(el.heatmapCanvas, gridToRender, map, { maxMinutes: state.maxMinutes, alpha: 0.82 });
    el.heatmapLegend.hidden = false;
    el.legendMax.textContent = `${state.maxMinutes}m`;
  } else {
    clearCanvas();
    el.heatmapLegend.hidden = true;
  }
}

/**
 * Build a pseudo-grid where each cell's position is warped.
 * When MapLibre projects these warped coordinates, the heatmap colors
 * appear at the right screen positions for the warp view.
 */
function warpedGrid(grid) {
  const { west, south, east, north, cols, rows, times, origin } = grid;
  const warpedTimes = [...times];
  // The times are correct; we just warp the lng/lat when projecting.
  // We do this by returning a synthetic grid whose coordinates ARE already warped,
  // but since renderHeatmap uses map.project for positioning, we need to pass warped
  // positions — handled by passing a modified grid with warped cell centers.
  // Simplest: warp the underlying grid struct.
  const cellW = (east  - west)  / Math.max(1, cols - 1);
  const cellH = (north - south) / Math.max(1, rows - 1);
  const valid = times.filter((t) => t != null);
  const maxT  = valid.length ? Math.max(...valid) : state.maxMinutes * 60;

  // We build a new grid by warping each cell centre's geographic coordinate.
  // The "times" in the new grid remain unchanged (same color).
  // But we store warped lng/lat as fake new west/south/east/north — not ideal.
  // Instead: renderHeatmap should accept an array of (screen-space x,y,time) tuples.
  // For now: return original grid — the warp is visible through the boundary geometry.
  return grid;
}

// ── Reach card ─────────────────────────────────────────────────────────────
function showReach() {
  if (!state.grid) return;
  const maxSec = state.maxMinutes * 60;
  const reachable = state.grid.times.filter((t) => t != null && t <= maxSec).length;
  const total     = state.grid.times.filter((t) => t != null).length;
  const pct       = total ? Math.round((reachable / total) * 100) : 0;
  el.reachArea.textContent = `${pct}%`;
  el.reachCard.hidden = false;
  const metaEl = document.getElementById("reachMeta");
  if (metaEl) metaEl.textContent = `of sampled points reachable in ${state.maxMinutes} min`;
}

// ── Events ─────────────────────────────────────────────────────────────────
function attachEvents() {
  // Map click → pin origin
  map.on("click", async (e) => {
    if ($("settingsMenu").hasAttribute("open")) return;
    const { lng, lat } = e.lngLat;
    let label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (!useMockMode()) {
      try {
        const r = await nominatimReverse(lat, lng);
        const top = r?.results?.[0];
        if (top?.formatted) label = shortenLabel(top.formatted);
      } catch { /* silent */ }
    }
    pinOrigin(lng, lat, label);
  });

  // Right-click / ctrl+click → draw route from pinned origin to clicked point
  map.on("contextmenu", async (e) => {
    if (!state.origin || !state.grid) return;
    e.preventDefault();
    const { lng, lat } = e.lngLat;
    const secs = sampleTimeSeconds(state.grid, lng, lat);
    el.tooltipMin.textContent = secs != null ? `~${Math.round(secs / 60)}` : `>${state.maxMinutes}`;
    el.timeTooltip.hidden = false;
    if (!useMockMode()) {
      try {
        const rt = await osrmRoute(state.origin, { lat, lon: lng });
        drawRoute(rt.geometry);
        el.tooltipMin.textContent = `~${Math.round(rt.seconds / 60)}`;
      } catch { /* silent */ }
    }
  });

  // Hover → show travel time (from grid)
  map.on("mousemove", (e) => {
    if (!state.grid) return;
    const { lng, lat } = e.lngLat;
    const secs = sampleTimeSeconds(state.grid, lng, lat);
    if (secs != null) {
      const mins = Math.round(secs / 60);
      el.tooltipMin.textContent = mins < 1 ? "<1" : `~${mins}`;
      el.timeTooltip.hidden = false;
    } else {
      el.tooltipMin.textContent = `>${state.maxMinutes}`;
      el.timeTooltip.hidden = state.grid == null;
    }
  });
  map.on("mouseleave", () => { if (!state.origin) el.timeTooltip.hidden = true; });

  // Re-render heatmap on map move/zoom
  map.on("moveend", () => { redraw(); });

  // Zoom buttons
  el.zoomInBtn.addEventListener("click",  () => map.zoomIn());
  el.zoomOutBtn.addEventListener("click", () => map.zoomOut());

  // Toggles
  el.warpToggle.addEventListener("change", () => {
    state.showWarp = el.warpToggle.checked;
    redraw();
    writeUrl();
  });
  el.heatmapToggle.addEventListener("change", () => {
    state.showHeatmap = el.heatmapToggle.checked;
    redraw();
    writeUrl();
  });
  el.ringsToggle.addEventListener("change", () => {
    state.showRings = el.ringsToggle.checked;
    redraw();
  });

  // Mode change → re-fetch (no-op for now since OSRM profiles don't include motorcycle)
  el.modeSelect.addEventListener("change", () => {
    state.mode = el.modeSelect.value;
    if (state.origin) pinOrigin(state.origin.lon, state.origin.lat, state.origin.label);
  });

  // Max time range
  el.maxTimeRange.addEventListener("input", () => {
    state.maxMinutes = Number(el.maxTimeRange.value);
    el.maxTimeLabel.textContent = `${state.maxMinutes} min`;
    if (el.legendMax) el.legendMax.textContent = `${state.maxMinutes}m`;
  });
  el.maxTimeRange.addEventListener("change", () => {
    redraw();
    showReach();
  });

  // Search
  el.searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = el.addressInput.value.trim();
    if (!q) return;
    el.searchMeta.textContent = "Searching…";
    el.searchResults.innerHTML = "";
    try {
      const results = await doSearch(q);
      if (!results.length) { el.searchMeta.textContent = "No results. Try another query."; return; }
      if (results.length === 1) {
        el.addressInput.value = results[0].formatted;
        el.searchResults.innerHTML = "";
        el.searchMeta.textContent = "";
        pinOrigin(results[0].lon, results[0].lat, results[0].formatted);
      } else {
        el.searchMeta.textContent = "Select a result:";
        showSearchResults(results);
      }
    } catch (err) {
      el.searchMeta.textContent = `Search error: ${err.message}`;
    }
  });

  // Close settings on outside click
  document.addEventListener("click", (e) => {
    const menu = $("settingsMenu");
    if (menu && !menu.contains(e.target)) menu.removeAttribute("open");
  });

  // Share
  el.shareBtn.addEventListener("click", async () => {
    writeUrl();
    try {
      if (navigator.share) {
        await navigator.share({ url: location.href, title: "Jakarta Drive-Time Cartogram" });
      } else {
        await navigator.clipboard.writeText(location.href);
        el.searchMeta.textContent = "Share URL copied!";
      }
    } catch { /* cancelled */ }
  });
}

// ── Search ─────────────────────────────────────────────────────────────────
async function doSearch(query) {
  if (useMockMode()) {
    const MOCK = [
      { formatted: "Monas, Jakarta Pusat",        lat: -6.1754, lon: 106.8272 },
      { formatted: "Blok M, Jakarta Selatan",      lat: -6.2443, lon: 106.7992 },
      { formatted: "Kelapa Gading, Jakarta Utara", lat: -6.1588, lon: 106.9088 },
      { formatted: "BSD City, Tangerang Selatan",  lat: -6.3024, lon: 106.6527 },
      { formatted: "Bekasi",                       lat: -6.2383, lon: 106.9756 },
      { formatted: "Depok",                        lat: -6.4025, lon: 106.7942 },
    ];
    return MOCK.filter((a) => a.formatted.toLowerCase().includes(query.toLowerCase()));
  }
  const res = await nominatimSearch(query);
  return (res.results || []).slice(0, 6).map((r) => ({
    formatted: shortenLabel(r.formatted || r.display_name || ""),
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
}

function showSearchResults(results) {
  el.searchResults.innerHTML = "";
  for (const r of results) {
    const btn = document.createElement("button");
    btn.className = "search-result-item";
    btn.textContent = r.formatted;
    btn.addEventListener("click", () => {
      el.addressInput.value = r.formatted;
      el.searchResults.innerHTML = "";
      el.searchMeta.textContent = "";
      pinOrigin(r.lon, r.lat, r.formatted);
    });
    el.searchResults.appendChild(btn);
  }
}

// ── Route drawing ──────────────────────────────────────────────────────────
function drawRoute(geo) {
  const src = map.getSource("route-src");
  if (!src || !geo) return;
  const fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: geo }] };
  src.setData(state.showWarp && state.grid
    ? transformGeoJSON(fc, state.grid)
    : fc
  );
}

function clearRoute() {
  const src = map.getSource("route-src");
  if (src) src.setData(empty());
}

// ── Canvas helpers ─────────────────────────────────────────────────────────
function clearCanvas() {
  const ctx = el.heatmapCanvas.getContext("2d");
  if (ctx) ctx.clearRect(0, 0, el.heatmapCanvas.width, el.heatmapCanvas.height);
  el.heatmapLegend.hidden = true;
}

// ── Map helpers ────────────────────────────────────────────────────────────
function updateOriginMarker(lon, lat) {
  const src = map.getSource("origin-src");
  if (src) src.setData({ type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } }
  ]});
}

function setBasemapOpacity(opacity) {
  if (map.getLayer("osm-bg")) map.setPaintProperty("osm-bg", "raster-opacity", opacity);
}

function empty() { return { type: "FeatureCollection", features: [] }; }

// ── Loading ────────────────────────────────────────────────────────────────
function showLoading(msg = "Loading…") {
  const span = el.loadingOverlay.querySelector("span");
  if (span) span.textContent = msg;
  el.loadingOverlay.hidden = false;
}
function hideLoading() { el.loadingOverlay.hidden = true; }

// ── Context data ───────────────────────────────────────────────────────────
async function loadBoundary() {
  try {
    const r = await fetch("/data/context/jabodetabek_boundary.geojson");
    if (r.ok) {
      state.boundaryFc = await r.json();
      const src = map.getSource("boundary-src");
      if (src) src.setData(state.boundaryFc);
    }
  } catch { /* offline */ }
}

// ── Mock mode ──────────────────────────────────────────────────────────────
function mockGrid(originLat, originLon) {
  const [west, south, east, north] = JABODETABEK_BBOX;
  const cols = 10;
  const rows = 10;
  const times = [];
  for (let j = 0; j < rows; j++) {
    const lat = south + (j / Math.max(1, rows - 1)) * (north - south);
    for (let i = 0; i < cols; i++) {
      const lon = west + (i / Math.max(1, cols - 1)) * (east - west);
      const dLat = (lat - originLat) * Math.PI / 180;
      const dLon = (lon - originLon) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(originLat*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLon/2)**2;
      const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      times.push(Math.round((km / 24) * 3600)); // 24 km/h avg
    }
  }
  return { west, south, east, north, cols, rows, times, origin: { lat: originLat, lon: originLon } };
}

// ── Badge ──────────────────────────────────────────────────────────────────
function updateBadge() {
  const mock = useMockMode();
  el.apiBadge.textContent  = mock ? "mock" : "live";
  el.apiBadge.classList.toggle("is-mock", mock);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function shortenLabel(label) {
  const parts = label.split(",").map((p) => p.trim());
  return parts.slice(0, 3).join(", ");
}

// ── URL state ──────────────────────────────────────────────────────────────
function writeUrl() {
  const p = new URLSearchParams({
    m: state.mode,
    t: state.maxMinutes,
    w: state.showWarp ? 1 : 0,
    h: state.showHeatmap ? 1 : 0,
    ...(state.origin && { lat: state.origin.lat.toFixed(5), lon: state.origin.lon.toFixed(5) }),
  });
  history.replaceState(null, "", `?${p}`);
}

function restoreUrl() {
  const p = new URLSearchParams(location.search);
  if (!p.get("lat") || !p.get("lon")) return false;
  if (p.get("m")) { state.mode = p.get("m"); el.modeSelect.value = state.mode; }
  if (p.get("t")) { state.maxMinutes = Number(p.get("t")); el.maxTimeRange.value = String(state.maxMinutes); el.maxTimeLabel.textContent = `${state.maxMinutes} min`; }
  if (p.get("w")) { state.showWarp    = p.get("w") === "1"; el.warpToggle.checked    = state.showWarp; }
  if (p.get("h")) { state.showHeatmap = p.get("h") === "1"; el.heatmapToggle.checked = state.showHeatmap; }
  pinOrigin(Number(p.get("lon")), Number(p.get("lat")), `${(+p.get("lat")).toFixed(4)}, ${(+p.get("lon")).toFixed(4)}`, { pushUrl: false });
  return true;
}
