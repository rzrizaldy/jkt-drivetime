import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const data = JSON.parse(await readFile(new URL("../public/data/jakarta_open_layers.json", import.meta.url), "utf-8"));

test("Jakarta context data has required layer arrays", () => {
  assert.equal(data.meta.observed_scope, "DKI Jakarta");
  assert.ok(Array.isArray(data.speed_corridors));
  assert.ok(Array.isArray(data.congestion_points));
  assert.ok(Array.isArray(data.traffic_lights));
  assert.ok(Array.isArray(data.city_labels));
});

test("coordinates are valid lat/lon pairs", () => {
  for (const point of [...data.congestion_points, ...data.traffic_lights, ...data.city_labels]) {
    assert.ok(point.lat >= -7 && point.lat <= -5.5, `${point.name} latitude is outside Jakarta region`);
    assert.ok(point.lon >= 106 && point.lon <= 108, `${point.name} longitude is outside Jakarta region`);
  }

  for (const corridor of data.speed_corridors) {
    assert.ok(corridor.speed_kph > 0, `${corridor.name} speed must be positive`);
    assert.ok(corridor.path.length >= 2, `${corridor.name} must have a path`);
  }
});
