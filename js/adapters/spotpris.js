// spotpris.js – spotpris per elområde från elprisetjustnu.se (öppet, ingen nyckel).
// Morgondagens priser publiceras normalt efter ca 13:00; före det är 404 väntat.
// Elområde är en inställning (standard SE3), inte hårdkodat i logiken.

import { request } from '../core/http.js';

const HOST = 'https://www.elprisetjustnu.se';
export const ZONES = ['SE1', 'SE2', 'SE3', 'SE4'];

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return { y, md: `${m}-${d}` };
}

export async function prices(date, zone = 'SE3') {
  if (!ZONES.includes(zone)) return { ok: false, err: 'zone' };
  const { y, md } = ymd(date);
  const res = await request(`${HOST}/api/v1/prices/${y}/${md}_${zone}.json`, { timeout: 8000 });
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, err: res.err || 'parse', status: res.status, ms: res.ms };
  return { ok: true, ms: res.ms, count: res.data.length, data: res.data };
}

export function today(zone) {
  return prices(new Date(), zone);
}

export function tomorrow(zone) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return prices(d, zone);
}
