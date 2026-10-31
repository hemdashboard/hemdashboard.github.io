// main.js – hemdashboardens rumsvy.
// Ingen innerHTML med data från Homey: allt via textContent.
// Reglage enligt controls.js (endast class 'light'); skrivningar går bara via homey.control.

import * as keystore from '../core/keystore.js';
import * as rooms from '../core/rooms.js';
import { hasControls, canWrite, isLight, purgeLegacy } from '../core/controls.js';
import { createHomey, asList } from '../adapters/homey.js';

// Ramspärr: meta-CSP kan inte sätta frame-ancestors. I en ram körs sidan aldrig.
if (window.top !== window.self) {
  throw new Error('framed');
}
document.documentElement.classList.remove('boot');

const swUrl = window.trustedTypes
  ? window.trustedTypes.createPolicy('hd-sw', {
      createScriptURL: (u) => { if (u !== './sw.js') throw new Error('tt-url'); return u; },
    }).createScriptURL('./sw.js')
  : './sw.js';

const $ = (id) => document.getElementById(id);
const POLL_MS = 15000;
const RETRY_MS = 30000;

let homey = null;
let zones = [];
const devices = new Map();      // id → enhetsobjekt från Homey
let view = 'room';              // 'room' | 'settings'
let rt = null;                  // realtidshandtag
let rtStatus = 'off';
let pollTimer = null;
let retryTimer = null;
let lastConn = {};               // felkategori per väg, t.ex. { cloud: 'network', local: 'timeout' }
const pending = new Map();      // id → antal pågående skrivningar
const refetchTimers = new Map();

// ---------- Hjälp ----------

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function capVal(d, cap) {
  const o = d && d.capabilitiesObj && d.capabilitiesObj[cap];
  return o && typeof o === 'object' ? o.value : undefined;
}

function num(v, dec = 0) {
  return Number(v).toLocaleString('sv-SE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Läsvärden för enheter utan reglage. Första tre som finns visas.
const READ = [
  ['onoff', v => (v ? 'På' : 'Av')],
  ['dim', v => `${Math.round(v * 100)} %`],
  ['locked', v => (v ? 'Låst' : 'Olåst')],
  ['alarm_contact', v => (v ? 'Öppen' : 'Stängd')],
  ['alarm_motion', v => (v ? 'Rörelse' : 'Ingen rörelse')],
  ['alarm_water', v => (v ? 'Vatten' : 'Torrt')],
  ['alarm_smoke', v => (v ? 'Rök' : 'Ingen rök')],
  ['measure_temperature', v => `${num(v, 1)} °C`],
  ['target_temperature', v => `mål ${num(v, 1)} °C`],
  ['measure_humidity', v => `${num(v)} %`],
  ['measure_power', v => `${num(v)} W`],
  ['meter_power', v => `${num(v, 1)} kWh`],
  ['measure_luminance', v => `${num(v)} lx`],
  ['measure_battery', v => `batteri ${num(v)} %`],
];

function readValues(d) {
  const out = [];
  for (const [cap, fmt] of READ) {
    const v = capVal(d, cap);
    if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) continue;
    out.push(fmt(v));
    if (out.length === 3) break;
  }
  return out;
}

function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), 'sv');
}

// ---------- Data ----------

function activeRoom() {
  const id = rooms.activeId();
  return rooms.list().find(r => r.id === id) || null;
}

function roomDevices(room) {
  if (!room) return [];
  const ids = rooms.zoneIds(room, zones);
  return [...devices.values()].filter(d => ids.has(d.zone));
}

async function pickConnection() {
  const tries = [];
  if (homey.has('local')) tries.push(homey.ping('local').then(r => ({ mode: 'local', ok: r.ok, err: r.err })));
  if (homey.has('cloud')) tries.push(homey.ping('cloud').then(r => ({ mode: 'cloud', ok: r.ok, err: r.err })));
  const res = await Promise.all(tries);
  lastConn = {};
  for (const r of res) lastConn[r.mode] = r.ok ? 'ok' : r.err;
  const pick = res.find(r => r.mode === 'local' && r.ok) || res.find(r => r.mode === 'cloud' && r.ok);
  homey.use(pick ? pick.mode : null);
  return Boolean(pick);
}

