// weather.js – väder från SMHI: nu, timmar framåt och några dygn. Endast visning.
// Position: Homeys position (homey.geolocation.readonly), avrundad till två decimaler
// innan den skickas till SMHI. Den sparas inte – den hämtas per session.

import { state, changed } from './state.js';
import { h, num, hh, dayLabel, note, chartWidth } from './ui.js';
import * as smhi from '../adapters/smhi.js';
import * as W from '../core/weather.js';
import { barChart, lineChart, weatherIcon } from '../core/svg.js';

let position = null; // { lat, lon } i minnet

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
      weatherIcon(s.kind, W.isNight(c.t), 44),
      h('div', h('div.big', `${num(c.temp, 1)}°`), h('div.stat-sub', `${s.text} · ${wind(c)}`))),
    h('div.wx-strip', ...next.map(p => h('div.wx-mini',
      h('div.stat-label', hh(p.t)), weatherIcon(W.symbol(p.sym).kind, W.isNight(p.t), 22), h('div.stat-sub', `${num(p.temp)}°`)))),
  ];
}

export function renderWeather(root, now = Date.now()) {
  const w = state.weather;
  const kids = [];
  if (!w) kids.push(h('section.card', h('h2', 'Väder'), note('Hämtar väder…')));
  else if (!w.pts.length) kids.push(h('section.card', h('h2', 'Väder'), note(errText(w), 'fail')));
  else {
    const c = W.current(w.pts, now);
    const s = W.symbol(c.sym);
    kids.push(h('section.card',
      h('h2', 'Väder nu'),
      h('div.wx-now',
        weatherIcon(s.kind, W.isNight(c.t), 56),
        h('div', h('div.big', `${num(c.temp, 1)}°`), h('div.stat-sub', s.text))),
      h('div.stats',
        h('div.stat', h('div.stat-label', 'Vind'), h('div.stat-val', wind(c)), h('div.stat-sub', 'medel (byvind)')),
        h('div.stat', h('div.stat-label', 'Nederbörd'), h('div.stat-val', `${num(c.rain || 0, 1)}`), h('div.stat-sub', 'mm/h')))));

    const hrs = W.nextHours(w.pts, now, 24);
    const labels = hrs.map(p => hh(p.t));
    kids.push(h('section.card',
      h('h2', 'Kommande timmar'),
      h('div.wx-strip.scroll', ...hrs.map(p => h('div.wx-mini',
        h('div.stat-label', hh(p.t)), weatherIcon(W.symbol(p.sym).kind, W.isNight(p.t), 24),
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
      h('p.fine', `Källa: SMHI (${w.api}). Endast visning; varningar sköts av Telegram.`)));
  }
  root.replaceChildren(...kids);
}
