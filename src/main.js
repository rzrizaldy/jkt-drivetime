import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import { nominatimReverse, nominatimSearch } from "./api/nominatim.js";
import { fetchJakartaRoads } from "./api/overpass.js";
import { extractRoute, fetchIsochrones, fetchRoute } from "./api/valhalla.js";
import {
  CONTOUR_COLORS,
  CONTOUR_MINUTES,
  JAKARTA_CENTER,
  useMockMode,
} from "./config.js";
import {
  buildTravelGridFromIsochrones,
  lookupTimeFromIsochrones,
} from "./map/cartogram.js";
import {
  clearLayers,
  createMap,
  drawContextLayers,
  drawIsochroneLayers,
  drawRoads,
  setBasemapOpacity,
  setOriginMarker,
  setRouteData,
} from "./map/maplibre.js";
import { defaultOrigin } from "./mockValhalla.js";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  origin: null,      // { lat, lon, label }
  mode: "drive",
  maxMinutes: 60,
  mapView: "geo",    // "geo" | "warp"
  isochrones: null,  // GeoJSON FeatureCollection
  warpGrid: null,    // TravelGrid from isochrones
  contextData: null,
  boundaryFc: null,
  roadsEnabled: false,
  roadsFc: null,
  showContext: true,
  loading: false,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  apiBadge: $("apiBadge"),
  searchInput: $("searchInput"),
  suggestions: $("suggestions"),
  settingsBtn: $("settingsBtn"),
  shareBtn: $("shareBtn"),
  settingsPanel: $("settingsPanel"),
  modeSelect: $("modeSelect"),
  maxTimeSelect: $("maxTimeSelect"),
  warpToggle: $("warpToggle"),
  contextToggle: $("contextToggle"),
  roadsToggle: $("roadsToggle"),
  settingsNote: $("settingsNote"),
  hint: $("hint"),
  timeReadout: $("timeReadout"),
  timeVal: $("timeVal"),
  btnGeo: $("btnGeo"),
  btnWarp: $("btnWarp"),
  coverageBadge: $("coverageBadge"),
};

// ── Map ────────────────────────────────────────────────────────────────────
const map = createMap(document.getElementById("map"));
let spinner = null;

map.on("load", () => {
  init();
});

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  const mock = useMockMode();
  el.apiBadge.textContent = mock ? "mock mode" : "OSM · Valhalla";
  el.apiBadge.classList.toggle("is-live", !mock);
  el.settingsNote.textContent = mock
    ? "Running in mock mode (haversine circles). Remove VITE_USE_MOCK to use real Valhalla data."
    : "Real drive-time data via Valhalla (valhalla1.openstreetmap.de) + OpenStreetMap.";

  await loadContextAssets();
  attachEvents();

  const restored = restoreFromUrl();
  if (!restored) {
    const def = defaultOrigin();
    await setOrigin(def.lon, def.lat, def.label, { pushUrl: false });
  }
}

