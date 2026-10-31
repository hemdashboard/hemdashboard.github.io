// smhi.js – väder från SMHI:s öppna prognos-API.
// Position hämtas vid körning (Homeys geolocation eller manuellt) och avrundas
// till två decimaler (~1 km). Den lagras aldrig i repot.
//
// Antagande (A): snow1g är den aktuella punktprognosen; pmp3g prövas som reserv.

import { request } from '../core/http.js';

const HOST = 'https://opendata-download-metfcst.smhi.se';

const APIS = [
  { name: 'snow1g', path: (lon, lat) => `/api/category/snow1g/version/1/geotype/point/lon/${lon}/lat/${lat}/data.json` },
  { name: 'pmp3g',  path: (lon, lat) => `/api/category/pmp3g/version/2/geotype/point/lon/${lon}/lat/${lat}/data.json` },
];

export function roundCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

// Prövar API:erna i tur och ordning. Returnerar första som svarar.
export async function forecast(lat, lon) {
  const la = roundCoord(lat), lo = roundCoord(lon);
  if (la === null || lo === null) return { ok: false, err: 'no-position', tried: [] };
  const tried = [];
  for (const api of APIS) {
    const res = await request(HOST + api.path(lo, la), { timeout: 10000 });
    tried.push({ api: api.name, err: res.err, ms: res.ms });
    if (res.ok && res.data && Array.isArray(res.data.timeSeries)) {
      return { ok: true, api: api.name, ms: res.ms, points: res.data.timeSeries.length, data: res.data, tried };
    }
  }
  return { ok: false, err: tried.map(t => `${t.api}:${t.err}`).join(','), tried };
}
