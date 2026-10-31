// checks.js – testsidans kontroller och den anonyma sammanfattningen.
// Sammanfattningen innehåller bara status, antal, tider och felkategorier –
// aldrig namn, ID, adresser, positioner eller nyckel.

import { asList } from '../adapters/homey.js';
import { autoK, isK, canToggle, localKCount } from '../core/kguard.js';
import * as smhi from '../adapters/smhi.js';
import * as spot from '../adapters/spotpris.js';

export const LAB_VERSION = '0.1.3';

export const CHECKS = [
  { id: '1',  title: 'Moln: API-nyckel från webbläsaren (CORS)' },
  { id: '2',  title: 'Lokalt: localUrlSecure från webbläsaren', note: 'Kräver hemmanätet' },
  { id: '3',  title: 'homey-api-biblioteket i webbläsaren' },
  { id: '4a', title: 'Läsa enheter med valda scopes' },
  { id: '4b', title: 'Styra: device.control räcker', note: 'Välj en ofarlig lampa i listan nedan och tryck Växla' },
  { id: '4k', title: 'K-enheter saknar reglage' },
  { id: '5',  title: 'Realtid i webbläsaren (60 s)', note: 'Tänd/släck något under tiden, här eller i Homey-appen' },
  { id: '7',  title: 'Närvaro läsbar' },
  { id: '8',  title: 'Insights läsbart' },
  { id: '11', title: 'Spotpris i dag och i morgon' },
  { id: '12', title: 'SMHI-prognos' },
];

// status: wait | run | ok | warn | fail | skip
export function initialState() {
  const s = {};
  for (const c of CHECKS) s[c.id] = { status: 'wait', detail: '' };
  s['3'] = { status: 'skip', detail: 'uppskjutet: biblioteket kunde inte hämtas till bygget. Egen adapter används; prövas bara om 5 faller' };
  return s;
}

// ---------- Körning ----------

export async function runConnection(homey, set) {
  const results = {};
  for (const [id, mode] of [['1', 'cloud'], ['2', 'local']]) {
    if (!homey.has(mode)) { set(id, 'skip', mode === 'cloud' ? 'inget Homey-ID angivet' : 'ingen lokal IP angiven'); continue; }
    set(id, 'run', '');
    // Två anrop: första kan inkludera TLS-uppsättning, andra visar ordinarie svarstid
    const a = await homey.ping(mode);
    const b = a.ok ? await homey.ping(mode) : null;
    results[mode] = a.ok;
    if (a.ok) set(id, 'ok', `${a.ms} ms, sedan ${b.ms} ms`, { ms1: a.ms, ms2: b.ms });
    else set(id, mode === 'local' && (a.err === 'network' || a.err === 'timeout') ? 'warn' : 'fail', mode === 'local' && (a.err === 'network' || a.err === 'timeout') ? `${a.err} – väntat utanför hemmanätet` : a.err, { err: a.err, ms: a.ms });
  }
  // Lokalt först om det svarar, annars moln
  homey.use(results.local ? 'local' : (results.cloud ? 'cloud' : null));
  return homey.active;
}

export async function runDevices(homey, set) {
  if (!homey.active) { set('4a', 'skip', 'ingen anslutning'); return []; }
  set('4a', 'run', '');
  const res = await homey.devices();
  if (!res.ok) { set('4a', 'fail', res.err, { err: res.err }); return []; }
  const list = asList(res.data);
  const toggle = list.filter(canToggle).length;
  const kAuto = list.filter(autoK).length;
  const kTotal = list.filter(isK).length;
  const avail = list.filter(d => d.available === false).length;
  set('4a', 'ok', `${list.length} enheter, ${toggle} med reglage, K ${kTotal} (auto ${kAuto}, egna ${localKCount()}), ej nåbara ${avail}, ${res.ms} ms`,
    { n: list.length, toggle, kAuto, kTotal, kLocal: localKCount(), unavailable: avail, ms: res.ms });
  return list;
}

