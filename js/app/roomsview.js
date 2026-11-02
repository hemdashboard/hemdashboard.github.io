// roomsview.js – rum: automatiskt ett rum per Homey-zon med enheter, manuella rum som override.
// Reglage enligt controls.js (light och coffeemachine); skrivningar går bara via homey.control.
//
// Layout: knapparna överst väljer vilka rum som visas (inga valda = alla), rummen som kort
// under varandra grupperade per överordnad zon (t.ex. våning). Ingen sidledsscroll. Vyn byggs om bara när rum
// eller enheter tillkommer/försvinner; annars uppdateras värdena på plats, så att
// realtidshändelser inte flyttar sidan eller avbryter ett reglage som används.

import { state, deviceList } from './state.js';
import { h, num, toast, capVal } from './ui.js';
import * as rooms from '../core/rooms.js';
import { hasControls, canWrite, isControlClass, controlClass, whyNoControl } from '../core/controls.js';
import { motion, ago } from '../core/activity.js';
import * as fav from '../core/favorites.js';
import { brand, hotWater, titledValues } from '../core/devinfo.js';
import { band, roomTemperature, isStale, tempAt } from '../core/temperature.js';
import { refOf } from './temps.js';

const pending = new Map(); // id → antal pågående skrivningar
let rerender = () => {};
let refetch = () => {};
let built = { sig: '', rows: new Map(), heads: new Map(), temps: new Map() };
let isOutdoor = () => false;
let scrollTarget = null;

export function init({ onRender, onRefetch, outdoor }) {
  rerender = onRender; refetch = onRefetch;
  if (typeof outdoor === 'function') isOutdoor = outdoor;
}
export function isPending(id) { return Boolean(pending.get(id)); }
export function hasPending() { return pending.size > 0; }
export function clearPending() { pending.clear(); built = { sig: '', rows: new Map(), heads: new Map(), temps: new Map() }; }

export function roomList() {
  return rooms.allRooms(state.zones, deviceList());
}

// Valda rum sparas lokalt i den här webbläsaren (inga namn, bara rum-ID från Homey/appen).
const SEL_KEY = 'hd.rooms.sel.v1';
function selected() {
  try {
    const a = JSON.parse(localStorage.getItem(SEL_KEY) || '[]');
    return new Set(Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.length <= 80).slice(0, 40) : []);
  } catch { return new Set(); }
}
function saveSelected(set) {
  try { localStorage.setItem(SEL_KEY, JSON.stringify([...set])); } catch { /* lagring otillgänglig */ }
}

// Öppnar rumsvyn med bara det rummet valt.
export function openRoom(id) { saveSelected(new Set([id])); scrollTarget = null; }

function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'sv'); }

// Läsvärden för enheter utan reglage. Första tre som finns visas.
const READ = [
  ['onoff', v => (v ? 'På' : 'Av')],
  ['dim', v => `${Math.round(v * 100)} %`],
  ['locked', v => (v ? 'Låst' : 'Olåst')],
  ['presence', v => (v ? 'Hemma' : 'Borta')],
  ['alarm_contact', v => (v ? 'Öppen' : 'Stängd')],
  ['alarm_water', v => (v ? 'Vatten' : 'Torrt')],
  ['alarm_smoke', v => (v ? 'Rök' : 'Ingen rök')],
  ['measure_temperature', v => `${num(v, 1)}°`],
  ['target_temperature', v => `mål ${num(v, 1)}°`],
  ['measure_humidity', v => `${num(v)} %`],
  ['measure_co2', v => `${num(v)} ppm`],
  ['measure_power', v => `${num(v)} W`],
  ['measure_price_total', v => `${num(v, 2)} kr/kWh`],
  ['windowcoverings_set', v => `${Math.round(v * 100)} %`],
  ['meter_power', v => `${num(v, 1)} kWh`],
  ['measure_luminance', v => `${num(v)} lx`],
  ['measure_battery', v => `batteri ${num(v)} %`],
];

const KNOWN = new Set([...READ.map(([c]) => c), 'alarm_motion']);

