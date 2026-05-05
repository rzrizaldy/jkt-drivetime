import maplibregl from "maplibre-gl";
import { JAKARTA_CENTER, JABODETABEK_BBOX } from "../config.js";
import { transformGeoJSON } from "./cartogram.js";

export function createMap(container) {
  const [w, s, e, n] = JABODETABEK_BBOX;
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        basemap: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [
        { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 1 } },
      ],
    },
    center: [...JAKARTA_CENTER],
    zoom: 9.5,
    maxBounds: [[w - 0.4, s - 0.4], [e + 0.4, n + 0.4]],
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  map.on("load", () => {
    // Route layer
    map.addSource("route", { type: "geojson", data: empty() });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: { "line-color": "#fff", "line-width": 3, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
    });

    // Origin marker layer (circle)
    map.addSource("origin", { type: "geojson", data: empty() });
    map.addLayer({
      id: "origin-ring",
      type: "circle",
      source: "origin",
      paint: {
        "circle-radius": 12,
        "circle-color": "transparent",
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 3,
      },
    });
    map.addLayer({
      id: "origin-dot",
      type: "circle",
      source: "origin",
      paint: { "circle-radius": 5, "circle-color": "#fff" },
    });
  });

  return map;
}

/** @param {maplibregl.Map} map @param {number} opacity */
export function setBasemapOpacity(map, opacity, duration = 600) {
  if (map.getLayer("basemap")) {
    map.setPaintProperty("basemap", "raster-opacity", opacity, { duration });
  }
}

/** @param {maplibregl.Map} map @param {GeoJSON.FeatureCollection|GeoJSON.Geometry|null} data */
export function setRouteData(map, data) {
  const src = map.getSource("route");
  if (src) src.setData(data ?? empty());
}

/** @param {maplibregl.Map} map @param {{ lon:number, lat:number }|null} pt */
export function setOriginMarker(map, pt) {
  const src = map.getSource("origin");
  if (!src) return;
  src.setData(
    pt
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [pt.lon, pt.lat] } }] }
      : empty()
  );
}

/**
 * Redraw all isochrone layers. Replaces previous iso-* sources/layers.
 * @param {maplibregl.Map} map
 * @param {GeoJSON.FeatureCollection|null} isochrones - Valhalla GeoJSON (features sorted smallest→largest)
 * @param {import('./cartogram.js').TravelGrid|null} warpGrid - if set, transform geometry
 * @param {{ colors: Record<number,string> }} opts
 */
export function drawIsochroneLayers(map, isochrones, warpGrid, opts = {}) {
  clearLayers(map, "iso-");
  if (!isochrones) return;

  const { colors = {} } = opts;
  const sortedDesc = [...(isochrones.features || [])].sort((a, b) => {
    const ta = a.properties?.contour ?? 0;
    const tb = b.properties?.contour ?? 0;
    return tb - ta; // largest first → drawn underneath
  });

  sortedDesc.forEach((feat) => {
    const minutes = feat.properties?.contour ?? 0;
    const color = colors[minutes] ?? "#6366f1";
    const sid = `iso-${minutes}`;
    const geom = warpGrid
      ? transform({ type: "FeatureCollection", features: [feat] }, warpGrid)
      : { type: "FeatureCollection", features: [feat] };

    upsertSource(map, sid, geom);
    upsertFill(map, `${sid}-fill`, sid, { "fill-color": color, "fill-opacity": 0.42 });
    upsertLine(map, `${sid}-line`, sid, { "line-color": color, "line-width": 1.5, "line-opacity": 0.75 });
  });
}

/**
 * Draw context layers (speed corridors, congestion, labels).
 */
export function drawContextLayers(map, contextData, boundaryFc, warpGrid) {
  clearLayers(map, "ctx-");
  if (!contextData) return;

  const maybe = (fc) => (warpGrid ? transform(fc, warpGrid) : fc);

  const lineFc = {
    type: "FeatureCollection",
    features: (contextData.speed_corridors || []).map((c) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: c.path.map(([la, lo]) => [lo, la]) },
    })),
  };
  upsertSource(map, "ctx-speed", maybe(lineFc));
  upsertLine(map, "ctx-speed-line", "ctx-speed", { "line-color": "#38bdf8", "line-width": 3, "line-opacity": 0.55 });

  const congFc = {
    type: "FeatureCollection",
    features: (contextData.congestion_points || []).map((p) => ({
      type: "Feature",
      properties: { name: p.name },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
  };
  upsertSource(map, "ctx-cong", maybe(congFc));
  if (!map.getLayer("ctx-cong-dot")) {
    map.addLayer({ id: "ctx-cong-dot", type: "circle", source: "ctx-cong", paint: { "circle-radius": 5, "circle-color": "#f97316", "circle-stroke-color": "#0f172a", "circle-stroke-width": 1 } });
  }

  if (boundaryFc) {
    upsertSource(map, "ctx-boundary", maybe(structuredClone(boundaryFc)));
    upsertLine(map, "ctx-boundary-line", "ctx-boundary", { "line-color": "#94a3b8", "line-width": 1.5, "line-dasharray": [3, 2], "line-opacity": 0.5 });
  }

  const labelFc = {
    type: "FeatureCollection",
    features: (contextData.city_labels || []).map((c) => ({
      type: "Feature",
      properties: { name: c.name },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
  upsertSource(map, "ctx-labels", maybe(labelFc));
  if (!map.getLayer("ctx-labels-sym")) {
    map.addLayer({
      id: "ctx-labels-sym",
      type: "symbol",
      source: "ctx-labels",
      layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 0.6], "text-anchor": "top" },
      paint: { "text-color": "#e2e8f0", "text-halo-color": "#0f172a", "text-halo-width": 1.5 },
    });
  }
}

/** Draw Overpass road data in warp view. */
export function drawRoads(map, roadsFc, warpGrid) {
  clearLayers(map, "roads-");
  if (!roadsFc?.features?.length) return;
  const geom = warpGrid ? transform(roadsFc, warpGrid) : roadsFc;
  upsertSource(map, "roads-main", geom);
  upsertLine(map, "roads-line", "roads-main", { "line-color": "#334155", "line-width": ["match", ["get", "highway"], "motorway", 2.5, "trunk", 2, 1], "line-opacity": 0.65 });
}

// ── helpers ────────────────────────────────────────────────────────────────

function empty() {
  return { type: "FeatureCollection", features: [] };
}

function transform(fc, grid) {
  return transformGeoJSON(structuredClone(fc), grid);
}

function upsertSource(map, id, data) {
  if (map.getSource(id)) map.getSource(id).setData(data);
  else map.addSource(id, { type: "geojson", data });
}

function upsertFill(map, id, source, paint) {
  if (!map.getLayer(id)) map.addLayer({ id, type: "fill", source, paint });
  else { map.setPaintProperty(id, "fill-color", paint["fill-color"]); map.setPaintProperty(id, "fill-opacity", paint["fill-opacity"]); }
}

function upsertLine(map, id, source, paint) {
  if (!map.getLayer(id)) map.addLayer({ id, type: "line", source, paint });
}

export function clearLayers(map, prefix) {
  const style = map.getStyle();
  if (!style?.layers) return;
  style.layers
    .map((l) => l.id)
    .filter((id) => id.startsWith(prefix))
    .forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
  Object.keys(style.sources || {})
    .filter((s) => s.startsWith(prefix))
    .forEach((s) => { if (map.getSource(s)) map.removeSource(s); });
}
