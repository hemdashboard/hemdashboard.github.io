// energy.js – el: mätare, Insights, spotpris, kostnad, tips. Hämtar och ritar.
//
// Datakällor:
//   - Elmätare: enheten med measure_power och en energimätare. Väljs automatiskt
//     (Tibber Pulse-liknande först) eller i Inställningar. Ingen enhet nämns i koden.
//   - Insights (homey.insights.readonly): förbrukning och effekt i dag, 7 och 30 dygn,
//     dygnskostnad ur accumulatedCost om mätaren har den.
//   - Prisenhet: enhet med measure_price_total (Tibber-hemmet). Pris nu, och dagens pris
//     ur Insights som linje över spotpriset.
//   - Spotpris: elprisetjustnu.se för i dag och i morgon (exkl. moms och avgifter).
//
// Antaganden (A), redovisas i Inställningar → Kontroll:
//   A1 Insights-upplösningarna 'today', 'last7Days', 'last31Days' finns (last24Hours är verifierad).
//   A2 meter_power på en mätare med accumulatedCost nollställs vid midnatt (Tibber Pulse).
//   A3 accumulatedCost är dagens kostnad i kr och nollställs vid midnatt.

import { state, prefs, setPref, deviceList, changed } from './state.js';
import { h, num, kr, power, hh, hhmm, dayLabel, weekday, capVal, hasCap, note, chartWidth, info } from './ui.js';
import { asList } from '../adapters/homey.js';
import * as spot from '../adapters/spotpris.js';
import * as E from '../core/energy.js';
import * as P from '../core/prices.js';
import { barChart } from '../core/svg.js';

const DAY = 86400000, HOUR = 3600000;
const LOGS_TTL = 3600000;
let logsCache = { at: 0, list: [] };

// ---------- Val av enheter ----------

function isTibberish(d) {
  return /tibber/i.test(`${d.driverUri || ''} ${d.driverId || ''} ${d.ownerUri || ''}`);
}

export function meterCandidates() {
  return deviceList()
    .filter(d => hasCap(d, 'measure_power') && (hasCap(d, 'meter_power.imported') || hasCap(d, 'meter_power') || hasCap(d, 'accumulatedCost')))
    .map(d => ({
      d,
      score: (hasCap(d, 'accumulatedCost') ? 4 : 0) + (hasCap(d, 'meter_power.imported') ? 3 : 0)
        + (isTibberish(d) ? 2 : 0) + (['socket', 'light', 'coffeemachine', 'heater', 'evcharger'].includes(d.class) ? -5 : 0),
    }))
    .sort((a, b) => b.score - a.score || String(a.d.name).localeCompare(String(b.d.name), 'sv'))
    .map(x => x.d);
}

export function priceCandidates() {
  return deviceList().filter(d => hasCap(d, 'measure_price_total'));
}

export function meter() {
  const id = prefs().meterId;
  if (id && state.devices.has(id)) return state.devices.get(id);
  const c = meterCandidates();
  return c.length && meterScore(c[0]) > 0 ? c[0] : null;
}

function meterScore(d) {
  return (hasCap(d, 'accumulatedCost') ? 4 : 0) + (hasCap(d, 'meter_power.imported') ? 3 : 0) + (isTibberish(d) ? 2 : 0);
}

export function priceDevice() {
  const id = prefs().priceId;
  if (id && state.devices.has(id)) return state.devices.get(id);
  return priceCandidates()[0] || null;
}

// ---------- Insights ----------

async function logs() {
  if (Date.now() - logsCache.at < LOGS_TTL && logsCache.list.length) return logsCache.list;
  const r = await state.homey.insightsLogs();
  state.diag.insightsLogs = r.ok ? 'ok' : r.err;
  if (!r.ok) return [];
  logsCache = { at: Date.now(), list: asList(r.data).filter(l => l && typeof l.id === 'string') };
  return logsCache.list;
}