// Generiska felkategorier från http.js – inga adresser eller ID.
function connText() {
  const part = (mode, label) => (mode in lastConn ? `${label}: ${lastConn[mode]}` : `${label}: ej angivet`);
  return `${part('cloud', 'moln')} · ${part('local', 'lokalt')}`;
}

function showOffline(on) {
  $('offline').classList.toggle('hidden', !on);
  if (on) {
    $('offlineWhy').textContent = connText();
    $('room').classList.add('hidden');
    $('empty').classList.add('hidden');
    $('roomTabs').replaceChildren();
  }
}

// Ansluter, läser in och startar realtid. Vid fel visas orsaken och nytt försök schemaläggs.
async function connect() {
  clearTimeout(retryTimer);
  if (!homey) return false;
  $('loading').classList.remove('hidden');
  try {
    const ok = (await pickConnection()) && (await loadAll());
    if (!ok) {
      if (homey.active && !lastConn.load) lastConn.load = 'enheter';
      setLive('off');
      showOffline(true);
      retryTimer = setTimeout(() => { if (!document.hidden) connect(); }, RETRY_MS);
      return false;
    }
    showOffline(false);
    renderAll();
    restartRealtime();
    startPolling();
    return true;
  } finally {
    if (homey) $('loading').classList.add('hidden');
  }
}

async function loadAll() {
  if (!homey.active) return false;
  const [z, d] = await Promise.all([homey.zones(), homey.devices()]);
  if (z.ok) zones = asList(z.data).filter(x => x && typeof x.id === 'string');
  if (!d.ok) { lastConn.load = d.err; return false; }
  devices.clear();
  for (const x of asList(d.data)) if (x && typeof x.id === 'string') devices.set(x.id, x);
  return true;
}

async function refetch(id) {
  if (!homey || !homey.active) return;
  const r = await homey.device(id);
  if (r.ok && r.data && r.data.id === id) {
    devices.set(id, r.data);
    if (!pending.get(id)) renderRoom();
  }
}

function refetchSoon(id) {
  clearTimeout(refetchTimers.get(id));
  refetchTimers.set(id, setTimeout(() => { refetchTimers.delete(id); refetch(id); }, 400));
}

// ---------- Realtid och polling ----------

function setLive(s) {
  rtStatus = s;
  const el = $('live');
  const txt = { live: 'LIVE', connecting: 'ANSLUTER', down: 'UPPDATERAS VAR 15 S', refused: 'UPPDATERAS VAR 15 S', off: '–' };
  el.dataset.s = s;
  el.textContent = !homey ? '–' : homey.active ? `${txt[s] || '–'} · ${homey.active === 'local' ? 'LOKALT' : 'MOLN'}` : 'INGEN ANSLUTNING';
  el.dataset.s = homey && !homey.active ? 'down' : s;
  renderConn();
}

function onRealtime(uri, event, data) {
  if (uri.startsWith('homey:device:')) {
    const id = uri.slice('homey:device:'.length);
    const d = devices.get(id);
    if (!d) return;
    const p = [event, data].find(x => x && typeof x === 'object' && typeof x.capabilityId === 'string' && 'value' in x);
    if (p && d.capabilitiesObj && d.capabilitiesObj[p.capabilityId]) {
      d.capabilitiesObj[p.capabilityId] = { ...d.capabilitiesObj[p.capabilityId], value: p.value };
      if (!pending.get(id)) renderRoom();
    } else {
      refetchSoon(id); // okänd form eller annan händelse – läs om enheten
    }
    return;
  }
  if (uri === 'homey:manager:devices') {
    const obj = [event, data].find(x => x && typeof x === 'object' && typeof x.id === 'string');
    if (obj && devices.has(obj.id)) refetchSoon(obj.id);
    else if (typeof event === 'string' && /create|delete/.test(event)) scheduleFullReload();
  }
}

let fullReloadTimer = null;
function scheduleFullReload() {
  clearTimeout(fullReloadTimer);
  fullReloadTimer = setTimeout(async () => { if (await loadAll()) { renderAll(); restartRealtime(); } }, 1500);
}

function restartRealtime() {
  if (rt) { rt.close(); rt = null; }
  if (!homey || !homey.active || document.hidden) { setLive('off'); return; }
  const ids = roomDevices(activeRoom()).map(d => d.id);
  rt = homey.realtime({ deviceIds: ids, onEvent: onRealtime, onStatus: setLive });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (document.hidden || !homey || !homey.active || rtStatus === 'live' || pending.size) return;
    if (await loadAll()) renderRoom();
  }, POLL_MS);
}

