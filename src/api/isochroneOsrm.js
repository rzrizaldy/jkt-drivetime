/**
 * Build a TravelGrid from OSRM Table API.
 * Samples a dense rectangular grid over the Jabodetabek bbox,
 * queries driving times in one batch, returns a TravelGrid
 * compatible with the heatmap renderer and warp transforms.
 */

import { JABODETABEK_BBOX } from "../config.js";
import { osrmTable } from "./osrm.js";

const COLS = 10;
const ROWS = 10;
const MAX_BATCH = 490; // OSRM public server hard limit

/** @typedef {{ west:number, south:number, east:number, north:number, cols:number, rows:number, times:(number|null)[], origin:{lat:number,lon:number} }} TravelGrid */

/**
 * @param {{ lat:number, lon:number }} origin
 * @param {readonly [number,number,number,number]} [bbox]
 * @param {number} [cols]
 * @param {number} [rows]
 * @returns {Promise<TravelGrid>}
 */
export async function buildOsrmGrid(origin, bbox = JABODETABEK_BBOX, cols = COLS, rows = ROWS) {
  const [west, south, east, north] = bbox;

  // Build targets
  const targets = [];
  for (let j = 0; j < rows; j++) {
    const lat = south + (j / Math.max(1, rows - 1)) * (north - south);
    for (let i = 0; i < cols; i++) {
      const lon = west + (i / Math.max(1, cols - 1)) * (east - west);
      targets.push({ lat, lon });
    }
  }

  // Batch requests if needed
  let times;
  if (targets.length <= MAX_BATCH) {
    times = await osrmTable(origin, targets);
  } else {
    times = [];
    for (let start = 0; start < targets.length; start += MAX_BATCH) {
      const batch = targets.slice(start, start + MAX_BATCH);
      const batchTimes = await osrmTable(origin, batch);
      times.push(...batchTimes);
    }
  }

  return { west, south, east, north, cols, rows, times, origin };
}