function findLog(list, device, cap) {
  if (!device) return null;
  const owner = `homey:device:${device.id}`;
  return list.find(l => (l.ownerUri === owner || l.uri === owner || String(l.id).startsWith(`${owner}:`))
    && (l.ownerId === cap || l.id === cap || String(l.id).endsWith(`:${cap}`))) || null;
}

function logOwner(l) {
  return String(l.ownerUri || l.uri || (String(l.id).match(/^(homey:[a-z]+:[^:]+):/) || [])[1] || '');
}

// Prisloggen: på prisenheten om den finns, annars Tibber-appens applogg '<hem>_price'
// (O 1/11: Tibber loggar priset per hem som applogg). Hemmet väljs på titel som innehåller
// enhetens namn, annars den enda.
function findPriceLog(list, pd) {
  const own = findLog(list, pd, 'measure_price_total');
  if (own) return own;
  const app = list.filter(l => /^homey:app:com\.tibber/.test(logOwner(l)) && /_price$/.test(String(l.id)) && l.type !== 'boolean');
  if (!app.length) return null;
  const name = pd && pd.name ? String(pd.name).toLowerCase() : '';
  return (name && app.find(l => String(l.title || '').toLowerCase().includes(name))) || (app.length === 1 ? app[0] : null);
}

async function entries(log, resolution, key, fallback) {
  if (!log) { state.diag[key] = 'saknas'; return []; }
  let r = await state.homey.insightsEntries(log, resolution);
  if (!r.ok && fallback) r = await state.homey.insightsEntries(log, fallback);
  state.diag[key] = r.ok ? 'ok' : r.err;
  return r.ok ? E.points(r.data) : [];
}

export function resetLogs() { logsCache = { at: 0, list: [] }; }

export async function loadEnergy() {
  if (!state.homey || !state.homey.active) return;
  const m = meter();
  const pd = priceDevice();
  if (!m) { state.energy = { err: 'no-meter', at: Date.now() }; changed('energy'); return; }
  const list = await logs();
  const cumCap = findLog(list, m, 'meter_power.imported') ? 'meter_power.imported' : 'meter_power';
  const cumLog = findLog(list, m, cumCap);
  // Effekt: measure_power, annars energy_power (O 1/11: Pulse loggar bara energy_power).
  const powLog = findLog(list, m, 'measure_power') || findLog(list, m, 'energy_power');
  const costLog = hasCap(m, 'accumulatedCost') ? findLog(list, m, 'accumulatedCost') : null;
  const priceLog = findPriceLog(list, pd);

  const [cumDay, powDay, cum7, pow7, cum31, pow31, cost31, priceDay] = await Promise.all([
    entries(cumLog, 'today', 'förbrukning i dag', 'last24Hours'),
    entries(powLog, 'today', 'effekt i dag', 'last24Hours'),
    entries(cumLog, 'last7Days', 'förbrukning 7 d'),
    entries(powLog, 'last7Days', 'effekt 7 d'),
    entries(cumLog, 'last31Days', 'förbrukning 30 d'),
    entries(powLog, 'last31Days', 'effekt 30 d'),
    costLog ? entries(costLog, 'last31Days', 'kostnad 30 d') : Promise.resolve(null),
    priceLog ? entries(priceLog, 'today', 'pris i dag', 'last24Hours') : Promise.resolve([]),
  ]);

  // Prisets Insights 31 dygn: bakgrund i förbrukningsdiagrammet, och kostnad när kostnadslogg saknas.
  let price31 = null;
  if (priceLog) price31 = await entries(priceLog, 'last31Days', 'pris 30 d');

  state.energy = { meterId: m.id, cumCap, cumDay, powDay, cum7, pow7, cum31, pow31, cost31, priceDay, price31, at: Date.now() };
  changed('energy');
}

