// ui.js – små DOM-hjälpare och format. Ingen innerHTML: allt via createElement/textContent.

export const $ = (id) => document.getElementById(id);

// h('div.card.wide', { onclick, 'aria-label': … }, 'text', child, …)
export function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split('.');
  const n = document.createElement(name || 'div');
  if (cls.length) n.className = cls.join(' ');
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  } else if (attrs !== undefined && attrs !== null) kids.unshift(attrs);
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return n;
}

export function num(v, dec = 0) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–';
  return Number(v).toLocaleString('sv-SE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function hhmm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function hh(ms) {
  return String(new Date(ms).getHours()).padStart(2, '0');
}

const WD = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
export function weekday(ms) { return WD[new Date(ms).getDay()]; }

export function dayLabel(ms, now = Date.now()) {
  const a = new Date(ms); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return 'i dag';
  if (diff === 1) return 'i morgon';
  if (diff === -1) return 'i går';
  return `${weekday(ms)} ${a.getDate()}/${a.getMonth() + 1}`;
}

// Kr med två decimaler under 10, annars hela kronor.
export function kr(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${num(v, Math.abs(v) < 10 ? 2 : 0)} kr`;
}

export function power(w) {
  if (w === null || w === undefined || !Number.isFinite(w)) return '–';
  return Math.abs(w) >= 1000 ? `${num(w / 1000, 2)} kW` : `${num(w)} W`;
}

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

export function capVal(d, cap) {
  const o = d && d.capabilitiesObj && d.capabilitiesObj[cap];
  return o && typeof o === 'object' ? o.value : undefined;
}

export function hasCap(d, cap) {
  return Boolean(d) && Array.isArray(d.capabilities) && d.capabilities.includes(cap);
}

// Liten statusrad i en sektion: { s: 'ok'|'warn'|'fail'|'wait', text }
export function note(text, s = 'wait') {
  return h('p.note', { dataset: { s } }, text);
}

// Faktisk bredd i px för ett diagram i ett helbreddskort (body- och kortmarginaler avdragna).
export function chartWidth() {
  const vw = Math.min(document.documentElement.clientWidth || 360, 1120);
  return Math.max(280, vw - 32 - 34);
}

// Förklaring bakom en info-knapp (i). Öppet läge minns per nyckel under sessionen,
// så att en omritning inte stänger den.
const openInfo = new Set();
export function info(key, text) {
  const d = h('details.info', h('summary', { 'aria-label': 'Förklaring', title: 'Förklaring' }, 'i'), h('p', text));
  if (openInfo.has(key)) d.open = true;
  d.addEventListener('toggle', () => { if (d.open) openInfo.add(key); else openInfo.delete(key); });
  return d;
}
