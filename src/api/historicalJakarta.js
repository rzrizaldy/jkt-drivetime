import { JABODETABEK_BBOX } from "../config.js";

const COLS = 54;
const ROWS = 54;
const DEFAULT_PEAK_SPEED_KPH = 25.66;
const ROAD_CIRCUITY_CENTER = 1.48;
const ROAD_CIRCUITY_OUTER = 1.27;
const JAKARTA_CENTER = { lat: -6.2088, lon: 106.8456 };

/**
 * Build a factual, non-live Jakarta travel-time surface from open-data context.
 * It is not turn-by-turn routing. It combines real geography, real corridor
 * speed observations, and a road-network circuity factor suitable for v1 maps.
 *
 * @param {{ lat:number, lon:number }} origin
 * @param {{ speed_corridors?: Array<{ speed_kph?: number, path?: number[][] }> }} contextData
 * @param {{ mode?: string }} opts
 * @returns {import("../map/cartogram.js").TravelGrid & { source:string, observedSpeedKph:number }}
 */
export function buildHistoricalJakartaGrid(origin, contextData = {}, opts = {}) {
  const [west, south, east, north] = JABODETABEK_BBOX;
  const corridors = normaliseCorridors(contextData.speed_corridors || []);
  const observedSpeedKph = observedCorridorSpeed(corridors) || DEFAULT_PEAK_SPEED_KPH;
  const modeFactor = modeSpeedFactor(opts.mode || "drive");
  const times = [];

  for (let j = 0; j < ROWS; j += 1) {
    const lat = south + (j / Math.max(1, ROWS - 1)) * (north - south);
    for (let i = 0; i < COLS; i += 1) {
      const lon = west + (i / Math.max(1, COLS - 1)) * (east - west);
      const km = haversineKm(origin.lat, origin.lon, lat, lon);
      const speed = localSpeedKph(lat, lon, corridors, observedSpeedKph) * modeFactor;
      const circuity = roadCircuity(origin, { lat, lon });
      const seconds = Math.round((km * circuity / Math.max(5, speed)) * 3600);
      times.push(seconds);
    }
  }

  return {
    west,
    south,
    east,
    north,
    cols: COLS,
    rows: ROWS,
    times,
    origin,
    source: "jakarta-historical-speed-v1",
    observedSpeedKph,
  };
}

export function observedCorridorSpeed(corridors) {
  const speeds = corridors.map((c) => c.speedKph).filter((n) => Number.isFinite(n) && n > 0);
  if (!speeds.length) return null;
  return speeds.reduce((sum, n) => sum + n, 0) / speeds.length;
}

function normaliseCorridors(rows) {
  return rows
    .map((row) => ({
      speedKph: Number(row.speed_kph),
      path: (row.path || [])
        .map(([lat, lon]) => ({ lat: Number(lat), lon: Number(lon) }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
    }))
    .filter((row) => row.path.length >= 2 && Number.isFinite(row.speedKph));
}

function localSpeedKph(lat, lon, corridors, fallbackSpeed) {
  if (!corridors.length) return fallbackSpeed;
  let weighted = 0;
  let weights = 0;
  for (const corridor of corridors) {
    const d = distanceToPathKm({ lat, lon }, corridor.path);
    const weight = 1 / Math.max(0.35, d) ** 2;
    weighted += corridor.speedKph * weight;
    weights += weight;
  }
  const corridorSpeed = weights ? weighted / weights : fallbackSpeed;
  const centralPenalty = Math.max(0, 1 - haversineKm(lat, lon, JAKARTA_CENTER.lat, JAKARTA_CENTER.lon) / 22);
  return clamp(corridorSpeed * (1 - centralPenalty * 0.12), 12, 42);
}

function roadCircuity(origin, target) {
  const centrality = Math.max(0, 1 - haversineKm(target.lat, target.lon, JAKARTA_CENTER.lat, JAKARTA_CENTER.lon) / 36);
  const radialKm = haversineKm(origin.lat, origin.lon, target.lat, target.lon);
  const crossMetroPenalty = radialKm > 18 ? 0.08 : 0;
  return ROAD_CIRCUITY_OUTER + (ROAD_CIRCUITY_CENTER - ROAD_CIRCUITY_OUTER) * centrality + crossMetroPenalty;
}

function modeSpeedFactor(mode) {
  if (mode === "motorcycle") return 1.18;
  if (mode === "bicycle") return 0.62;
  if (mode === "walk") return 0.18;
  return 1;
}

function distanceToPathKm(point, path) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i += 1) {
    best = Math.min(best, distanceToSegmentKm(point, path[i], path[i + 1]));
  }
  return best;
}

function distanceToSegmentKm(p, a, b) {
  const x = (p.lon - a.lon) * Math.cos((p.lat * Math.PI) / 180) * 111.32;
  const y = (p.lat - a.lat) * 110.57;
  const x2 = (b.lon - a.lon) * Math.cos((p.lat * Math.PI) / 180) * 111.32;
  const y2 = (b.lat - a.lat) * 110.57;
  const len2 = x2 * x2 + y2 * y2;
  const t = len2 ? clamp((x * x2 + y * y2) / len2, 0, 1) : 0;
  const dx = x - x2 * t;
  const dy = y - y2 * t;
  return Math.sqrt(dx * dx + dy * dy);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