// Pris (kr/kWh) vid tid ms ur en punktserie: senaste punkten som började före ms + 30 min.
function stepPriceAt(pts) {
  return (ms) => {
    let v = null;
    for (const p of pts) { if (p.t <= ms + 30 * 60000) v = p.v; else break; }
    return v;
  };
}

// Sammanställer siffrorna som visas. Ren funktion av state.
export function figures(now = Date.now()) {
  const m = meter();
  const pd = priceDevice();
  const out = { meter: m, priceDevice: pd, powerNow: m ? capVal(m, 'measure_power') : null,
    priceNow: pd ? capVal(pd, 'measure_price_total') : null };
  const en = state.energy;
  if (!m || !en || en.err || en.meterId !== m.id) return out;

  const day0 = E.startOfDay(now), month0 = E.startOfMonth(now);
  const hours = E.hourly(en.cumDay, day0, day0 + DAY);
  // Live-värden för i dag när mätaren har dem (A2, A3), annars Insights.
  const liveKwh = hasCap(m, 'accumulatedCost') && en.cumCap !== 'meter_power' ? capVal(m, 'meter_power') : null;
  out.todayKwh = Number.isFinite(liveKwh) ? liveKwh : hours.reduce((s, x) => s + x.kwh, 0);
  out.todayKwhSrc = Number.isFinite(liveKwh) ? 'mätaren' : 'Insights';

  const liveCost = capVal(m, 'accumulatedCost');
  if (Number.isFinite(liveCost)) { out.todayKr = liveCost; out.costSrc = 'Tibber'; }
  else if (en.priceDay && en.priceDay.length) {
    const c = E.costFromHourly(hours, stepPriceAt(en.priceDay));
    out.todayKr = c.kr; out.costSrc = 'förbrukning × Tibber-pris';
    out.todayPartial = c.kwhPriced < c.kwh * 0.95;
  }

  out.monthKwh = E.sumKwh(en.cum31, month0, now);
  if (out.todayKwhSrc === 'mätaren') out.monthKwh = E.sumKwh(en.cum31, month0, day0) + out.todayKwh;
  const daysBefore = Math.round((day0 - month0) / DAY);
  if (en.cost31 && en.cost31.length && Number.isFinite(out.todayKr)) {
    const dm = E.dailyMax(en.cost31, month0, day0);
    let s = 0; for (const v of dm.values()) s += v;
    out.monthKr = s + out.todayKr;
    out.monthDays = dm.size; out.monthDaysExpected = daysBefore;
  } else if (!(en.cost31 && en.cost31.length) && en.price31 && en.price31.length) {
    const c = E.costFromHourly(E.hourly(en.cum31, month0, now), stepPriceAt(en.price31));
    out.monthKr = c.kr; out.monthPartial = c.kwhPriced < c.kwh * 0.95;
    out.monthDays = daysBefore; out.monthDaysExpected = daysBefore;
  }
  return out;
}

// ---------- Spotpris ----------

export async function loadSpot() {
  const zone = prefs().zone;
  const [t, m] = await Promise.all([spot.today(zone), spot.tomorrow(zone)]);
  state.diag['spotpris i dag'] = t.ok ? 'ok' : t.err;
  state.diag['spotpris i morgon'] = m.ok ? 'ok' : (m.status === 404 ? 'ej publicerat' : m.err);
  const series = P.merge(t.ok ? P.normalize(t.data) : [], m.ok ? P.normalize(m.data) : []);
  state.spot = { series, today: t.ok, tomorrow: m.ok, tomorrowStatus: m.status, zone, day: E.startOfDay(Date.now()), at: Date.now() };
  changed('spot');
}

export function spotNeedsReload(now = Date.now()) {
  const s = state.spot;
  if (!s) return true;
  if (s.day !== E.startOfDay(now) || s.zone !== prefs().zone) return true;
  if (!s.today && now - s.at > 10 * 60000) return true;
  if (!s.tomorrow && new Date(now).getHours() >= 13 && now - s.at > 20 * 60000) return true;
  return false;
}

