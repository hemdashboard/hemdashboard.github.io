// plan.js – planritning överst i rumsvyn: var det lyser, rör sig och står öppet.
//
// Geometrin ligger i floorplan.js (rumstyper, inga personnamn eller ID, beslut 33).
// Kopplingen ritat rum → appens rum (Homey-zon eller eget rum) sparas bara i den här
// webbläsaren; entydiga namn kopplas automatiskt. Läser samma enhetsdata som rumsvyn
// och styr ingenting.

import { state, deviceList } from './state.js';
import { h, toast, capVal, info, num } from './ui.js';
import { el } from '../core/svg.js';
import * as rooms from '../core/rooms.js';
import { FLOORS, autoMap, points, rooms as planAreas } from '../core/floorplan.js';
import { motion } from '../core/activity.js';
import { roomList, openRoom, roomTemp, tempText, staleKind, TEMP_ICO_PATHS, ARROWS } from './roomsview.js';
import { band } from '../core/temperature.js';

const MAP_KEY = 'hd.plan.map.v1';
const OLD_DB = 'hd-plans'; // 0.5.0: uppladdad bild i IndexedDB, tas bort

let edit = false;
let pickArea = '';
let onOpen = () => {};
let rootEl = null;
let built = { sig: '', areas: new Map(), status: null };

export function init({ onOpenRoom }) { onOpen = onOpenRoom; }

// Tar bort den uppladdade bilden från 0.5.0 ur webbläsaren (husdata som inte behövs längre).
export function purgeOld() {
  try { indexedDB.deleteDatabase(OLD_DB); } catch { /* ingen IndexedDB */ }
  try { localStorage.removeItem('hd.plan.cur.v1'); } catch { /* lagring otillgänglig */ }
}

function saved() {
  try {
    const o = JSON.parse(localStorage.getItem(MAP_KEY) || 'null');
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const out = {};
    for (const [k, v] of Object.entries(o).slice(0, 60)) {
      if (typeof k === 'string' && k.length <= 40 && typeof v === 'string' && v.length <= 80) out[k] = v;
    }
    return out;
  } catch { return null; }
}

function saveMap(m) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify(m)); return true; } catch { return false; }
}

// Aktuell koppling: sparad om den finns, annars automatisk. Rum som inte längre finns räknas inte.
function mapping(list) {
  const m = saved() || autoMap(list);
  const ids = new Set(list.map(r => r.id));
  const out = {};
  for (const [a, r] of Object.entries(m)) if (r && ids.has(r)) out[a] = r;
  return out;
}

// Appens rum som är kopplade till en utomhusyta i planritningen (Altan, Framsidan, Förråd ute).
// Används av rumskorten för temperaturskalan. Kopplingen är lokal per webbläsare.
export function isOutdoorRoom(roomId) {
  if (!roomId) return false;
  const m = mapping(roomList());
  return planAreas().some(a => a.out && m[a.id] === roomId);
}

function setLink(areaId, roomId, list) {
  const m = mapping(list);
  if (roomId) m[areaId] = roomId; else delete m[areaId];
  if (!saveMap(m)) toast('Kunde inte spara (privat läge?).');
}

function isLit(d) {
  const cls = d.class === 'light' || d.virtualClass === 'light';
  return cls && d.available !== false && capVal(d, 'onoff') === true;
}

function roomState(room, now) {
  const devs = rooms.devicesInRoom(room, deviceList(), state.zones);
  let lit = 0, moving = false, open = 0;
  for (const d of devs) {
    if (isLit(d)) lit += 1;
    const m = motion(d, now);
    if (m && m.active) moving = true;
    if (capVal(d, 'alarm_contact') === true) open += 1;
  }
  return { lit, moving, open };
}

function stateText(s) {
  const parts = [];
  if (s.lit) parts.push(`${s.lit} tänd${s.lit > 1 ? 'a' : ''}`);
  if (s.moving) parts.push('rörelse');
  if (s.open) parts.push(`${s.open} öppen`);
  return parts.join(' · ');
}

// ---------- Temperaturbricka ----------
// Samma bricka som i rumskorten, ritad i SVG ovanför rumsnamnet: termometer, värde i
// bandets färg och trendpil. Döljs i rum utan temperatursensor. Bredden följer texten.

const K = 1.15; // 15 % större än första mockupen, för läsbarhet på mobil
const TB = { h: 40 * K, pad: 8 * K, ico: 30 * K, arrow: 30 * K, gap: 4 * K, ch: 15.2 * K, rx: 8 * K, dy: 9 * K, lift: 58, margin: 12 };

