// controls.js – vilka enheter som får reglage i appen (beslut 30, ersätter K-regeln).
//
// Regel: reglage endast för enheter vars `class` är exakt 'light'.
//   - `virtualClass` räknas inte (ett uttag med lampa som virtuell klass får inget reglage).
//   - Saknad, okänd eller annan klass = inget reglage.
//   - Otillgänglig enhet (available === false) = inget reglage.
//   - Bara capabilities 'onoff' och 'dim', och bara om de inte är markerade som ej skrivbara.
//
// Ingen K-lista och ingen lokal markering: regeln är densamma i alla webbläsare och
// kräver ingen husdata i repot. Fler klasser kräver ST-beslut.
//
// Regeln gäller både rendering och skrivväg. Skrivvägen (homey.control) anropar
// assertControl före varje skrivanrop. Detta är en klientregel: nyckelns scope
// homey.device.control gäller alla enheter.

export const CONTROL_CLASS = 'light';
export const CONTROL_CAPS = Object.freeze(['onoff', 'dim']);

// Äldre version (≤ 0.1.5) sparade en egen K-lista här. Den används inte längre.
const LEGACY_K_KEY = 'hd.k.local.v1';

function caps(device) {
  return device && Array.isArray(device.capabilities) ? device.capabilities : [];
}

function capObj(device, cap) {
  const o = device && device.capabilitiesObj;
  return o && typeof o === 'object' && o[cap] && typeof o[cap] === 'object' ? o[cap] : null;
}

export function isLight(device) {
  return Boolean(device) && typeof device === 'object' && device.class === CONTROL_CLASS;
}

// Antagande (A): Web API anger `available` per enhet. Bara uttryckligt false räknas
// som otillgänglig, så att en saknad flagga inte tar bort alla reglage.
export function isAvailable(device) {
  return Boolean(device) && device.available !== false;
}

export function canWrite(device, cap) {
  if (!isLight(device) || !CONTROL_CAPS.includes(cap)) return false;
  if (!caps(device).includes(cap)) return false;
  const o = capObj(device, cap);
  return !(o && o.setable === false);
}

export function hasControls(device) {
  return isAvailable(device) && (canWrite(device, 'onoff') || canWrite(device, 'dim'));
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
