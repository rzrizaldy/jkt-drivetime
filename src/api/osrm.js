/**
 * OSRM public demo API client.
 * Base URL: https://router.project-osrm.org
 * Global OSM coverage, no key needed.
 */

const BASE    = "https://router.project-osrm.org";
const PROFILE = "driving";
const TIMEOUT_MS = 30_000;  // 30 s per request — fail fast rather than hang

/** @typedef {{ lat:number, lon:number }} LatLon */

function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

/**
 * Compute driving times from a single origin to many target points.
 * Returns an object with the raw OSRM response so callers can read `sources`.
 *
 * @param {LatLon} origin
 * @param {LatLon[]} targets
 * @returns {Promise<{ durations: (number|null)[], sources: {location:[number,number]}[] }>}
 */
export async function osrmTable(origin, targets) {
  const all    = [origin, ...targets];
  const coords = all.map((p) => `${p.lon},${p.lat}`).join(";");
  const url    = `${BASE}/table/v1/${PROFILE}/${coords}?sources=0&annotations=duration`;

  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("OSRM request timed out (30 s). Try a closer origin.");
    throw err;
  }
  if (!res.ok) throw new Error(`OSRM table HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== "Ok") throw new Error(`OSRM: ${json.code} ${json.message ?? ""}`);

  const row   = json.durations?.[0] ?? [];
  const durations = targets.map((_, i) => {
    const t = row[i + 1];
    return typeof t === "number" && t >= 0 ? t : null;
  });

  // sources[0] is the OSRM-snapped location of the origin
  const rawSrc = json.sources?.[0];
  const sources = rawSrc
    ? [{ lat: rawSrc.location[1], lon: rawSrc.location[0] }]
    : [origin];

  return { durations, sources };
}

/**
 * Driving route between two points.
 * @param {LatLon} from
 * @param {LatLon} to
 * @returns {Promise<{ seconds:number, meters:number, geometry:GeoJSON.LineString|null }>}
 */
export async function osrmRoute(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url    = `${BASE}/route/v1/${PROFILE}/${coords}?overview=full&geometries=geojson`;

  let res;
  try {
    res = await fetchWithTimeout(url, 20_000);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("OSRM route timed out.");
    throw err;
  }
  if (!res.ok) throw new Error(`OSRM route HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== "Ok") throw new Error(`OSRM: ${json.code}`);
  const route = json.routes?.[0];
  return {
    seconds:  Number(route?.duration ?? 0),
    meters:   Number(route?.distance ?? 0),
    geometry: route?.geometry ?? null,
  };
}
