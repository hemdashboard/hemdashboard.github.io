// plan.js – planritning överst i rumsvyn: var det lyser, rör sig och står öppet.
//
// Bilden och rummens placering sparas bara i den här webbläsaren (planstore.js,
// IndexedDB). Repot innehåller ingen ritning, inga rum och inga namn. Markeringarna
// läser samma enhetsdata som rumsvyn och styr ingenting.

import { state, deviceList } from './state.js';
import { h, toast, capVal, info } from './ui.js';
import * as rooms from '../core/rooms.js';
import * as store from '../core/planstore.js';
import { motion } from '../core/activity.js';
import { roomList, openRoom } from './roomsview.js';

const CUR_KEY = 'hd.plan.cur.v1';

let plans = null;          // null = inte laddade
let loading = false;
let edit = false;
let pickRoom = '';
let onOpen = () => {};
let rootEl = null;
let built = { sig: '', marks: new Map(), status: null };

export function init({ onOpenRoom }) { onOpen = onOpenRoom; }

function curId() { try { return localStorage.getItem(CUR_KEY) || ''; } catch { return ''; } }
function setCur(id) { try { localStorage.setItem(CUR_KEY, id); } catch { /* lagring otillgänglig */ } }

function current() {
  if (!plans || !plans.length) return null;
  return plans.find(p => p.id === curId()) || plans[0];
}

async function load() {
  if (loading) return;
  loading = true;
  plans = await store.list();
  loading = false;
  built.sig = '';
  if (rootEl) renderPlan(rootEl);
}

function isLit(d) {
  const cls = d.class === 'light' || d.virtualClass === 'light';
  return cls && d.available !== false && capVal(d, 'onoff') === true;
}

// Läget i ett rum: antal tända lampor, rörelse (aktiv senaste minuten) och öppna kontakter.
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

// ---------- Uppladdning ----------

function uploadForm(after) {
  const name = h('input', { type: 'text', maxlength: '40', placeholder: 'Namn, t.ex. Plan 1', autocomplete: 'off', 'aria-label': 'Planens namn' });
  const file = h('input.visually-hidden', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'planFile' });
  const btn = h('label.btnlike.primary', { for: 'planFile' }, 'Välj bild…');
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const p = await store.addFromFile(f, name.value, plans || []);
      plans = [...(plans || []), p];
      setCur(p.id);
      edit = true; pickRoom = '';
      toast('Ritningen är sparad i den här webbläsaren. Placera rummen.');
      after();
    } catch (e) {
      toast({ type: 'Välj en PNG-, JPEG- eller WebP-bild.', size: 'Bilden är för stor.', full: `Högst ${store.MAX_PLANS} ritningar.`,
        decode: 'Kunde inte läsa bilden.', storage: 'Kunde inte spara (privat läge?).' }[e.message] || 'Kunde inte spara ritningen.');
    }
  });
  return h('div.plan-upload', name, h('div.row', btn, file));
}

// ---------- Rendering ----------

export function renderPlan(root, now = Date.now()) {
  rootEl = root;
  if (plans === null) { load(); return; }
  const p = current();
  const list = roomList();
  const sig = `${p ? `${p.id}:${Object.entries(p.marks).map(([k, v]) => `${k}@${v.x},${v.y}`).join(';')}` : '-'}|${edit}|${pickRoom}|${plans.length}|${list.map(r => `${r.id}:${r.name}`).join(',')}`;
  if (sig !== built.sig || !root.firstChild) build(root, p, list, sig);
  update(list, now);
}

function rerender() { built.sig = ''; if (rootEl) renderPlan(rootEl); }