function icon(paths, cls) {
  const g = el('g', { class: cls });
  for (const d of paths) g.append(el('path', { d }));
  return g;
}

// maxW: ytans bredd minus marginal. Får brickan inte plats krymps den bara i den ytan.
function tempBadge(cx, cy, maxW) {
  const g = el('g', { class: 'fp-temp', 'data-show': '0', 'aria-hidden': 'true' });
  const rect = el('rect', { class: 'fp-temp-bg', height: TB.h, rx: TB.rx, y: cy - TB.h / 2 });
  const ico = icon(TEMP_ICO_PATHS, 'fp-temp-ico');
  const val = el('text', { class: 'fp-temp-val', y: cy + TB.dy });
  const arrows = { up: icon(ARROWS.up, 'fp-tr up'), down: icon(ARROWS.down, 'fp-tr down'), flat: icon(ARROWS.flat, 'fp-tr flat') };
  const title = el('title');
  const dot = el('circle', { class: 'fp-stale-dot', r: 5 * K });
  g.append(title, rect, ico, val, arrows.up, arrows.down, arrows.flat, dot);
  function update(t, outdoor) {
    if (t.temp === null) { g.setAttribute('data-show', '0'); return; }
    g.setAttribute('data-show', '1');
    g.setAttribute('data-band', band(t.temp, outdoor) || 'ok');
    const dir = t.tr ? t.tr.dir : 'none';
    g.setAttribute('data-dir', dir);
    g.setAttribute('data-stale', staleKind(t));
    val.textContent = `${num(t.temp, 1)}°`;
    title.textContent = tempText(t).short;
    const tw = val.textContent.length * TB.ch;
    const w = TB.pad + TB.ico + TB.gap + tw + (dir !== 'none' ? TB.gap + TB.arrow : 0) + TB.pad + 2;
    const x0 = cx - w / 2;
    rect.setAttribute('x', x0); rect.setAttribute('width', w);
    const s = TB.ico / 24;
    ico.setAttribute('transform', `translate(${x0 + TB.pad} ${cy - TB.ico / 2}) scale(${s})`);
    val.setAttribute('x', x0 + TB.pad + TB.ico + TB.gap);
    const ax = x0 + TB.pad + TB.ico + TB.gap + tw + TB.gap;
    for (const a of Object.values(arrows)) a.setAttribute('transform', `translate(${ax} ${cy - TB.arrow / 2}) scale(${TB.arrow / 24})`);
    dot.setAttribute('cx', x0 + w - TB.rx * 0.6); dot.setAttribute('cy', cy - TB.h / 2 + TB.rx * 0.6); // övre högra hörnet
    const fit = maxW > 0 && w > maxW ? maxW / w : 1;
    if (fit < 1) g.setAttribute('transform', `translate(${cx} ${cy}) scale(${fit.toFixed(3)}) translate(${-cx} ${-cy})`);
    else g.removeAttribute('transform');
  }
  return { g, update };
}

// ---------- Rendering ----------

export function renderPlan(root, now = Date.now()) {
  rootEl = root;
  const list = roomList();
  const map = mapping(list);
  const sig = `${edit}|${pickArea}|${JSON.stringify(map)}|${list.map(r => `${r.id}:${r.name}`).join(',')}`;
  if (sig !== built.sig || !root.firstChild) build(root, list, map, sig);
  update(now);
}

function rerender() { built.sig = ''; if (rootEl) renderPlan(rootEl); }

