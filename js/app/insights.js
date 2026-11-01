// insights.js – översiktens insikter: korta rader som säger något nytt om läget i huset.
// Bygger på data som redan hämtats (enheter, Insights, priser). Inga egna nätanrop.

import { state, deviceList } from './state.js';
import { h, num, power, hh, info, note } from './ui.js';
import * as E from '../core/energy.js';
import { hotWater, brand } from '../core/devinfo.js';
import { figures } from './energy.js';

const DAY = 86400000;

function line(label, value, sub, kind = '') {
  return h(`li${kind ? `.${kind}` : ''}`, h('span.ins-label', label), h('span.ins-val', value), sub ? h('span.ins-sub', sub) : null);
}

export function insightsBody(now = Date.now()) {
  const rows = [];

  // Varmvatten (NIBE BT7 m.fl.)
  for (const d of deviceList()) {
    const hw = hotWater(d);
    if (!hw) continue;
    const b = brand(d);
    rows.push(line('Varmvatten', `${num(hw.value, 1)}°`, `${b ? `${b} · ` : ''}${hw.title}`, hw.value < 40 ? 'warn' : ''));
    break;
  }

  const f = figures(now);
  const en = state.energy;
  const day0 = E.startOfDay(now);

  // Effekttopp i dag
  if (en && en.powDay && en.powDay.length) {
    const top = en.powDay.filter(p => p.t >= day0).reduce((a, p) => (!a || p.v > a.v ? p : a), null);
    if (top) rows.push(line('Effekttopp i dag', power(top.v), `kl ${hh(top.t)}`));
  }

  // Snittpriset du betalat i dag
  if (Number.isFinite(f.todayKr) && f.todayKwh > 0.5) {
    const paid = f.todayKr / f.todayKwh;
    const nowP = Number.isFinite(f.priceNow) ? f.priceNow : null;
    rows.push(line('Snittpris i dag', `${num(paid, 2)} kr/kWh`,
      nowP !== null ? `just nu ${num(nowP, 2)} kr/kWh${nowP > paid * 1.2 ? ' – dyrare än snittet' : nowP < paid * 0.8 ? ' – billigare än snittet' : ''}` : null,
      nowP !== null && nowP > paid * 1.2 ? 'warn' : ''));
  }

  if (!rows.length) return [note(state.devices.size ? 'Inga insikter än – Insights hämtas.' : 'Hämtar…')];
  return [h('ul.insights', ...rows),
    info('ins', 'Varmvatten: varmvattengivaren på värmepumpen (topp om den finns). Snittpris i dag = dagens kostnad delat med dagens förbrukning, inkl. skatt och moms.')];
}
