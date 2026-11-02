// temperature.js – temperaturband och trend för rumskorten. Ren logik, inga nätanrop.
//
// Band inne: kallt under 19°, lagom 19–23,5°, varmt över 23,5°.
// Utomhusrum (kopplade till en utomhusyta i planritningen): frost under 5°, annars neutralt.
// Trend: ändring senaste timmen på minst 0,3° upp eller ned, annars stabil.
// Givare (0.7.2): kameror räknas inte (deras temperatur är kamerahusets, inte rummets).
// Ett värde som inte uppdaterats på 3 h räknas som inaktuellt och lämnas utanför snittet.

import { changedAt } from './activity.js';

export const IN_COLD = 19;
export const IN_WARM = 23.5;
export const OUT_FROST = 5;
export const TREND_MIN = 0.3;
export const HOUR = 3600000;
export const STALE_MS = 3 * HOUR;
export const NO_TEMP_CLASSES = new Set(['camera']);

function tempValue(d) {
  const o = d && d.capabilitiesObj && d.capabilitiesObj.measure_temperature;
  return o && typeof o === 'object' ? o.value : undefined;
}

// Givare som kan räknas i ett rums temperatur: tillgänglig, med värde, inte en kamera.
export function isTempSensor(d) {
  return Boolean(d) && d.available !== false && !NO_TEMP_CLASSES.has(d.class)
    && typeof tempValue(d) === 'number' && Number.isFinite(tempValue(d));
}

// Tidpunkt (ms) för temperaturvärdets senaste uppdatering, eller null om Homey inte anger den.
export function tempAt(d) { return changedAt(d, 'measure_temperature'); }

// Inaktuellt: senaste uppdatering äldre än STALE_MS. Saknas tiden räknas värdet som aktuellt (A).
export function isStale(d, now = Date.now()) {
  const t = tempAt(d);
  return t !== null && now - t > STALE_MS;
}

// Rummets temperatur ur dess enheter.
// Snittet tas av aktuella givare. Finns bara inaktuella används de, men markeras.
// Trenden räknas bara på aktuella givare. refOf(id) ger referensvärdet en timme bakåt.
// { temp, tr, stale: antal inaktuella, total, onlyStale, lastAt: senaste uppdatering bland de inaktuella }
export function roomTemperature(devs, refOf = () => null, now = Date.now()) {
  const all = (devs || []).filter(isTempSensor);
  const fresh = all.filter(d => !isStale(d, now));
  const old = all.filter(d => isStale(d, now));
  const use = fresh.length ? fresh : old;
  const vals = use.map(tempValue);
  const temp = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const tr = fresh.length ? trend(fresh.map(d => ({ now: tempValue(d), ref: refOf(d.id) }))) : null;
  const ts = old.map(tempAt).filter(t => t !== null);
  return { temp, tr, stale: old.length, total: all.length, onlyStale: !fresh.length && old.length > 0,
    lastAt: ts.length ? Math.max(...ts) : null };
}

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
