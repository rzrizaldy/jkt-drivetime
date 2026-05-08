/** Map center [lng, lat] */
export const JAKARTA_CENTER = Object.freeze([106.8272, -6.1754]);
/** [west, south, east, north] */
export const JABODETABEK_BBOX = Object.freeze([106.32, -6.78, 107.22, -5.92]);

export const CONTOUR_MINUTES = Object.freeze([10, 20, 30, 45, 60, 75, 90]);

export const CONTOUR_COLORS = Object.freeze({
  10: "#dc4525",
  20: "#f47f2e",
  30: "#ffc44f",
  45: "#95bcd3",
  60: "#4a678d",
  75: "#2f4d73",
  90: "#17304d",
});

export const TRAVEL_MODES = Object.freeze([
  { id: "drive", label: "Drive", costing: "auto" },
  { id: "motorcycle", label: "Motorcycle", costing: "motor_scooter" },
  { id: "bicycle", label: "Bicycle", costing: "bicycle" },
  { id: "walk", label: "Walk", costing: "pedestrian" },
]);

/** True when using the Valhalla routing backend. */
export function useLiveRoutingMode() {
  return String(import.meta.env?.VITE_USE_LIVE_ROUTING ?? "true") !== "false";
}

/** Backwards-compatible alias for old fallback-only modules. */
export function useMockMode() {
  return String(import.meta.env?.VITE_USE_MOCK ?? "false") === "true";
}

export function modeToCosting(mode) {
  const found = TRAVEL_MODES.find((m) => m.id === mode);
  return found?.costing ?? "auto";
}
