import { booleanPointInPolygon, bearing, destination, point } from "@turf/turf";

import { JABODETABEK_BBOX } from "../config.js";

const MESH_INFLUENCE_RADIUS = 8;
const MESH_SIGMA_CELLS = 3.4;
const MESH_DISPLACEMENT_SCALE = 1.0;
const MESH_MAX_SHIFT_CELLS = 5.2;
const MESH_SMOOTHING_PASSES = 3;
const MESH_EDGE_FADE_CELLS = 8;

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

export function buildMeshWarp(grid, maxMinutes = 60) {
  const { west, south, east, north, cols, rows, times } = grid;
  const cellW = (east - west) / Math.max(1, cols - 1);
  const cellH = (north - south) / Math.max(1, rows - 1);
  const minuteGrid = Array.from({ length: rows }, () => new Array(cols).fill(maxMinutes * 1.4));
  const validMask = Array.from({ length: rows }, () => new Array(cols).fill(false));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const seconds = times[col + row * cols];
      if (Number.isFinite(seconds)) {
        minuteGrid[row][col] = seconds / 60;
        validMask[row][col] = true;
      }
    }
  }

  let smoothedMinutes = minuteGrid.map((row) => row.slice());
  for (let pass = 0; pass < 2; pass += 1) {
    const next = smoothedMinutes.map((row) => row.slice());
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (!validMask[row][col]) continue;
        let total = 0;
        let count = 0;
        for (let y = Math.max(0, row - 2); y <= Math.min(rows - 1, row + 2); y += 1) {
          for (let x = Math.max(0, col - 2); x <= Math.min(cols - 1, col + 2); x += 1) {
            if (!validMask[y][x]) continue;
            total += smoothedMinutes[y][x];
            count += 1;
          }
        }
        next[row][col] = count ? total / count : smoothedMinutes[row][col];
      }
    }
    smoothedMinutes = next;
  }

  const anomalyGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!validMask[row][col]) continue;
      const t = clamp(smoothedMinutes[row][col] / maxMinutes, 0, 1);
      anomalyGrid[row][col] = (1 + (1 - t) * 1.67) - 1;
    }
  }

  const warpNodes = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const sigmaSq = MESH_SIGMA_CELLS * MESH_SIGMA_CELLS;
  const maxShiftX = cellW * MESH_MAX_SHIFT_CELLS;
  const maxShiftY = cellH * MESH_MAX_SHIFT_CELLS;

  for (let nodeRow = 0; nodeRow < rows; nodeRow += 1) {
    for (let nodeCol = 0; nodeCol < cols; nodeCol += 1) {
      const baseX = west + nodeCol * cellW;
      const baseY = south + nodeRow * cellH;
      let offsetX = 0;
      let offsetY = 0;
      const rowStart = Math.max(0, nodeRow - MESH_INFLUENCE_RADIUS);
      const rowEnd = Math.min(rows - 1, nodeRow + MESH_INFLUENCE_RADIUS);
      const colStart = Math.max(0, nodeCol - MESH_INFLUENCE_RADIUS);
      const colEnd = Math.min(cols - 1, nodeCol + MESH_INFLUENCE_RADIUS);
      for (let row = rowStart; row <= rowEnd; row += 1) {
        for (let col = colStart; col <= colEnd; col += 1) {
          if (!validMask[row][col]) continue;
          const anomaly = anomalyGrid[row][col];
          if (Math.abs(anomaly) < 1e-6) continue;
          const centerX = west + col * cellW;
          const centerY = south + row * cellH;
          const dxCells = (baseX - centerX) / cellW;
          const dyCells = (baseY - centerY) / cellH;
          const distSqCells = dxCells * dxCells + dyCells * dyCells;
          const distCells = Math.sqrt(distSqCells + 1e-9);
          const gaussian = Math.exp(-distSqCells / (2 * sigmaSq));
          const strength = anomaly * gaussian * MESH_DISPLACEMENT_SCALE;
          offsetX += (dxCells / distCells) * strength * cellW;
          offsetY += (dyCells / distCells) * strength * cellH;
        }
      }
      offsetX = clamp(offsetX, -maxShiftX, maxShiftX);
      offsetY = clamp(offsetY, -maxShiftY, maxShiftY);
      const edgeDistance = Math.min(nodeCol, cols - 1 - nodeCol, nodeRow, rows - 1 - nodeRow);
      const edgeFade = smoothstep(0, MESH_EDGE_FADE_CELLS, edgeDistance);
      warpNodes[nodeRow][nodeCol] = [baseX + offsetX * edgeFade, baseY + offsetY * edgeFade];
    }
  }

  for (let pass = 0; pass < MESH_SMOOTHING_PASSES; pass += 1) {
    const next = warpNodes.map((row) => row.map((node) => node.slice()));
    for (let row = 1; row < rows - 1; row += 1) {
      for (let col = 1; col < cols - 1; col += 1) {
        let totalX = 0;
        let totalY = 0;
        let count = 0;
        for (let y = row - 1; y <= row + 1; y += 1) {
          for (let x = col - 1; x <= col + 1; x += 1) {
            totalX += warpNodes[y][x][0];
            totalY += warpNodes[y][x][1];
            count += 1;
          }
        }
        const edgeDistance = Math.min(col, cols - 1 - col, row, rows - 1 - row);
        const edgeFade = smoothstep(0, MESH_EDGE_FADE_CELLS, edgeDistance);
        next[row][col] = [
          lerp(west + col * cellW, totalX / count, 0.72 * edgeFade),
          lerp(south + row * cellH, totalY / count, 0.72 * edgeFade),
        ];
      }
    }
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) warpNodes[row][col] = next[row][col];
    }
  }

  function warpPoint(coord) {
    const [lng, lat] = coord;
    const rawCol = clamp((lng - west) / cellW, 0, cols - 1.000001);
    const rawRow = clamp((lat - south) / cellH, 0, rows - 1.000001);
    const col = clamp(Math.floor(rawCol), 0, cols - 2);
    const row = clamp(Math.floor(rawRow), 0, rows - 2);
    return bilerpPoint(
      warpNodes[row][col],
      warpNodes[row][col + 1],
      warpNodes[row + 1][col],
      warpNodes[row + 1][col + 1],
      rawCol - col,
      rawRow - row
    );
  }

  return { warpPoint, cellSize: Math.max(Math.abs(cellW), Math.abs(cellH)) };
}