function stopLive() {
  clearInterval(pollTimer); pollTimer = null;
  if (rt) { rt.close(); rt = null; }
}

// Android dödar bakgrundsflikar: vid återkomst läses allt om och realtiden startas om.
document.addEventListener('visibilitychange', async () => {
  if (!homey) return;
  if (document.hidden) { if (rt) { rt.close(); rt = null; } return; }
  if (!homey.active) { connect(); return; }
  if (await loadAll()) renderAll();
  else { homey.use(null); connect(); return; }
  restartRealtime();
});

// ---------- Skrivning ----------

async function write(d, cap, value) {
  // Spärren prövas i homey.control; detta är bara UI-flödet runt den.
  const before = d.capabilitiesObj && d.capabilitiesObj[cap] ? d.capabilitiesObj[cap].value : undefined;
  pending.set(d.id, (pending.get(d.id) || 0) + 1);
  if (d.capabilitiesObj && d.capabilitiesObj[cap]) {
    d.capabilitiesObj[cap] = { ...d.capabilitiesObj[cap], value };
    if (cap === 'dim' && value > 0 && d.capabilitiesObj.onoff) d.capabilitiesObj.onoff = { ...d.capabilitiesObj.onoff, value: true };
  }
  renderRoom();
  const r = await homey.control(d, cap, value);
  const left = (pending.get(d.id) || 1) - 1;
  if (left > 0) pending.set(d.id, left); else pending.delete(d.id);
  if (!r.ok) {
    if (d.capabilitiesObj && d.capabilitiesObj[cap]) d.capabilitiesObj[cap] = { ...d.capabilitiesObj[cap], value: before };
    toast(r.err === 'control-denied' ? 'Spärrad: enheten får inte styras här.'
      : r.err === 'timeout' ? 'Inget svar från Homey.' : 'Kunde inte styra enheten.');
    refetchSoon(d.id);
  }
  renderRoom();
}

// ---------- Rendering ----------

function renderTabs() {
  const nav = $('roomTabs');
  nav.replaceChildren();
  const list = rooms.list();
  const act = rooms.activeId();
  for (const r of list) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = r.name;
    b.setAttribute('aria-pressed', r.id === act ? 'true' : 'false');
    b.addEventListener('click', () => {
      rooms.setActive(r.id);
      renderAll();
      restartRealtime();
    });
    nav.append(b);
  }
  $('empty').classList.toggle('hidden', list.length > 0);
  $('room').classList.toggle('hidden', list.length === 0);
}

function lightTile(d) {
  const li = document.createElement('li');
  li.className = 'tile';
  const avail = d.available !== false;
  const ctl = hasControls(d);
  li.dataset.ctl = ctl ? '1' : '0';
  const on = capVal(d, 'onoff') === true;
  const dim = capVal(d, 'dim');
  li.dataset.on = ctl && on ? '1' : '0';

  const top = document.createElement('div'); top.className = 'tile-top';
  const name = document.createElement('div'); name.className = 'name'; name.textContent = d.name || '(namnlös)';
  const state = document.createElement('div'); state.className = 'state';
  if (!avail) state.textContent = 'Otillgänglig';
  else state.textContent = on ? (typeof dim === 'number' ? `På · ${Math.round(dim * 100)} %` : 'På') : 'Av';
  const txt = document.createElement('div'); txt.append(name, state);
  top.append(txt);

  if (ctl && canWrite(d, 'onoff')) {
    const sw = document.createElement('button');
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    sw.setAttribute('aria-label', `${d.name || 'Lampa'} på/av`);
    sw.addEventListener('click', () => write(d, 'onoff', !on));
    top.append(sw);
  }
  li.append(top);

  if (ctl && canWrite(d, 'dim')) {
    const range = document.createElement('input');
    range.type = 'range'; range.min = '1'; range.max = '100'; range.step = '1';
    range.className = 'dim';
    range.value = String(Math.max(1, Math.round((typeof dim === 'number' ? dim : 0) * 100)));
    range.setAttribute('aria-label', `${d.name || 'Lampa'} ljusstyrka`);
    range.addEventListener('input', () => { state.textContent = `På · ${range.value} %`; });
    range.addEventListener('change', () => write(d, 'dim', Number(range.value) / 100));
    li.append(range);
  }
  if (!avail) li.classList.add('off');
  return li;
}