export async function runToggle(homey, device, set) {
  set('4b', 'run', '');
  const cur = device.capabilitiesObj && device.capabilitiesObj.onoff ? device.capabilitiesObj.onoff.value : null;
  const next = !cur;
  const w = await homey.setCapability(device.id, 'onoff', next);
  if (!w.ok) { set('4b', 'fail', w.err, { err: w.err, ms: w.ms }); return null; }
  const r = await homey.device(device.id);
  const after = r.ok && r.data && r.data.capabilitiesObj && r.data.capabilitiesObj.onoff ? r.data.capabilitiesObj.onoff.value : undefined;
  const confirmed = after === next;
  set('4b', confirmed ? 'ok' : 'warn', `skrivning ${w.ms} ms, återläst ${confirmed ? 'stämmer' : 'stämmer inte ännu'}`,
    { msWrite: w.ms, readback: confirmed });
  return r.ok ? r.data : null;
}

export function runKRender(listEl, devices, set) {
  const kIds = new Set(devices.filter(isK).map(d => d.id));
  let rows = 0, withControl = 0;
  for (const li of listEl.querySelectorAll('li[data-k="1"]')) {
    rows += 1;
    if (li.querySelector('button.toggle')) withControl += 1;
  }
  const ok = rows === kIds.size && withControl === 0;
  set('4k', ok ? 'ok' : 'fail', `${rows} K-rader, ${withControl} med reglage`, { rows, withControl });
}

export async function runRealtime(homey, set, seconds = 60) {
  if (!homey.active) { set('5', 'skip', 'ingen anslutning'); return; }
  set('5', 'run', `lyssnar ${seconds} s via ${homey.active === 'local' ? 'lokalt' : 'moln'}…`);
  const r = await homey.realtimeProbe(homey.active, seconds, n => set('5', 'run', `${n} händelser…`));
  const via = homey.active === 'local' ? 'lokalt' : 'moln';
  const meta = { via, stage: r.stage, events: r.events, firstEventMs: r.firstEventMs, err: r.err };
  const nsNote = r.nsFromHandshake === undefined ? '' : r.nsFromHandshake ? ', namnrymd från handskakning' : ', namnrymd /api (reserv)';
  if (r.events > 0) set('5', 'ok', `${r.events} händelser (${via}), första efter ${r.firstEventMs} ms${nsNote}`, meta);
  else if (r.stage === 'sub-ok') set('5', 'warn', `prenumeration OK men inga händelser på ${seconds} s (${via})${nsNote} – tände/släckte du något?`, meta);
  else set('5', 'fail', `nådde steg ${r.stage}${r.err ? ', ' + r.err : ''} (${via}) – polling krävs eller homey-api`, meta);
}

export async function runPresence(homey, devices, set) {
  if (!homey.active) { set('7', 'skip', 'ingen anslutning'); return; }
  set('7', 'run', '');
  const res = await homey.users();
  const presenceDevices = devices.filter(d => /presence/i.test(`${d.driverId || ''} ${d.driverUri || ''} ${d.ownerUri || ''}`)).length;
  if (!res.ok) { set('7', 'fail', `användare: ${res.err}; närvaroenheter ${presenceDevices}`, { err: res.err, presenceDevices }); return; }
  const users = asList(res.data);
  const withFlag = users.filter(u => typeof u.present === 'boolean').length;
  // Antalet hemma redovisas inte: sammanfattningen visar förmåga, inte närvaroläge.
  set('7', withFlag > 0 ? 'ok' : 'warn',
    `${users.length} användare, närvaroflagga läsbar på ${withFlag}, Smart Presence-liknande enheter ${presenceDevices}`,
    { users: users.length, withFlag, presenceDevices });
}

