// svg.js – egna diagram och ikoner i SVG. Inga bibliotek, ingen innerHTML:
// allt byggs med createElementNS och textContent (Trusted Types krävs i sidan).
// Färger sätts via klasser i css/app.css, så paletten finns på ett ställe.

const NS = 'http://www.w3.org/2000/svg';

export function el(name, attrs = {}, kids = []) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  for (const c of kids) if (c) n.append(c);
  return n;
}

function text(x, y, s, cls, anchor = 'middle') {
  const t = el('text', { x, y, class: cls, 'text-anchor': anchor });
  t.textContent = s;
  return t;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// Bredden (opts.width) ska vara den faktiska bredden i px, så att text och linjer
// inte skalas. Anroparen räknar ut den (chartWidth i ui.js).

// Stapeldiagram med valfri linje (andra serie, egen skala till höger utan axel).
// bars: [{ v: number|null, label?: string, cls?: string, title?: string }]
// opts: { width, height, fmt(v), labelEvery, now (index), line: [number|null], lineSameScale, minMax,
//         bg: [number|null], bgFmt(v) }
export function barChart(bars, opts = {}) {
  const W = Math.max(280, Math.round(opts.width || 640)), H = opts.height || 200;
  const hasBg = Array.isArray(opts.bg) && opts.bg.some(v => v !== null && Number.isFinite(v));
  const padL = 40, padR = hasBg ? 40 : 8, padT = 10, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = bars.map(b => b.v).filter(v => v !== null && Number.isFinite(v));
  const lineVals = opts.lineSameScale && Array.isArray(opts.line) ? opts.line.filter(v => v !== null && Number.isFinite(v)) : [];
  const lo = Math.min(0, ...vals, ...lineVals);
  const hi = niceMax(Math.max(opts.minMax || 0, ...vals, ...lineVals, 0));
  const y = (v) => padT + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const n = Math.max(1, bars.length);
  const bw = iw / n;
  const gap = n > 40 ? 0.5 : n > 20 ? 1 : 2;
  const fmt = opts.fmt || ((v) => String(Math.round(v)));

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  if (opts.label) svg.setAttribute('aria-label', opts.label);

  // Rutnät och y-etiketter (3 nivåer)
  for (let i = 0; i <= 2; i += 1) {
    const v = lo + (hi - lo) * (i / 2);
    const yy = y(v);
    svg.append(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: 'grid' }));
    svg.append(text(padL - 6, yy + 4, fmt(v), 'axis', 'end'));
  }
  if (lo < 0) svg.append(el('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'zero' }));

  // Bakgrund: en andra serie (t.ex. pris per stapel) som trappsteg bakom staplarna,
  // med egen skala och etiketter till höger. opts.bg: [number|null], opts.bgFmt(v).
  let bgTop = null;
  if (hasBg) {
    const bv = opts.bg.filter(v => v !== null && Number.isFinite(v));
    const blo = Math.min(0, ...bv), bhi = niceMax(Math.max(...bv, 0));
    const by = (v) => padT + ih - ((v - blo) / (bhi - blo || 1)) * ih;
    let d = '', pen = false;
    opts.bg.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { if (pen) d += `V${by(blo).toFixed(1)}Z`; pen = false; return; }
      const x0 = padL + bw * i, x1 = x0 + bw, yy = by(v).toFixed(1);
      d += pen ? `H${x0.toFixed(1)}V${yy}H${x1.toFixed(1)}` : `M${x0.toFixed(1)},${by(blo).toFixed(1)}V${yy}H${x1.toFixed(1)}`;
      pen = true;
    });
    if (pen) d += `V${by(blo).toFixed(1)}Z`;
    svg.append(el('path', { d, class: 'bgarea' }));
    // Trappans överkant ritas ovanpå staplarna (läggs till sist), så att priset syns.
    let top = '', on = false;
    opts.bg.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { on = false; return; }
      const x0 = padL + bw * i, x1 = x0 + bw, yy = by(v).toFixed(1);
      top += on ? `V${yy}H${x1.toFixed(1)}` : `M${x0.toFixed(1)},${yy}H${x1.toFixed(1)}`;
      on = true;
    });
    bgTop = el('path', { d: top, class: 'bgline' });
    const bf = opts.bgFmt || ((v) => String(Math.round(v * 100) / 100));
    for (const v of [bhi / 2, bhi]) svg.append(text(W - padR + 6, by(v) + 4, bf(v), 'axis bg-axis', 'start'));
  }

  if (opts.now !== undefined && opts.now !== null && opts.now >= 0 && opts.now < n) {
    const x = padL + bw * opts.now;
    svg.append(el('rect', { x, y: padT, width: bw, height: ih, class: 'nowband' }));
  }

  bars.forEach((b, i) => {
    if (b.v === null || !Number.isFinite(b.v)) return;
    const x = padL + bw * i + gap / 2;
    const y0 = y(Math.max(0, lo)), y1 = y(b.v);
    const r = el('rect', { x, y: Math.min(y0, y1), width: Math.max(0.5, bw - gap), height: Math.max(0.5, Math.abs(y0 - y1)), class: `bar ${b.cls || ''}` });
    if (b.title) { const t = el('title'); t.textContent = b.title; r.append(t); }
    svg.append(r);
  });

  if (bgTop) svg.append(bgTop);

  if (Array.isArray(opts.line)) {
    const lv = opts.line.filter(v => v !== null && Number.isFinite(v));
    if (lv.length) {
      // lineSameScale: linjen har samma enhet som staplarna (t.ex. kr/kWh) och delar skala.
      const lhi = opts.lineSameScale ? hi : niceMax(Math.max(...lv));
      const llo = opts.lineSameScale ? lo : 0;
      const ly = (v) => padT + ih - ((v - llo) / (lhi - llo || 1)) * ih;
      let d = '', pen = false;
      opts.line.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) { pen = false; return; }
        const x = padL + bw * i + bw / 2;
        d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${ly(v).toFixed(1)}`;
        pen = true;
      });
      svg.append(el('path', { d, class: opts.lineCls || 'line' }));
    }
  }

  let every = opts.labelEvery || Math.ceil(n / 8);
  while (bw * every < 30 && every < n) every *= 2;
  bars.forEach((b, i) => {
    if (!b.label || i % every !== 0) return;
    svg.insertBefore(el('line', { x1: padL + bw * i, x2: padL + bw * i, y1: padT, y2: padT + ih, class: 'grid v' }), svg.firstChild);
    svg.append(text(padL + bw * i + bw / 2, H - 6, b.label, 'axis'));
  });
  return svg;
}

// Linjediagram för temperatur m.m. points: [{ v, label? }]. Visar min/max-etiketter.
export function lineChart(points, opts = {}) {
  const W = Math.max(280, Math.round(opts.width || 640)), H = opts.height || 140;
  const padL = 34, padR = 8, padT = 12, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = points.map(p => p.v).filter(v => v !== null && Number.isFinite(v));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  if (opts.label) svg.setAttribute('aria-label', opts.label);
  if (!vals.length) return svg;
  let lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  if (hi - lo < 4) { lo -= 2; hi += 2; }
  const n = points.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  const fmt = opts.fmt || ((v) => String(Math.round(v)));
  for (const v of [lo, (lo + hi) / 2, hi]) {
    svg.append(el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(text(padL - 6, y(v) + 4, fmt(v), 'axis', 'end'));
  }
  if (lo < 0 && hi > 0) svg.append(el('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), class: 'zero' }));
  let d = '', pen = false;
  points.forEach((p, i) => {
    if (p.v === null || !Number.isFinite(p.v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  });
  svg.append(el('path', { d, class: opts.cls || 'line' }));
  let every = opts.labelEvery || Math.ceil(n / 8);
  while ((iw / Math.max(1, n - 1)) * every < 30 && every < n) every *= 2;
  points.forEach((p, i) => { if (p.label && i % every === 0) svg.append(text(x(i), H - 6, p.label, 'axis')); });
  return svg;
}

// Väderikoner: enkla geometriska former i linjestil.
export function weatherIcon(kind, night = false, size = 32) {
  const s = el('svg', { viewBox: '0 0 32 32', width: size, height: size, class: `wx wx-${kind}`, 'aria-hidden': 'true' });
  const sun = () => night
    ? el('path', { d: 'M20 6a9 9 0 1 0 6 13.5A8 8 0 0 1 20 6z', class: 'wx-moon' })
    : el('g', { class: 'wx-sun' }, [
      el('circle', { cx: 16, cy: 16, r: 6 }),
      ...[0, 45, 90, 135, 180, 225, 270, 315].map(a => {
        const r = (a * Math.PI) / 180;
        return el('line', { x1: 16 + Math.cos(r) * 9, y1: 16 + Math.sin(r) * 9, x2: 16 + Math.cos(r) * 12, y2: 16 + Math.sin(r) * 12 });
      }),
    ]);
  const cloud = (dy = 0) => el('path', { d: `M9 ${22 + dy}h14a5 5 0 0 0 0-10 7 7 0 0 0-13 2 4 4 0 0 0-1 8z`, class: 'wx-cloud' });
  const drops = (cls) => el('g', { class: cls }, [8, 14, 20].map(xx => el('line', { x1: xx + 3, y1: 25, x2: xx + 1, y2: 30 })));
  switch (kind) {
    case 'sun': s.append(sun()); break;
    case 'part': {
      const g = el('g', { transform: 'translate(-5 -5) scale(.75)' }, [sun()]);
      s.append(g, cloud(2));
      break;
    }
    case 'fog':
      s.append(el('g', { class: 'wx-fog' }, [10, 15, 20, 25].map((yy, i) => el('line', { x1: 5 + (i % 2) * 3, x2: 27 - (i % 2) * 3, y1: yy, y2: yy }))));
      break;
    case 'rain': s.append(cloud(-3), drops('wx-rain')); break;
    case 'sleet': s.append(cloud(-3), drops('wx-sleet')); break;
    case 'snow':
      s.append(cloud(-3), el('g', { class: 'wx-snow' }, [9, 16, 23].map(xx => el('circle', { cx: xx, cy: 27, r: 1.4 }))));
      break;
    case 'thunder':
      s.append(cloud(-3), el('path', { d: 'M17 20l-4 6h4l-2 5 6-8h-4l2-3z', class: 'wx-bolt' }));
      break;
    default: s.append(cloud());
  }
  return s;
}
