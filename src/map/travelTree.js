/**
 * Build a dendrogram-like accessibility tree from a travel-time grid.
 * Each cell drains to the adjacent cell with lower travel time. We then keep
 * only segments with enough upstream accumulation, producing main branches
 * instead of a uniform hatch.
 *
 * @param {import("./cartogram.js").TravelGrid} grid
 * @param {{ maxMinutes?: number, stride?: number }} opts
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildTravelTree(grid, { maxMinutes = 60, stride = 1 } = {}) {
  if (!grid?.times?.length) return { type: "FeatureCollection", features: [] };
  const { west, south, east, north, cols, rows, times } = grid;
  const cellW = (east - west) / Math.max(1, cols - 1);
  const cellH = (north - south) / Math.max(1, rows - 1);
  const maxSeconds = maxMinutes * 60 * 3;
  const total = cols * rows;
  const downstream = Array.from({ length: total }, () => -1);
  const accumulation = Array.from({ length: total }, () => 0);
  const active = [];

  const idx = (i, j) => i + j * cols;
  const center = (i, j) => [west + i * cellW, south + j * cellH];

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const cell = idx(i, j);
      const here = times[cell];
      if (!Number.isFinite(here) || here <= 0 || here > maxSeconds) continue;

      accumulation[cell] = 1;
      active.push(cell);
      let bestTime = here;
      for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) {
          if (x === 0 && y === 0) continue;
          const ni = i + x;
          const nj = j + y;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const t = times[idx(ni, nj)];
          if (Number.isFinite(t) && t < bestTime) {
            downstream[cell] = idx(ni, nj);
            bestTime = t;
          }
        }
      }
    }
  }

  active
    .sort((a, b) => (times[b] ?? 0) - (times[a] ?? 0))
    .forEach((cell) => {
      const down = downstream[cell];
      if (down >= 0) accumulation[down] += accumulation[cell];
    });

  const minFlow = 8;
  const features = [];
  for (const cell of active) {
    const down = downstream[cell];
    if (down < 0) continue;
    const i = cell % cols;
    const j = Math.floor(cell / cols);
    if ((i % stride !== 0 || j % stride !== 0) && accumulation[cell] < minFlow * 2) continue;
    if (accumulation[cell] < minFlow) continue;

    const ni = down % cols;
    const nj = Math.floor(down / cols);
    features.push({
      type: "Feature",
      properties: { minutes: Math.round((times[cell] ?? 0) / 60), flow: accumulation[cell] },
      geometry: { type: "LineString", coordinates: [center(i, j), center(ni, nj)] },
    });
  }

  return { type: "FeatureCollection", features };
}