function build(root, p, list, sig) {
  built = { sig, marks: new Map(), status: null };
  const head = h('div.card-head', h('h2', 'Planritning'));
  const kids = [head];

  if (!p) {
    kids.push(h('p', 'Ladda upp en bild av planlösningen. Den sparas bara i den här webbläsaren och syns inte för någon annan. Sedan placerar du rummen på bilden.'));
    kids.push(uploadForm(rerender));
    kids.push(info('plan', 'Planritningen räknas som husdata och ligger aldrig i appens kod. Den skalas ned till högst 1600 px och sparas lokalt (IndexedDB). En annan telefon eller webbläsare behöver ladda upp sin egen.'));
    root.replaceChildren(h('section.card.plan', ...kids));
    return;
  }

  const tools = h('div.plan-tools');
  if (plans.length > 1) {
    tools.append(h('div.seg', { role: 'group', 'aria-label': 'Välj ritning' },
      ...plans.map(x => h('button', { 'aria-pressed': x.id === p.id ? 'true' : 'false', onclick: () => { setCur(x.id); rerender(); } }, x.name))));
  }
  tools.append(h('button.ghostbtn', { 'aria-pressed': edit ? 'true' : 'false', onclick: () => { edit = !edit; pickRoom = ''; rerender(); } }, edit ? 'Klar' : 'Placera rum'));
  head.append(tools);
  kids.push(info('plan', 'Punkterna visar rummen du placerat: fylld = lampa tänd, ring = rörelse senaste minuten, gul kant = dörr eller fönster öppet. Tryck på ett rum för att öppna det. Ritningen och placeringen finns bara i den här webbläsaren.'));

  const img = h('img.plan-img', { src: p.img, alt: `Planritning ${p.name}`, width: String(p.w), height: String(p.h), draggable: 'false' });
  const stage = h('div.plan-stage', { dataset: { edit: edit ? '1' : '0' } }, img);

  for (const r of list) {
    const m = p.marks[r.id];
    if (!m) continue;
    const dot = h('span.pm-dot', { 'aria-hidden': 'true' });
    const label = h('span.pm-label', r.name);
    const sub = h('span.pm-sub');
    const btn = h('button.pm', {
      'aria-label': r.name,
      dataset: { room: r.id, sel: edit && pickRoom === r.id ? '1' : '0' },
      onclick: (e) => {
        e.stopPropagation();
        if (edit) { pickRoom = r.id; rerender(); return; }
        openRoom(r.id); onOpen();
      },
    }, dot, h('span.pm-text', label, sub));
    btn.style.left = `${m.x * 100}%`;
    btn.style.top = `${m.y * 100}%`;
    stage.append(btn);
    built.marks.set(r.id, { btn, sub, room: r });
  }

  if (edit) {
    stage.addEventListener('click', async (e) => {
      if (!pickRoom) { toast('Välj ett rum under bilden först.'); return; }
      const box = img.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = (e.clientX - box.left) / box.width, y = (e.clientY - box.top) / box.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      try {
        const np = await store.setMark(p, pickRoom, x, y);
        plans = plans.map(q => (q.id === np.id ? np : q));
        rerender();
      } catch { toast('Kunde inte spara placeringen.'); }
    });
  }
  kids.push(stage);

  if (edit) {
    const sel = h('nav.jump', { 'aria-label': 'Rum att placera' },
      ...list.map(r => h('button.chip', {
        'aria-pressed': pickRoom === r.id ? 'true' : 'false',
        dataset: { placed: p.marks[r.id] ? '1' : '0' },
        onclick: () => { pickRoom = pickRoom === r.id ? '' : r.id; rerender(); },
      }, r.name)));
    const actions = h('div.row');
    if (pickRoom && p.marks[pickRoom]) {
      actions.append(h('button', {
        onclick: async () => {
          try { const np = await store.clearMark(p, pickRoom); plans = plans.map(q => (q.id === np.id ? np : q)); rerender(); }
          catch { toast('Kunde inte ta bort.'); }
        },
      }, 'Ta bort rummets punkt'));
    }
    actions.append(h('button.danger', {
      onclick: async () => {
        if (!confirm(`Ta bort ritningen "${p.name}" från den här webbläsaren? Inget ändras i Homey.`)) return;
        try { await store.remove(p.id); plans = plans.filter(q => q.id !== p.id); edit = false; pickRoom = ''; rerender(); }
        catch { toast('Kunde inte ta bort.'); }
      },
    }, 'Ta bort ritningen'));
    kids.push(h('p.note', pickRoom ? 'Tryck på bilden där rummet ligger.' : 'Välj ett rum och tryck sedan på bilden. Rum med punkt är markerade.'));
    kids.push(sel, actions);
    if (plans.length < store.MAX_PLANS) kids.push(h('details.plan-add', h('summary', 'Lägg till en ritning till (t.ex. en våning till)'), uploadForm(rerender)));
  } else if (!Object.keys(p.marks).length) {
    kids.push(h('p.note', 'Inga rum placerade ännu – tryck på Placera rum.'));
  }

  const status = h('p.note.plan-status');
  built.status = status;
  kids.push(status);
  root.replaceChildren(h('section.card.plan', ...kids));
}

function update(list, now) {
  let lit = 0, moving = 0;
  for (const [, x] of built.marks) {
    const s = roomState(x.room, now);
    x.btn.dataset.lit = s.lit ? '1' : '0';
    x.btn.dataset.motion = s.moving ? '1' : '0';
    x.btn.dataset.open = s.open ? '1' : '0';
    x.sub.textContent = stateText(s);
    if (s.lit) lit += 1;
    if (s.moving) moving += 1;
  }
  if (built.status) {
    built.status.textContent = built.marks.size
      ? `${lit} rum med tänt · ${moving} med rörelse${list.length > built.marks.size && !edit ? ` · ${list.length - built.marks.size} rum utan punkt` : ''}`
      : '';
  }
}
