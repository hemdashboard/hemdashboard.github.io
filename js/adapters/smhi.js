// smhi.js – väder från SMHI:s öppna prognos-API (snow1g).
// Position hämtas vid körning (Homeys geolocation eller manuellt) och avrundas
// till två decimaler (~1 km). Den lagras aldrig i repot.
//
// pmp3g är stängt sedan 2026-03-31 och används inte längre som reserv (fynd 75).
// Fallerar snow1g visar appen senaste lyckade svar (app/weather.js).

import { request } from '../core/http.js';

const HOST = 'https://opendata-download-metfcst.smhi.se';
export const API = 'snow1g';

const path = (lon, lat) => `/api/category/snow1g/version/1/geotype/point/lon/${lon}/lat/${lat}/data.json`;

export function roundCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

// Ett anrop. { ok, api, ms, points, data } eller { ok: false, err, ms }.
export async function forecast(lat, lon) {
  const la = roundCoord(lat), lo = roundCoord(lon);
  if (la === null || lo === null) return { ok: false, err: 'no-position' };
  const res = await request(HOST + path(lo, la), { timeout: 10000 });
  if (res.ok && res.data && Array.isArray(res.data.timeSeries)) {
    return { ok: true, api: API, ms: res.ms, points: res.data.timeSeries.length, data: res.data };
  }
  return { ok: false, err: `${API}:${res.ok ? 'bad-format' : res.err}`, ms: res.ms };
}