// ── Origin pinning ─────────────────────────────────────────────────────────
async function setOrigin(lon, lat, label, { pushUrl = true } = {}) {
  state.origin = { lon, lat, label: label || `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
  state.warpGrid = null;
  state.isochrones = null;

  setOriginMarker(map, { lon, lat });
  hideHint();
  showLoading();
  clearLayers(map, "iso-");
  setRouteData(map, null);
  el.timeReadout.hidden = true;

  try {
    const fc = await fetchIsochrones({ lat, lon, mode: state.mode, maxMinutes: state.maxMinutes });
    state.isochrones = fc;
    state.warpGrid = buildTravelGridFromIsochrones(fc, { lat, lon }, undefined, 38, 38, state.maxMinutes);
    renderAll();
    el.coverageBadge.hidden = false;
  } catch (err) {
    console.error(err);
    setNote(`Error: ${err.message}`);
  } finally {
    hideLoading();
  }

  if (pushUrl) writeUrl();
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderAll() {
  const grid = state.mapView === "warp" ? state.warpGrid : null;

  drawIsochroneLayers(map, state.isochrones, grid, { colors: { ...CONTOUR_COLORS } });

  if (state.showContext) {
    drawContextLayers(map, state.contextData, state.boundaryFc, grid);
  } else {
    clearLayers(map, "ctx-");
  }

  if (state.roadsEnabled && state.roadsFc) {
    drawRoads(map, state.roadsFc, grid);
  }

  setBasemapOpacity(map, state.mapView === "warp" ? 0.08 : 1);
}

// ── Events ─────────────────────────────────────────────────────────────────
function attachEvents() {
  // Map click → set origin
  map.on("click", async (e) => {
    if (el.settingsPanel.offsetParent !== null) return; // settings open, ignore
    const { lng, lat } = e.lngLat;
    let label = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (!useMockMode()) {
      try {
        const r = await nominatimReverse(lat, lng);
        label = r.results?.[0]?.formatted || label;
      } catch { /* ignore */ }
    }
    await setOrigin(lng, lat, label);
  });

  // Cursor hover → show travel time
  map.on("mousemove", (e) => {
    if (!state.isochrones) return;
    const { lng, lat } = e.lngLat;
    const t = lookupTimeFromIsochrones(state.isochrones, lng, lat);
    if (t != null) {
      el.timeVal.textContent = `~${Math.round(t)}`;
      el.timeReadout.hidden = false;
    } else if (state.origin) {
      el.timeVal.textContent = `>${state.maxMinutes}`;
      el.timeReadout.hidden = false;
    }
  });

  map.on("mouseleave", () => {
    if (state.origin) return; // keep readout if origin pinned
    el.timeReadout.hidden = true;
  });

  // Search
  let debounce;
  el.searchInput.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = el.searchInput.value.trim();
    if (!q) { hideSuggestions(); return; }
    debounce = setTimeout(() => doSearch(q), 280);
  });

  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideSuggestions();
  });

  document.addEventListener("click", (e) => {
    if (!el.suggestions.contains(e.target) && e.target !== el.searchInput) hideSuggestions();
  });

  // Settings panel toggle
  el.settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.settingsPanel.hidden = !el.settingsPanel.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!el.settingsPanel.contains(e.target) && e.target !== el.settingsBtn) {
      el.settingsPanel.hidden = true;
    }
  });

  // Mode / max-time change
  el.modeSelect.addEventListener("change", () => {
    state.mode = el.modeSelect.value;
    if (state.origin) setOrigin(state.origin.lon, state.origin.lat, state.origin.label);
  });
  el.maxTimeSelect.addEventListener("change", () => {
    state.maxMinutes = Number(el.maxTimeSelect.value);
    if (state.origin) setOrigin(state.origin.lon, state.origin.lat, state.origin.label);
  });

  // View toggle
  el.btnGeo.addEventListener("click", () => setMapView("geo"));
  el.btnWarp.addEventListener("click", () => setMapView("warp"));

  // Warp + context toggles inside settings
  el.warpToggle.addEventListener("change", () => {
    setMapView(el.warpToggle.checked ? "warp" : "geo");
  });
  el.contextToggle.addEventListener("change", () => {
    state.showContext = el.contextToggle.checked;
    renderAll();
    writeUrl();
  });
  el.roadsToggle.addEventListener("change", async () => {
    state.roadsEnabled = el.roadsToggle.checked;
    if (state.roadsEnabled && !state.roadsFc) {
      setNote("Loading roads from Overpass…");
      try {
        state.roadsFc = await fetchJakartaRoads();
        setNote(`${state.roadsFc.features.length} road segments loaded.`);
      } catch (err) {
        setNote(`Overpass error: ${err.message}`);
        el.roadsToggle.checked = false;
        state.roadsEnabled = false;
        return;
      }
    }
    renderAll();
    writeUrl();
  });

  // Share
  el.shareBtn.addEventListener("click", async () => {
    writeUrl();
    try {
      await navigator.clipboard.writeText(location.href);
      setNote("Share URL copied to clipboard.");
    } catch {
      setNote(location.href);
    }
  });
}

// ── Map view toggle ────────────────────────────────────────────────────────
function setMapView(mode) {
  state.mapView = mode;
  el.btnGeo.classList.toggle("is-active", mode === "geo");
  el.btnWarp.classList.toggle("is-active", mode === "warp");
  el.warpToggle.checked = mode === "warp";
  renderAll();
  writeUrl();
}

// ── Search ─────────────────────────────────────────────────────────────────
async function doSearch(query) {
  if (useMockMode()) {
    const anchors = [
      { formatted: "Monas, Jakarta Pusat", lat: -6.1754, lon: 106.8272 },
      { formatted: "Blok M, Jakarta Selatan", lat: -6.2443, lon: 106.7992 },
      { formatted: "Kelapa Gading, Jakarta Utara", lat: -6.1588, lon: 106.9088 },
      { formatted: "BSD City, Tangerang Selatan", lat: -6.3024, lon: 106.6527 },
      { formatted: "Bekasi", lat: -6.2383, lon: 106.9756 },
    ];
    showSuggestions(anchors.filter((a) => a.formatted.toLowerCase().includes(query.toLowerCase())));
    return;
  }
  try {
    const res = await nominatimSearch(query);
    showSuggestions((res.results || []).slice(0, 5));
  } catch (err) {
    setNote(err.message);
  }
}

function showSuggestions(results) {
  el.suggestions.innerHTML = "";
  if (!results.length) { hideSuggestions(); return; }
  results.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "suggestion-item";
    btn.textContent = r.formatted;
    btn.addEventListener("click", () => {
      hideSuggestions();
      el.searchInput.value = r.formatted;
      setOrigin(r.lon, r.lat, r.formatted);
    });
    el.suggestions.appendChild(btn);
  });
  el.suggestions.hidden = false;
}

function hideSuggestions() { el.suggestions.hidden = true; }

// ── Loading spinner ────────────────────────────────────────────────────────
function showLoading() {
  if (spinner) return;
  spinner = document.createElement("div");
  spinner.className = "loading-ring";
  document.getElementById("app").appendChild(spinner);
}

function hideLoading() {
  spinner?.remove();
  spinner = null;
}

// ── Context data ───────────────────────────────────────────────────────────
async function loadContextAssets() {
  try {
    const r = await fetch("/data/jakarta_open_layers.json");
    if (r.ok) state.contextData = await r.json();
  } catch { /* offline */ }
  try {
    const r = await fetch("/data/context/jabodetabek_boundary.geojson");
    if (r.ok) state.boundaryFc = await r.json();
  } catch { /* offline */ }
}

// ── Share URL ──────────────────────────────────────────────────────────────
function writeUrl() {
  const p = {
    v: state.mapView,
    m: state.mode,
    t: state.maxMinutes,
    c: state.showContext ? 1 : 0,
    ...(state.origin && { lat: state.origin.lat.toFixed(5), lon: state.origin.lon.toFixed(5) }),
  };
  history.replaceState(null, "", `?${new URLSearchParams(p)}`);
}

function restoreFromUrl() {
  const p = new URLSearchParams(location.search);
  if (!p.get("lat") || !p.get("lon")) return false;
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  if (p.get("m")) { state.mode = p.get("m"); el.modeSelect.value = state.mode; }
  if (p.get("t")) { state.maxMinutes = Number(p.get("t")); el.maxTimeSelect.value = String(state.maxMinutes); }
  if (p.get("c")) { state.showContext = p.get("c") === "1"; el.contextToggle.checked = state.showContext; }
  const view = p.get("v") || "geo";
  setMapView(view);
  setOrigin(lon, lat, `${lat.toFixed(4)}, ${lon.toFixed(4)}`, { pushUrl: false });
  return true;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function hideHint() { el.hint.classList.add("hidden"); }
function setNote(msg) { el.settingsNote.textContent = msg; }
