import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import maplibregl from "maplibre-gl";

import { nominatimReverse, nominatimSearch } from "./api/nominatim.js";
import { buildHistoricalJakartaGrid } from "./api/historicalJakarta.js";
import { fetchIsochrones, fetchRoute, extractRoute } from "./api/valhalla.js";
import { cacheSize, clearCache, getGrid, setGrid } from "./cache.js";
import { CONTOUR_COLORS, JAKARTA_CENTER, JABODETABEK_BBOX, useLiveRoutingMode } from "./config.js";
import { renderHeatmap } from "./heatmap.js";
import { buildMeshWarp, buildTravelGridFromIsochrones, sampleTimeSeconds, transformGeoJSONWithMeshWarp } from "./map/cartogram.js";
import { buildTravelTree } from "./map/travelTree.js";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  origin:     null,   // { lat, lon, label }
  mode:       "drive",
  maxMinutes: 60,
  showWarp:   true,
  showHeatmap:false,
  showRings:  true,
  grid:       null,   // TravelGrid derived from Valhalla isochrones or fallback
  isochrones: null,
  meshWarp:   null,
  boundaryFc: null,
  contextFc:  { corridors: empty(), congestion: empty(), signals: empty(), labels: empty() },
  contextRaw: null,
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
let didBoot = false;
function bootApp() {
  if (didBoot) return;
  try {
    if (!map.getStyle()) return;
    setupMapLayers();
  } catch (err) {
    console.warn("Jakarta map boot waiting:", err);
    return;
  }
  didBoot = true;
  attachEvents();
  updateBadge();
  loadContextLayers();

  if (!restoreUrl()) {
    // Default: Monas, Jakarta Pusat
    pinOrigin(106.8272, -6.1754, "Monas, Jakarta Pusat", { pushUrl: false });
  }
}

map.on("style.load", bootApp);
map.on("styledata", bootApp);
map.on("load", bootApp);
const bootTimer = setInterval(() => {
  bootApp();
  if (didBoot) clearInterval(bootTimer);
}, 250);

// ── Map layers ─────────────────────────────────────────────────────────────
function setupMapLayers() {
  // Origin marker
  addSource("origin-src", { type: "geojson", data: empty() });
  addLayer({ id: "origin-halo", type: "circle", source: "origin-src",
    paint: { "circle-radius": 13, "circle-color": "transparent",
      "circle-stroke-color": "rgba(23,48,77,0.85)", "circle-stroke-width": 3 } });
  addLayer({ id: "origin-dot", type: "circle", source: "origin-src",
    paint: { "circle-radius": 5, "circle-color": "#fff8ef" } });

  // Jabodetabek boundary
  addSource("boundary-src", { type: "geojson", data: empty() });
  addLayer({ id: "boundary-line", type: "line", source: "boundary-src",
    paint: { "line-color": "rgba(33,57,82,0.68)", "line-width": 1.4, "line-dasharray": [5, 3] } });

  addSource("isochrones-ghost-src", { type: "geojson", data: empty() });
  addLayer({ id: "isochrones-ghost-fill", type: "fill", source: "isochrones-ghost-src",
    layout: { visibility: "none" },
    paint: { "fill-color": "#fffaf1", "fill-opacity": 0.1 } });
  addLayer({ id: "isochrones-ghost-line", type: "line", source: "isochrones-ghost-src",
    layout: { visibility: "none" },
    paint: {
      "line-color": "rgba(19,43,72,0.3)",
      "line-width": 1.1,
      "line-dasharray": [2, 2],
      "line-opacity": 0.62
    } });

  addSource("isochrones-src", { type: "geojson", data: empty() });
  addLayer({ id: "isochrones-fill", type: "fill", source: "isochrones-src",
    paint: {
      "fill-color": ["match", ["to-string", ["get", "contour"]], "10", CONTOUR_COLORS[10], "20", CONTOUR_COLORS[20], "30", CONTOUR_COLORS[30], "45", CONTOUR_COLORS[45], "60", CONTOUR_COLORS[60], "#4a678d"],
      "fill-opacity": ["interpolate", ["linear"], ["get", "contour"], 10, 0.62, 60, 0.28]
    } });
  addLayer({ id: "isochrones-line", type: "line", source: "isochrones-src",
    paint: {
      "line-color": ["match", ["to-string", ["get", "contour"]], "10", CONTOUR_COLORS[10], "20", CONTOUR_COLORS[20], "30", CONTOUR_COLORS[30], "45", CONTOUR_COLORS[45], "60", CONTOUR_COLORS[60], "#4a678d"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.6, 12, 2.4],
      "line-opacity": 0.86
    } });

  // Travel-time dendrogram. This is the primary cartogram structure.
  addSource("tree-src", { type: "geojson", data: empty(), lineMetrics: true });
  addLayer({ id: "travel-tree-shadow", type: "line", source: "tree-src",
    layout: { visibility: "none" },
    paint: {
      "line-color": "rgba(255,248,239,0.62)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.8, 12, 3.2],
      "line-opacity": 0.55,
      "line-blur": 1.1
    } });
  addLayer({ id: "travel-tree-line", type: "line", source: "tree-src",
    layout: { visibility: "none" },
    paint: {
      "line-color": ["interpolate", ["linear"], ["get", "minutes"], 0, "#dc4525", 20, "#f47f2e", 40, "#f8e89c", 60, "#4a678d"],
      "line-width": ["interpolate", ["linear"], ["get", "flow"], 5, 0.55, 35, 1.25, 140, 2.9],
      "line-opacity": ["interpolate", ["linear"], ["get", "minutes"], 0, 0.96, 60, 0.44]
    } });

  // Jakarta context overlays
  addSource("corridors-src", { type: "geojson", data: empty() });
  addLayer({ id: "corridors-glow", type: "line", source: "corridors-src",
    layout: { visibility: "none" },
    paint: { "line-color": "rgba(215,92,46,0.22)", "line-width": 9, "line-blur": 2 } });
  addLayer({ id: "corridors-line", type: "line", source: "corridors-src",
    layout: { visibility: "none" },
    paint: { "line-color": "#d75c2e", "line-width": 2.5, "line-opacity": 0.78 } });

  addSource("congestion-src", { type: "geojson", data: empty() });
  addLayer({ id: "congestion-dot", type: "circle", source: "congestion-src",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 7],
      "circle-color": "#e14d2a",
      "circle-stroke-color": "#fff8ef",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.9
    } });

  addSource("signals-src", { type: "geojson", data: empty() });
  addLayer({ id: "signals-dot", type: "circle", source: "signals-src",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 5],
      "circle-color": "#1c8b7b",
      "circle-stroke-color": "#fff8ef",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.88
    } });

  addSource("labels-src", { type: "geojson", data: empty() });
  addLayer({ id: "city-labels", type: "symbol", source: "labels-src",
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Semibold"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 12, 15],
      "text-offset": [0, 0.7],
      "text-anchor": "top"
    },
    paint: {
      "text-color": "rgba(23,48,77,0.72)",
      "text-halo-color": "rgba(255,248,239,0.88)",
      "text-halo-width": 1.2
    } });

  // Route line
  addSource("route-src", { type: "geojson", data: empty() });
  addLayer({ id: "route-line", type: "line", source: "route-src",
    paint: { "line-color": "rgba(23,48,77,0.9)", "line-width": 3, "line-dasharray": [3, 2] } });
}

