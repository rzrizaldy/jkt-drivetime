/**
 * Build a TravelGrid from OSRM Table API.
 * Samples a dense rectangular grid over the Jabodetabek bbox,
 * queries driving times in one batch, returns a TravelGrid
 * compatible with the heatmap renderer and warp transforms.
 */

import { JABODETABEK_BBOX } from "../config.js";
import { getGrid, setGrid } from "../cache.js";
import { osrmTable } from "./osrm.js";

const COLS = 10;
const ROWS = 10;
const MAX_BATCH = 490;

/** @typedef {{ west:number, south:number, east:number, north:number, cols:number, rows:number, times:(number|null)[], origin:{lat:number,lon:number} }} TravelGrid */

/**
 * Build a TravelGrid from OSRM, with L1+L2 cache.
 * Subsequent calls for the same origin (~500 m snap) return instantly.
 *
 * @param {{ lat:number, lon:number }} origin
 * @param {readonly [number,number,number,number]} [bbox]
 * @param {number} [cols]
 * @param {number} [rows]
 * @returns {Promise<TravelGrid>}
 */
export async function buildOsrmGrid(origin, bbox = JABODETABEK_BBOX, cols = COLS, rows = ROWS) {
  // ── Cache hit ────────────────────────────────────────────────────────────
  const cached = getGrid(origin.lat, origin.lon);
  if (cached) return cached;

  // ── Cache miss: fetch from OSRM ──────────────────────────────────────────
  const [west, south, east, north] = bbox;
  const targets = [];
  for (let j = 0; j < rows; j++) {
    const lat = south + (j / Math.max(1, rows - 1)) * (north - south);
    for (let i = 0; i < cols; i++) {
      const lon = west + (i / Math.max(1, cols - 1)) * (east - west);
      targets.push({ lat, lon });
    }
  }

  let times;
  if (targets.length <= MAX_BATCH) {
    times = await osrmTable(origin, targets);
  } else {
    times = [];
    for (let start = 0; start < targets.length; start += MAX_BATCH) {
      const batch = targets.slice(start, start + MAX_BATCH);
      times.push(...await osrmTable(origin, batch));
    }
  }

  const grid = { west, south, east, north, cols, rows, times, origin };

  // ── Persist ──────────────────────────────────────────────────────────────
  setGrid(origin.lat, origin.lon, grid);
  return grid;
}
