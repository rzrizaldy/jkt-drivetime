/**
 * Two-layer travel-grid cache:
 *   L1 – in-memory Map (same session, instant)
 *   L2 – localStorage (persists across reloads, survives tab close)
 *
 * Keys are snapped to ~500 m precision so nearby clicks reuse the
 * same cached grid instead of re-fetching.
 */

const NS       = "jkt-grid-v1:";
const SNAP_DEG = 0.005;          // ~500 m at Jakarta latitude
const MAX_KEYS = 40;             // max localStorage entries before LRU evict

/** @type {Map<string, import('./map/cartogram.js').TravelGrid>} */
const memCache = new Map();

/** Snap lat/lon to a grid so nearby points share a cache entry. */
export function snapKey(lat, lon) {
  const sLat = (Math.round(lat / SNAP_DEG) * SNAP_DEG).toFixed(4);
  const sLon = (Math.round(lon / SNAP_DEG) * SNAP_DEG).toFixed(4);
  return `${sLat},${sLon}`;
}

/** @returns {import('./map/cartogram.js').TravelGrid | null} */
export function getGrid(lat, lon) {
  const key = snapKey(lat, lon);

  // L1
  if (memCache.has(key)) return memCache.get(key);

  // L2
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw) {
      const grid = JSON.parse(raw);
      memCache.set(key, grid);           // promote to L1
      touchKey(key);
      return grid;
    }
  } catch { /* storage unavailable or corrupt */ }

  return null;
}

/** @param {import('./map/cartogram.js').TravelGrid} grid */
export function setGrid(lat, lon, grid) {
  const key = snapKey(lat, lon);

  // L1
  memCache.set(key, grid);

  // L2
  try {
    evictIfNeeded();
    localStorage.setItem(NS + key, JSON.stringify(grid));
    touchKey(key);
  } catch { /* quota exceeded – skip */ }
}

/** How many grids are cached in localStorage. */
export function cacheSize() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(NS)).length;
  } catch { return 0; }
}

/** Clear everything (both layers). */
export function clearCache() {
  memCache.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(NS))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ── LRU helpers ─────────────────────────────────────────────────────────────
const TS_NS = "jkt-grid-ts-v1:";

function touchKey(key) {
  try { localStorage.setItem(TS_NS + key, Date.now().toString()); } catch { /* ignore */ }
}

function evictIfNeeded() {
  try {
    const entries = Object.keys(localStorage)
      .filter((k) => k.startsWith(NS));
    if (entries.length < MAX_KEYS) return;

    // Find oldest by timestamp
    const withTs = entries.map((k) => {
      const raw = localStorage.getItem(TS_NS + k.slice(NS.length)) ?? "0";
      return { k, ts: Number(raw) };
    });
    withTs.sort((a, b) => a.ts - b.ts);
    const oldest = withTs[0].k;
    localStorage.removeItem(oldest);
    localStorage.removeItem(TS_NS + oldest.slice(NS.length));
  } catch { /* ignore */ }
}