function readTile(d) {
  const li = document.createElement('li');
  li.className = 'tile ro';
  li.dataset.ctl = '0';
  const name = document.createElement('div'); name.className = 'name'; name.textContent = d.name || '(namnlös)';
  const state = document.createElement('div'); state.className = 'state';
  if (d.available === false) { state.textContent = 'Otillgänglig'; li.classList.add('off'); }
  else state.textContent = readValues(d).join(' · ') || '–';
  li.append(name, state);
  return li;
}

function renderRoom() {
  const room = activeRoom();
  const list = roomDevices(room);
  const lights = list.filter(isLight).sort(byName);
  const others = list.filter(d => !isLight(d)).sort(byName);
  $('lights').replaceChildren(...lights.map(lightTile));
  $('others').replaceChildren(...others.map(readTile));
  $('lightsHead').classList.toggle('hidden', lights.length === 0);
  $('otherHead').classList.toggle('hidden', others.length === 0);
  renderRuleCheck(list);
}

// Regelkontroll av det som faktiskt ritats: varje reglage ska höra till en enhet
// som regeln tillåter, och inget annat element får ha ett reglage.
function renderRuleCheck(list) {
  const tiles = [...document.querySelectorAll('#room li.tile')];
  let controls = 0, wrong = 0;
  for (const li of tiles) {
    const has = Boolean(li.querySelector('.switch, input.dim'));
    if (has) controls += 1;
    if (has && li.dataset.ctl !== '1') wrong += 1;
  }
  const allowed = list.filter(hasControls).length;
  const lights = list.filter(isLight).length;
  const unavailable = list.filter(d => d.available === false).length;
  const ok = wrong === 0 && controls === allowed;
  $('ruleCheck').textContent =
    `${ok ? 'OK' : 'FEL'} · ${list.length} enheter i rummet, ${lights} light, ${controls} med reglage, ` +
    `${wrong} utanför regeln, ${unavailable} otillgängliga`;
}

function renderConn() {
  if (!homey) { $('connInfo').textContent = '–'; return; }
  $('connInfo').textContent = `Anslutning: ${homey.active === 'local' ? 'lokalt' : homey.active === 'cloud' ? 'moln' : 'ingen'} · realtid: ${rtStatus} · ${devices.size} enheter totalt · ${connText()}`;
}

function zoneLabel(z) {
  let depth = 0, p = z.parent;
  while (p && depth < 8) { const pz = zones.find(x => x.id === p); if (!pz) break; depth += 1; p = pz.parent; }
  return `${'· '.repeat(depth)}${z.name || '(namnlös zon)'}`;
}

function zonesInTreeOrder() {
  const out = [];
  const kids = (pid) => zones.filter(z => (z.parent || null) === pid).sort(byName);
  const walk = (pid, depth) => { if (depth > 8) return; for (const z of kids(pid)) { out.push(z); walk(z.id, depth + 1); } };
  walk(null, 0);
  for (const z of zones) if (!out.includes(z)) out.push(z); // föräldralösa sist
  return out;
}

function renderSettings() {
  const ul = $('roomList');
  ul.replaceChildren();
  for (const r of rooms.list()) {
    const li = document.createElement('li');
    const z = zones.find(x => x.id === r.zoneId);
    const t = document.createElement('div');
    const n = document.createElement('div'); n.textContent = r.name;
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = `${z ? z.name : 'zon saknas i Homey'}${r.withChildren ? ' + underzoner' : ''}`;
    t.append(n, m);
    const del = document.createElement('button');
    del.className = 'danger'; del.textContent = 'Ta bort';
    del.addEventListener('click', () => {
      if (!confirm(`Ta bort rummet "${r.name}" från appen? Inget ändras i Homey.`)) return;
      rooms.remove(r.id);
      renderAll(); restartRealtime();
    });
    li.append(t, del);
    ul.append(li);
  }
  const sel = $('roomZone');
  const keep = sel.value;
  sel.replaceChildren();
  for (const z of zonesInTreeOrder()) {
    const o = document.createElement('option');
    o.value = z.id; o.textContent = zoneLabel(z);
    sel.append(o);
  }
  if (keep) sel.value = keep;
  renderConn();
}

