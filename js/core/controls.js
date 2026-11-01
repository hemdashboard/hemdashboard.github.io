// controls.js – vilka enheter som får reglage i appen (beslut 31, ersätter beslut 30 i delen klasser).
//
// Regel: reglage endast för enheter vars `class` är exakt 'light' eller 'coffeemachine'.
//   - `virtualClass` räknas inte (ett uttag med lampa som virtuell klass får inget reglage).
//   - Undantag (beslut 32): ett uttag (`class` 'socket') som i Homey markerats som
//     kaffebryggare (`virtualClass` 'coffeemachine') räknas som coffeemachine, endast 'onoff'.
//     En kaffebryggare bakom en smart plugg; markeringen görs av ägaren i Homey-appen.
//   - Saknad, okänd eller annan klass = inget reglage. Uttag (socket) är alltid läsande.
//   - Otillgänglig enhet (available === false) = inget reglage.
//   - light: capabilities 'onoff' och 'dim'. coffeemachine: endast 'onoff'.
//   - Capability markerad som ej skrivbar (setable === false) = inget reglage.
//
// Ingen K-lista och ingen lokal markering: regeln är densamma i alla webbläsare och
// kräver ingen husdata i repot. Fler klasser kräver ST-beslut.
//
// Regeln gäller både rendering och skrivväg. Skrivvägen (homey.control) anropar
// assertControl före varje skrivanrop. Detta är en klientregel: nyckelns scope
// homey.device.control gäller alla enheter.

export const CONTROL_RULES = Object.freeze({
  light: Object.freeze(['onoff', 'dim']),
  coffeemachine: Object.freeze(['onoff']),
});

// Äldre version (≤ 0.1.5) sparade en egen K-lista här. Den används inte längre.
const LEGACY_K_KEY = 'hd.k.local.v1';

function caps(device) {
  return device && Array.isArray(device.capabilities) ? device.capabilities : [];
}

function capObj(device, cap) {
  const o = device && device.capabilitiesObj;
  return o && typeof o === 'object' && o[cap] && typeof o[cap] === 'object' ? o[cap] : null;
}

// Effektiv klass för regeln: `class`, utom uttag markerade som kaffebryggare (se ovan).
export function controlClass(device) {
  if (!device || typeof device !== 'object' || typeof device.class !== 'string') return null;
  if (device.class === 'socket' && device.virtualClass === 'coffeemachine') return 'coffeemachine';
  return device.class;
}

function rule(device) {
  const c = controlClass(device);
  return c && Object.prototype.hasOwnProperty.call(CONTROL_RULES, c) ? CONTROL_RULES[c] : null;
}

// Enheten tillhör en klass som kan få reglage (oavsett tillgänglighet).
export function isControlClass(device) {
  return rule(device) !== null;
}

// Antagande (A): Web API anger `available` per enhet. Bara uttryckligt false räknas
// som otillgänglig, så att en saknad flagga inte tar bort alla reglage.
export function isAvailable(device) {
  return Boolean(device) && device.available !== false;
}

export function canWrite(device, cap) {
  const r = rule(device);
  if (!r || !r.includes(cap)) return false;
  if (!caps(device).includes(cap)) return false;
  const o = capObj(device, cap);
  return !(o && o.setable === false);
}

export function hasControls(device) {
  const r = rule(device);
  return Boolean(r) && isAvailable(device) && r.some(c => canWrite(device, c));
}

// Varför en enhet som ser ut som lampa eller kaffebryggare saknar reglage. Används bara i
// den anonyma regelkontrollen (inga namn eller ID). null = har reglage eller är inte aktuell.
export function whyNoControl(device) {
  if (!device || typeof device !== 'object') return null;
  const vc = typeof device.virtualClass === 'string' ? device.virtualClass : '';
  const looks = isControlClass(device) || Object.prototype.hasOwnProperty.call(CONTROL_RULES, vc);
  if (!looks || hasControls(device)) return null;
  const cls = `class ${device.class || '?'}${vc ? `/virtualClass ${vc}` : ''}`;
  if (!isControlClass(device)) return `${cls}: klassen tillåts inte`;
  if (!isAvailable(device)) return `${cls}: otillgänglig`;
  const r = rule(device);
  for (const c of r) {
    if (!caps(device).includes(c)) continue;
    const o = capObj(device, c);
    if (o && o.setable === false) return `${cls}: ${c} ej skrivbar`;
  }
  return `${cls}: saknar ${r.join('/')}`;
}

// Normaliserar värdet för en tillåten capability; null = ogiltigt.
export function controlValue(cap, value) {
  if (cap === 'onoff') return typeof value === 'boolean' ? value : null;
  if (cap === 'dim') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
  }
  return null;
}

// Skrivvägens spärr. Kastar 'control-denied' eller 'control-value'.
export function assertControl(device, cap, value) {
  if (!device || typeof device.id !== 'string' || !device.id) throw new Error('control-denied');
  if (!hasControls(device) || !canWrite(device, cap)) throw new Error('control-denied');
  const v = controlValue(cap, value);
  if (v === null) throw new Error('control-value');
  return v;
}

// Tar bort den gamla egna K-listan ur lagringen. Ofarligt om den saknas.
export function purgeLegacy() {
  try { localStorage.removeItem(LEGACY_K_KEY); } catch { /* lagring otillgänglig */ }
}
