// favorites.js – stjärnmärkta reglage som också visas under Snabbreglage på Hem.
//
// Sparas bara i den här webbläsaren som en lista med enhets-ID från Homey (som valet av
// elmätare). Inga namn och inget i repot. Stjärnan ändrar inte vad som får styras:
// Snabbreglage visar bara enheter som regeln i controls.js tillåter.
//
// Ingen sparad lista = standard: alla kaffebryggare. Första stjärnändringen sparar
// listan, och därefter gäller den som den är.

import { controlClass, isControlClass } from './controls.js';

const KEY = 'hd.fav.v1';
const MAX = 40;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, MAX) : [];
  } catch { return null; }
}

function write(ids) {
  try { localStorage.setItem(KEY, JSON.stringify([...ids].slice(0, MAX))); return true; } catch { return false; }
}

// Aktuell mängd favoriter givet enhetslistan (standard om inget sparats).
export function ids(devices) {
  const saved = read();
  if (saved !== null) return new Set(saved);
  return new Set(devices.filter(d => controlClass(d) === 'coffeemachine').map(d => d.id));
}

export function isFav(device, devices) {
  return Boolean(device) && ids(devices).has(device.id);
}

// Växlar stjärnan. Bara enheter i en reglageklass kan stjärnmärkas. Returnerar nytt läge
// eller null om det inte gick att spara.
export function toggle(device, devices) {
  if (!device || typeof device.id !== 'string' || !isControlClass(device)) return null;
  const set = ids(devices);
  const on = !set.has(device.id);
  if (on) {
    if (set.size >= MAX) return null;
    set.add(device.id);
  } else set.delete(device.id);
  // Bortglömda enheter (finns inte längre i Homey) rensas vid varje ändring.
  const known = new Set(devices.map(d => d.id));
  for (const id of [...set]) if (!known.has(id)) set.delete(id);
  return write(set) ? on : null;
}

// Favoriter att visa: i reglageklass, i Homeys ordning efter namn, kaffebryggare först.
export function list(devices) {
  const set = ids(devices);
  return devices.filter(d => set.has(d.id) && isControlClass(d))
    .sort((a, b) => (controlClass(b) === 'coffeemachine') - (controlClass(a) === 'coffeemachine')
      || String(a.name || '').localeCompare(String(b.name || ''), 'sv'));
}
