// activity.js – rörelse, närvaro och laddning ur enhetsobjekten. Rena funktioner utan
// husdata: allt läses ur enheterna vid körning.

export const MOTION_ACTIVE_MS = 60000;

function capObj(d, cap) {
  const o = d && d.capabilitiesObj && d.capabilitiesObj[cap];
  return o && typeof o === 'object' ? o : null;
}

function hasCap(d, cap) {
  return Boolean(d) && Array.isArray(d.capabilities) && d.capabilities.includes(cap);
}

// Tidpunkt för senaste ändring av en capability (ms) eller null.
// Homey anger lastUpdated som ISO-sträng; realtidshändelser sätter den i appen.
export function changedAt(d, cap) {
  const o = capObj(d, cap);
  if (!o) return null;
  const t = typeof o.lastUpdated === 'number' ? o.lastUpdated : Date.parse(o.lastUpdated || '');
  return Number.isFinite(t) && t > 0 ? t : null;
}

// Rörelse: { active, now, last } eller null om enheten saknar alarm_motion.
//   now    = sensorn rapporterar rörelse just nu
//   active = rörelse nu eller som upphörde inom senaste minuten
//   last   = senaste rörelse (ms): nu om den pågår, annars när larmet gick tillbaka
// Antagande (A): lastUpdated följer senaste värdeändring, så vid false är det tiden då
// rörelsen upphörde. Det räcker för "senaste rörelse".
export function motion(d, now = Date.now()) {
  if (!hasCap(d, 'alarm_motion')) return null;
  const o = capObj(d, 'alarm_motion');
  const on = Boolean(o && o.value === true);
  const at = changedAt(d, 'alarm_motion');
  const last = on ? now : at;
  return { now: on, active: on || (at !== null && now - at >= 0 && now - at < MOTION_ACTIVE_MS), last };
}

// "nu", "45 s", "12 min", "3 h", "i går 21:40", "28/10"
export function ago(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '–';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return 'nu';
  if (s < 60) return `${s} s sedan`;
  if (s < 3600) return `${Math.floor(s / 60)} min sedan`;
  const d = new Date(ms), n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day0 = new Date(n); day0.setHours(0, 0, 0, 0);
  if (ms >= day0.getTime()) return `${Math.floor(s / 3600)} h sedan`;
  if (ms >= day0.getTime() - 86400000) return `i går ${hm}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
}

// Närvaroenheter (Smart Presence m.fl.): enheter med boolesk capability 'presence'.
// Returnerar [{ id, name, home, since }] med hemma först, därefter namn.
export function presence(devices) {
  const out = [];
  for (const d of devices) {
    if (!hasCap(d, 'presence')) continue;
    const o = capObj(d, 'presence');
    if (!o || typeof o.value !== 'boolean') continue;
    out.push({ id: d.id, name: String(d.name || ''), home: o.value, since: changedAt(d, 'presence') });
  }
  return out.sort((a, b) => (b.home - a.home) || a.name.localeCompare(b.name, 'sv'));
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts[0].slice(0, 1).toUpperCase();
}

// Laddboxar: klass evcharger eller capability evcharger_charging.
export function chargers(devices) {
  return devices.filter(d => d && (d.class === 'evcharger' || hasCap(d, 'evcharger_charging')));
}

// Laddar just nu: uttryckligt laddningsläge, annars effekt över 100 W.
export function isCharging(d) {
  const c = capObj(d, 'evcharger_charging');
  if (c && typeof c.value === 'boolean') {
    if (c.value) return true;
  }
  const p = capObj(d, 'measure_power');
  return Boolean(p && typeof p.value === 'number' && p.value > 100);
}

// Energiflöde nät → hus → laddbox (W). Husets mätare mäter allt inklusive laddboxen,
// så huset i övrigt = nät − laddbox (aldrig under 0). null-värden när data saknas.
export function flow(gridW, chargerW) {
  const g = Number.isFinite(gridW) ? gridW : null;
  const c = Number.isFinite(chargerW) ? Math.max(0, chargerW) : null;
  const house = g !== null && c !== null ? Math.max(0, g - c) : null;
  return { grid: g, charger: c, house, share: g && c !== null ? Math.min(1, c / g) : null };
}