function readValues(d) {
  const out = [];
  const hw = hotWater(d);
  if (hw) out.push(`varmvatten ${num(hw.value, 1)}°`);
  for (const [cap, fmt] of READ) {
    const v = capVal(d, cap);
    if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) continue;
    // Inaktuell temperatur (äldre än 3 h) får sin ålder, t.ex. "21,3° (5 h)".
    if (cap === 'measure_temperature' && isStale(d)) { out.push(`${fmt(v)} (${ago(tempAt(d))})`); }
    else out.push(fmt(v));
    if (out.length === 3) break;
  }
  if (!out.length) {
    for (const t of titledValues(d, KNOWN).slice(0, 2)) out.push(`${t.title} ${num(t.value, 1)}${t.units === '°C' ? '°' : t.units ? ` ${t.units}` : ''}`);
  }
  return out;
}

function brandEl(d) {
  const b = brand(d);
  return b ? h('span.brand', ` (${b})`) : null;
}

// ---------- Skrivning ----------

async function write(d, cap, value) {
  // Spärren prövas i homey.control; detta är bara UI-flödet runt den.
  const before = d.capabilitiesObj && d.capabilitiesObj[cap] ? d.capabilitiesObj[cap].value : undefined;
  pending.set(d.id, (pending.get(d.id) || 0) + 1);
  if (d.capabilitiesObj && d.capabilitiesObj[cap]) {
    d.capabilitiesObj[cap] = { ...d.capabilitiesObj[cap], value };
    if (cap === 'dim' && value > 0 && d.capabilitiesObj.onoff) d.capabilitiesObj.onoff = { ...d.capabilitiesObj.onoff, value: true };
  }
  rerender();
  const r = await state.homey.control(d, cap, value);
  const left = (pending.get(d.id) || 1) - 1;
  if (left > 0) pending.set(d.id, left); else pending.delete(d.id);
  if (!r.ok) {
    if (d.capabilitiesObj && d.capabilitiesObj[cap]) d.capabilitiesObj[cap] = { ...d.capabilitiesObj[cap], value: before };
    toast(r.err === 'control-denied' ? 'Spärrad: enheten får inte styras här.'
      : r.err === 'timeout' ? 'Inget svar från Homey.' : 'Kunde inte styra enheten.');
    refetch(d.id);
  }
  rerender();
}

// ---------- Rader ----------
// Varje rad har update(d) som bara ändrar text och attribut, aldrig strukturen.

export function controlRow(d0) {
  let d = d0;
  const nameTxt = h('span');
  const name = h('span.dev-name', nameTxt, brandEl(d));
  const st = h('span.dev-state');
  const sw = canWrite(d, 'onoff') ? h('button.switch', {
    role: 'switch', 'aria-label': `${d.name || 'Enhet'} på/av`,
    onclick: () => write(d, 'onoff', capVal(d, 'onoff') !== true),
  }) : null;
  let range = null, dragging = false;
  if (canWrite(d, 'dim')) {
    range = h('input.dim', { type: 'range', min: '1', max: '100', step: '1', 'aria-label': `${d.name || 'Lampa'} ljusstyrka` });
    range.addEventListener('pointerdown', () => { dragging = true; });
    range.addEventListener('pointerup', () => { dragging = false; });
    range.addEventListener('pointercancel', () => { dragging = false; });
    range.addEventListener('input', () => { st.textContent = `${range.value} %`; });
    range.addEventListener('change', () => { dragging = false; write(d, 'dim', Number(range.value) / 100); });
  }
  // Stjärna: visar reglaget även under Snabbreglage på Hem (sparas lokalt, ändrar inte regeln).
  const star = h('button.star', {
    'aria-label': `${d.name || 'Enhet'}: visa under Snabbreglage`,
    onclick: () => {
      const on = fav.toggle(d, deviceList());
      if (on === null) { toast('Kunde inte spara stjärnan.'); return; }
      star.setAttribute('aria-pressed', on ? 'true' : 'false');
      toast(on ? 'Visas under Snabbreglage.' : 'Borttagen från Snabbreglage.');
      rerender();
    },
  }, h('span', { 'aria-hidden': 'true' }, '★'));
  const li = h('li.dev', { dataset: { ctl: '1', kind: controlClass(d) || '' } },
    h('div.dev-top', h('div.dev-text', name, st), h('div.dev-act', star, sw)), range);
  function update(nd) {
    d = nd;
    const avail = d.available !== false;
    const ctl = hasControls(d);
    const on = capVal(d, 'onoff') === true;
    const dim = capVal(d, 'dim');
    li.dataset.ctl = ctl ? '1' : '0';
    li.dataset.on = ctl && on ? '1' : '0';
    li.classList.toggle('off', !avail);
    nameTxt.textContent = d.name || '(namnlös)';
    st.textContent = !avail ? 'Otillgänglig' : on ? (typeof dim === 'number' && range ? `${Math.round(dim * 100)} %` : 'På') : 'Av';
    if (sw) { sw.setAttribute('aria-checked', on ? 'true' : 'false'); sw.disabled = !ctl; sw.hidden = !ctl; }
    star.setAttribute('aria-pressed', fav.isFav(d, deviceList()) ? 'true' : 'false');
    if (range) {
      range.hidden = !ctl || !on;
      if (!dragging && document.activeElement !== range) range.value = String(Math.max(1, Math.round((typeof dim === 'number' ? dim : 0) * 100)));
    }
  }
  update(d);
  return { el: li, update };
}

