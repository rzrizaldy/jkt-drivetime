import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildHistoricalJakartaGrid, observedCorridorSpeed } from "../src/api/historicalJakarta.js";
import { buildTravelTree } from "../src/map/travelTree.js";

test("historical Jakarta model uses corridor speeds from open-data context", async () => {
  const data = JSON.parse(await readFile(new URL("../public/data/jakarta_open_layers.json", import.meta.url), "utf8"));
  const speed = observedCorridorSpeed(data.speed_corridors.map((row) => ({
    speedKph: row.speed_kph,
    path: row.path.map(([lat, lon]) => ({ lat, lon })),
  })));
  assert.ok(speed > 15);
  assert.ok(speed < 35);
});

test("historical Jakarta grid is dense and finite", async () => {
  const data = JSON.parse(await readFile(new URL("../public/data/jakarta_open_layers.json", import.meta.url), "utf8"));
  const grid = buildHistoricalJakartaGrid({ lat: -6.1754, lon: 106.8272 }, data, { mode: "drive" });
  assert.equal(grid.source, "jakarta-historical-speed-v1");
  assert.equal(grid.cols * grid.rows, grid.times.length);
  assert.ok(grid.cols >= 50);
  assert.ok(grid.times.every((t) => Number.isFinite(t) && t >= 0));
});

test("motorcycle profile is faster than drive for same historical surface", async () => {
  const data = JSON.parse(await readFile(new URL("../public/data/jakarta_open_layers.json", import.meta.url), "utf8"));
  const origin = { lat: -6.1754, lon: 106.8272 };
  const drive = buildHistoricalJakartaGrid(origin, data, { mode: "drive" });
  const moto = buildHistoricalJakartaGrid(origin, data, { mode: "motorcycle" });
  const idx = Math.floor(drive.times.length * 0.72);
  assert.ok(moto.times[idx] < drive.times[idx]);
});

test("travel tree creates branching linework from historical grid", async () => {
  const data = JSON.parse(await readFile(new URL("../public/data/jakarta_open_layers.json", import.meta.url), "utf8"));
  const grid = buildHistoricalJakartaGrid({ lat: -6.1754, lon: 106.8272 }, data, { mode: "drive" });
  const tree = buildTravelTree(grid, { maxMinutes: 60, stride: 2 });
  assert.equal(tree.type, "FeatureCollection");
  assert.ok(tree.features.length > 40);
  assert.ok(tree.features.every((f) => f.geometry.type === "LineString"));
});
