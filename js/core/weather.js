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

// Utsikt de närmaste `hours` timmarna: det man vill veta innan man går ut.
// Returnerar en lista { kind, warn, text } i ordning nederbörd, kyla, vind, temperatur.
// Gränser (A, justerbara): nederbörd ≥ 0,1 mm/h, frost ≤ 0 °C (risk ≤ 2 °C nattetid),
// hårda byar ≥ 14 m/s eller medelvind ≥ 10 m/s.
export function outlook(pts, now = Date.now(), hours = 24) {
  const end = now + hours * 3600000;
  const win = pts.filter(p => p.t + 3600000 > now && p.t < end);
  if (!win.length) return [];
  const hhmm = (ms) => `${String(new Date(ms).getHours()).padStart(2, '0')}`;
  const wet = (p) => p.rain !== null && p.rain >= 0.1;
  const kindOf = (p) => symbol(p.sym).kind;
  const out = [];

  // Nederbörd: pågår nu, eller när börjar den, hur länge och hur mycket.
  const first = win.findIndex(wet);
  if (first === -1) out.push({ kind: 'dry', warn: false, text: `Uppehåll närmaste ${hours} h` });
  else {
    let last = first, mm = 0;
    for (let i = first; i < win.length && wet(win[i]); i += 1) {
      const next = win[i + 1] || pts[pts.indexOf(win[i]) + 1];
      const stepH = next ? Math.min(6, (next.t - win[i].t) / 3600000) : 1;
      mm += win[i].rain * stepH; last = i;
    }
    const after = win[last + 1];
    // Typ ur symbolerna i perioden: snö eller snöblandat om någon timme har det, annars regn.
    const kinds = win.slice(first, last + 1).map(kindOf);
    const k = kinds.includes('snow') ? 'snow' : kinds.includes('sleet') ? 'sleet' : 'rain';
    const what = k === 'snow' ? 'Snö' : k === 'sleet' ? 'Snöblandat' : 'Regn';
    const amount = mm >= 0.5 ? `, ca ${mm < 10 ? Math.round(mm * 10) / 10 : Math.round(mm)} mm`.replace('.', ',') : '';
    const text = win[first].t <= now
      ? `${what} nu${after ? `, uppehåll från ${hhmm(after.t)}` : ' resten av dygnet'}${amount}`
      : `${what} från ${hhmm(win[first].t)}${after ? ` till ${hhmm(after.t)}` : ''}${amount}`;
    out.push({ kind: k, warn: mm >= 5 || k !== 'rain', text });
  }

  // Kyla: lägsta temperatur och när.
  const temps = win.filter(p => p.temp !== null);
  if (temps.length) {
    const min = temps.reduce((a, p) => (p.temp < a.temp ? p : a));
    const max = temps.reduce((a, p) => (p.temp > a.temp ? p : a));
    if (min.temp <= -0.5) out.push({ kind: 'frost', warn: true, text: `Minusgrader, lägst ${fmt(min.temp)}° kl ${hhmm(min.t)}` });
    else if (min.temp <= 0) out.push({ kind: 'frost', warn: true, text: `Nollgradigt kl ${hhmm(min.t)}, risk för halka` });
    else if (min.temp <= 2 && isNight(min.t)) out.push({ kind: 'frost', warn: false, text: `Risk för frost, lägst ${fmt(min.temp)}° kl ${hhmm(min.t)}` });
    out.push({ kind: 'temp', warn: false, text: `${fmt(min.temp)}° till ${fmt(max.temp)}°, varmast kl ${hhmm(max.t)}` });
  }

  // Vind: hårdaste byn eller medelvinden.
  const gusts = win.filter(p => p.gust !== null);
  const g = gusts.length ? gusts.reduce((a, p) => (p.gust > a.gust ? p : a)) : null;
  const winds = win.filter(p => p.wind !== null);
  const w = winds.length ? winds.reduce((a, p) => (p.wind > a.wind ? p : a)) : null;
  if (g && g.gust >= 14) out.push({ kind: 'wind', warn: true, text: `Hårda vindbyar, upp till ${Math.round(g.gust)} m/s kl ${hhmm(g.t)}` });
  else if (w && w.wind >= 10) out.push({ kind: 'wind', warn: true, text: `Blåsigt, ${Math.round(w.wind)} m/s kl ${hhmm(w.t)}` });

  // Ordning: varningar först, temperatur sist.
  return [...out.filter(o => o.warn), ...out.filter(o => !o.warn && o.kind !== 'temp'), ...out.filter(o => o.kind === 'temp')];
}

function fmt(v) { return String(Math.round(v)).replace('-', '−'); }