export async function runInsights(homey, set) {
  if (!homey.active) { set('8', 'skip', 'ingen anslutning'); return; }
  set('8', 'run', '');
  const res = await homey.insightsLogs();
  if (!res.ok) { set('8', 'fail', `loggar: ${res.err}`, { err: res.err }); return; }
  const logs = asList(res.data);
  const num = logs.find(l => l.type === 'number' && l.ownerUri && l.id);
  if (!num) { set('8', 'warn', `${logs.length} loggar, ingen numerisk att prova`, { logs: logs.length }); return; }
  const e = await homey.insightsEntries(num);
  const pts = e.ok && e.data ? (Array.isArray(e.data.values) ? e.data.values.length : asList(e.data).length) : 0;
  if (e.ok) set('8', 'ok', `${logs.length} loggar, en numerisk logg gav ${pts} punkter senaste dygnet, ${e.ms} ms`, { logs: logs.length, points: pts, ms: e.ms });
  else set('8', 'fail', `${logs.length} loggar, punkter: ${e.err}`, { logs: logs.length, err: e.err });
}

export async function runSpot(zone, set) {
  set('11', 'run', '');
  const [t, m] = await Promise.all([spot.today(zone), spot.tomorrow(zone)]);
  const hour = new Date().getHours();
  const tomorrowTxt = m.ok ? `i morgon ${m.count} perioder` : (m.status === 404 && hour < 14 ? 'i morgon ej publicerat än (väntat före ca 13)' : `i morgon ${m.err}`);
  const meta = { zone, today: t.ok ? t.count : t.err, tomorrow: m.ok ? m.count : (m.status || m.err), ms: t.ms };
  if (!t.ok) set('11', 'fail', `i dag ${t.err}; ${tomorrowTxt}`, meta);
  else if (!m.ok && !(m.status === 404 && hour < 14)) set('11', 'warn', `${zone}: i dag ${t.count} perioder, ${tomorrowTxt}`, meta);
  else set('11', 'ok', `${zone}: i dag ${t.count} perioder (${t.ms} ms), ${tomorrowTxt}`, meta);
}

export async function runSmhi(homey, manual, set) {
  set('12', 'run', '');
  let lat = null, lon = null, src = 'manuell', posErr = 'ingen anslutning';
  if (manual && manual.lat && manual.lon) { lat = manual.lat; lon = manual.lon; }
  else if (homey && homey.active) {
    const g = await homey.location();
    if (g.ok) { lat = g.lat; lon = g.lon; src = `Homey (${g.via})`; }
    else posErr = g.err;
  }
  if (lat == null || lon == null) { set('12', 'fail', `ingen position från Homey: ${posErr} – ange manuellt`, { err: 'no-position' }); return; }
  const f = await smhi.forecast(lat, lon);
  if (f.ok) set('12', 'ok', `${f.api}: ${f.points} tidpunkter, ${f.ms} ms, position från ${src}`, { api: f.api, points: f.points, ms: f.ms, posSrc: src });
  else set('12', 'fail', f.err, { err: f.err, posSrc: src });
}

// ---------- Sammanfattning ----------

export function clientInfo() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'okänt';
  const chrome = ua.match(/Chrome\/(\d+)/);
  const browser = /Edg\//.test(ua) ? 'Edge' : chrome ? `Chrome ${chrome[1]}` : /Firefox\/(\d+)/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'okänd';
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const c = navigator.connection || {};
  return { os, browser, standalone, netType: c.type || '?', effective: c.effectiveType || '?' };
}

export function summary(state, meta, place) {
  const ci = clientInfo();
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const sym = { ok: 'OK  ', warn: 'VARN', fail: 'FEL ', skip: 'HOPP', wait: '–   ', run: 'PÅGÅR' };
  const lines = [
    `HD-LAB ${LAB_VERSION} · ${ts}`,
    `Klient: ${ci.os} · ${ci.browser} · standalone ${ci.standalone ? 'ja' : 'nej'} · nät ${ci.netType}/${ci.effective} · plats ${place}`,
    `Aktiv anslutning: ${meta.active || 'ingen'}`,
    '',
  ];
  for (const c of CHECKS) {
    const s = state[c.id];
    lines.push(`${c.id.padEnd(3)} ${sym[s.status] || s.status}  ${c.title}`);
    if (s.detail) lines.push(`      ${s.detail}`);
  }
  return lines.join('\n');
}
