import { booleanPointInPolygon, bearing, destination, point } from "@turf/turf";

import { JABODETABEK_BBOX } from "../config.js";

/** @typedef {{ west:number, south:number, east:number, north:number, cols:number, rows:number, times:(number|null)[], origin:{lat:number,lon:number} }} TravelGrid */

/** Sort isochrone features by contour value ascending (smallest time first). */
function sortAsc(features) {
  return [...features].sort((a, b) => {
    const ta = a.properties?.contour ?? a.properties?.value ?? 0;
    const tb = b.properties?.contour ?? b.properties?.value ?? 0;
    return ta - tb;
  });
}

/**
 * @param {GeoJSON.FeatureCollection} isochrones
 * @param {number} lng
 * @param {number} lat
 * @returns {number|null} minutes, or null if outside all rings
 */
export function lookupTimeFromIsochrones(isochrones, lng, lat) {
  const features = sortAsc(isochrones.features || []);
  const p = point([lng, lat]);
  for (const feat of features) {
    try {
      if (booleanPointInPolygon(p, feat)) {
        const t = feat.properties?.contour ?? feat.properties?.value;
        return t != null ? Number(t) : null;
      }
    } catch {
      // malformed polygon — skip
    }
  }
  return null;
}

/**
 * Build a travel-time grid from isochrone polygons (no matrix API calls needed).
 * @param {GeoJSON.FeatureCollection} isochrones
 * @param {{ lat:number, lon:number }} origin
 * @param {readonly [number,number,number,number]} bbox4326 [west,south,east,north]
 * @param {number} cols
 * @param {number} rows
 * @param {number} maxMinutes
 * @returns {TravelGrid}
 */
export function buildTravelGridFromIsochrones(
  isochrones,
  origin,
  bbox4326 = JABODETABEK_BBOX,
  cols = 38,
  rows = 38,
  maxMinutes = 60
) {
  const features = sortAsc(isochrones.features || []);
  const [west, south, east, north] = bbox4326;
  const times = [];

  for (let j = 0; j < rows; j += 1) {
    const lat = south + (j / Math.max(1, rows - 1)) * (north - south);
    for (let i = 0; i < cols; i += 1) {
      const lng = west + (i / Math.max(1, cols - 1)) * (east - west);
      const p = point([lng, lat]);
      let t = null;
      for (const feat of features) {
        try {
          if (booleanPointInPolygon(p, feat)) {
            const v = feat.properties?.contour ?? feat.properties?.value;
            t = v != null ? Number(v) * 60 : null;
            break;
          }
        } catch {
          // skip
        }
      }
      times.push(t ?? maxMinutes * 60 * 1.4);
    }
  }

  return { west, south, east, north, cols, rows, times, origin };
}

/**
 * @param {TravelGrid} grid
 * @param {number} lng
 * @param {number} lat
 * @returns {number|null} seconds
 */
export function sampleTimeSeconds(grid, lng, lat) {
  const { west, south, east, north, cols, rows, times } = grid;
  if (lng < west || lng > east || lat < south || lat > north) return null;
  const fx = ((lng - west) / (east - west)) * (cols - 1);
  const fy = ((lat - south) / (north - south)) * (rows - 1);
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const i1 = Math.min(cols - 1, i0 + 1);
  const j1 = Math.min(rows - 1, j0 + 1);
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (i, j) => times[i + j * cols] ?? null;
  const interp = (x, y, v00, v10, v01, v11) => {
    const vals = [v00, v10, v01, v11].filter((v) => v != null);
    if (!vals.length) return null;
    const fill = vals.reduce((s, n) => s + n, 0) / vals.length;
    const a = (v00 ?? fill) * (1 - x) + (v10 ?? fill) * x;
    const b = (v01 ?? fill) * (1 - x) + (v11 ?? fill) * x;
    return a * (1 - y) + b * y;
  };
  return interp(tx, ty, at(i0, j0), at(i1, j0), at(i0, j1), at(i1, j1));
}

/**
 * Radial time warp: displace [lng, lat] along bearing from origin by travel_minutes * scaleKm.
 */
export function warpLngLat(originLon, originLat, lng, lat, timeSeconds, scaleKmPerMinute = 0.44) {
  const o = point([originLon, originLat]);
  const p = point([lng, lat]);
  const brg = bearing(o, p);
  const km = Math.max(0, timeSeconds / 60) * scaleKmPerMinute;
  return destination(o, km, brg, { units: "kilometers" }).geometry.coordinates;
}

/**
 * Transform every coordinate in a GeoJSON object using the travel grid.
 */
export function transformGeoJSON(input, grid, scaleKmPerMinute = 0.44) {
  const valid = grid.times.filter((t) => t != null);
  const maxT = valid.length ? Math.max(...valid) : 3600;

  const warp = ([lng, lat]) => {
    let t = sampleTimeSeconds(grid, lng, lat);
    if (t == null) t = maxT;
    return warpLngLat(grid.origin.lon, grid.origin.lat, lng, lat, t, scaleKmPerMinute);
  };

  const walk = (geom) => {
    if (!geom) return;
    if (geom.type === "Point") geom.coordinates = warp(geom.coordinates);
    else if (geom.type === "LineString" || geom.type === "MultiPoint")
      geom.coordinates = geom.coordinates.map(warp);
    else if (geom.type === "Polygon" || geom.type === "MultiLineString")
      geom.coordinates = geom.coordinates.map((ring) => ring.map(warp));
    else if (geom.type === "MultiPolygon")
      geom.coordinates = geom.coordinates.map((poly) => poly.map((ring) => ring.map(warp)));
  };

  const clone = structuredClone(input);
  if (clone.type === "FeatureCollection") clone.features.forEach((f) => walk(f.geometry));
  else if (clone.type === "Feature") walk(clone.geometry);
  else walk(clone);
  return clone;
}

/** Keep legacy matrix parsing for tests compatibility. */
export function parseMatrixTimes(data, numTargets) {
  const out = Array.from({ length: numTargets }, () => null);
  const raw = data.sources_to_targets ?? data.sourcesToTargets;
  if (!raw) return out;
  const flat = Array.isArray(raw[0]) ? raw.flat() : raw;
  for (const cell of flat) {
    if (!cell || typeof cell !== "object") continue;
    const from = cell.from_index ?? 0;
    const to = cell.to_index ?? cell.toIndex;
    if (from !== 0 || to == null) continue;
    const t = cell.time;
    if (typeof t === "number" && t >= 0) out[to] = t;
  }
  return out;
}

export function sampleGridPoints(bbox4326, cols, rows) {
  const [west, south, east, north] = bbox4326;
  const pts = [];
  for (let j = 0; j < rows; j += 1) {
    const lat = south + (j / Math.max(1, rows - 1)) * (north - south);
    for (let i = 0; i < cols; i += 1) {
      pts.push({ lat, lon: west + (i / Math.max(1, cols - 1)) * (east - west), i, j });
    }
  }
  return pts;
}