function addSource(id, source) {
  if (!map.getSource(id)) map.addSource(id, source);
}

function addLayer(layer) {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
}

// ── Pin origin ─────────────────────────────────────────────────────────────
let _pinSeq = 0;  // cancel stale pin attempts

async function pinOrigin(lon, lat, label, { pushUrl = true } = {}) {
  const seq = ++_pinSeq;

  state.origin = { lon, lat, label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  state.grid   = null;
  state.isochrones = null;
  state.meshWarp = null;
  state.routeGeo = null;

  updateOriginMarker(lon, lat);
  el.originLabel.textContent = state.origin.label;
  el.originLabel.hidden = false;
  el.statusText.textContent = `Pinned near ${state.origin.label}`;
  el.timeTooltip.hidden = true;
  el.reachCard.hidden = true;
  clearCanvas();
  clearRoute();

  // Check cache before showing spinner so message is correct
  const cacheProfile = gridCacheProfile();
  const isCached = Boolean(getGrid(lat, lon, cacheProfile));
  const modelName = useLiveRoutingMode() ? "OSM routing" : "Jakarta historical speeds";
  showLoading(isCached ? "Loading cached grid…" : `Computing drive times (${modelName})…`);

  // Hard 45-second safety timeout — loading overlay will NEVER stay stuck
  const safetyTimer = setTimeout(() => {
    if (seq === _pinSeq) {
      hideLoading();
      el.searchMeta.textContent = "Timed out — tap the map to try again.";
    }
  }, 45_000);

  try {
    const cached = getGrid(lat, lon, cacheProfile);
    if (cached) {
      state.grid = cached;
      state.isochrones = cached.isochrones || null;
    } else if (useLiveRoutingMode()) {
      state.isochrones = await fetchIsochrones({ lat, lon, mode: state.mode, maxMinutes: state.maxMinutes });
      state.grid = buildTravelGridFromIsochrones(
        state.isochrones,
        { lat, lon },
        JABODETABEK_BBOX,
        48,
        48,
        state.maxMinutes
      );
      state.grid.source = "valhalla-isochrone-v1";
      state.grid.isochrones = state.isochrones;
      setGrid(lat, lon, state.grid, cacheProfile);
    } else {
      state.grid = buildHistoricalJakartaGrid({ lat, lon }, state.contextRaw || {}, { mode: state.mode });
      setGrid(lat, lon, state.grid, cacheProfile);
    }
    if (seq !== _pinSeq) return;   // a newer pin already took over

    // Defer canvas draw one frame so layout dimensions are settled
    await new Promise(resolve => requestAnimationFrame(resolve));
    redraw();
    showReach();
    updateCacheBadge();
  } catch (err) {
    if (seq === _pinSeq) {
      el.searchMeta.textContent = `Error: ${err.message}`;
    }
    console.error("pinOrigin error:", err);
  } finally {
    clearTimeout(safetyTimer);
    if (seq === _pinSeq) hideLoading();
  }

  if (pushUrl && seq === _pinSeq) writeUrl();
}

// ── Redraw heatmap + layers ────────────────────────────────────────────────
function redraw() {
  if (!state.grid) return;

  const warp = state.showWarp;
  state.meshWarp = warp ? buildMeshWarp(state.grid, state.maxMinutes) : null;
  setBasemapOpacity(warp ? 0.48 : 0.96);

  // Boundary
  const bndSrc = map.getSource("boundary-src");
  if (bndSrc && state.boundaryFc) {
    bndSrc.setData(warp && state.meshWarp
      ? transformGeoJSONWithMeshWarp(state.boundaryFc, state.meshWarp)
      : state.boundaryFc
    );
  }

  updateContextLayerData();
  updateTravelTreeData();
  updateIsochroneData();

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

function updateIsochroneData() {
  const src = map.getSource("isochrones-src");
  const ghostSrc = map.getSource("isochrones-ghost-src");
  if (!src) return;
  const fc = state.isochrones
    ? sortedIsochrones(state.showWarp && state.meshWarp ? transformGeoJSONWithMeshWarp(state.isochrones, state.meshWarp) : state.isochrones)
    : empty();
  src.setData(fc);
  if (ghostSrc) ghostSrc.setData(state.showWarp && state.isochrones ? sortedIsochrones(state.isochrones) : empty());
  const visibility = state.isochrones && state.showRings ? "visible" : "none";
  ["isochrones-fill", "isochrones-line"].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
  });
  const ghostVisibility = state.isochrones && state.showRings && state.showWarp ? "visible" : "none";
  ["isochrones-ghost-fill", "isochrones-ghost-line"].forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", ghostVisibility);
  });
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
    try {
      const r = await nominatimReverse(lat, lng);
      const top = r?.results?.[0];
      if (top?.formatted) label = shortenLabel(top.formatted);
    } catch { /* silent */ }
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
    if (useLiveRoutingMode()) {
      try {
        const rt = await extractRoute(await fetchRoute({ from: state.origin, to: { lat, lon: lng }, mode: state.mode }));
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

  // Re-render heatmap on map move/zoom (debounced so rapid panning is smooth)
  let _moveTimer = null;
  map.on("move", () => {
    if (_moveTimer) clearTimeout(_moveTimer);
    _moveTimer = setTimeout(() => { _moveTimer = null; redraw(); }, 80);
  });
  map.on("moveend", () => {
    if (_moveTimer) { clearTimeout(_moveTimer); _moveTimer = null; }
    redraw();
  });

  // Zoom buttons
  el.zoomInBtn.addEventListener("click",  () => map.zoomIn());
  el.zoomOutBtn.addEventListener("click", () => map.zoomOut());
  document.querySelectorAll(".map-action-btn").forEach((btn, index) => {
    btn.addEventListener("click", async () => {
      if (index === 0) {
        await toggleMapFullscreen();
      } else {
        el.shareBtn.click();
      }
    });
  });

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

  // Mode change → re-fetch with the matching Valhalla costing profile.
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
  // Cache clear button
  const clearCacheBtn = $("clearCacheBtn");
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", () => {
      clearCache();
      const info = $("cacheInfo");
      if (info) info.textContent = "Cache cleared.";
      setTimeout(() => { if (info) info.textContent = "Computed grids are cached in localStorage for instant re-visit."; }, 2000);
    });
  }
  updateCacheBadge();

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
  try {
    const res = await nominatimSearch(query);
    const results = (res.results || []).slice(0, 6).map((r) => ({
      formatted: shortenLabel(r.formatted || r.display_name || ""),
      lat: Number(r.lat),
      lon: Number(r.lon),
    })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    if (results.length) return results;
  } catch {
    // Fall through to curated places so the app still works offline.
  }
  {
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
    ? transformGeoJSONWithMeshWarp(fc, state.meshWarp)
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

async function toggleMapFullscreen() {
  const frame = $("mapFrame");
  if (!frame) return;
  try {
    if (document.fullscreenElement === frame) {
      await document.exitFullscreen();
    } else if (frame.requestFullscreen) {
      await frame.requestFullscreen();
    }
  } catch {
    map.fitBounds([[bw, bs], [be, bn]], { padding: 34, duration: 600 });
  } finally {
    setTimeout(() => {
      map.resize();
      redraw();
    }, 80);
  }
}

document.addEventListener("fullscreenchange", () => {
  setTimeout(() => {
    map.resize();
    redraw();
  }, 80);
});

// ── Loading ────────────────────────────────────────────────────────────────
function showLoading(msg = "Loading…") {
  if (!el.loadingOverlay) return;
  const span = el.loadingOverlay.querySelector("span");
  if (span) span.textContent = msg;
  el.loadingOverlay.hidden = false;
}
function hideLoading() {
  if (el.loadingOverlay) el.loadingOverlay.hidden = true;
}

// ── Context data ───────────────────────────────────────────────────────────
async function loadContextLayers() {
  try {
    const [boundaryRes, contextRes] = await Promise.all([
      fetch("/data/context/jabodetabek_boundary.geojson"),
      fetch("/data/jakarta_open_layers.json"),
    ]);
    if (boundaryRes.ok) state.boundaryFc = await boundaryRes.json();
    if (contextRes.ok) {
      state.contextRaw = await contextRes.json();
      state.contextFc = buildContextFeatureCollections(state.contextRaw);
      if (state.origin && state.grid?.source === "jakarta-historical-speed-v1") {
        state.grid = buildHistoricalJakartaGrid(state.origin, state.contextRaw, { mode: state.mode });
        setGrid(state.origin.lat, state.origin.lon, state.grid, gridCacheProfile());
        redraw();
        showReach();
      }
    }
    const src = map.getSource("boundary-src");
    if (src && state.boundaryFc) src.setData(state.boundaryFc);
    updateContextLayerData();
  } catch { /* offline */ }
}

function buildContextFeatureCollections(data) {
  const corridors = {
    type: "FeatureCollection",
    features: (data.speed_corridors || []).map((c) => ({
      type: "Feature",
      properties: { name: c.name, speed_kph: c.speed_kph },
      geometry: { type: "LineString", coordinates: (c.path || []).map(([lat, lon]) => [lon, lat]) },
    })),
  };
  const points = (rows, type) => ({
    type: "FeatureCollection",
    features: (rows || []).map((p) => ({
      type: "Feature",
      properties: { name: p.name, type, note: p.note || "" },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  });
  return {
    corridors,
    congestion: points(data.congestion_points, "congestion"),
    signals: points(data.traffic_lights, "signal"),
    labels: points(data.city_labels, "label"),
  };
}

function updateContextLayerData() {
  // Context lines stay geographic so they remain a readable reference layer.
  map.getSource("corridors-src")?.setData(structuredClone(state.contextFc.corridors));
  map.getSource("congestion-src")?.setData(structuredClone(state.contextFc.congestion));
  map.getSource("signals-src")?.setData(structuredClone(state.contextFc.signals));
  map.getSource("labels-src")?.setData(state.showWarp && state.grid
    ? transformGeoJSONWithMeshWarp(state.contextFc.labels, state.meshWarp)
    : structuredClone(state.contextFc.labels));
}

function sortedIsochrones(fc) {
  return {
    type: "FeatureCollection",
    features: [...(fc.features || [])].sort((a, b) => Number(b.properties?.contour || 0) - Number(a.properties?.contour || 0)),
  };
}

function updateTravelTreeData() {
  const src = map.getSource("tree-src");
  if (!src || !state.grid) return;
  const tree = buildTravelTree(state.grid, { maxMinutes: state.maxMinutes, stride: state.showWarp ? 1 : 2 });
  src.setData(state.showWarp && state.meshWarp ? transformGeoJSONWithMeshWarp(tree, state.meshWarp) : tree);
}

// ── Badge ──────────────────────────────────────────────────────────────────
function updateBadge() {
  const historical = !useLiveRoutingMode();
  el.apiBadge.textContent  = historical ? "historical" : "valhalla";
  el.apiBadge.classList.toggle("is-mock", historical);
}

function gridCacheProfile() {
  return useLiveRoutingMode() ? `valhalla-iso-${state.mode}-${state.maxMinutes}` : `historical-${state.mode}`;
}

function updateCacheBadge() {
  const n = cacheSize();
  el.searchMeta.textContent = n > 0 ? `${n} origin${n === 1 ? "" : "s"} cached — next visit is instant.` : "";
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
  state.showHeatmap = p.get("h") === "1";
  el.heatmapToggle.checked = state.showHeatmap;
  pinOrigin(Number(p.get("lon")), Number(p.get("lat")), `${(+p.get("lat")).toFixed(4)}, ${(+p.get("lon")).toFixed(4)}`, { pushUrl: false });
  return true;
}
