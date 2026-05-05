import { CONTOUR_MINUTES } from "./config.js";

const MONAS = { lat: -6.1754, lon: 106.8272 };

function ringAround(lat, lon, radiusKm, vertices = 80, squeeze = 0.78) {
  const pts = [];
  for (let i = 0; i <= vertices; i += 1) {
    const angle = (Math.PI * 2 * i) / vertices;
    const wobble = 1 + 0.1 * Math.sin(angle * 4) + 0.07 * Math.cos(angle * 7);
    pts.push([
      lon + (Math.cos(angle) * radiusKm * wobble) / 111,
      lat + (Math.sin(angle) * radiusKm * wobble * squeeze) / 111,
    ]);
  }
  return pts;
}

export function mockIsochrones({ lat, lon, maxMinutes = 60 }) {
  const contours = CONTOUR_MINUTES.filter((m) => m <= maxMinutes);
  if (!contours.includes(maxMinutes)) contours.push(maxMinutes);
  return {
    type: "FeatureCollection",
    features: contours.map((minutes) => ({
      type: "Feature",
      properties: { contour: minutes, mock: true },
      geometry: { type: "Polygon", coordinates: [ringAround(lat, lon, minutes * 0.55)] },
    })),
  };
}

export function mockRoute({ from, to }) {
  const km = haversineKm(from.lat, from.lon, to.lat, to.lon);
  const seconds = Math.round((km / 24) * 3600);
  return {
    features: [
      {
        type: "Feature",
        properties: { time: seconds, distance: km * 1000, mock: true },
        geometry: {
          type: "LineString",
          coordinates: [
            [from.lon, from.lat],
            [(from.lon + to.lon) / 2 + 0.01, (from.lat + to.lat) / 2 - 0.008],
            [to.lon, to.lat],
          ],
        },
      },
    ],
  };
}

export function defaultOrigin() {
  return { label: "Monas, Jakarta Pusat", lat: MONAS.lat, lon: MONAS.lon };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