export function tips(now = Date.now()) {
  const s = state.spot;
  if (!s || !s.series.length) return null;
  const w3 = P.cheapestWindow(s.series, now, 3, 24);
  const w5 = P.cheapestWindow(s.series, now, 5, 24);
  const day0 = E.startOfDay(now);
  const peaks = [];
  for (const d of [day0, day0 + DAY]) {
    const hrs = P.hourlyAvg(s.series, d, d + DAY);
    const set = P.peakHours(hrs);
    // Sammanhängande timmar till intervall, bara de som inte är passerade.
    let cur = null;
    for (const x of hrs) {
      if (set.has(x.t) && x.t + HOUR > now) {
        if (cur && cur.e === x.t) { cur.e = x.t + HOUR; cur.max = Math.max(cur.max, x.p); }
        else { cur = { t: x.t, e: x.t + HOUR, max: x.p }; peaks.push(cur); }
      }
    }
  }
  const nowP = P.priceAt(s.series, now);
  return { w3, w5, peaks, nowP, horizonEnd: s.series[s.series.length - 1].e };
}

// ---------- Rendering ----------

function windowLine(label, use, w, now) {
  if (!w) return h('div.tip', h('div.tip-head', label), h('div.tip-val', 'Väntar på fler priser'), h('div.tip-sub', use));
  const saving = w.ref > 0 ? Math.round((1 - w.avg / w.ref) * 100) : null;
  return h('div.tip',
    h('div.tip-head', label),
    h('div.tip-val', `${w.t <= now ? 'nu' : `${dayLabel(w.t, now) === 'i dag' ? '' : `${dayLabel(w.t, now)} `}${hhmm(w.t)}`}–${hhmm(w.e)}`),
    h('div.tip-sub', `${use} · snitt ${num(w.avg, 2)} kr/kWh${saving !== null && saving > 0 ? ` · ${saving} % under snittet` : ''}`));
}

function peaksLine(peaks, now) {
  if (!peaks.length) return h('div.tip', h('div.tip-head', 'Pristoppar'), h('div.tip-val', 'Inga markerade'), h('div.tip-sub', 'Jämna priser framåt'));
  const txt = peaks.slice(0, 3).map(p => `${dayLabel(p.t, now) === 'i dag' ? '' : `${dayLabel(p.t, now)} `}${hh(p.t)}–${hh(p.e)}`).join(', ');
  return h('div.tip.peak',
    h('div.tip-head', 'Pristoppar'),
    h('div.tip-val', txt),
    h('div.tip-sub', `upp till ${num(Math.max(...peaks.map(p => p.max)), 2)} kr/kWh · undvik stora förbrukare`));
}

export function tipsBody(now = Date.now()) {
  const t = tips(now);
  if (!t) return [note(state.spot ? 'Inga spotpriser än.' : 'Hämtar spotpriser…')];
  return [
    windowLine('Billigaste 5 h', 'laddning', t.w5, now),
    windowLine('Billigaste 3 h', 'tvätt och disk', t.w3, now),
    peaksLine(t.peaks, now),
    info('tips', `Spotpris ${state.spot.zone}, exkl. moms och avgifter. Billigaste sammanhängande 3 och 5 timmar som börjar inom 24 timmar. Pristoppar: dygnets tre dyraste timmar och timmar minst 50 % över dygnets median. Bygger enbart på pris${state.spot.tomorrow ? '' : '; morgondagens priser publiceras ca 13'}.`),
  ];
}

function stat(label, value, sub, cls = '') {
  return h(`div.stat${cls ? `.${cls}` : ''}`, h('div.stat-label', label), h('div.stat-val', value), sub ? h('div.stat-sub', sub) : null);
}

