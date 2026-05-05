import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildTravelGridFromIsochrones,
  lookupTimeFromIsochrones,
  parseMatrixTimes,
  sampleGridPoints,
  sampleTimeSeconds,
  warpLngLat,
} from "../src/map/cartogram.js";

/** Minimal mock isochrone FeatureCollection for testing. */
function makeIsochrones(lat, lon) {
  const ring = (r, v) => ({
    type: "Feature",
    properties: { contour: v },
    geometry: {
      type: "Polygon",
      coordinates: [Array.from({ length: 5 }, (_, i) => {
        const a = (2 * Math.PI * i) / 4;
        return [lon + Math.cos(a) * r, lat + Math.sin(a) * r];
      }).concat([[lon + 1 * r, lat]])],
    },
  });
  return { type: "FeatureCollection", features: [ring(0.05, 10), ring(0.1, 20), ring(0.2, 30)] };
}

test("lookupTimeFromIsochrones finds point inside smallest ring", () => {
  const fc = makeIsochrones(-6.2, 106.8);
  const t = lookupTimeFromIsochrones(fc, 106.801, -6.2);
  assert.ok(t != null && t <= 10);
});

test("lookupTimeFromIsochrones returns null for outside-all-rings point", () => {
  const fc = makeIsochrones(-6.2, 106.8);
  const t = lookupTimeFromIsochrones(fc, 108.0, -6.2);
  assert.equal(t, null);
});

test("buildTravelGridFromIsochrones returns correct dimensions", () => {
  const fc = makeIsochrones(-6.2, 106.8);
  const grid = buildTravelGridFromIsochrones(fc, { lat: -6.2, lon: 106.8 }, [106.5, -6.5, 107.0, -5.9], 10, 10, 60);
  assert.equal(grid.cols, 10);
  assert.equal(grid.rows, 10);
  assert.equal(grid.times.length, 100);
});

test("parseMatrixTimes reads flat Valhalla-style matrix", () => {
  const data = {
    sources_to_targets: [
      { from_index: 0, to_index: 0, time: 0 },
      { from_index: 0, to_index: 1, time: 120 },
      { from_index: 0, to_index: 2, time: 240 },
    ],
  };
  assert.deepEqual(parseMatrixTimes(data, 3), [0, 120, 240]);
});

test("sampleGridPoints covers bbox corners", () => {
  const pts = sampleGridPoints([100, -10, 101, -9], 3, 3);
  assert.equal(pts.length, 9);
  assert.equal(pts[0].lon, 100);
  assert.equal(pts[0].lat, -10);
  assert.equal(pts.at(-1).lon, 101);
  assert.equal(pts.at(-1).lat, -9);
});

test("sampleTimeSeconds bilinear interpolates", () => {
  const grid = {
    west: 0, south: 0, east: 2, north: 2,
    cols: 3, rows: 3,
    times: [0, 100, 200, 100, 200, 300, 200, 300, 400],
    origin: { lat: 1, lon: 1 },
  };
  const mid = sampleTimeSeconds(grid, 1, 1);
  assert.ok(mid !== null && mid >= 199 && mid <= 201);
});

test("warpLngLat moves point radially", () => {
  const [wlg, wlt] = warpLngLat(106.8, -6.2, 106.81, -6.21, 600, 0.5);
  assert.ok(typeof wlg === "number" && typeof wlt === "number");
  assert.notEqual(wlg, 106.81);
  assert.notEqual(wlt, -6.21);
});

test("Jabodetabek boundary GeoJSON exists", async () => {
  const raw = await readFile(new URL("../public/data/context/jabodetabek_boundary.geojson", import.meta.url), "utf-8");
  const fc = JSON.parse(raw);
  assert.equal(fc.type, "FeatureCollection");
  assert.ok(fc.features?.length >= 1);
});