// Rörelseikon: fylld när sensorn rapporterat rörelse senaste minuten, annars kontur.
// Tiden anger senaste rörelse. Uppdateras av realtid och var 30:e sekund.
const MOTION_SVG = 'M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8';
function motionEl() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', MOTION_SVG);
  svg.append(path);
  const txt = h('span.mo-txt');
  return { el: h('span.motion', { dataset: { on: '0' } }, svg, txt), txt };
}

function readRow(d0) {
  const nameTxt = h('span');
  const name = h('span.ro-name', nameTxt, brandEl(d0));
  const val = h('span.ro-val');
  const mo = motion(d0) ? motionEl() : null;
  const li = h('li.ro', { dataset: { ctl: '0' } }, name, h('span.ro-right', mo ? mo.el : null, val));
  function update(d) {
    const off = d.available === false;
    li.classList.toggle('off', off);
    nameTxt.textContent = d.name || '(namnlös)';
    const rest = off ? 'Otillgänglig' : readValues(d).join(' · ');
    if (mo) {
      const m = motion(d);
      mo.el.dataset.on = !off && m && m.active ? '1' : '0';
      mo.el.setAttribute('title', m && m.now ? 'Rörelse nu' : m && m.active ? 'Rörelse senaste minuten' : 'Ingen rörelse senaste minuten');
      mo.txt.textContent = off || !m ? '' : m.now ? 'nu' : m.last ? ago(m.last) : '–';
      val.textContent = rest;
    } else {
      val.textContent = rest || '–';
    }
  }
  update(d0);
  return { el: li, update };
}

// ---------- Rum och grupper ----------

// Grupp = rummets överordnade zon om den inte är rotzonen (t.ex. en våning), annars ingen.
function groupOf(room) {
  const zid = [...room.zoneIds][0];
  const z = state.zones.find(x => x.id === zid);
  if (!z || !z.parent) return '';
  const p = state.zones.find(x => x.id === z.parent);
  return p && p.parent ? p.name || '' : '';
}

// Rummets temperatur och trend senaste timmen, utan kameror och utan givare äldre än 3 h
// (se core/temperature.js). Delas med planritningen.
// { temp, tr, stale, total, onlyStale, lastAt }
export function roomTemp(devs, now = Date.now()) {
  return roomTemperature(devs, refOf, now);
}

// 'none' | 'some' (någon givare utanför snittet) | 'all' (bara inaktuella värden)
export function staleKind(t) {
  return !t || !t.stale ? 'none' : t.onlyStale ? 'all' : 'some';
}