export function elCardBody(now = Date.now()) {
  const f = figures(now);
  if (!f.meter) return [note(state.devices.size ? 'Ingen elmätare hittad. Välj i Inställningar.' : 'Hämtar…')];
  return [
    h('div.big', power(f.powerNow), h('span.unit', 'nu')),
    h('div.stats',
      stat('I dag', `${num(f.todayKwh, 1)} kWh`, Number.isFinite(f.todayKr) ? kr(f.todayKr) : null),
      stat('Månaden', `${num(f.monthKwh, 0)} kWh`, Number.isFinite(f.monthKr) ? kr(f.monthKr) : null),
      stat('Pris nu', Number.isFinite(f.priceNow) ? `${num(f.priceNow, 2)}` : '–', 'kr/kWh')),
  ];
}

function rangeButtons(cur, onPick) {
  const opts = [['day', 'I dag'], ['7', '7 dagar'], ['30', '30 dagar']];
  return h('div.seg', { role: 'group', 'aria-label': 'Period' },
    ...opts.map(([k, l]) => h('button', { 'aria-pressed': cur === k ? 'true' : 'false', onclick: () => onPick(k) }, l)));
}

// Pris per hink i [from, to) ur Insights-punkter: tidsviktat medel av stegvärdena.
function pricePerBucket(pts, from, to, step) {
  const out = [];
  for (let b = from; b < to; b = step(b)) {
    const e = step(b);
    let w = 0, sum = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i].t, z = i + 1 < pts.length ? pts[i + 1].t : a + HOUR;
      const lo = Math.max(a, b), hi = Math.min(z, e);
      if (hi > lo) { sum += pts[i].v * (hi - lo); w += hi - lo; }
    }
    out.push(w > 0 ? sum / w : null);
  }
  return out;
}

// Bakgrundspriset: Tibbers totalpris ur Insights; för i dag spotpris som reserv.
function priceBackground(range, now) {
  const en = state.energy;
  const day0 = E.startOfDay(now);
  if (range === 'day') {
    if (en.priceDay && en.priceDay.length) {
      const v = pricePerBucket(en.priceDay, day0, day0 + DAY, t => t + HOUR);
      return { bg: v.map((x, i) => (day0 + i * HOUR <= now ? x : null)), src: 'Tibber totalpris' };
    }
    if (state.spot && state.spot.series.length) {
      return { bg: P.hourlyAvg(state.spot.series, day0, day0 + DAY).map(x => (x.t <= now ? x.p : null)), src: 'spotpris exkl. moms' };
    }
    return null;
  }
  if (!en.price31 || !en.price31.length) return null;
  const n = range === '7' ? 7 : 30;
  return { bg: pricePerBucket(en.price31, E.addDays(day0, -(n - 1)), day0 + DAY, t => E.addDays(t, 1)), src: 'Tibber totalpris, dygnsmedel' };
}

