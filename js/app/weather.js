// weather.js – väder från SMHI: nu, timmar framåt och några dygn. Endast visning.
// Position: Homeys position (homey.geolocation.readonly), avrundad till två decimaler
// innan den skickas till SMHI. Den sparas inte – den hämtas per session.

import { state, changed } from './state.js';
import { h, num, hh, dayLabel, note, chartWidth, info } from './ui.js';
import * as smhi from '../adapters/smhi.js';
import * as W from '../core/weather.js';
import { barChart, lineChart, weatherIcon } from '../core/svg.js';
import { sunTimes } from '../core/sun.js';

let position = null; // { lat, lon } i minnet
let builtSig = '';    // vad Väder-vyn senast byggdes av (0.7.2)

export async function loadWeather() {
  if (!position && state.homey && state.homey.active) {
    const g = await state.homey.location();
    state.diag.position = g.ok ? 'ok' : g.err;
    if (g.ok) position = { lat: g.lat, lon: g.lon };
  }
  if (!position) {
    state.weather = { pts: [], err: 'no-position', at: Date.now() };
    changed('weather');
    return;
  }
  const f = await smhi.forecast(position.lat, position.lon);
  state.diag.smhi = f.ok ? `ok (${f.api})` : f.err;
  state.weather = f.ok ? { pts: W.parse(f.data), api: f.api, at: Date.now() } : { pts: [], err: f.err, at: Date.now() };
  changed('weather');
}

export function weatherNeedsReload(now = Date.now()) {
  const w = state.weather;
  return !w || now - w.at > (w.err ? 5 : 30) * 60000;
}

export function forgetPosition() { position = null; }

// Natt enligt verklig sol när positionen finns, annars en enkel klockregel.
function nightAt(ms) {
  if (!position) return W.isNight(ms);
  const s = sunTimes(ms, position.lat, position.lon);
  if (s.polar) return s.polar === 'night';
  return ms < s.rise || ms > s.set;
}

function hm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "Sol upp 07:21 · ned 16:28 · 9 h 7 min" för i dag, eller i morgon efter solnedgång.
function sunLine(now) {
  if (!position) return null;
  let s = sunTimes(now, position.lat, position.lon);
  let label = '';
  if (!s.polar && now > s.set) { s = sunTimes(now + 86400000, position.lat, position.lon); label = 'I morgon: '; }
  if (s.polar) return s.polar === 'day' ? 'Midnattssol' : 'Polarnatt';
  const len = Math.round((s.set - s.rise) / 60000);
  return `${label}sol upp ${hm(s.rise)} · ned ${hm(s.set)} · ${Math.floor(len / 60)} h ${len % 60} min`;
}

function outlookList(pts, now) {
  const items = W.outlook(pts, now, 24);
  return h('ul.outlook', ...items.map(o => h('li', { dataset: { kind: o.kind, warn: o.warn ? '1' : '0' } }, o.text)));
}

function wind(p) {
  if (p.wind === null) return '–';
  return `${num(p.wind)} m/s${p.gust !== null && p.gust - p.wind >= 3 ? ` (${num(p.gust)})` : ''}`;
}

function errText(w) {
  return w.err === 'no-position' ? 'Homeys position kunde inte läsas, så vädret kan inte hämtas.' : 'SMHI svarar inte just nu.';
}

export function weatherCardBody(now = Date.now()) {
  const w = state.weather;
  if (!w) return [note('Hämtar väder…')];
  if (!w.pts.length) return [note(errText(w), 'fail')];
  const c = W.current(w.pts, now);
  const s = W.symbol(c.sym);
  const next = W.nextHours(w.pts, now, 8).filter(p => p.t > now).filter((_, i) => i % 2 === 0).slice(0, 4);
  return [
    h('div.wx-now',
      weatherIcon(s.kind, nightAt(c.t), 44),
      h('div', h('div.big', `${num(c.temp, 1)}°`), h('div.stat-sub', `${s.text} · ${wind(c)}`))),
    h('p.sect-label', 'Närmaste dygnet'),
    outlookList(w.pts, now),
    h('div.wx-strip', ...next.map(p => h('div.wx-mini',
      h('div.stat-label', hh(p.t)), weatherIcon(W.symbol(p.sym).kind, nightAt(p.t), 22), h('div.stat-sub', `${num(p.temp)}°`)))),
    sunLine(now) ? h('p.fine', sunLine(now)) : null,
  ];
}

