/**
 * Canvas-based smooth heatmap renderer.
 * Renders a pixel-level gradient (red=close, blue=far) from a travel-time grid.
 * Exactly matches the NYC cartogram color scale.
 */

const GRADIENT_STOPS = [
  { t: 0,    r: 220, g: 69,  b: 37  },
  { t: 0.20, r: 244, g: 127, b: 46  },
  { t: 0.40, r: 255, g: 196, b: 79  },
  { t: 0.62, r: 248, g: 232, b: 156 },
  { t: 0.80, r: 149, g: 188, b: 211 },
  { t: 1.00, r: 74,  g: 103, b: 141 },
];

/**
 * @param {number} minutes
 * @param {number} maxMinutes
 * @returns {[number,number,number]} rgb
 */
export function heatmapRgb(minutes, maxMinutes) {
  const t = Math.min(1, Math.max(0, minutes / maxMinutes));
  let left = GRADIENT_STOPS[0];
  let right = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    if (t >= GRADIENT_STOPS[i].t && t <= GRADIENT_STOPS[i + 1].t) {
      left = GRADIENT_STOPS[i];
      right = GRADIENT_STOPS[i + 1];
      break;
    }
  }
  const mix = (t - left.t) / (right.t - left.t || 1);
  return [
    Math.round(left.r + (right.r - left.r) * mix),
    Math.round(left.g + (right.g - left.g) * mix),
    Math.round(left.b + (right.b - left.b) * mix),
  ];
}

/**
 * Draw a smooth heatmap on the given canvas using a travel-time grid.
 * Renders each grid cell as a rectangle, then applies CSS blur for smoothness.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import('./map/cartogram.js').TravelGrid} grid
 * @param {maplibregl.Map} map — used to project lng/lat → screen px
 * @param {{ maxMinutes: number, alpha: number }} opts
 */
export function renderHeatmap(canvas, grid, map, { maxMinutes = 60, alpha = 0.82 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { west, south, east, north, cols, rows, times } = grid;
  if (!times?.length) return;

  const cellW = (east - west)   / Math.max(1, cols - 1);
  const cellH = (north - south) / Math.max(1, rows - 1);

  // Off-screen canvas for sharp rectangles → then blur
  const off = new OffscreenCanvas(canvas.width, canvas.height);
  const octx = off.getContext("2d");

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const t = times[i + j * cols];
      if (t == null) continue;
      const minutes = t / 60;

      const lng0 = west  + i * cellW;
      const lat0 = south + j * cellH;
      const lng1 = lng0 + cellW;
      const lat1 = lat0 + cellH;

      const p0 = map.project([lng0, lat0]);
      const p1 = map.project([lng1, lat1]);

      const px = Math.min(p0.x, p1.x) * dpr;
      const py = Math.min(p0.y, p1.y) * dpr;
      const pw = (Math.abs(p1.x - p0.x) + 1) * dpr;
      const ph = (Math.abs(p1.y - p0.y) + 1) * dpr;

      const [r, g, b] = heatmapRgb(minutes, maxMinutes);
      octx.fillStyle = `rgb(${r},${g},${b})`;
      octx.fillRect(px, py, pw, ph);
    }
  }

  // Composite with blur
  ctx.filter = "blur(14px)";
  ctx.globalAlpha = alpha;
  ctx.drawImage(off, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
}

/**
 * Same as renderHeatmap but also draws the isochrone ring outlines
 * as subtle dashed lines (optional "rings" toggle).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {GeoJSON.FeatureCollection} isochrones
 * @param {maplibregl.Map} map
 * @param {{ maxMinutes: number }} opts
 */
export function renderRingOutlines(canvas, isochrones, map, { maxMinutes = 60 } = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const features = (isochrones?.features || [])
    .sort((a, b) => (a.properties?.contour ?? 0) - (b.properties?.contour ?? 0));

  ctx.save();
  ctx.scale(dpr, dpr);

  for (const feat of features) {
    const minutes = feat.properties?.contour ?? 0;
    const [r, g, b] = heatmapRgb(minutes, maxMinutes);
    const geom = feat.geometry;
    if (!geom) continue;

    const rings =
      geom.type === "Polygon"      ? geom.coordinates :
      geom.type === "MultiPolygon" ? geom.coordinates.flat() : [];

    ctx.beginPath();
    for (const ring of rings) {
      let first = true;
      for (const [lng, lat] of ring) {
        const { x, y } = map.project([lng, lat]);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.closePath();
    }
    ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
  }

  ctx.restore();
}