function consumptionChart(range, now) {
  const en = state.energy;
  const day0 = E.startOfDay(now);
  const bgp = priceBackground(range, now);
  if (range === 'day') {
    const hours = E.hourly(en.cumDay, day0, day0 + DAY);
    const pw = E.powerHourly(en.powDay, day0, day0 + DAY);
    const cur = Math.floor((now - day0) / HOUR);
    const bars = hours.map((x, i) => ({ v: i > cur ? null : x.kwh, label: hh(x.t), cls: i === cur ? 'cur' : '', title: `${hh(x.t)}: ${num(x.kwh, 2)} kWh` }));
    const total = hours.reduce((s, x) => s + x.kwh, 0);
    const top = pw.reduce((a, x) => (x.max !== null && (!a || x.max > a.max) ? x : a), null);
    return {
      svg: barChart(bars, { width: chartWidth(), fmt: v => num(v, 1), labelEvery: 3, now: cur, line: pw.map((x, i) => (i > cur ? null : x.avg)),
        bg: bgp ? bgp.bg : null, bgFmt: v => num(v, 1), label: 'Förbrukning per timme i dag mot pris' }),
      bgSrc: bgp ? bgp.src : null,
      hasLine: pw.some(x => x.avg !== null),
      sum: `${num(total, 1)} kWh i dag${top ? ` · högsta effekt ${power(top.max)} kl ${hh(top.t)}` : ''}`,
    };
  }
  const n = range === '7' ? 7 : 30;
  const pts = n === 7 ? en.cum7 : en.cum31;
  const pws = n === 7 ? en.pow7 : en.pow31;
  const from = E.addDays(day0, -(n - 1));
  const days = E.daily(pts, from, day0 + DAY);
  const pw = E.powerDaily(pws, from, day0 + DAY);
  const bars = days.map((x, i) => ({
    v: x.has ? x.kwh : null,
    label: n === 7 ? weekday(x.t) : `${new Date(x.t).getDate()}/${new Date(x.t).getMonth() + 1}`,
    cls: i === days.length - 1 ? 'cur' : '',
    title: `${dayLabel(x.t, now)}: ${num(x.kwh, 1)} kWh`,
  }));
  const full = days.slice(0, -1).filter(x => x.has);
  const avg = full.length ? full.reduce((s, x) => s + x.kwh, 0) / full.length : null;
  return {
    svg: barChart(bars, { width: chartWidth(), fmt: v => num(v, 0), labelEvery: n === 7 ? 1 : 5, line: pw.map(x => x.max),
      bg: bgp ? bgp.bg : null, bgFmt: v => num(v, 1), label: `Förbrukning per dygn, ${n} dygn, mot pris` }),
    bgSrc: bgp ? bgp.src : null,
    hasLine: pw.some(x => x.max !== null),
    sum: `${num(days.reduce((s, x) => s + x.kwh, 0), 0)} kWh totalt${avg !== null ? ` · snitt ${num(avg, 1)} kWh per hela dygn` : ''}`,
  };
}

function spotChart(now) {
  const s = state.spot;
  const day0 = E.startOfDay(now);
  const span = s.tomorrow ? 2 : 1;
  const hrs = P.hourlyAvg(s.series, day0, day0 + span * DAY);
  const t = tips(now);
  const peaks = new Set();
  for (let d = 0; d < span; d += 1) for (const x of P.peakHours(hrs.slice(d * 24, d * 24 + 24))) peaks.add(x);
  const inWin = (w, x) => w && x.t + HOUR > w.t && x.t < w.e;
  const cur = Math.floor((now - day0) / HOUR);
  const bars = hrs.map((x, i) => ({
    v: x.p,
    label: i % 24 === 0 ? (i ? 'i morgon' : 'i dag') : hh(x.t),
    cls: peaks.has(x.t) ? 'peak' : inWin(t && t.w5, x) ? 'cheap' : i < cur ? 'past' : '',
    title: `${dayLabel(x.t, now)} ${hh(x.t)}: ${num(x.p, 2)} kr/kWh`,
  }));
  // Tibber-priset i dag (inkl. skatt och moms) som linje, per timme, om Insights har det.
  let line = null;
  const en = state.energy;
  if (en && en.priceDay && en.priceDay.length) {
    const at = stepPriceAt(en.priceDay);
    line = hrs.map((x, i) => (i < 24 && x.t <= now ? at(x.t) : null));
    if (!line.some(v => v !== null)) line = null;
  }
  return barChart(bars, { width: chartWidth(), fmt: v => num(v, 1), labelEvery: span === 2 ? 6 : 3, now: cur, line, lineSameScale: true, label: 'Spotpris per timme' });
}

