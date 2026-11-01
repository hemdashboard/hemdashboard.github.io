// temps.js – referensvärden för temperaturtrenden i rumskorten.
//
// Ett Insights-anrop per temperatursensor (measure_temperature, senaste timmen), plus ett
// reservanrop med längre fönster när timmen har färre än två punkter. Hämtas när rumsvyn
// visas och därefter högst var tionde minut. Nuvärdet tas ur enhetsdatan (realtid), så att
// pilen följer med utan nya Insights-anrop. Endast läsning (homey.insights.readonly).

import { state, deviceList } from './state.js';
import { capVal } from './ui.js';
import { insightLogList, findLog } from './energy.js';
import * as E from '../core/energy.js';
import { reference } from '../core/temperature.js';

const TTL = 10 * 60000;
const PARALLEL = 4;

const refs = new Map(); // enhets-id → referensvärde en timme bakåt (eller null)
let at = 0;
let busy = false;

function sensors() {
  return deviceList().filter(d => d.available !== false && Number.isFinite(capVal(d, 'measure_temperature')));
}

async function one(list, d, now) {
  const log = findLog(list, d, 'measure_temperature');
  if (!log) return null;
  const r1 = await state.homey.insightsEntries(log, 'lastHour');
  const hour = r1.ok ? E.points(r1.data) : [];
  if (hour.length >= 2) return reference(hour, [], now);
  const r2 = await state.homey.insightsEntries(log, 'last6Hours');
  return reference(hour, r2.ok ? E.points(r2.data) : [], now);
}

// Hämtar om referenserna om de är äldre än TTL. onDone anropas när nya värden finns.
export async function maybeLoad(onDone) {
  const homey = state.homey;
  if (busy || !homey || !homey.active || Date.now() - at < TTL) return;
  busy = true;
  try {
    const list = await insightLogList();
    if (!list.length) { state.diag.tempTrend = 'saknas'; at = Date.now(); return; }
    const now = Date.now();
    const devs = sensors();
    const next = new Map();
    let ok = 0;
    for (let i = 0; i < devs.length; i += PARALLEL) {
      const part = devs.slice(i, i + PARALLEL);
      const vals = await Promise.all(part.map(d => one(list, d, now).catch(() => null)));
      part.forEach((d, k) => { next.set(d.id, vals[k]); if (Number.isFinite(vals[k])) ok += 1; });
    }
    refs.clear();
    for (const [k, v] of next) refs.set(k, v);
    at = Date.now();
    state.diag.tempTrend = `${ok}/${devs.length}`;
    if (onDone) onDone();
  } finally {
    busy = false;
  }
}

export function refOf(id) {
  const v = refs.get(id);
  return Number.isFinite(v) ? v : null;
}

export function reset() { refs.clear(); at = 0; }
