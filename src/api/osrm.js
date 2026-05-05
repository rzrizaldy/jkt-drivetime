/**
 * OSRM public demo API client.
 * Base URL: https://router.project-osrm.org
 * Global OSM coverage, no key needed.
 */

const BASE = "https://router.project-osrm.org";
const PROFILE = "driving";

/** @typedef {{ lat:number, lon:number }} LatLon */

/**
 * Compute driving times from a single origin to many target points.
 * OSRM Table API supports up to ~500 coordinates per request.
 *
 * @param {LatLon} origin
 * @param {LatLon[]} targets
 * @returns {Promise<(number|null)[]>} seconds or null for unreachable
 */
export async function osrmTable(origin, targets) {
  const coords = [origin, ...targets].map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${BASE}/table/v1/${PROFILE}/${coords}?sources=0&annotations=duration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM table ${res.status}`);
  const json = await res.json();
  if (json.code !== "Ok") throw new Error(`OSRM: ${json.code} ${json.message || ""}`);
  const row = json.durations?.[0] ?? [];
  // row[0] = 0 (self), row[1..] = target times
  return targets.map((_, i) => {
    const t = row[i + 1];
    return typeof t === "number" && t >= 0 ? t : null;
  });
}

/**
 * Driving route between two points.
 * @param {LatLon} from
 * @param {LatLon} to
 * @returns {Promise<{ seconds:number, meters:number, geometry:GeoJSON.LineString|null }>}
 */
export async function osrmRoute(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${BASE}/route/v1/${PROFILE}/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM route ${res.status}`);
  const json = await res.json();
  if (json.code !== "Ok") throw new Error(`OSRM: ${json.code}`);
  const route = json.routes?.[0];
  return {
    seconds: Number(route?.duration ?? 0),
    meters:  Number(route?.distance ?? 0),
    geometry: route?.geometry ?? null,
  };
}
