// prices.js – rena beräkningar på spotpris. Inga nätanrop.
//
// Källa: elprisetjustnu.se, kr/kWh exklusive moms, avgifter och skatt. Perioderna är
// 15 minuter sedan hösten 2025 (tidigare 60). Båda hanteras: varje period har start och slut.
//
// Period: { t: start (ms), e: slut (ms), p: kr/kWh }.

export function normalize(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r) continue;
    const t = Date.parse(r.time_start), e = Date.parse(r.time_end);
    const p = Number(r.SEK_per_kWh);
    if (Number.isFinite(t) && Number.isFinite(e) && e > t && Number.isFinite(p)) out.push({ t, e, p });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function merge(...lists) {
  const map = new Map();
  for (const l of lists) for (const x of l || []) map.set(x.t, x);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function priceAt(series, ms) {
  for (const x of series) if (ms >= x.t && ms < x.e) return x.p;
  return null;
}

// Tidsviktat medelpris per timme i [from, to). { t, p | null }.
export function hourlyAvg(series, from, to) {
  const out = [];
  for (let h = from; h < to; h += 3600000) {
    let w = 0, s = 0;
    for (const x of series) {
      const a = Math.max(x.t, h), b = Math.min(x.e, h + 3600000);
      if (b > a) { s += x.p * (b - a); w += b - a; }
    }
    out.push({ t: h, p: w > 0 ? s / w : null });
  }
  return out;
}

// Medelpris för [a, b) om hela intervallet har pris, annars null.
function avgOver(series, a, b) {
  let w = 0, s = 0;
  for (const x of series) {
    const lo = Math.max(x.t, a), hi = Math.min(x.e, b);
    if (hi > lo) { s += x.p * (hi - lo); w += hi - lo; }
  }
  return w >= (b - a) - 1000 ? s / w : null;
}

// Billigaste sammanhängande fönster om `hours` timmar som startar mellan `from` och
// `from + horizonH` och slutar senast där prisdata tar slut. Kandidater: nu (`from`) och
// varje periodgräns (15 eller 60 min) därefter.
// Returnerar { t, e, avg, ref } där ref är medelpriset över hela sökhorisonten, eller null.
export function cheapestWindow(series, from, hours, horizonH = 24) {
  if (!series.length) return null;
  const len = hours * 3600000;
  const limit = Math.min(from + horizonH * 3600000, series[series.length - 1].e);
  const starts = [from, ...series.filter(x => x.t > from).map(x => x.t)];
  let best = null;
  for (const s of starts) {
    if (s + len > limit) break;
    const a = avgOver(series, s, s + len);
    if (a === null) continue;
    if (!best || a < best.avg - 1e-9) best = { t: s, e: s + len, avg: a };
  }
  if (!best) return null;
  best.ref = avgOver(series, Math.max(from, series[0].t), limit);
  return best;
}

// Pristoppar per dygn (hela timmar): de 3 dyraste timmarna, och dessutom varje timme som
// är minst 50 % över dygnets median. Kräver minst 0,05 kr/kWh över median så att en
// platt dag inte får toppar.
export function peakHours(hours) {
  const vals = hours.filter(h => h.p !== null);
  if (vals.length < 6) return new Set();
  const sorted = vals.map(h => h.p).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const top3 = [...vals].sort((a, b) => b.p - a.p).slice(0, 3);
  const out = new Set();
  for (const h of top3) if (h.p - median >= 0.05) out.add(h.t);
  for (const h of vals) if (h.p >= median * 1.5 && h.p - median >= 0.05) out.add(h.t);
  return out;
}

export function dayStats(hours) {
  const v = hours.filter(h => h.p !== null).map(h => h.p);
  if (!v.length) return null;
  return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length };
}