function floorSvg(f, list, map) {
  const [vx, vy, vw, vh] = f.view;
  const svg = el('svg', { viewBox: `${vx} ${vy} ${vw} ${vh}`, class: 'fp', role: 'group', 'aria-label': f.label });
  if (f.walls) {
    const [wx, wy, ww, wh] = f.walls;
    svg.append(el('rect', { x: wx, y: wy, width: ww, height: wh, class: 'fp-wall' }));
  }
  for (const a of f.areas) {
    const roomId = a.kind === 'room' ? map[a.id] : null;
    const room = roomId ? list.find(r => r.id === roomId) : null;
    const g = el('g', { class: `fp-area ${a.kind}${a.out ? ' outside' : ''}`, 'data-area': a.id, 'data-linked': room ? '1' : '0',
      'data-sel': edit && pickArea === a.id ? '1' : '0' });
    g.append(el('polygon', { points: points(a.pts), class: 'fp-poly' }));
    if (a.label) {
      const [x, y] = a.at;
      const t = el('text', { x, y, class: 'fp-label', 'text-anchor': 'middle' });
      t.textContent = room ? room.name : a.label;
      g.append(t);
      if (a.sub && !room) {
        const s2 = el('text', { x, y: y + 34, class: 'fp-sub', 'text-anchor': 'middle' });
        s2.textContent = a.sub;
        g.append(s2);
      }
      const st = el('text', { x, y: y + 34, class: 'fp-state', 'text-anchor': 'middle' });
      g.append(st);
      const xs = a.pts.map(p => p[0]);
      const tc = room ? tempBadge(x, y - TB.lift, Math.max(...xs) - Math.min(...xs) - 2 * TB.margin) : null;
      if (tc) g.append(tc.g);
      if (room) built.areas.set(a.id, { g, st, room, tc, out: Boolean(a.out) });
    }
    if (a.kind === 'room') {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', room ? room.name : `${a.label} (inte kopplat)`);
      const act = () => {
        if (edit) { pickArea = pickArea === a.id ? '' : a.id; rerender(); return; }
        if (room) { openRoom(room.id); onOpen(); }
        else toast('Rummet är inte kopplat – tryck på Koppla rum.');
      };
      g.addEventListener('click', act);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    }
    svg.append(g);
  }
  for (const fx of f.fixtures) svg.append(el('polygon', { points: points(fx), class: 'fp-fix' }));
  if (f.entry) {
    const [x, y] = f.entry;
    svg.append(el('path', { d: `M${x - 16} ${y + 26}L${x} ${y + 8}L${x + 16} ${y + 26}`, class: 'fp-entry' }));
  }
  return h('figure.fp-floor', h('figcaption', f.label), svg);
}

function build(root, list, map, sig) {
  built = { sig, areas: new Map(), status: null };
  const head = h('div.card-head', h('h2', 'Planritning'),
    h('div.plan-tools', h('button.ghostbtn', { 'aria-pressed': edit ? 'true' : 'false', onclick: () => { edit = !edit; pickArea = ''; rerender(); } }, edit ? 'Klar' : 'Koppla rum')));
  const kids = [head,
    info('plan', 'Fylld yta = lampa tänd, blå kant = rörelse senaste minuten, gul kant = dörr eller fönster öppet. Tryck på ett rum för att öppna det. Ritningen är schematisk; kopplingen till Homeys rum sparas bara i den här webbläsaren.')];

  kids.push(h('div.fp-floors', ...FLOORS.map(f => floorSvg(f, list, map))));

  if (edit) {
    const area = FLOORS.flatMap(f => f.areas).find(a => a.id === pickArea);
    if (!area) {
      kids.push(h('p.note', 'Tryck på ett rum i ritningen och välj sedan vilket rum i appen det är.'));
    } else {
      const cur = map[area.id] || '';
      kids.push(h('p.note', `${area.label}: välj rum`));
      kids.push(h('nav.jump', { 'aria-label': 'Koppla till rum' },
        ...list.map(r => h('button.chip', {
          'aria-pressed': cur === r.id ? 'true' : 'false',
          onclick: () => { setLink(area.id, cur === r.id ? '' : r.id, list); pickArea = ''; rerender(); },
        }, r.name))));
    }
    kids.push(h('div.row', h('button', {
      onclick: () => {
        if (!confirm('Återställ kopplingen till den automatiska?')) return;
        try { localStorage.removeItem(MAP_KEY); } catch { /* ignore */ }
        pickArea = ''; rerender();
      },
    }, 'Återställ koppling')));
  }

  const status = h('p.note.plan-status');
  built.status = status;
  kids.push(status);
  root.replaceChildren(h('section.card.plan', ...kids));
}

function update(now) {
  let lit = 0, moving = 0;
  for (const [, x] of built.areas) {
    const s = roomState(x.room, now);
    x.g.setAttribute('data-lit', s.lit ? '1' : '0');
    x.g.setAttribute('data-motion', s.moving ? '1' : '0');
    x.g.setAttribute('data-open', s.open ? '1' : '0');
    x.st.textContent = stateText(s);
    if (x.tc) x.tc.update(roomTemp(rooms.devicesInRoom(x.room, deviceList(), state.zones)), x.out);
    if (s.lit) lit += 1;
    if (s.moving) moving += 1;
  }
  if (built.status) {
    const total = FLOORS.flatMap(f => f.areas).filter(a => a.kind === 'room').length;
    const free = total - built.areas.size;
    built.status.textContent = `${lit} rum med tänt · ${moving} med rörelse${free ? ` · ${free} ritade rum inte kopplade` : ''}`;
  }
}
