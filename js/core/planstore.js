// planstore.js – planritningar sparade lokalt i webbläsaren (IndexedDB).
//
// Planritningen är husdata och finns aldrig i repot. Användaren laddar upp en bild i
// appen; den skalas ned och sparas som data-URL i den här webbläsaren, tillsammans med
// var rummen ligger (procent av bildens bredd/höjd). En annan webbläsare eller telefon
// har ingen ritning förrän den laddas upp där.
//
// Plan: { id, name, img (data:image/...), w, h, marks: { [rumId]: { x, y } } }

const DB = 'hd-plans';
const STORE = 'plans';
export const MAX_PLANS = 4;
export const MAX_SIDE = 1600;
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function open() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { reject(new Error('storage')); return; }
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('storage'));
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(new Error('storage'));
      t.onabort = () => reject(new Error('storage'));
    });
  } finally { db.close(); }
}

function req2p(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error('storage')); });
}

function clamp01(v) { return Math.min(1, Math.max(0, Math.round(Number(v) * 10000) / 10000)); }

function valid(p) {
  return p && typeof p === 'object' && typeof p.id === 'string' && p.id.length <= 64
    && typeof p.name === 'string' && p.name.length <= 40
    && typeof p.img === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.img)
    && Number.isFinite(p.w) && Number.isFinite(p.h);
}

function cleanMarks(m) {
  const out = {};
  if (!m || typeof m !== 'object') return out;
  for (const [k, v] of Object.entries(m).slice(0, 60)) {
    if (typeof k !== 'string' || k.length > 80 || !v || typeof v !== 'object') continue;
    if (!Number.isFinite(Number(v.x)) || !Number.isFinite(Number(v.y))) continue;
    out[k] = { x: clamp01(v.x), y: clamp01(v.y) };
  }
  return out;
}

export async function list() {
  try {
    const all = await tx('readonly', s => req2p(s.getAll()));
    return (Array.isArray(all) ? all : []).filter(valid).map(p => ({ ...p, marks: cleanMarks(p.marks) }))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'sv'));
  } catch { return []; }
}

async function put(p) {
  await tx('readwrite', s => req2p(s.put(p)));
}

export async function setMark(plan, roomId, x, y) {
  const p = { ...plan, marks: { ...cleanMarks(plan.marks), [roomId]: { x: clamp01(x), y: clamp01(y) } } };
  await put(p);
  return p;
}

export async function clearMark(plan, roomId) {
  const m = cleanMarks(plan.marks);
  delete m[roomId];
  const p = { ...plan, marks: m };
  await put(p);
  return p;
}

export async function remove(id) {
  await tx('readwrite', s => req2p(s.delete(id)));
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

// Läser en bildfil, skalar ned till högst MAX_SIDE och sparar den som ny plan.
// Kastar 'type', 'size', 'full', 'decode' eller 'storage'.
export async function addFromFile(file, name, existing) {
  if (!file || !TYPES.includes(file.type)) throw new Error('type');
  if (file.size > 20 * 1024 * 1024) throw new Error('size');
  if (existing.length >= MAX_PLANS) throw new Error('full');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('decode'); }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  let img = c.toDataURL('image/webp', 0.85);
  if (!img.startsWith('data:image/webp')) img = c.toDataURL('image/jpeg', 0.85);
  if (img.length > MAX_BYTES * 1.37) throw new Error('size');
  const p = { id: newId(), name: String(name || '').trim().slice(0, 40) || `Plan ${existing.length + 1}`,
    img, w, h, marks: {}, order: existing.length };
  await put(p);
  return p;
}
