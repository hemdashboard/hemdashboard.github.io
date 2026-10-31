// roomsview.js – rum: automatiskt ett rum per Homey-zon med enheter, manuella rum som override.
// Reglage enligt controls.js (light och coffeemachine); skrivningar går bara via homey.control.

import { state, prefs, setPref, deviceList } from './state.js';
import { h, num, toast, capVal } from './ui.js';
import * as rooms from '../core/rooms.js';
import { hasControls, canWrite, isControlClass } from '../core/controls.js';

const pending = new Map(); // id → antal pågående skrivningar
let rerender = () => {};
let refetch = () => {};

export function init({ onRender, onRefetch }) { rerender = onRender; refetch = onRefetch; }
export function isPending(id) { return Boolean(pending.get(id)); }
export function hasPending() { return pending.size > 0; }
export function clearPending() { pending.clear(); }

export function roomList() {
  return rooms.allRooms(state.zones, deviceList());
}

export function activeRoom(list = roomList()) {
  const id = prefs().room;
  return list.find(r => r.id === id) || list[0] || null;
}

export function setActiveRoom(id) { setPref('room', id); }

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
  ['measure_temperature', v => `${num(v, 1)} °C`],
  ['target_temperature', v => `mål ${num(v, 1)} °C`],
  ['measure_humidity', v => `${num(v)} %`],
  ['measure_co2', v => `${num(v)} ppm`],
  ['measure_power', v => `${num(v)} W`],
  ['meter_power', v => `${num(v, 1)} kWh`],
  ['windowcoverings_set', v => `${Math.round(v * 100)} %`],
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

// ---------- Rutor ----------

function controlTile(d) {
  const avail = d.available !== false;
  const ctl = hasControls(d);
  const on = capVal(d, 'onoff') === true;
  const dim = capVal(d, 'dim');
  const state_ = h('div.state', !avail ? 'Otillgänglig' : on ? (typeof dim === 'number' && canWrite(d, 'dim') ? `På · ${Math.round(dim * 100)} %` : 'På') : 'Av');
  const top = h('div.tile-top', h('div', h('div.name', d.name || '(namnlös)'), state_));
  if (ctl && canWrite(d, 'onoff')) {
    top.append(h('button.switch', {
      role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': `${d.name || 'Enhet'} på/av`,
      onclick: () => write(d, 'onoff', !on),
    }));
  }
  const li = h('li.tile', { dataset: { ctl: ctl ? '1' : '0', on: ctl && on ? '1' : '0', kind: d.class } }, top);
  if (ctl && canWrite(d, 'dim')) {
    const range = h('input.dim', {
      type: 'range', min: '1', max: '100', step: '1',
      value: String(Math.max(1, Math.round((typeof dim === 'number' ? dim : 0) * 100))),
      'aria-label': `${d.name || 'Lampa'} ljusstyrka`,
    });
    range.addEventListener('input', () => { state_.textContent = `På · ${range.value} %`; });
    range.addEventListener('change', () => write(d, 'dim', Number(range.value) / 100));
    li.append(range);
  }
  if (!avail) li.classList.add('off');
  return li;
}

function readTile(d) {
  const off = d.available === false;
  return h(`li.tile.ro${off ? '.off' : ''}`, { dataset: { ctl: '0' } },
    h('div.name', d.name || '(namnlös)'),
    h('div.state', off ? 'Otillgänglig' : readValues(d).join(' · ') || '–'));
}

// ---------- Vyer ----------

export function renderRooms(root) {
  const list = roomList();
  const room = activeRoom(list);
  const devs = rooms.devicesInRoom(room, deviceList(), state.zones);
  const ctl = devs.filter(isControlClass).sort(byName);
  const others = devs.filter(d => !isControlClass(d)).sort(byName);

  const tabs = h('nav.rooms', { 'aria-label': 'Rum' }, ...list.map(r => h('button.chip', {
    'aria-pressed': room && r.id === room.id ? 'true' : 'false',
    onclick: () => { setActiveRoom(r.id); rerender(); },
  }, r.name)));

  const kids = [tabs];
  if (!list.length) kids.push(h('p.note', 'Inga rum med enheter än.'));
  if (ctl.length) kids.push(h('h2.sect', 'Reglage'), h('ul.tiles', ...ctl.map(controlTile)));
  if (others.length) kids.push(h('h2.sect', 'Övrigt'), h('ul.tiles.ro', ...others.map(readTile)));
  root.replaceChildren(...kids);
  // Håll vald flik i synfältet
  const cur = tabs.querySelector('[aria-pressed="true"]');
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  return devs;
}

// Översiktens rumskort: per rum antal tända av de styrbara och en temperatur om någon finns.
export function roomsCardBody(onOpen) {
  const list = roomList();
  if (!list.length) return [h('p.note', state.devices.size ? 'Inga rum med enheter.' : 'Hämtar…')];
  const all = deviceList();
  return [h('ul.roomgrid', ...list.map(r => {
    const devs = rooms.devicesInRoom(r, all, state.zones);
    const ctl = devs.filter(d => hasControls(d));
    const lit = ctl.filter(d => capVal(d, 'onoff') === true).length;
    const temps = devs.map(d => capVal(d, 'measure_temperature')).filter(v => typeof v === 'number' && Number.isFinite(v));
    const temp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    const off = devs.filter(d => d.available === false).length;
    return h('li', h('button.room', {
      dataset: { lit: lit ? '1' : '0' },
      onclick: () => { setActiveRoom(r.id); onOpen(); },
    },
    h('span.room-name', r.name),
    h('span.room-meta', ctl.length ? `${lit}/${ctl.length} på` : `${devs.length} enh.`,
      temp !== null ? ` · ${num(temp, 1)}°` : '', off ? ` · ${off} otillg.` : '')));
  }))];
}

// Regelkontroll av alla enheter: varje ruta byggs som i rumsvyn (utanför sidan) och
// räknas. Varje reglage ska höra till en enhet som regeln tillåter.
export function ruleCheck() {
  const devs = deviceList();
  const root = h('ul', ...devs.map(d => (isControlClass(d) ? controlTile(d) : readTile(d))));
  const tiles = [...root.querySelectorAll('li.tile')];
  let controls = 0, wrong = 0;
  for (const li of tiles) {
    const has = Boolean(li.querySelector('.switch, input.dim'));
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