// Text för temperaturbrickans titel och skärmläsare, t.ex. "21,4° · stiger +0,6° senaste timmen".
export function tempText(t) {
  const dir = t.tr ? t.tr.dir : '';
  const sign = t.tr && t.tr.delta > 0 ? '+' : t.tr && t.tr.delta < 0 ? '−' : '±';
  const how = !t.tr ? 'trend saknas'
    : `${dir === 'up' ? 'stiger' : dir === 'down' ? 'sjunker' : 'stabil'} ${sign}${num(Math.abs(t.tr.delta), 1)}° senaste timmen`;
  const k = staleKind(t);
  const last = t.lastAt ? `, senast ${ago(t.lastAt)}` : '';
  const st = k === 'all' ? ` · inaktuellt (ingen givare uppdaterad på 3 h${last})`
    : k === 'some' ? ` · ${t.stale} av ${t.total} givare utanför snittet (inte uppdaterad på 3 h${last})` : '';
  return { short: `${num(t.temp, 1)}° · ${how}${st}`, label: `${num(t.temp, 1)} grader, ${how}${st}` };
}

function roomSummary(devs) {
  const ctl = devs.filter(d => hasControls(d));
  const lit = ctl.filter(d => capVal(d, 'onoff') === true).length;
  const t = roomTemp(devs);
  const off = devs.filter(d => d.available === false).length;
  return { ctl: ctl.length, lit, ...t, off,
    text: `${ctl.length ? `${lit}/${ctl.length} på` : `${devs.length} enh.`}${off ? ` · ${off} otillg.` : ''}` };
}

