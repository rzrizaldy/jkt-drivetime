import assert from "node:assert/strict";
import { test } from "node:test";
import { modeToCosting } from "../src/config.js";
import { mockIsochrones, mockRoute } from "../src/mockValhalla.js";

test("modeToCosting maps modes to Valhalla costing", () => {
  assert.equal(modeToCosting("drive"), "auto");
  assert.equal(modeToCosting("motorcycle"), "motor_scooter");
  assert.equal(modeToCosting("bicycle"), "bicycle");
  assert.equal(modeToCosting("walk"), "pedestrian");
  assert.equal(modeToCosting("unknown"), "auto");
});

test("mockIsochrones returns one feature per contour", () => {
  const fc = mockIsochrones({ lat: -6.2, lon: 106.8, maxMinutes: 30 });
  assert.equal(fc.type, "FeatureCollection");
  assert.ok(fc.features.length >= 1);
  for (const f of fc.features) {
    assert.ok(f.properties.contour > 0);
    assert.equal(f.geometry.type, "Polygon");
  }
});

test("mockIsochrones contours are within maxMinutes", () => {
  const fc = mockIsochrones({ lat: -6.2, lon: 106.8, maxMinutes: 20 });
  assert.ok(fc.features.every((f) => f.properties.contour <= 20));
});

test("mockRoute returns GeoJSON with time and distance", () => {
  const r = mockRoute({ from: { lat: -6.2, lon: 106.8 }, to: { lat: -6.25, lon: 106.85 } });
  const feat = r.features?.[0];
  assert.ok(feat != null);
  assert.ok(Number(feat.properties.time) > 0);
  assert.ok(Number(feat.properties.distance) > 0);
  assert.equal(feat.geometry.type, "LineString");
});