export function renderEnergy(root, now = Date.now()) {
  const p = prefs();
  const f = figures(now);
  const kids = [];

  // Nu
  if (!f.meter) kids.push(h('section.card', h('h2', 'El'), note(state.devices.size ? 'Ingen elmätare hittad. Välj en i Inställningar.' : 'Hämtar…')));
  else {
    const monthSub = Number.isFinite(f.monthKr)
      ? `${kr(f.monthKr)}${f.monthDaysExpected && f.monthDays < f.monthDaysExpected ? ` · ${f.monthDays} av ${f.monthDaysExpected} dygn` : ''}${f.monthPartial ? ' · ofullständig' : ''}`
      : null;
    kids.push(h('section.card',
      h('h2', 'El nu'),
      h('div.big', power(f.powerNow), h('span.unit', 'effekt')),
      h('div.stats',
        stat('I dag', `${num(f.todayKwh, 1)} kWh`, Number.isFinite(f.todayKr) ? `${kr(f.todayKr)}${f.todayPartial ? ' · ofullständig' : ''}` : null),
        stat('Månaden', `${num(f.monthKwh, 0)} kWh`, monthSub),
        stat('Pris nu', Number.isFinite(f.priceNow) ? num(f.priceNow, 2) : '–', 'kr/kWh totalt')),
      info('elnu', `Pris nu: Tibber, inkl. skatt och moms. Kostnad: ${f.costSrc || 'saknas'}. Förbrukning i dag: ${f.todayKwhSrc || '–'}. Månaden: förbrukning ur Insights${Number.isFinite(f.monthKr) ? ', kostnad = förbrukning per timme × Tibbers pris samma timme' : ''}.`)));
  }

  // Tips direkt efter siffrorna (bredvid dem på bred skärm)
  kids.push(h('section.card', h('h2', 'Smarta tips'), h('div.tips', ...tipsBody(now))));

  // Förbrukning
  const en = state.energy;
  if (f.meter) {
    const box = h('section.card', h('div.card-head', h('h2', 'Förbrukning'),
      rangeButtons(p.energyRange, (k) => { setPref('energyRange', k); renderEnergy(root); })));
    if (!en) box.append(note('Hämtar Insights…'));
    else if (en.err || en.meterId !== f.meter.id) box.append(note('Hämtar Insights…'));
    else {
      const c = consumptionChart(p.energyRange, now);
      box.append(c.svg, h('div.legend', h('span.key.bar', 'kWh (vänster)'),
        c.bgSrc ? h('span.key.bg', `kr/kWh (höger): ${c.bgSrc}`) : null,
        c.hasLine ? h('span.key.line', p.energyRange === 'day' ? 'medeleffekt' : 'högsta effekt') : null), h('p.fine', c.sum));
    }
    kids.push(box);
  }

  // Spotpris
  const sbox = h('section.card', h('h2', `Spotpris ${p.zone}`));
  if (!state.spot) sbox.append(note('Hämtar spotpriser…'));
  else if (!state.spot.series.length) sbox.append(note('Spotpriser kunde inte hämtas.', 'fail'));
  else {
    const day0 = E.startOfDay(now);
    const td = P.dayStats(P.hourlyAvg(state.spot.series, day0, day0 + DAY));
    const tm = state.spot.tomorrow ? P.dayStats(P.hourlyAvg(state.spot.series, day0 + DAY, day0 + 2 * DAY)) : null;
    sbox.append(
      spotChart(now),
      h('div.legend', h('span.key.cheap', 'billigaste 5 h'), h('span.key.peak', 'pristopp'),
        en && en.priceDay && en.priceDay.length ? h('span.key.line', 'Tibber i dag') : null),
      h('div.stats',
        td ? stat('I dag', `${num(td.avg, 2)}`, `${num(td.min, 2)}–${num(td.max, 2)} kr/kWh`) : null,
        tm ? stat('I morgon', `${num(tm.avg, 2)}`, `${num(tm.min, 2)}–${num(tm.max, 2)} kr/kWh`) : stat('I morgon', '–', 'publiceras ca 13')),
      info('spot', 'Staplar: spotpris per timme (medel av kvartspriser), exkl. moms och avgifter. Linjen: Tibbers totalpris i dag inkl. skatt och moms, i samma skala. Grönt: billigaste 5 timmar. Orange: pristoppar.'));
  }
  kids.push(sbox);
  root.replaceChildren(...kids);
}
