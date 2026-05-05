/** Map center [lng, lat] */
export const JAKARTA_CENTER = Object.freeze([106.8272, -6.1754]);
/** [west, south, east, north] */
export const JABODETABEK_BBOX = Object.freeze([106.32, -6.78, 107.22, -5.92]);

export const CONTOUR_MINUTES = Object.freeze([10, 20, 30, 45, 60]);

export const CONTOUR_COLORS = Object.freeze({
  10: "#22c55e",
  20: "#86efac",
  30: "#facc15",
  45: "#f97316",
  60: "#ef4444",
});

export const TRAVEL_MODES = Object.freeze([
  { id: "drive", label: "Drive", costing: "auto" },
  { id: "motorcycle", label: "Motorcycle", costing: "motor_scooter" },
  { id: "bicycle", label: "Bicycle", costing: "bicycle" },
  { id: "walk", label: "Walk", costing: "pedestrian" },
]);

/** True when running without a backend (haversine mock). */
export function useMockMode() {
  return String(import.meta.env?.VITE_USE_MOCK ?? "") === "true";
}

export function modeToCosting(mode) {
  const found = TRAVEL_MODES.find((m) => m.id === mode);
  return found?.costing ?? "auto";
}
