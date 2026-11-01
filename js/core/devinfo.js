// devinfo.js – tillverkare och okända värden för en enhet. Ingen husdata: allt läses
// ur enhetsobjektet vid körning.

// App-id → visningsnamn. Generell regel: sista ledet i id:t med stor bokstav
// (com.plejd → Plejd). Mönstren nedan gäller välkända märken där id:t inte är märket
// (t.ex. nl.philips.hue → Hue, com.ikea.tradfri → IKEA). Ingen lista över husets appar.
const PATTERNS = [
  [/philips\.hue|\.hue$/i, 'Hue'], [/tradfri|ikea/i, 'IKEA'], [/nibe|myuplink/i, 'NIBE'],
  [/eufy/i, 'Eufy'], [/yale/i, 'Yale'], [/somfy|tahoma/i, 'Somfy'], [/xiaomi|aqara/i, 'Aqara'],
  [/sonoff/i, 'Sonoff'], [/mill/i, 'Mill'], [/google|chromecast/i, 'Google'],
];

export function appId(d) {
  const s = `${(d && d.driverUri) || ''} ${(d && d.driverId) || ''} ${(d && d.ownerUri) || ''}`;
  const m = s.match(/homey:app:([A-Za-z0-9._-]+)/);
  return m ? m[1] : null;
}

export function brand(d) {
  const id = appId(d);
  if (!id) {
    const s = `${(d && d.driverUri) || ''} ${(d && d.driverId) || ''}`;
    if (/zigbee/i.test(s)) return 'Zigbee';
    if (/zwave/i.test(s)) return 'Z-Wave';
    return null;
  }
  for (const [re, name] of PATTERNS) if (re.test(id)) return name;
  const last = id.split('.').pop().replace(/[-_]+/g, ' ');
  return last ? last.charAt(0).toUpperCase() + last.slice(1) : null;
}

function capObj(d, cap) {
  const o = d && d.capabilitiesObj && d.capabilitiesObj[cap];
  return o && typeof o === 'object' ? o : null;
}

// Varmvattentemperatur: capability vars titel anger varmvatten (t.ex. NIBE BT7 "Hot water
// top", BT6 "Hot water charging"). Topp föredras. Returnerar { value, title, cap } eller null.
export function hotWater(d) {
  if (!d || !Array.isArray(d.capabilities)) return null;
  const cands = [];
  for (const cap of d.capabilities) {
    const o = capObj(d, cap);
    if (!o || typeof o.value !== 'number' || !Number.isFinite(o.value)) continue;
    const t = String(o.title || '');
    let score = 0;
    if (/hot water top|bt7\b|varmvatten topp|tappvarmvatten/i.test(t)) score = 3;
    else if (/hot water|varmvatten|bt6\b/i.test(t)) score = 2;
    if (score) cands.push({ score, value: o.value, title: t, cap });
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] || null;
}

// Numeriska värden med titel för capabilities som appen inte känner till (t.ex. capability_N).
export function titledValues(d, known) {
  const out = [];
  if (!d || !Array.isArray(d.capabilities)) return out;
  for (const cap of d.capabilities) {
    if (known.has(cap)) continue;
    const o = capObj(d, cap);
    if (!o || typeof o.value !== 'number' || !Number.isFinite(o.value) || !o.title) continue;
    out.push({ cap, title: String(o.title), value: o.value, units: typeof o.units === 'string' ? o.units : '' });
  }
  return out;
}