// Väder-vyn byggs bara om när innehållet kan ha ändrats: ny SMHI-hämtning (at), ny timme
// (timremsan och "nu" flyttas), ny bredd (diagrammen) eller tom vy. Realtidshändelser från
// Homey ritar annars om hela appen var 250:e ms och nollade remsans sidledsscroll.
// Vid ombyggnad behålls remsans scrollLeft.
export function renderWeather(root, now = Date.now()) {
  const w = state.weather;
  const sig = `${w ? `${w.at}|${w.err || ''}|${w.pts.length}` : '-'}|${Math.floor(now / 3600000)}|${chartWidth()}`;
  if (sig === builtSig && root.firstChild) return;
  const prev = root.querySelector('.wx-strip.scroll');
  const left = prev ? prev.scrollLeft : 0;
  builtSig = sig;
  const kids = [];
  if (!w) kids.push(h('section.card', h('h2', 'Väder'), note('Hämtar väder…')));
  else if (!w.pts.length) kids.push(h('section.card', h('h2', 'Väder'), note(errText(w), 'fail')));
  else {
    const c = W.current(w.pts, now);
    const s = W.symbol(c.sym);
    kids.push(h('section.card',
      h('h2', 'Väder nu'),
      h('div.wx-now',
        weatherIcon(s.kind, nightAt(c.t), 56),
        h('div', h('div.big', `${num(c.temp, 1)}°`), h('div.stat-sub', s.text))),
      h('div.stats',
        h('div.stat', h('div.stat-label', 'Vind'), h('div.stat-val', wind(c)), h('div.stat-sub', 'medel (byvind)')),
        h('div.stat', h('div.stat-label', 'Nederbörd'), h('div.stat-val', `${num(c.rain || 0, 1)}`), h('div.stat-sub', 'mm/h'))),
      h('p.sect-label', 'Närmaste dygnet'),
      outlookList(w.pts, now),
      sunLine(now) ? h('p.fine', sunLine(now)) : null));

    const hrs = W.nextHours(w.pts, now, 24);
    const labels = hrs.map(p => hh(p.t));
    kids.push(h('section.card',
      h('h2', 'Kommande timmar'),
      h('div.wx-strip.scroll', ...hrs.map(p => h('div.wx-mini',
        h('div.stat-label', hh(p.t)), weatherIcon(W.symbol(p.sym).kind, nightAt(p.t), 24),
        h('div.stat-sub', `${num(p.temp)}°`), h('div.stat-sub.dim', p.wind !== null ? `${num(p.wind)} m/s` : '')))),
      lineChart(hrs.map((p, i) => ({ v: p.temp, label: labels[i] })), { width: chartWidth(), fmt: v => `${num(v)}°`, labelEvery: 3, cls: 'line temp', label: 'Temperatur kommande dygn' }),
      hrs.some(p => p.rain > 0)
        ? barChart(hrs.map((p, i) => ({ v: p.rain || 0, label: labels[i], cls: 'rain' })), { width: chartWidth(), height: 110, fmt: v => num(v, 1), labelEvery: 3, minMax: 1, label: 'Nederbörd mm/h' })
        : h('p.fine', 'Ingen nederbörd de närmaste timmarna.')));

    const days = W.days(w.pts, 6, now);
    kids.push(h('section.card',
      h('h2', 'Kommande dygn'),
      h('ul.days', ...days.map(d => {
        const sy = W.symbol(d.sym);
        return h('li',
          h('span.d-name', dayLabel(d.t, now)),
          weatherIcon(sy.kind, false, 26),
          h('span.d-temp', `${num(d.min)}° / ${num(d.max)}°`),
          h('span.d-more', `${d.wind !== null ? `${num(d.wind)} m/s` : ''}${d.mm >= 0.5 ? ` · ${num(d.mm, d.mm < 10 ? 1 : 0)} mm` : ''}`));
      })),
      info('wx', `Källa: SMHI (${w.api}), uppdateras var 30:e minut. Närmaste dygnet: nederbörd från 0,1 mm/h, minusgrader under −0,5°, frostrisk nattetid till 2°, hårda vindbyar från 14 m/s. Sol upp och ned räknas ut lokalt från Homeys position.`)));
  }
  root.replaceChildren(...kids);
  const strip = root.querySelector('.wx-strip.scroll');
  if (strip && left) strip.scrollLeft = left;
}

// Tvingar fram ombyggnad nästa gång (t.ex. efter frånkoppling, när vyn tömts).
export function resetWeatherView() { builtSig = ''; }
