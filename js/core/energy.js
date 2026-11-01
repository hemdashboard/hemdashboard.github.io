// energy.js – rena beräkningar för effekt, förbrukning och kostnad ur Homey Insights.
// Inga nätanrop och inga ID här. Tider är lokala (Europe/Stockholm i praktiken).
//
// Insights-punkter: [{ t: ISO-sträng | ms, v: number | null }]. Varje punkt anger värdet
// vid (eller medel för steget som slutar vid) tiden t.
//
// Mätare:
//   - Räknande (meter_power.imported): stiger hela tiden.
//   - Dygnsnollställd (meter_power på vissa mätare): faller till ~0 vid midnatt.
// deltas() klarar båda: ett fall räknas som nollställning och det nya värdet som förbrukning
// sedan nollställningen.

export function points(raw) {
  const arr = raw && Array.isArray(raw.values) ? raw.values : Array.isArray(raw) ? raw : [];
  const out = [];
  for (const p of arr) {
    if (!p || p.v === null || p.v === undefined) continue;
    const v = Number(p.v);
    const t = typeof p.t === 'number' ? p.t : Date.parse(p.t);
    if (Number.isFinite(v) && Number.isFinite(t)) out.push({ t, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Förbrukning mellan på varandra följande punkter. { t (slut), dt, kwh }.
// Ett fall större än 0,5 % (minst 0,01) tolkas som nollställning.
export function deltas(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1], b = pts[i];
    let d = b.v - a.v;
    if (d < 0) d = (a.v - b.v) > Math.max(0.01, Math.abs(a.v) * 0.005) ? Math.max(0, b.v) : 0;
    out.push({ t0: a.t, t: b.t, kwh: d });
  }
  return out;
}

export function startOfDay(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime();
}
// Hel timme räknat i UTC: entydigt även när klockan ställs tillbaka (02:00 finns två
// gånger i oktober) och korrekt för tidszoner med hela timmars förskjutning.
export function startOfHour(ms) {
  return ms - (((ms % 3600000) + 3600000) % 3600000);
}
export function startOfMonth(ms) {
  const d = new Date(ms); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime();
}
export function addDays(ms, n) {
  const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime();
}

// Fördelar varje delta proportionellt över de hinkar (timme/dygn) intervallet täcker.
// keyFn(ms) → hinkstart, nextFn(start) → nästa hinkstart.
function bucket(ds, keyFn, nextFn, from, to) {
  const map = new Map();
  for (const d of ds) {
    if (d.kwh <= 0) continue;
    const span = d.t - d.t0;
    if (span <= 0) { const k = keyFn(d.t - 1); map.set(k, (map.get(k) || 0) + d.kwh); continue; }
    let s = d.t0;
    while (s < d.t) {
      const k = keyFn(s);
      // Spärr: nästa hink måste ligga efter s, annars kan loopen inte gå framåt.
      const e = Math.min(Math.max(nextFn(k), s + 60000), d.t);
      map.set(k, (map.get(k) || 0) + d.kwh * (e - s) / span);
      s = e;
    }
  }
  const out = [];
  for (let k = keyFn(from); k < to; k = nextFn(k)) out.push({ t: k, kwh: map.get(k) || 0, has: map.has(k) });
  return out;
}

const nextHour = (ms) => ms + 3600000;
const nextDay = (ms) => addDays(ms, 1);

export function hourly(pts, from, to) {
  return bucket(deltas(pts), startOfHour, nextHour, from, to);
}

export function daily(pts, from, to) {
  return bucket(deltas(pts), startOfDay, nextDay, from, to);
}

export function sumKwh(pts, from, to) {
  let s = 0;
  for (const d of deltas(pts)) {
    if (d.t <= from || d.t0 >= to) continue;
    const span = d.t - d.t0;
    const a = Math.max(d.t0, from), b = Math.min(d.t, to);
    s += span > 0 ? d.kwh * (b - a) / span : d.kwh;
  }
  return s;
}

// Effekt: medel och topp per hink ur measure_power-punkter (W).
export function powerStats(pts, keyFn, nextFn, from, to) {
  const map = new Map();
  for (const p of pts) {
    if (p.t < from || p.t >= to) continue;
    const k = keyFn(p.t);
    const o = map.get(k) || { sum: 0, n: 0, max: -Infinity };
    o.sum += p.v; o.n += 1; o.max = Math.max(o.max, p.v);
    map.set(k, o);
  }
  const out = [];
  for (let k = keyFn(from); k < to; k = nextFn(k)) {
    const o = map.get(k);
    out.push({ t: k, avg: o ? o.sum / o.n : null, max: o ? o.max : null });
  }
  return out;
}
export const powerHourly = (pts, from, to) => powerStats(pts, startOfHour, nextHour, from, to);
export const powerDaily = (pts, from, to) => powerStats(pts, startOfDay, nextDay, from, to);

// Dygnskostnad ur en dygnsnollställd kostnadsräknare (t.ex. accumulatedCost):
// det högsta värdet under dygnet. Insights steg kan missa de sista minuterna före
// midnatt, så värdet är en nedre gräns (A).
export function dailyMax(pts, from, to) {
  const map = new Map();
  for (const p of pts) {
    if (p.t < from || p.t >= to) continue;
    const k = startOfDay(p.t - 1); // värdet exakt vid midnatt hör till dygnet som slutar
    map.set(k, Math.max(map.get(k) ?? -Infinity, p.v));
  }
  return map;
}

// Kostnad = förbrukning per timme × pris för samma timme. priceAt(ms) → kr/kWh eller null.
// Returnerar { kr, kwh, kwhPriced } så att täckningen kan redovisas.
export function costFromHourly(hours, priceAt) {
  let kr = 0, kwh = 0, kwhPriced = 0;
  for (const h of hours) {
    kwh += h.kwh;
    const p = priceAt(h.t);
    if (p === null || p === undefined || !Number.isFinite(p)) continue;
    kr += h.kwh * p; kwhPriced += h.kwh;
  }
  return { kr, kwh, kwhPriced };
}
