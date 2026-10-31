// kguard.js – säkerhetskritiska enheter (K) får aldrig reglage i appen.
//
// Definition (projektets 04): lås, larm, kameror, portar och garage,
// vattenventiler samt värmekritiskt (elpanna, frostskydd).
//
// Två källor, och en enhet är K om någon av dem säger det:
//   1. Automatisk regel på enhetsklass och capabilities (nedan).
//   2. Användarens egen K-lista, sparad lokalt per webbläsare (enhets-ID).
//      Behövs för t.ex. ett frostskydd som i Homey är ett vanligt uttag.
//
// Detta är en UI-regel. Nyckelns scope device.control gäller alla enheter,
// så den verkliga spärren är vem som har nyckeln.

const K_CLASSES = new Set([
  'lock', 'camera', 'doorbell', 'garagedoor', 'homealarm',
  'valve', 'boiler', 'heatpump',
]);

const K_CAPABILITIES = [
  'locked', 'homealarm_state', 'garagedoor_closed', 'valve_open',
];

const LOCAL_KEY = 'hd.k.local.v1';

function readLocal() {
  try { return new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')); }
  catch { return new Set(); }
}
function writeLocal(set) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...set])); return true; }
  catch { return false; }
}

export function autoK(device) {
  const cls = device.class || '';
  const vcls = device.virtualClass || '';
  if (K_CLASSES.has(cls) || K_CLASSES.has(vcls)) return true;
  const caps = device.capabilities || [];
  return K_CAPABILITIES.some(c => caps.includes(c));
}

export function isK(device) {
  return autoK(device) || readLocal().has(device.id);
}

export function setLocalK(deviceId, on) {
  const set = readLocal();
  if (on) set.add(deviceId); else set.delete(deviceId);
  return writeLocal(set);
}

export function localKCount() {
  return readLocal().size;
}

// En enhet får ett på/av-reglage bara om den inte är K och onoff är skrivbar.
export function canToggle(device) {
  if (isK(device)) return false;
  const caps = device.capabilities || [];
  if (!caps.includes('onoff')) return false;
  const obj = device.capabilitiesObj && device.capabilitiesObj.onoff;
  return !(obj && obj.setable === false);
}
