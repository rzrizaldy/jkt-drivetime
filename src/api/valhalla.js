import { CONTOUR_MINUTES, modeToCosting, useMockMode } from "../config.js";

const BASE = "/api/valhalla";

async function post(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Valhalla ${res.status} ${endpoint}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * @param {{ lat: number, lon: number, mode: string, maxMinutes: number }} opts
 * @returns {Promise<GeoJSON.FeatureCollection>}
 */
export async function fetchIsochrones({ lat, lon, mode, maxMinutes = 60 }) {
  if (useMockMode()) {
    const { mockIsochrones } = await import("../mockValhalla.js");
    return mockIsochrones({ lat, lon, maxMinutes });
  }
  const contours = CONTOUR_MINUTES.filter((m) => m <= maxMinutes);
  if (!contours.includes(maxMinutes)) contours.push(maxMinutes);
  return post("/isochrone", {
    locations: [{ lat, lon }],
    costing: modeToCosting(mode),
    contours: contours.map((time) => ({ time })),
    polygons: true,
    denoise: 0.5,
    generalize: 250,
  });
}

/**
 * @param {{ from: { lat: number, lon: number }, to: { lat: number, lon: number }, mode: string }} opts
 */
export async function fetchRoute({ from, to, mode }) {
  if (useMockMode()) {
    const { mockRoute } = await import("../mockValhalla.js");
    return mockRoute({ from, to });
  }
  return post("/route", {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: modeToCosting(mode),
    units: "kilometers",
  });
}

/** Extract seconds + meters + LineString geometry from Valhalla route or mock response. */
export async function extractRoute(routeJson) {
  const trip = routeJson?.trip;
  const leg = trip?.legs?.[0];
  if (leg) {
    const seconds = Number(trip?.summary?.time ?? leg.summary?.time ?? 0);
    const meters = Number((trip?.summary?.length ?? leg.summary?.length ?? 0)) * 1000;
    let geometry = null;
    if (leg.shape && typeof leg.shape === "string") {
      const { decode } = await import("@mapbox/polyline");
      const pts = decode(leg.shape, 6);
      geometry = { type: "LineString", coordinates: pts.map(([a, b]) => [b, a]) };
    }
    return { seconds, meters, geometry };
  }
  const feat = routeJson?.features?.[0];
  if (feat) {
    const p = feat.properties || {};
    return { seconds: Number(p.time ?? 0), meters: Number(p.distance ?? 0), geometry: feat.geometry ?? null };
  }
  return { seconds: 0, meters: 0, geometry: null };
}
