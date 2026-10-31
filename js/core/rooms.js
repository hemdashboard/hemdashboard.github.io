// rooms.js – appens rum. Kopplingen rum → Homey-zon görs i appen och sparas lokalt
// i den här webbläsaren. Repot innehåller inga rum, zoner eller namn.
//
// Ett rum: { id, name, zoneId, withChildren }. Namnet anger användaren själv.
// Försvinner lagringen (ny webbläsare, rensad data) läggs rummen till igen i
// inställningarna – inget säkerhetsberoende ligger här (reglageregeln är fast i koden).

const KEY = 'hd.rooms.v1';
const ACTIVE_KEY = 'hd.rooms.active';
const MAX_ROOMS = 30;
export const MAX_NAME = 40;

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; }
  catch { return false; }
}

function valid(r) {
  return r && typeof r === 'object'
    && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64
    && typeof r.name === 'string' && r.name.length > 0 && r.name.length <= MAX_NAME
    && typeof r.zoneId === 'string' && r.zoneId.length > 0 && r.zoneId.length <= 64;
}

export function list() {
  try {
    const a = JSON.parse(read(KEY) || '[]');
    return Array.isArray(a) ? a.filter(valid).map(r => ({ ...r, withChildren: r.withChildren === true })) : [];
  } catch { return []; }
}

function save(rooms) {
  return write(KEY, JSON.stringify(rooms.slice(0, MAX_ROOMS)));
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

// Kastar 'name' | 'zone' | 'full' | 'storage'.
export function add(name, zoneId, withChildren = false) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  if (!n) throw new Error('name');
  if (typeof zoneId !== 'string' || !zoneId) throw new Error('zone');
  const rooms = list();
  if (rooms.length >= MAX_ROOMS) throw new Error('full');
  const room = { id: newId(), name: n, zoneId, withChildren: Boolean(withChildren) };
  rooms.push(room);
  if (!save(rooms)) throw new Error('storage');
  return room;
}

export function remove(id) {
  const rooms = list().filter(r => r.id !== id);
  save(rooms);
  if (activeId() === id) setActive(rooms[0] ? rooms[0].id : null);
}

export function activeId() {
  const id = read(ACTIVE_KEY);
  const rooms = list();
  if (id && rooms.some(r => r.id === id)) return id;
  return rooms[0] ? rooms[0].id : null;
}

export function setActive(id) {
  write(ACTIVE_KEY, id || null);
}

// ---------- Automatiska rum (0.3) ----------
// Varje Homey-zon med egna enheter blir ett rum, i zonträdets ordning.
//   - Enheter i rotzonen (zon utan förälder) hamnar i rummet "Övrigt".
//   - Zoner utan enheter visas inte.
//   - Manuella rum (ovan) är override: de visas först, och zoner de täcker
//     tas bort ur de automatiska rummen så att en enhet bara visas en gång.
// Ett rum: { id, name, zoneIds:Set, auto:boolean }. Inget sparas – allt räknas fram vid körning.

export const OTHER_ID = 'auto:other';

function byNameSv(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'sv');
}

export function zonesInTreeOrder(zones) {
  const out = [];
  const seen = new Set();
  const kids = (pid) => zones.filter(z => (z.parent || null) === pid).sort(byNameSv);
  const walk = (pid, depth) => {
    if (depth > 10) return;
    for (const z of kids(pid)) { if (seen.has(z.id)) continue; seen.add(z.id); out.push(z); walk(z.id, depth + 1); }
  };
  walk(null, 0);
  for (const z of zones) if (!seen.has(z.id)) out.push(z); // föräldralösa sist
  return out;
}

export function allRooms(zones, devices, manual = list()) {
  const counts = new Map();
  for (const d of devices) if (d && typeof d.zone === 'string') counts.set(d.zone, (counts.get(d.zone) || 0) + 1);
  const zoneSet = new Set(zones.map(z => z.id));
  const roots = new Set(zones.filter(z => !z.parent || !zoneSet.has(z.parent)).map(z => z.id));

  const out = [];
  const covered = new Set();
  for (const r of manual) {
    const ids = zoneIds(r, zones);
    ids.forEach(id => covered.add(id));
    out.push({ id: r.id, name: r.name, zoneIds: ids, auto: false });
  }
  for (const z of zonesInTreeOrder(zones)) {
    if (covered.has(z.id) || roots.has(z.id) || !counts.get(z.id)) continue;
    out.push({ id: `auto:${z.id}`, name: z.name || '(namnlös zon)', zoneIds: new Set([z.id]), auto: true });
  }
  // Rotzonen och enheter vars zon saknas i zonlistan
  const otherIds = new Set([...roots].filter(id => !covered.has(id)));
  const orphan = devices.some(d => d && typeof d.zone === 'string' && !zoneSet.has(d.zone));
  if ([...otherIds].some(id => counts.get(id)) || orphan) {
    out.push({ id: OTHER_ID, name: 'Övrigt', zoneIds: otherIds, auto: true, orphans: true });
  }
  return out;
}

export function devicesInRoom(room, devices, zones) {
  if (!room) return [];
  const zoneSet = new Set(zones.map(z => z.id));
  return devices.filter(d => d && (room.zoneIds.has(d.zone) || (room.orphans && !zoneSet.has(d.zone))));
}

// Zon-ID som hör till rummet: zonen själv, och med withChildren även alla underzoner.
export function zoneIds(room, zones) {
  const set = new Set([room.zoneId]);
  if (!room.withChildren) return set;
  let grew = true;
  while (grew) {
    grew = false;
    for (const z of zones) {
      if (z && z.parent && set.has(z.parent) && !set.has(z.id)) { set.add(z.id); grew = true; }
    }
  }
  return set;
}
