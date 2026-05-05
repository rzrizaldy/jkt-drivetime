import { JABODETABEK_BBOX } from "../config.js";

const VIEWBOX = `${JABODETABEK_BBOX[1]},${JABODETABEK_BBOX[0]},${JABODETABEK_BBOX[3]},${JABODETABEK_BBOX[2]}`;

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
  url.searchParams.set("viewbox", VIEWBOX);
  url.searchParams.set("bounded", "1");
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