// Temperaturbricka i rumskortets rubrik: termometer, värde i bandets färg och trendpil.
// Utan temperatursensor döljs brickan. Utan trenddata visas ingen pil.
const SVGNS = 'http://www.w3.org/2000/svg';
const TEMP_ICO = ['M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z', 'M12 11v6'];
export const TEMP_ICO_PATHS = TEMP_ICO;
export const ARROWS = { up: ['M7 17 17 7', 'M9 7h8v8'], down: ['M7 7l10 10', 'M17 9v8H9'], flat: ['M5 12h14', 'M14 7l5 5-5 5'] };
function svgPaths(cls, ds) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  for (const d of ds) { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
function tempChip() {
  const val = h('span.val');
  const el = h('span.temp', { hidden: true, role: 'img' }, svgPaths('ico', TEMP_ICO), val, h('span.stale-dot'),
    svgPaths('tr up', ARROWS.up), svgPaths('tr down', ARROWS.down), svgPaths('tr flat', ARROWS.flat));
  function update(s, outdoor) {
    if (s.temp === null) { el.hidden = true; return; }
    el.hidden = false;
    el.dataset.band = band(s.temp, outdoor) || 'ok';
    val.textContent = `${num(s.temp, 1)}°`;
    el.dataset.dir = s.tr ? s.tr.dir : 'none';
    el.dataset.stale = staleKind(s);
    const tt = tempText(s);
    el.setAttribute('title', tt.short);
    el.setAttribute('aria-label', tt.label);
  }
  return { el, update };
}

function structure() {
  const list = roomList();
  const all = deviceList();
  return list.map(r => {
    const devs = rooms.devicesInRoom(r, all, state.zones);
    return { room: r, group: groupOf(r), ctl: devs.filter(isControlClass).sort(byName), ro: devs.filter(d => !isControlClass(d)).sort(byName), devs };
  });
}

// Signatur för strukturen: rum, grupper, vilka enheter och om de har reglage.
function signature(rs) {
  return rs.map(x => `${x.room.id}|${x.group}|${x.room.name}|${x.ctl.map(d => `${d.id}:${canWrite(d, 'onoff') ? 1 : 0}${canWrite(d, 'dim') ? 1 : 0}`).join(',')}|${x.ro.map(d => d.id).join(',')}`).join('\n');
}

export function renderRooms(root) {
  const rs = structure();
  const sel = selected();
  const sig = `${[...sel].sort().join(',')}\n${signature(rs)}`;
  if (sig !== built.sig || !root.firstChild) build(root, rs, sig, sel);
  else for (const x of rs) {
    for (const d of x.devs) { const row = built.rows.get(d.id); if (row && !isPending(d.id)) row.update(d); }
    const s = roomSummary(x.devs);
    const head = built.heads.get(x.room.id);
    if (head) head.textContent = s.text;
    const tc = built.temps.get(x.room.id);
    if (tc) tc.update(s, isOutdoor(x.room.id));
  }
  if (scrollTarget) {
    const el = root.querySelector(`[data-room="${CSS.escape(scrollTarget)}"]`);
    scrollTarget = null;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }
}

function build(root, rs, sig, sel) {
  built = { sig, rows: new Map(), heads: new Map(), temps: new Map() };
  if (!rs.length) { root.replaceChildren(h('p.note', state.devices.size ? 'Inga rum med enheter.' : 'Hämtar…')); return; }

  // Valda rum som inte längre finns räknas inte.
  const valid = new Set([...sel].filter(id => rs.some(x => x.room.id === id)));
  const toggle = (id) => {
    const s = selected();
    if (s.has(id)) s.delete(id); else s.add(id);
    saveSelected(s);
    renderRooms(root);
  };
  const pick = h('nav.jump', { 'aria-label': 'Välj rum att visa' },
    h('button.chip.all', { 'aria-pressed': valid.size ? 'false' : 'true', onclick: () => { saveSelected(new Set()); renderRooms(root); } }, 'Alla'),
    ...rs.map(x => h('button.chip', { 'aria-pressed': valid.has(x.room.id) ? 'true' : 'false', onclick: () => toggle(x.room.id) }, x.room.name)));

  const kids = [pick];
  const shown = valid.size ? rs.filter(x => valid.has(x.room.id)) : rs;
  let group = null, grid = null;
  for (const x of shown) {
    if (x.group !== group || !grid) {
      group = x.group;
      if (group) kids.push(h('h2.group', group));
      grid = h('div.roomcards');
      kids.push(grid);
    }
    const s = roomSummary(x.devs);
    const meta = h('span.rc-meta', s.text);
    built.heads.set(x.room.id, meta);
    const tc = tempChip();
    tc.update(s, isOutdoor(x.room.id));
    built.temps.set(x.room.id, tc);
    const card = h('section.card.roomcard', { dataset: { room: x.room.id } },
      h('div.rc-head', h('h3', x.room.name), h('span.rc-right', meta, tc.el)));
    if (x.ctl.length) {
      const ul = h('ul.devs');
      for (const d of x.ctl) { const r = controlRow(d); built.rows.set(d.id, r); ul.append(r.el); }
      card.append(ul);
    }
    if (x.ro.length) {
      const ul = h('ul.ros');
      for (const d of x.ro) { const r = readRow(d); built.rows.set(d.id, r); ul.append(r.el); }
      card.append(ul);
    }
    grid.append(card);
  }
  root.replaceChildren(...kids);
}

// Regelkontroll av alla enheter: varje rad byggs som i rumsvyn (utanför sidan) och
// räknas. Varje synligt reglage ska höra till en enhet som regeln tillåter.
export function ruleCheck() {
  const devs = deviceList();
  const root = h('ul', ...devs.map(d => (isControlClass(d) ? controlRow(d).el : readRow(d).el)));
  let controls = 0, wrong = 0;
  for (const li of root.children) {
    const has = [...li.querySelectorAll('.switch, input.dim')].some(e => !e.hidden);
    if (has) controls += 1;
    if (has && li.dataset.ctl !== '1') wrong += 1;
  }
  const allowed = devs.filter(hasControls).length;
  const cls = devs.filter(isControlClass).length;
  const unavailable = devs.filter(d => d.available === false).length;
  const ok = wrong === 0 && controls === allowed;
  // Utan reglage trots lampa/kaffebryggare i class eller virtualClass: skäl utan namn eller ID.
  const why = new Map();
  for (const d of devs) { const w = whyNoControl(d); if (w) why.set(w, (why.get(w) || 0) + 1); }
  const whyTxt = [...why].map(([w, n]) => `${n} × ${w}`).join('; ');
  return `${ok ? 'OK' : 'FEL'} · ${devs.length} enheter, ${cls} light/coffeemachine, ${controls} med reglage, ` +
    `${wrong} utanför regeln, ${unavailable} otillgängliga${whyTxt ? ` · utan reglage: ${whyTxt}` : ''}`;
}
