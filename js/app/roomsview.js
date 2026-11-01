// roomsview.js – rum: automatiskt ett rum per Homey-zon med enheter, manuella rum som override.
// Reglage enligt controls.js (light och coffeemachine); skrivningar går bara via homey.control.
//
// Layout (0.3.1): alla rum under varandra, grupperade per överordnad zon (t.ex. våning),
// med hopplänkar som radbryts överst – ingen sidledsscroll. Vyn byggs om bara när rum
// eller enheter tillkommer/försvinner; annars uppdateras värdena på plats, så att
// realtidshändelser inte flyttar sidan eller avbryter ett reglage som används.

import { state, prefs, setPref, deviceList } from './state.js';
import { h, num, toast, capVal } from './ui.js';
import * as rooms from '../core/rooms.js';
import { hasControls, canWrite, isControlClass } from '../core/controls.js';

const pending = new Map(); // id → antal pågående skrivningar
let rerender = () => {};
let refetch = () => {};
let built = { sig: '', rows: new Map(), heads: new Map() };
let scrollTarget = null;

export function init({ onRender, onRefetch }) { rerender = onRender; refetch = onRefetch; }
export function isPending(id) { return Boolean(pending.get(id)); }
export function hasPending() { return pending.size > 0; }
export function clearPending() { pending.clear(); built = { sig: '', rows: new Map(), heads: new Map() }; }

export function roomList() {
  return rooms.allRooms(state.zones, deviceList());
}

export function setActiveRoom(id) { setPref('room', id); }

// Översikten öppnar ett rum: rumsvyn scrollar dit vid nästa ritning.
export function openRoom(id) { setActiveRoom(id); scrollTarget = id; }

function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'sv'); }

// Läsvärden för enheter utan reglage. Första tre som finns visas.
const READ = [
  ['onoff', v => (v ? 'På' : 'Av')],
  ['dim', v => `${Math.round(v * 100)} %`],
  ['locked', v => (v ? 'Låst' : 'Olåst')],
  ['alarm_contact', v => (v ? 'Öppen' : 'Stängd')],
  ['alarm_motion', v => (v ? 'Rörelse' : 'Ingen rörelse')],
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

function readValues(d) {
  const out = [];
  for (const [cap, fmt] of READ) {
    const v = capVal(d, cap);
    if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) continue;
    out.push(fmt(v));
    if (out.length === 3) break;
  }
  return out;
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

function controlRow(d0) {
  let d = d0;
  const name = h('span.dev-name', d.name || '(namnlös)');
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
  const li = h('li.dev', { dataset: { ctl: '1', kind: d.class } },
    h('div.dev-top', h('div.dev-text', name, st), sw), range);
  function update(nd) {
    d = nd;
    const avail = d.available !== false;
    const ctl = hasControls(d);
    const on = capVal(d, 'onoff') === true;
    const dim = capVal(d, 'dim');
    li.dataset.ctl = ctl ? '1' : '0';
    li.dataset.on = ctl && on ? '1' : '0';
    li.classList.toggle('off', !avail);
    name.textContent = d.name || '(namnlös)';
    st.textContent = !avail ? 'Otillgänglig' : on ? (typeof dim === 'number' && range ? `${Math.round(dim * 100)} %` : 'På') : 'Av';
    if (sw) { sw.setAttribute('aria-checked', on ? 'true' : 'false'); sw.disabled = !ctl; sw.hidden = !ctl; }
    if (range) {
      range.hidden = !ctl || !on;
      if (!dragging && document.activeElement !== range) range.value = String(Math.max(1, Math.round((typeof dim === 'number' ? dim : 0) * 100)));
    }
  }
  update(d);
  return { el: li, update };
}

function readRow(d0) {
  const name = h('span.ro-name');
  const val = h('span.ro-val');
  const li = h('li.ro', { dataset: { ctl: '0' } }, name, val);
  function update(d) {
    const off = d.available === false;
    li.classList.toggle('off', off);
    name.textContent = d.name || '(namnlös)';
    val.textContent = off ? 'Otillgänglig' : readValues(d).join(' · ') || '–';
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

function roomSummary(devs) {
  const ctl = devs.filter(d => hasControls(d));
  const lit = ctl.filter(d => capVal(d, 'onoff') === true).length;
  const temps = devs.map(d => capVal(d, 'measure_temperature')).filter(v => typeof v === 'number' && Number.isFinite(v));
  const temp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const off = devs.filter(d => d.available === false).length;
  return { ctl: ctl.length, lit, temp, off,
    text: `${ctl.length ? `${lit}/${ctl.length} på` : `${devs.length} enh.`}${temp !== null ? ` · ${num(temp, 1)}°` : ''}${off ? ` · ${off} otillg.` : ''}` };
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
  const sig = signature(rs);
  if (sig !== built.sig || !root.firstChild) build(root, rs, sig);
  else for (const x of rs) {
    for (const d of x.devs) { const row = built.rows.get(d.id); if (row && !isPending(d.id)) row.update(d); }
    const head = built.heads.get(x.room.id);
    if (head) head.textContent = roomSummary(x.devs).text;
  }
  if (scrollTarget) {
    const el = root.querySelector(`[data-room="${CSS.escape(scrollTarget)}"]`);
    scrollTarget = null;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }
}

function build(root, rs, sig) {
  built = { sig, rows: new Map(), heads: new Map() };
  if (!rs.length) { root.replaceChildren(h('p.note', state.devices.size ? 'Inga rum med enheter.' : 'Hämtar…')); return; }

  const jump = h('nav.jump', { 'aria-label': 'Hoppa till rum' }, ...rs.map(x => h('button.chip', {
    onclick: () => {
      setActiveRoom(x.room.id);
      const el = root.querySelector(`[data-room="${CSS.escape(x.room.id)}"]`);
      if (el) el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
  }, x.room.name)));

  const kids = [jump];
  let group = null, grid = null;
  for (const x of rs) {
    if (x.group !== group || !grid) {
      group = x.group;
      if (group) kids.push(h('h2.group', group));
      grid = h('div.roomcards');
      kids.push(grid);
    }
    const meta = h('span.rc-meta', roomSummary(x.devs).text);
    built.heads.set(x.room.id, meta);
    const card = h('section.card.roomcard', { dataset: { room: x.room.id } },
      h('div.rc-head', h('h3', x.room.name), meta));
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

// Översiktens rumskort: per rum antal på av de styrbara och en temperatur om någon finns.
export function roomsCardBody(onOpen) {
  const rs = structure();
  if (!rs.length) return [h('p.note', state.devices.size ? 'Inga rum med enheter.' : 'Hämtar…')];
  return [h('ul.roomgrid', ...rs.map(x => {
    const s = roomSummary(x.devs);
    return h('li', h('button.room', {
      dataset: { lit: s.lit ? '1' : '0' },
      onclick: () => { openRoom(x.room.id); onOpen(); },
    }, h('span.room-name', x.room.name), h('span.room-meta', s.text)));
  }))];
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
  return `${ok ? 'OK' : 'FEL'} · ${devs.length} enheter, ${cls} light/coffeemachine, ${controls} med reglage, ` +
    `${wrong} utanför regeln, ${unavailable} otillgängliga`;
}
