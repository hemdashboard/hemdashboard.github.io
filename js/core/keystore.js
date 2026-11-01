// keystore.js – lagrar anslutningsuppgifter (API-nyckel, Homey-ID, lokal adress)
// krypterade i webbläsaren, utan PIN (beslut 35, ersätter PIN-delen av beslut 25).
//
// Krypto: AES-GCM 256 med en icke-exporterbar nyckel (WebCrypto, extractable: false).
// Nyckeln sparas i IndexedDB, chiffertexten i localStorage. Skript kan använda nyckeln
// men aldrig läsa ut den, så en dump eller kopia av localStorage räcker inte för att
// läsa API-nyckeln, och den ligger aldrig i klartext i lagringen.
//
// Skyddar inte mot kod som körs på samma origin (den kan dekryptera medan sidan körs)
// och inte mot den som har den upplåsta telefonen. Där är spärrarna telefonens
// skärmlås, egen origin, strikt CSP, tvåfaktor på GitHub och att nyckeln raderas i Homey.
//
// Migrering: lagring från ≤ 0.6.1 (v1, PIN + PBKDF2) låses upp en sista gång med PIN
// och skrivs om till v2. Tas bort när alla enheter har migrerats.

const STORE_KEY = 'hd.keystore.v2';
const AAD = new TextEncoder().encode(STORE_KEY);
const DB = 'hd-keystore';
const OS = 'keys';
const KID = 'wrap';

// v1 (endast migrering)
const V1_KEY = 'hd.keystore.v1';
const V1_FAIL_KEY = 'hd.keystore.fails';
const V1_ITERATIONS = 600_000;
const V1_MAX_FAILS = 10;

let unlocked = null; // { key, cloudId, lanIp } i minnet

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

function readStore(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function writeStore(k, v) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
    return true;
  } catch { return false; }
}

// ---------- IndexedDB: den icke-exporterbara nyckeln ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OS, mode);
      const req = fn(tx.objectStore(OS));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const getWrapKey = () => idb('readonly', s => s.get(KID));
const putWrapKey = (k) => idb('readwrite', s => s.put(k, KID));
const delWrapKey = () => idb('readwrite', s => s.delete(KID));

// ---------- Publikt ----------

function cleanSecrets(secrets) {
  if (!secrets || typeof secrets.key !== 'string' || !secrets.key.trim()) throw new Error('key-missing');
  return {
    key: secrets.key.trim(),
    cloudId: (secrets.cloudId || '').trim(),
    lanIp: (secrets.lanIp || '').trim(),
  };
}

// Sparade uppgifter i aktuellt format.
export function hasStored() {
  return readStore(STORE_KEY) !== null;
}

// Gammal PIN-lagring som ska flyttas med PIN en sista gång.
export function needsMigration() {
  return !hasStored() && readStore(V1_KEY) !== null;
}

export function isUnlocked() {
  return unlocked !== null;
}

export function get() {
  if (!unlocked) throw new Error('locked');
  return { ...unlocked };
}

export async function save(secrets) {
  const clean = cleanSecrets(secrets);
  let aes;
  try {
    aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await putWrapKey(aes);
  } catch { throw new Error('storage-unavailable'); }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, aes, enc.encode(JSON.stringify(clean)));
  const blob = { v: 2, alg: 'AES-GCM-256', iv: b64(iv), ct: b64(ct) };
  if (!writeStore(STORE_KEY, JSON.stringify(blob))) throw new Error('storage-unavailable');
  writeStore(V1_KEY, null);
  writeStore(V1_FAIL_KEY, null);
  unlocked = clean;
}

// Läser sparade uppgifter. Kastar 'nothing-stored' eller 'unreadable'
// (t.ex. om webbläsarens IndexedDB rensats men inte localStorage).
export async function open() {
  const raw = readStore(STORE_KEY);
  if (!raw) throw new Error('nothing-stored');
  try {
    const blob = JSON.parse(raw);
    const aes = await getWrapKey();
    if (!aes) throw new Error('no-key');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv), additionalData: AAD }, aes, unb64(blob.ct));
    unlocked = cleanSecrets(JSON.parse(dec.decode(pt)));
    return true;
  } catch {
    throw new Error('unreadable');
  }
}

// Migrering från v1: PIN en sista gång, sedan v2. Kastar 'wrong-pin' eller 'wiped'.
export async function migrate(pin) {
  const raw = readStore(V1_KEY);
  if (!raw) throw new Error('nothing-stored');
  let secrets;
  try {
    const blob = JSON.parse(raw);
    const it = Math.max(Number(blob.it) || 0, V1_ITERATIONS);
    const base = await crypto.subtle.importKey('raw', enc.encode(String(pin || '')), 'PBKDF2', false, ['deriveKey']);
    const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(blob.salt), iterations: it },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, aes, unb64(blob.ct));
    secrets = JSON.parse(dec.decode(pt));
  } catch {
    const fails = (parseInt(readStore(V1_FAIL_KEY) || '0', 10) || 0) + 1;
    if (fails >= V1_MAX_FAILS) { await forget(); throw new Error('wiped'); }
    writeStore(V1_FAIL_KEY, String(fails));
    throw new Error('wrong-pin');
  }
  await save(secrets);
}

export async function forget() {
  unlocked = null;
  writeStore(STORE_KEY, null);
  writeStore(V1_KEY, null);
  writeStore(V1_FAIL_KEY, null);
  try { await delWrapKey(); } catch { /* ingen IndexedDB */ }
}
