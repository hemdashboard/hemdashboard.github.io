// state.js – delat läge mellan vyerna och lokala inställningar.
// Inställningarna sparas bara i den här webbläsaren. De kan innehålla Homey-ID för
// vald elmätare och prisenhet; det är lokalt per användare och aldrig i repot.

export const state = {
  homey: null,
  zones: [],
  devices: new Map(),   // id → enhet
  view: 'home',         // 'home' | 'energy' | 'weather' | 'rooms' | 'settings'
  activeRoom: null,
  energy: null,         // se energy.js
  spot: null,           // { series, today, tomorrow, err, at }
  weather: null,        // { pts, err, at, api }
  diag: {},             // anonym diagnos per datakälla: { key: 'ok' | felkategori }
};

const PREF_KEY = 'hd.prefs.v1';
const DEFAULTS = Object.freeze({ zone: 'SE3', meterId: '', priceId: '', room: '', energyRange: 'day', kpiUnit: 'kwh' });

export function prefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (typeof p[k] === 'string' && p[k].length <= 64) out[k] = p[k];
    return out;
  } catch { return { ...DEFAULTS }; }
}

export function setPref(k, v) {
  if (!(k in DEFAULTS)) return;
  const p = prefs();
  p[k] = String(v || '').slice(0, 64);
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* lagring otillgänglig */ }
}

export function deviceList() {
  return [...state.devices.values()];
}

// Enkel händelsebuss så att vyer kan rita om när data kommer.
const subs = new Set();
export function onChange(fn) { subs.add(fn); }
export function changed(what) { for (const fn of subs) { try { fn(what); } catch (e) { console.error(e); } } }
