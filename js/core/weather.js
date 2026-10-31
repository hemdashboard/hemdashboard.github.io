// weather.js – tolkar SMHI:s punktprognos till en enhetlig form. Inga nätanrop.
//
// Två format stöds (antagande A, båda prövas):
//   snow1g: timeSeries[] = { time, data: { air_temperature, wind_speed, wind_speed_of_gust,
//           precipitation_amount_mean, symbol_code, … } }
//   pmp3g:  timeSeries[] = { validTime, parameters: [{ name, values: [v] }] } med t, ws, gust,
//           pmean, Wsymb2
// Nederbörd anges som medelintensitet (mm/h); summor räknas som intensitet × steg.
//
// Punkt: { t, temp, wind, gust, rain (mm/h), sym (1–27) }

function num(v) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n > -9000 ? n : null;
}

export function parse(data) {
  const ts = data && Array.isArray(data.timeSeries) ? data.timeSeries : [];
  const out = [];
  for (const s of ts) {
    if (!s) continue;
    const t = Date.parse(s.time || s.validTime);
    if (!Number.isFinite(t)) continue;
    let g;
    if (s.data && typeof s.data === 'object') {
      const d = s.data;
      g = (...keys) => { for (const k of keys) if (k in d) return num(d[k]); return null; };
    } else if (Array.isArray(s.parameters)) {
      const m = new Map(s.parameters.filter(p => p && p.name).map(p => [p.name, p.values]));
      g = (...keys) => { for (const k of keys) if (m.has(k)) return num(m.get(k)); return null; };
    } else continue;
    out.push({
      t,
      temp: g('air_temperature', 't'),
      wind: g('wind_speed', 'ws'),
      gust: g('wind_speed_of_gust', 'gust'),
      rain: g('precipitation_amount_mean', 'pmean'),
      sym: g('symbol_code', 'Wsymb2'),
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Wsymb2 1–27 → svensk text och ikonsort.
const SYM = [
  null,
  ['Klart', 'sun'], ['Nästan klart', 'sun'], ['Växlande molnighet', 'part'], ['Halvklart', 'part'],
  ['Molnigt', 'cloud'], ['Mulet', 'cloud'], ['Dimma', 'fog'],
  ['Lätta regnskurar', 'rain'], ['Regnskurar', 'rain'], ['Kraftiga regnskurar', 'rain'],
  ['Åskskurar', 'thunder'],
  ['Lätta byar av snöblandat regn', 'sleet'], ['Byar av snöblandat regn', 'sleet'], ['Kraftiga byar av snöblandat regn', 'sleet'],
  ['Lätta snöbyar', 'snow'], ['Snöbyar', 'snow'], ['Kraftiga snöbyar', 'snow'],
  ['Lätt regn', 'rain'], ['Regn', 'rain'], ['Kraftigt regn', 'rain'],
  ['Åska', 'thunder'],
  ['Lätt snöblandat regn', 'sleet'], ['Snöblandat regn', 'sleet'], ['Kraftigt snöblandat regn', 'sleet'],
  ['Lätt snöfall', 'snow'], ['Snöfall', 'snow'], ['Kraftigt snöfall', 'snow'],
];

export function symbol(code) {
  const c = Math.round(Number(code));
  const s = c >= 1 && c <= 27 ? SYM[c] : null;
  return s ? { text: s[0], kind: s[1] } : { text: '–', kind: 'cloud' };
}

// Natt (ungefär): visas med måne i stället för sol. Enkel klockregel, ingen solberäkning.
export function isNight(ms) {
  const h = new Date(ms).getHours();
  const m = new Date(ms).getMonth();
  const [rise, set] = m >= 4 && m <= 7 ? [5, 22] : m === 3 || m === 8 ? [7, 20] : [8, 16];
  return h < rise || h >= set;
}

// Punkten som gäller nu: senaste punkten som har börjat, annars den första.
export function current(pts, now = Date.now()) {
  let cur = null;
  for (const p of pts) { if (p.t <= now) cur = p; else break; }
  return cur || pts[0] || null;
}

export function nextHours(pts, now = Date.now(), n = 24) {
  const from = now - 3600000;
  return pts.filter(p => p.t > from).slice(0, n);
}

// Dygnssammanfattning: min/max temp, max vind och byvind, nederbörd i mm, typsymbol (dagtid).
export function days(pts, count = 5, now = Date.now()) {
  const map = new Map();
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const d = new Date(p.t); d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    const o = map.get(k) || { t: k, min: null, max: null, wind: null, gust: null, mm: 0, syms: [] };
    if (p.temp !== null) { o.min = o.min === null ? p.temp : Math.min(o.min, p.temp); o.max = o.max === null ? p.temp : Math.max(o.max, p.temp); }
    if (p.wind !== null) o.wind = o.wind === null ? p.wind : Math.max(o.wind, p.wind);
    if (p.gust !== null) o.gust = o.gust === null ? p.gust : Math.max(o.gust, p.gust);
    const next = pts[i + 1];
    const stepH = next ? Math.min(12, (next.t - p.t) / 3600000) : 1;
    if (p.rain !== null && p.rain > 0) o.mm += p.rain * stepH;
    const h = new Date(p.t).getHours();
    if (p.sym !== null) (h >= 9 && h <= 18 ? o.syms : (o.night = o.night || [])).push(p.sym);
    map.set(k, o);
  }
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return [...map.values()]
    .filter(o => o.t >= today.getTime())
    .slice(0, count)
    .map(o => ({ t: o.t, min: o.min, max: o.max, wind: o.wind, gust: o.gust, mm: o.mm,
      sym: mode(o.syms.length ? o.syms : o.night || []) }));
}

// Vanligaste symbolen; vid lika vinner den med högst kod (mest väder).
function mode(arr) {
  if (!arr.length) return null;
  const c = new Map();
  for (const s of arr) c.set(s, (c.get(s) || 0) + 1);
  let best = null, n = -1;
  for (const [s, k] of c) if (k > n || (k === n && s > best)) { best = s; n = k; }
  return best;
}
