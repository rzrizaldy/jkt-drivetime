/**
 * Canvas-based smooth heatmap renderer (NYC color scale).
 */

const GRADIENT_STOPS = [
  { t: 0,    r: 220, g: 69,  b: 37  },
  { t: 0.20, r: 244, g: 127, b: 46  },
  { t: 0.40, r: 255, g: 196, b: 79  },
  { t: 0.62, r: 248, g: 232, b: 156 },
  { t: 0.80, r: 149, g: 188, b: 211 },
  { t: 1.00, r: 74,  g: 103, b: 141 },
];

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
 * Draw a smooth blurred heatmap on a visible canvas from a TravelGrid.
 * Uses ImageData (pixel-level) for max compatibility — no OffscreenCanvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import('./map/cartogram.js').TravelGrid} grid
 * @param {maplibregl.Map} map
 * @param {{ maxMinutes?: number, alpha?: number }} opts
 */
export function renderHeatmap(canvas, grid, map, { maxMinutes = 60, alpha = 0.82 } = {}) {
  if (!canvas || !grid || !map) return;

  const parent = canvas.parentElement;
  const pw = parent ? parent.clientWidth  : 0;
  const ph = parent ? parent.clientHeight : 0;
  if (!pw || !ph) return;          // layout not ready — will retry on next moveend

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width  = Math.round(pw * dpr);
  canvas.height = Math.round(ph * dpr);

  const W = canvas.width;
  const H = canvas.height;
  if (!W || !H) return;

  const { west, south, east, north, cols, rows, times } = grid;
  if (!times?.length) return;
  const maxSeconds = maxMinutes * 60 * 1.1;

  // Render soft point splats, not grid rectangles. This avoids the boxy
  // CommuteTimeMap look while still using the same factual travel-time grid.
  const tmp = document.createElement("canvas");
  tmp.width  = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");

  const cellW = (east  - west)  / Math.max(1, cols - 1);
  const cellH = (north - south) / Math.max(1, rows - 1);

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const t = times[i + j * cols];
      if (t == null) continue;
      if (t > maxSeconds) continue;

      const lng0 = west  + i * cellW;
      const lat0 = south + j * cellH;
      const lng1 = lng0  + cellW;
      const lat1 = lat0  + cellH;
      const lngC = lng0;
      const latC = lat0;

      let p0, p1, pc;
      try {
        pc = map.project([lngC, latC]);
        p0 = map.project([lng0 - cellW * 0.5, lat0 - cellH * 0.5]);
        p1 = map.project([lng1, lat1]);
      } catch { continue; }

      const px = pc.x * dpr;
      const py = pc.y * dpr;
      const radius = Math.max(14, Math.hypot(p1.x - p0.x, p1.y - p0.y) * 0.95) * dpr;

      if (!isFinite(px) || !isFinite(py) || !isFinite(radius)) continue;

      const [r, g, b] = heatmapRgb(t / 60, maxMinutes);
      const grad = tctx.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.82)`);
      grad.addColorStop(0.68, `rgba(${r},${g},${b},0.42)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      tctx.fillStyle = grad;
      tctx.beginPath();
      tctx.arc(px, py, radius, 0, Math.PI * 2);
      tctx.fill();
    }
  }

  // ── Composite with blur ──────────────────────────────────────────────────
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.filter = "blur(8px)";
  ctx.globalAlpha = alpha;
  ctx.drawImage(tmp, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
}

/**
 * Draw dashed ring outlines from isochrone features.
 */
export function renderRingOutlines(canvas, isochrones, map, { maxMinutes = 60 } = {}) {
  if (!canvas || !map) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
        try {
          const { x, y } = map.project([lng, lat]);
          if (!isFinite(x) || !isFinite(y)) continue;
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          first = false;
        } catch { /* skip */ }
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
