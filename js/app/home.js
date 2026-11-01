// home.js – översiktens kort för närvaro, snabbreglage och energiflöde vid laddning.
// Allt läses ur enheterna vid körning; inga namn eller ID i koden. Snabbreglagen går
// genom samma rad och skrivväg som rumsvyn (controls.js + homey.control).

import { deviceList } from './state.js';
import { h, power, capVal, info } from './ui.js';
import { el } from '../core/svg.js';
import * as fav from '../core/favorites.js';
import { presence, initials, ago, chargers, isCharging, flow } from '../core/activity.js';
import { controlRow } from './roomsview.js';
import { meter } from './energy.js';

// ---------- Närvaro (Smart Presence m.fl.) ----------
// Initial i stället för bild: profilbilder skulle vara husdata. De kan läggas till senare
// som lokal bild per webbläsare, på samma sätt som planritningen.

export function presenceBody(now = Date.now()) {
  const ps = presence(deviceList());
  if (!ps.length) return [h('p.note', 'Ingen närvaroenhet hittad.')];
  const home = ps.filter(p => p.home).length;
  return [
    h('ul.people', ...ps.map(p => h('li.person', { dataset: { home: p.home ? '1' : '0' }, title: `${p.name}: ${p.home ? 'hemma' : 'borta'}` },
      h('span.avatar', { 'aria-hidden': 'true' }, initials(p.name)),
      h('span.p-text', h('span.p-name', p.name),
        h('span.p-state', `${p.home ? 'Hemma' : 'Borta'}${p.since ? ` · ${ago(p.since, now)}` : ''}`))))),
    h('p.fine', home ? `${home} av ${ps.length} hemma` : 'Ingen hemma'),
    info('presence', 'Närvaro läses från närvaroenheterna i Homey (t.ex. Smart Presence) när appen körs. Tiden anger när läget senast ändrades. Inget sparas i appen.'),
  ];
}

// ---------- Snabbreglage ----------
// Stjärnmärkta reglage (favorites.js). Standard utan sparad lista: kaffebryggarna.
// Bara enheter i en reglageklass visas; regeln i controls.js avgör om reglaget är aktivt.

export function quickBody() {
  const ds = fav.list(deviceList());
  if (!ds.length) return [h('p.note', 'Stjärnmärk ett reglage i Rum så visas det här.')];
  const ul = h('ul.devs.quick');
  for (const d of ds) ul.append(controlRow(d).el);
  return [ul, info('quick', 'Stjärnmärk lampor och kaffebryggare i Rum för att få dem här. Stjärnorna sparas bara i den här webbläsaren. Vad som får styras avgörs av samma regel som i Rum.')];
}

// ---------- Energiflöde: nät → hus → laddbox ----------
// Visas bara när en laddbox laddar. Endast visning.

export function chargingNow() {
  return chargers(deviceList()).filter(isCharging);
}

const ICON = {
  grid: 'M12 3l-5 18M12 3l5 18M8.5 9h7M7.5 13h9M6.5 17h11',
  house: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  car: 'M5 16v-4l2-5h10l2 5v4M5 16h14M5 16v2M19 16v2M7.5 13.5h.01M16.5 13.5h.01M7 7l-1 5h12l-1-5',
};

function node(x, kind, label, value, cls) {
  const g = el('g', { class: `fl-node ${cls || ''}`, transform: `translate(${x},0)` });
  g.append(el('rect', { x: -34, y: 6, width: 68, height: 52, rx: 10, class: 'fl-box' }));
  g.append(el('path', { d: ICON[kind], class: 'fl-icon', transform: 'translate(-12,12)' }));
  const t1 = el('text', { x: 0, y: 76, class: 'fl-label', 'text-anchor': 'middle' }); t1.textContent = label;
  const t2 = el('text', { x: 0, y: 94, class: 'fl-val', 'text-anchor': 'middle' }); t2.textContent = value;
  g.append(t1, t2);
  return g;
}

function link(x1, x2, watts, cls) {
  const g = el('g', { class: `fl-link ${cls || ''}` });
  g.append(el('line', { x1, y1: 32, x2, y2: 32, class: 'fl-track' }));
  if (watts > 0) {
    // Fart efter effekt: 1–11 kW ger 2,4–0,8 s per varv (klass, ingen inline-stil).
    const speed = watts >= 7000 ? 'fast' : watts >= 2500 ? 'mid' : 'slow';
    g.append(el('line', { x1, y1: 32, x2, y2: 32, class: `fl-dash ${speed}` }));
  }
  return g;
}

export function flowCard() {
  const ch = chargingNow();
  if (!ch.length) return null;
  const c = ch[0];
  const m = meter();
  const f = flow(m ? capVal(m, 'measure_power') : null, capVal(c, 'measure_power'));
  const svg = el('svg', { viewBox: '0 0 320 104', class: 'flow', role: 'img',
    'aria-label': `Nät ${power(f.grid)}, huset ${power(f.house)}, laddbox ${power(f.charger)}` });
  svg.append(
    link(74, 126, f.grid || 0, ''),
    link(194, 246, f.charger || 0, 'ev'),
    node(40, 'grid', 'Nät', power(f.grid), ''),
    node(160, 'house', 'Huset', power(f.house), ''),
    node(280, 'car', 'Laddbox', power(f.charger), 'ev'),
  );
  const share = f.share !== null ? `${Math.round(f.share * 100)} % av effekten går till laddningen` : 'Husets mätare saknas – bara laddboxens effekt visas.';
  return h('section.card.span2.flowcard',
    h('h2.card-title', 'Laddning pågår'),
    info('flow', 'Visas när laddboxen laddar. Nät = husets elmätare (allt som går in i huset), Laddbox = laddboxens egen effekt, Huset = skillnaden. Endast visning, laddningen styrs inte här.'),
    svg,
    h('p.fine', `${share}${ch.length > 1 ? ` · ${ch.length} laddboxar laddar, den första visas` : ''}`));
}
