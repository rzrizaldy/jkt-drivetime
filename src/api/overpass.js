let _roadCache = null;

/**
 * Fetch major Jakarta roads from Overpass and return as GeoJSON FeatureCollection.
 * Results are cached for the session.
 * @returns {Promise<GeoJSON.FeatureCollection>}
 */
export async function fetchJakartaRoads() {
  if (_roadCache) return _roadCache;
  const query = `
[out:json][timeout:30];
way["highway"~"motorway|trunk|primary|secondary"](${-6.78},${106.32},${-5.92},${107.22});
out geom;
  `.trim();

  const res = await fetch("/api/overpass/api/interpreter", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json();

  const features = (json.elements || [])
    .filter((el) => el.type === "way" && el.geometry?.length >= 2)
    .map((el) => ({
      type: "Feature",
      properties: { highway: el.tags?.highway, name: el.tags?.name },
      geometry: {
        type: "LineString",
        coordinates: el.geometry.map((n) => [n.lon, n.lat]),
      },
    }));

  _roadCache = { type: "FeatureCollection", features };
  return _roadCache;
}
