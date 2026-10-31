// keystore.js – lagrar anslutningsuppgifter (API-nyckel, Homey-ID, lokal adress)
// krypterade i webbläsaren med en PIN.
//
// Krypto: PBKDF2-SHA256 (600 000 iterationer) → AES-GCM 256. Allt via WebCrypto.
// Klartexten finns bara i minnet under sessionen och skrivs aldrig till lagring,
// konsol eller nätverk utöver Homey-anropen.
//
// Begränsning (medveten): en kort PIN går att knäcka offline av den som kommer
// åt webbläsarens lagring. Skyddet gäller en upplåst/lånad telefon och nyfikna
// blickar, inte en angripare med full åtkomst till enheten. Återkallning sker
// genom att nyckeln raderas i Homey.

const STORE_KEY = 'hd.keystore.v1';
const FAIL_KEY = 'hd.keystore.fails';
const ITERATIONS = 600_000;
const MAX_FAILS = 10;
export const MIN_PIN = 6;

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

async function deriveKey(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function hasStored() {
  return readStore(STORE_KEY) !== null;
}

export function isUnlocked() {
  return unlocked !== null;
}

export function get() {
  if (!unlocked) throw new Error('locked');
  return { ...unlocked };
}

export async function save(secrets, pin) {
  if (typeof pin !== 'string' || pin.length < MIN_PIN) throw new Error('pin-short');
  if (!secrets || typeof secrets.key !== 'string' || !secrets.key.trim()) throw new Error('key-missing');
  const clean = {
    key: secrets.key.trim(),
    cloudId: (secrets.cloudId || '').trim(),
    lanIp: (secrets.lanIp || '').trim(),
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await deriveKey(pin, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(clean)));
  const blob = { v: 1, kdf: 'PBKDF2-SHA256', it: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  if (!writeStore(STORE_KEY, JSON.stringify(blob))) throw new Error('storage-unavailable');
  writeStore(FAIL_KEY, null);
  unlocked = clean;
}

export async function unlock(pin) {
  const raw = readStore(STORE_KEY);
  if (!raw) throw new Error('nothing-stored');
  try {
    const blob = JSON.parse(raw);
    // Iterationstalet i lagringen får aldrig sänka skyddet under ITERATIONS.
    const it = Math.max(Number(blob.it) || 0, ITERATIONS);
    const aes = await deriveKey(pin, unb64(blob.salt), it);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, aes, unb64(blob.ct));
    unlocked = JSON.parse(dec.decode(pt));
    writeStore(FAIL_KEY, null);
    return true;
  } catch {
    const fails = (parseInt(readStore(FAIL_KEY) || '0', 10) || 0) + 1;
    if (fails >= MAX_FAILS) {
      forget();
      throw new Error('wiped');
    }
    writeStore(FAIL_KEY, String(fails));
    throw new Error('wrong-pin');
  }
}

export function lock() {
  unlocked = null;
}

export function forget() {
  unlocked = null;
  writeStore(STORE_KEY, null);
  writeStore(FAIL_KEY, null);
}
