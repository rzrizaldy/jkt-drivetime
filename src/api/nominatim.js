import { JABODETABEK_BBOX } from "../config.js";

const [WEST, SOUTH, EAST, NORTH] = JABODETABEK_BBOX;
const VIEWBOX = `${WEST},${NORTH},${EAST},${SOUTH}`;

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

/**
 * @param {string} query
 * @returns {Promise<{ results: { formatted: string, lat: number, lon: number }[] }>}
 */
export async function nominatimSearch(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "id");
  url.searchParams.set("viewbox", VIEWBOX);
  const rows = await getJson(url.toString());
  return {
    results: (rows || []).map((r) => ({
      formatted: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
    })),
  };
}

export async function nominatimReverse(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "jsonv2");
  const row = await getJson(url.toString());
  return {
    results: [
      {
        formatted: row.display_name || `Pinned ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        lat,
        lon,
      },
    ],
  };
}
