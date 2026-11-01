// temperature.js – temperaturband och trend för rumskorten. Ren logik, inga nätanrop.
//
// Band inne: kallt under 19°, lagom 19–23,5°, varmt över 23,5°.
// Utomhusrum (kopplade till en utomhusyta i planritningen): frost under 5°, annars neutralt.
// Trend: ändring senaste timmen på minst 0,3° upp eller ned, annars stabil.

export const IN_COLD = 19;
export const IN_WARM = 23.5;
export const OUT_FROST = 5;
export const TREND_MIN = 0.3;
export const HOUR = 3600000;

// 'cold' | 'ok' | 'warm' | 'frost' | null
export function band(temp, outdoor = false) {
  if (typeof temp !== 'number' || !Number.isFinite(temp)) return null;
  if (outdoor) return temp < OUT_FROST ? 'frost' : 'ok';
  if (temp < IN_COLD) return 'cold';
  if (temp > IN_WARM) return 'warm';
  return 'ok';
}

// Referensvärde för en sensor en timme bakåt.
// hour: punkter från senaste timmen, before: punkter från ett längre fönster (reserv).
// Minst två punkter i timmen → den första. Annars sista punkten före timmen.
// Returnerar ett tal eller null.
export function reference(hour, before, now = Date.now()) {
  const h = Array.isArray(hour) ? hour.filter(p => p && Number.isFinite(p.v)) : [];
  if (h.length >= 2) return h[0].v;
  const cut = now - HOUR;
  const b = Array.isArray(before) ? before.filter(p => p && Number.isFinite(p.v) && p.t <= cut) : [];
  return b.length ? b[b.length - 1].v : null;
}

// Rummets ändring: medel av sensorernas ändring (nuvärde − referens), bara sensorer med båda.
// pairs: [{ now, ref }]. Returnerar { delta, dir } där dir är 'up' | 'down' | 'flat', eller null.
export function trend(pairs) {
  const ds = (pairs || [])
    .filter(p => p && Number.isFinite(p.now) && Number.isFinite(p.ref))
    .map(p => p.now - p.ref);
  if (!ds.length) return null;
  const delta = ds.reduce((a, b) => a + b, 0) / ds.length;
  const e = 1e-9; // flyttalsmarginal: 20,3 − 20,0 ska räknas som 0,3
  const dir = delta >= TREND_MIN - e ? 'up' : delta <= -TREND_MIN + e ? 'down' : 'flat';
  return { delta, dir };
}