function renderAll() {
  renderTabs();
  renderRoom();
  renderSettings();
}

function showView() {
  const stored = keystore.hasStored();
  const open = keystore.isUnlocked();
  $('setup').classList.toggle('hidden', stored);
  $('unlock').classList.toggle('hidden', !(stored && !open));
  $('bar').classList.toggle('hidden', !open);
  $('app').classList.toggle('hidden', !open || view !== 'room');
  $('settings').classList.toggle('hidden', !open || view !== 'settings');
  $('toRoom').setAttribute('aria-pressed', view === 'room' ? 'true' : 'false');
  $('toSettings').setAttribute('aria-pressed', view === 'settings' ? 'true' : 'false');
  $('live').classList.toggle('hidden', !open);
}

// ---------- Händelser ----------

const ERR = {
  'pin-short': `PIN måste vara minst ${keystore.MIN_PIN} tecken.`,
  'key-missing': 'Ange API-nyckeln.',
  'storage-unavailable': 'Webbläsaren tillåter inte lagring (privat läge?).',
  'wrong-pin': 'Fel PIN.',
  'wiped': 'För många fel. Sparade uppgifter är raderade – ange nyckeln igen.',
  'nothing-stored': 'Inget sparat.',
};

$('saveBtn').addEventListener('click', async () => {
  const pin = $('pin').value, pin2 = $('pin2').value;
  if (pin !== pin2) return toast('PIN-koderna skiljer sig.');
  if (!$('cloudId').value.trim() && !$('lanIp').value.trim()) return toast('Ange Homey-ID, lokal IP eller båda.');
  try {
    $('saveBtn').disabled = true;
    await keystore.save({ key: $('apiKey').value, cloudId: $('cloudId').value, lanIp: $('lanIp').value }, pin);
    for (const id of ['apiKey', 'pin', 'pin2']) $(id).value = '';
    onUnlocked();
  } catch (e) { toast(ERR[e.message] || 'Kunde inte spara.'); }
  finally { $('saveBtn').disabled = false; }
});

$('unlockBtn').addEventListener('click', async () => {
  try {
    $('unlockBtn').disabled = true;
    await keystore.unlock($('unlockPin').value);
    $('unlockPin').value = '';
    onUnlocked();
  } catch (e) { toast(ERR[e.message] || 'Kunde inte låsa upp.'); showView(); }
  finally { $('unlockBtn').disabled = false; }
});
$('unlockPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('unlockBtn').click(); });

function teardown() {
  stopLive();
  clearTimeout(retryTimer);
  showOffline(false);
  homey = null; zones = []; devices.clear(); pending.clear();
  $('lights').replaceChildren(); $('others').replaceChildren();
  setLive('off');
}

for (const id of ['forgetBtn', 'forgetBtn2']) {
  $(id).addEventListener('click', () => {
    if (!confirm('Radera sparad nyckel från den här webbläsaren?')) return;
    keystore.forget();
    teardown(); view = 'room'; showView();
    toast('Raderad. Ta bort nyckeln i Homey om den inte ska användas mer.');
  });
}

$('lockBtn').addEventListener('click', () => {
  keystore.lock();
  teardown(); view = 'room'; showView();
});

$('toRoom').addEventListener('click', () => { view = 'room'; showView(); });
$('toSettings').addEventListener('click', () => { view = 'settings'; renderSettings(); showView(); });
$('emptyAdd').addEventListener('click', () => { view = 'settings'; renderSettings(); showView(); $('roomName').focus(); });

$('roomAdd').addEventListener('click', () => {
  try {
    const r = rooms.add($('roomName').value, $('roomZone').value, $('roomChildren').checked);
    rooms.setActive(r.id);
    $('roomName').value = ''; $('roomChildren').checked = false;
    view = 'room';
    renderAll(); showView(); restartRealtime();
  } catch (e) {
    toast({ name: 'Ange ett namn.', zone: 'Välj en zon.', full: 'För många rum.', storage: 'Kunde inte spara (privat läge?).' }[e.message] || 'Kunde inte lägga till.');
  }
});

$('retryBtn').addEventListener('click', () => connect());

async function onUnlocked() {
  homey = createHomey(keystore.get());
  view = 'room';
  showView();
  await connect();
}

// ---------- Start ----------

purgeLegacy();
showView();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(swUrl).catch(() => { /* appen fungerar utan */ });
}