export function transformGeoJSONWithMeshWarp(input, meshWarp) {
  if (!meshWarp) return input;
  const clone = structuredClone(input);
  const warpLine = (coords, closed = false) => densifyCoordinates(coords, meshWarp.cellSize * 0.75, closed).map(meshWarp.warpPoint);
  const walk = (geom) => {
    if (!geom) return;
    if (geom.type === "Point") geom.coordinates = meshWarp.warpPoint(geom.coordinates);
    else if (geom.type === "LineString") geom.coordinates = warpLine(geom.coordinates);
    else if (geom.type === "MultiPoint") geom.coordinates = geom.coordinates.map(meshWarp.warpPoint);
    else if (geom.type === "Polygon") geom.coordinates = geom.coordinates.map((ring) => warpLine(ring, true));
    else if (geom.type === "MultiLineString") geom.coordinates = geom.coordinates.map((line) => warpLine(line));
    else if (geom.type === "MultiPolygon") geom.coordinates = geom.coordinates.map((poly) => poly.map((ring) => warpLine(ring, true)));
  };
  if (clone.type === "FeatureCollection") clone.features.forEach((f) => walk(f.geometry));
  else if (clone.type === "Feature") walk(clone.geometry);
  else walk(clone);
  return clone;
}

function densifyCoordinates(coords, maxSegment, closed = false) {
  if (!coords.length || maxSegment <= 0) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i += 1) {
    const prev = coords[i - 1];
    const next = coords[i];
    const dist = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    const steps = Math.min(10, Math.max(1, Math.ceil(dist / maxSegment)));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      out.push([lerp(prev[0], next[0], t), lerp(prev[1], next[1], t)]);
    }
  }
  if (closed && out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
  return out;
}

function bilerpPoint(p00, p10, p01, p11, tx, ty) {
  return [
    lerp(lerp(p00[0], p10[0], tx), lerp(p01[0], p11[0], tx), ty),
    lerp(lerp(p00[1], p10[1], tx), lerp(p01[1], p11[1], tx), ty),
  ];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / ((edge1 - edge0) || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
