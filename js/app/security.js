// security.js – lås- och larmkort på Hem och vyn Kamera. Endast visning.
// Lås och larm är K (04): inga reglage, och inget här skriver till Homey.
// Ögonblicksbilder visas inte (ingen läsbar bild i Homey, O 1/11).

import { deviceList } from './state.js';
import { h } from './ui.js';
import { el } from '../core/svg.js';
import { ago } from '../core/activity.js';
import { locks, alarms, cameras, LOW_BATTERY } from '../core/security.js';

const ICONS = {
  lock: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14v10H5z'],
  unlock: ['M7 11V7a5 5 0 0 1 9.3-2.5', 'M5 11h14v10H5z'],
  door: ['M6 21V4h12v17', 'M4 21h16', 'M14.5 12h.01'],
  dooropen: ['M6 21V4h12v17', 'M4 21h16', 'M6 4l7 2v15'],
  shield: ['M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z', 'M9 12l2 2 4-4'],
  shieldoff: ['M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z', 'M9.5 9.5l5 5M14.5 9.5l-5 5'],
  siren: ['M7 17v-5a5 5 0 0 1 10 0v5', 'M5 17h14v4H5z', 'M12 3v2M4 7l1.5 1.5M20 7l-1.5 1.5'],
  battery: ['M3 8h16v9H3z', 'M21 11v3'],
  camera: ['M3 7h4l2-3h6l2 3h4v13H3z', 'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l2 2H4z', 'M10 20a2 2 0 0 0 4 0'],
};

function icon(name) {
  const svg = el('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  for (const d of ICONS[name]) svg.append(el('path', { d }));
  return svg;
}

const WD = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
// "18:42" i dag, "i går 18:42", annars "lör 31/10 18:42".
export function stamp(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '–';
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  if (ms >= day0.getTime()) return hm;
  if (ms >= day0.getTime() - 86400000) return `i går ${hm}`;
  return `${WD[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${hm}`;
}

function big(iconName, state, sub) {
  return h('div.sec-big', h('span.sec-ico', icon(iconName)), h('span.sec-txt', h('span.sec-state', state), h('span.sec-sub', sub)));
}
function row(iconName, text, tone = '') {
  return h('p.sec-row', { dataset: tone ? { tone } : {} }, icon(iconName), h('span', text));
}

function lockCard(l, now) {
  const state = l.off ? 'Otillgängligt' : l.locked === null ? 'Okänt' : l.locked ? 'Låst' : 'Olåst';
  const sub = l.since ? `sedan ${stamp(l.since, now)}` : '';
  const kids = [h('div.sec-head', h('span.sec-label', l.name || 'Lås'), h('span.tag', 'Visning')),
    big(l.locked === false ? 'unlock' : 'lock', state, sub)];
  if (l.door === 'open') kids.push(row('dooropen', `Dörren öppen${l.doorSince ? ` · ${ago(l.doorSince, now).replace(' sedan', '')}` : ''}`, l.locked ? 'warn' : 'bad'));
  else if (l.door === 'closed') kids.push(row('door', 'Dörren stängd', l.locked ? 'good' : ''));
  if (l.battery) kids.push(row('battery', 'Byt batteri i låset', 'warn'));
  return h('section.card.sec', { dataset: { tone: l.tone }, 'aria-label': `${l.name}: ${state}` }, ...kids);
}

function alarmBody(a, cams, now) {
  const state = a.off ? 'Otillgängligt' : a.alarm ? 'Larm!' : a.armed ? (a.mode === 'Aktiverat' ? 'Aktiverat' : a.mode) : a.mode;
  const sub = a.since ? `${a.alarm ? '' : 'sedan '}${stamp(a.since, now)}` : '';
  const last = cams.map(c => c.event && c.event.at).filter(Number.isFinite).sort((x, y) => y - x)[0];
  const camTxt = cams.length ? `${cams.length} kamer${cams.length === 1 ? 'a' : 'or'}${last ? ` · senast ${stamp(last, now)}` : ''}` : '';
  return [big(a.alarm ? 'siren' : a.armed ? 'shield' : 'shieldoff', state, sub),
    camTxt ? row('camera', a.alarm ? 'Se kameror' : camTxt, a.alarm ? 'bad' : '') : null];
}

// Korten på Hem: lås och larm. Tomt om inget finns.
export function secCards(onOpenCameras, now = Date.now()) {
  const devs = deviceList();
  const ls = locks(devs), as = alarms(devs), cams = cameras(devs);
  const out = ls.map(l => lockCard(l, now));
  for (const a of as) {
    out.push(h('button.card.sec.sec-link', { type: 'button', dataset: { tone: a.tone }, onclick: onOpenCameras, 'aria-label': `${a.name}: ${a.mode}. Öppna Kamera` },
      h('div.sec-head', h('span.sec-label', 'Larm'), h('span.chev', { 'aria-hidden': 'true' }, '›')),
      ...alarmBody(a, cams, now)));
  }
  return out;
}

// Vyn Kamera: larmläget överst, sedan en rad per kamera med senaste händelse och batteri.
export function renderCameras(root, now = Date.now()) {
  const devs = deviceList();
  const as = alarms(devs), cams = cameras(devs);
  const kids = [];
  for (const a of as) {
    kids.push(h('section.card.sec.sec-wide', { dataset: { tone: a.tone } },
      h('div.sec-head', h('span.sec-label', a.name || 'Larm'), h('span.tag', 'Visning')), ...alarmBody(a, [], now)));
  }
  if (!cams.length) kids.push(h('p.note', 'Inga kameror hittade.'));
  for (const c of cams) {
    const ev = c.event;
    const evTxt = c.off ? 'Otillgänglig' : !ev ? 'Ingen händelse' : ev.now ? `${ev.label} nu` : `${ev.label} · ${stamp(ev.at, now)}`;
    const low = c.battery !== null && c.battery < LOW_BATTERY;
    kids.push(h('section.card.cam', { dataset: { live: ev && ev.now ? '1' : '0', off: c.off ? '1' : '0' } },
      h('span.cam-ico', icon(c.kind === 'doorbell' ? 'bell' : 'camera')),
      h('span.cam-txt', h('span.cam-name', c.name || 'Kamera'), h('span.cam-ev', evTxt)),
      c.battery !== null ? h('span.cam-bat', { dataset: { low: low ? '1' : '0' } }, `${Math.round(c.battery)} %`) : null));
  }
  kids.push(h('p.fine', 'Tiderna kommer från Homey och kan ligga upp till en minut efter kamerans egen tid. Igenkänt ansikte visas som Person, utan namn. Ögonblicksbilder visas inte: Homey ger ingen bild att läsa.'));
  root.replaceChildren(h('div.camlist', ...kids));
}
