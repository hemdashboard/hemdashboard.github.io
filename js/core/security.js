// security.js – lås, larm och kameror ur enhetsobjekten. Rena funktioner utan husdata:
// enheterna hittas på klass och capabilities vid körning, aldrig på ID eller namn.
//
// Lås och larm är säkerhetskritiska (K, 04). Här läses bara; ingen funktion här eller i
// vyn skickar något till Homey. Åtgärdskapabiliteter (CMD_*) utom larmläget läses aldrig.
// Namn på igenkända ansikten (NTFY_KNOWN_FACE_DETECTION) visas aldrig: bara tiden för senaste
// ändring används, som händelsen "Person". Namnet lagras och visas aldrig.

import { changedAt } from './activity.js';

function cap(d, c) {
  const o = d && d.capabilitiesObj && d.capabilitiesObj[c];
  return o && typeof o === 'object' ? o.value : undefined;
}
function has(d, c) {
  return Boolean(d) && Array.isArray(d.capabilities) && d.capabilities.includes(c);
}
function byName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'sv'); }
// Kort visningsnamn: delen efter sista ": " (appar lägger ibland hem- eller kontonamn före).
function short(name) { const s = String(name || ''); const i = s.lastIndexOf(': '); return i >= 0 && i < s.length - 2 ? s.slice(i + 2) : s; }

// ---------- Lås ----------
// { id, name, locked, since, door: 'open' | 'closed' | null, doorSince, battery: bool, tone, off }
// tone: 'good' = låst (och stängd), 'warn' = olåst eller lågt batteri, 'bad' = olåst och öppen.
export function locks(devices) {
  return devices.filter(d => d && (d.class === 'lock' || d.virtualClass === 'lock') && has(d, 'locked'))
    .sort(byName)
    .map(d => {
      const locked = cap(d, 'locked');
      const contact = has(d, 'alarm_contact') ? cap(d, 'alarm_contact') : undefined;
      const door = contact === true ? 'open' : contact === false ? 'closed' : null;
      const battery = cap(d, 'alarm_battery') === true;
      const off = d.available === false;
      let tone = locked === true ? 'good' : 'warn';
      if (locked !== true && door === 'open') tone = 'bad';
      if (tone === 'good' && (battery || door === 'open')) tone = 'warn';
      if (off || typeof locked !== 'boolean') tone = 'idle';
      return { id: d.id, name: short(d.name), locked: typeof locked === 'boolean' ? locked : null,
        since: changedAt(d, 'locked'), door, doorSince: door ? changedAt(d, 'alarm_contact') : null, battery, tone, off };
    });
}

// ---------- Larm (class homealarm) ----------
// Läget läses ur CMD_SET_ARMING (O 1/11: 'disarmed'). Kända lägen översätts, övriga = "Aktiverat".
const MODES = { disarmed: 'Avstängt', away: 'Borta', home: 'Hemma', schedule: 'Schema', geo: 'Geofence', custom1: 'Eget läge 1', custom2: 'Eget läge 2', custom3: 'Eget läge 3' };

// { id, name, armed: bool | null, mode, since, alarm: bool, tone, off }
export function alarms(devices) {
  return devices.filter(d => d && (d.class === 'homealarm' || d.virtualClass === 'homealarm') && (has(d, 'CMD_SET_ARMING') || has(d, 'homealarm_state')))
    .sort(byName)
    .map(d => {
      const raw = has(d, 'CMD_SET_ARMING') ? cap(d, 'CMD_SET_ARMING') : cap(d, 'homealarm_state');
      const key = typeof raw === 'string' ? raw.toLowerCase() : '';
      const armed = key ? (key !== 'disarmed') : null;
      const mode = key ? (MODES[key] || (armed ? 'Aktiverat' : 'Avstängt')) : 'Okänt';
      const alarm = cap(d, 'alarm_generic') === true;
      const off = d.available === false;
      const since = changedAt(d, has(d, 'CMD_SET_ARMING') ? 'CMD_SET_ARMING' : 'homealarm_state');
      const tone = off || armed === null ? 'idle' : alarm ? 'bad' : armed ? 'good' : 'idle';
      return { id: d.id, name: String(d.name || ''), armed, mode, since, alarm, tone, off };
    });
}

// ---------- Kameror och dörrklocka ----------
// Senaste händelse = den händelsekapabilitet som ändrades senast. Antagande (A): lastUpdated
// följer värdeändringen, så tiden är när händelsen började eller upphörde.
const EVENTS = [
  ['NTFY_PRESS_DOORBELL', 'Ringklocka'],
  ['NTFY_FACE_DETECTION', 'Person'],
  ['NTFY_KNOWN_FACE_DETECTION', 'Person'], // tiden endast; namnet lagras och visas aldrig. Samma namn igen ger troligen ingen ny tid (A)
  ['NTFY_MOTION_DETECTION', 'Rörelse'],
  ['alarm_motion', 'Rörelse'],
  ['NTFY_VEHICLE_DETECTED', 'Fordon'],
  ['NTFY_PET_DETECTED', 'Djur'],
];

// { id, name, kind: 'camera' | 'doorbell', battery, event: { label, at, now } | null, off }
export function cameras(devices) {
  return devices.filter(d => d && ['camera', 'doorbell'].includes(d.class))
    .sort((a, b) => (a.class === 'doorbell') - (b.class === 'doorbell') || byName(a, b))
    .map(d => {
      let event = null;
      for (const [c, label] of EVENTS) {
        if (!has(d, c)) continue;
        const at = changedAt(d, c);
        const now = cap(d, c) === true;
        if (at !== null && (!event || at > event.at)) event = { label, at, now };
        else if (now && event && !event.now) event = { label, at: at || event.at, now };
      }
      const b = cap(d, 'measure_battery');
      return { id: d.id, name: String(d.name || ''), kind: d.class, battery: Number.isFinite(b) ? b : null, event, off: d.available === false };
    });
}

export const LOW_BATTERY = 20;
