import { useMockMode } from "../config.js";
import { fetchJson } from "./valhalla.js";

const AMENITY_BY_CATEGORY = {
  public_transport: "bus_station",
  catering_cafe: "cafe",
  commercial: "mall",
  healthcare: "hospital",
  education: "school",
  parking: "parking",
};

/**
 * @param {{ category: string, south: number, west: number, north: number, east: number, origin: { lat: number, lon: number } }} opts
 */
export async function fetchPlacesInBBox(opts) {
  const { category, south, west, north, east, origin } = opts;
  if (useMockMode()) {
    const { mockPlaces } = await import("../mockValhalla.js");
    return mockPlaces({ category, origin });
  }
  const amenity = AMENITY_BY_CATEGORY[category.replaceAll(".", "_")] || "bus_station";
  const q = `
[out:json][timeout:25];
(
  node["amenity"="${amenity}"](${south},${west},${north},${east});
  way["amenity"="${amenity}"](${south},${west},${north},${east});
);
out center;
`;
  const url = "https://overpass-api.de/api/interpreter";
  const res = await fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(q)}`,
  });
  const elements = res.elements || [];
  const features = elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) return null;
      return {
        type: "Feature",
        properties: {
          name: el.tags?.name || el.tags?.ref || "POI",
          formatted: el.tags?.name || "",
          categories: [category],
        },
        geometry: { type: "Point", coordinates: [lon, lat] },
      };
    })
    .filter(Boolean);
  return { type: "FeatureCollection", features: features.slice(0, 40) };
}
