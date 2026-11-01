// main.js – hemdashboardens start, anslutning, navigering och inställningar.
// Ingen innerHTML med data från Homey: allt via textContent/createElement.
// Reglage enligt controls.js (light och coffeemachine); skrivningar går bara via homey.control.

import * as keystore from '../core/keystore.js';
import * as rooms from '../core/rooms.js';
import { purgeLegacy } from '../core/controls.js';
import { createHomey, asList } from '../adapters/homey.js';
import { ZONES } from '../adapters/spotpris.js';
import { state, prefs, setPref, deviceList, onChange } from './state.js';
import { $, h, toast } from './ui.js';
import * as energy from './energy.js';
import * as weather from './weather.js';
import * as roomsview from './roomsview.js';
import * as insights from './insights.js';
import * as home from './home.js';
import * as plan from './plan.js';

export const APP_VERSION = '0.6.1';

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

const POLL_MS = 15000;
const RETRY_MS = 30000;
const ENERGY_MS = 5 * 60000;
const TICK_MS = 30000;

let rt = null;                  // realtidshandtag
let rtStatus = 'off';
let pollTimer = null, retryTimer = null, tickTimer = null;
let lastConn = {};               // felkategori per väg, t.ex. { cloud: 'network', local: 'timeout' }
let energyAt = 0;
const refetchTimers = new Map();

const TITLES = { home: 'Hem', energy: 'El', weather: 'Väder', rooms: 'Rum', settings: 'Inställningar' };

// ---------- Anslutning ----------

async function pickConnection() {
  const homey = state.homey;
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
  if (on) $('offlineWhy').textContent = connText();
}

async function connect() {
  clearTimeout(retryTimer);
  if (!state.homey) return false;
  const ok = (await pickConnection()) && (await loadAll());
  if (!state.homey) return false;
  if (!ok) {
    if (state.homey.active && !lastConn.load) lastConn.load = 'enheter';
    setLive('off');
    showOffline(true);
    retryTimer = setTimeout(() => { if (!document.hidden) connect(); }, RETRY_MS);
    loadExternal(); // elpris fungerar utan Homey
    render();
    return false;
  }
  showOffline(false);
  render();
  restartRealtime();
  startPolling();
  energyAt = Date.now();
  await Promise.all([energy.loadEnergy(), loadExternal()]);
  return true;
}

async function loadAll() {
  const homey = state.homey;
  if (!homey || !homey.active) return false;
  const [z, d] = await Promise.all([homey.zones(), homey.devices()]);
  if (z.ok) state.zones = asList(z.data).filter(x => x && typeof x.id === 'string');
  if (!d.ok) { lastConn.load = d.err; return false; }
  state.devices.clear();
  for (const x of asList(d.data)) if (x && typeof x.id === 'string') state.devices.set(x.id, x);
  return true;
}

async function loadExternal() {
  const jobs = [];
  if (energy.spotNeedsReload()) jobs.push(energy.loadSpot());
  if (weather.weatherNeedsReload() && state.homey && state.homey.active) jobs.push(weather.loadWeather());
  await Promise.all(jobs);
}

async function refetch(id) {
  const homey = state.homey;
  if (!homey || !homey.active) return;
  const r = await homey.device(id);
  if (r.ok && r.data && r.data.id === id) {
    state.devices.set(id, r.data);
    if (!roomsview.isPending(id)) scheduleRender();
  }
}

function refetchSoon(id) {
  clearTimeout(refetchTimers.get(id));
  refetchTimers.set(id, setTimeout(() => { refetchTimers.delete(id); refetch(id); }, 400));
}

// ---------- Realtid, polling och tidtagare ----------

function setLive(s) {
  rtStatus = s;
  const el = $('live');
  const homey = state.homey;
  const txt = { live: 'LIVE', connecting: 'ANSLUTER', down: 'VAR 15 S', refused: 'VAR 15 S', off: '–' };
  el.textContent = !homey ? '–' : homey.active ? `${txt[s] || '–'} · ${homey.active === 'local' ? 'LOKALT' : 'MOLN'}` : 'INGEN ANSLUTNING';
  el.dataset.s = homey && !homey.active ? 'down' : s;
}

function onRealtime(uri, event, data) {
  if (uri.startsWith('homey:device:')) {
    const id = uri.slice('homey:device:'.length);
    const d = state.devices.get(id);
    if (!d) return;
    const p = [event, data].find(x => x && typeof x === 'object' && typeof x.capabilityId === 'string' && 'value' in x);
    if (p && d.capabilitiesObj && d.capabilitiesObj[p.capabilityId]) {
      // lastUpdated följer med så att "senaste rörelse" och närvaro "sedan" stämmer utan omläsning.
      d.capabilitiesObj[p.capabilityId] = { ...d.capabilitiesObj[p.capabilityId], value: p.value, lastUpdated: Date.now() };
      if (!roomsview.isPending(id)) scheduleRender();
    } else {
      refetchSoon(id); // okänd form eller annan händelse – läs om enheten
    }
    return;
  }
  if (uri === 'homey:manager:devices') {
    const obj = [event, data].find(x => x && typeof x === 'object' && typeof x.id === 'string');
    if (obj && state.devices.has(obj.id)) refetchSoon(obj.id);
    else if (typeof event === 'string' && /create|delete/.test(event)) scheduleFullReload();
  }
}

let fullReloadTimer = null;
function scheduleFullReload() {
  clearTimeout(fullReloadTimer);
  fullReloadTimer = setTimeout(async () => { if (await loadAll()) { render(); restartRealtime(); } }, 1500);
}

// Realtid för alla enheter: översikten visar el och rum samtidigt.
function restartRealtime() {
  if (rt) { rt.close(); rt = null; }
  const homey = state.homey;
  if (!homey || !homey.active || document.hidden) { setLive('off'); return; }
  rt = homey.realtime({ deviceIds: deviceList().map(d => d.id), onEvent: onRealtime, onStatus: setLive });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const homey = state.homey;
    if (document.hidden || !homey || !homey.active || rtStatus === 'live' || roomsview.hasPending()) return;
    if (await loadAll()) scheduleRender();
  }, POLL_MS);
}

function startTick() {
  clearInterval(tickTimer);
  tick();
  tickTimer = setInterval(tick, TICK_MS);
}

async function tick() {
  renderClock();
  if (document.hidden || !keystore.isUnlocked()) return;
  const homey = state.homey;
  if (homey && homey.active && Date.now() - energyAt >= ENERGY_MS) { energyAt = Date.now(); energy.loadEnergy(); }
  await loadExternal();
  scheduleRender();
}

function stopLive() {
  clearInterval(pollTimer); pollTimer = null;
  if (rt) { rt.close(); rt = null; }
}

// Android dödar bakgrundsflikar: vid återkomst läses allt om och realtiden startas om.
document.addEventListener('visibilitychange', async () => {
  const homey = state.homey;
  if (!homey) return;
  if (document.hidden) { if (rt) { rt.close(); rt = null; } return; }
  if (!homey.active) { connect(); return; }
  if (await loadAll()) render();
  else { homey.use(null); connect(); return; }
  restartRealtime();
  tick();
});

// ---------- Rendering ----------

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); }, 250);
}

function renderClock() {
  const d = new Date();
  const date = d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('clock').textContent = `${date} · ${time}`;
}

function render() {
  if (!keystore.isUnlocked()) return;
  const v = state.view;
  if (v === 'home') {
    $('ovKpi').replaceChildren(...energy.kpiTiles(() => setView('energy')));
    const fc = home.flowCard();
    $('ovFlow').replaceChildren(...(fc ? [fc] : []));
    $('ovFlow').classList.toggle('hidden', !fc);
    $('ovPresence').replaceChildren(...home.presenceBody());
    if (!roomsview.hasPending()) {
      const q = home.quickBody();
      $('ovQuick').replaceChildren(...q);
      $('ovQuickCard').classList.remove('hidden');
    }
    $('ovTips').replaceChildren(...energy.tipsBody());
    $('ovWx').replaceChildren(...weather.weatherCardBody());
    $('ovIns').replaceChildren(...insights.insightsBody());
  } else if (v === 'energy') {
    energy.renderEnergy($('energyRoot'));
  } else if (v === 'weather') {
    weather.renderWeather($('weatherRoot'));
  } else if (v === 'rooms') {
    plan.renderPlan($('planRoot'));
    roomsview.renderRooms($('roomsRoot'));
  } else if (v === 'settings') {
    renderSettings();
  }
}

onChange(() => scheduleRender());

function setView(v) {
  if (!TITLES[v]) return;
  state.view = v;
  showView();
  render();
  window.scrollTo(0, 0);
}

function showView() {
  const stored = keystore.hasStored();
  const open = keystore.isUnlocked();
  $('setup').classList.toggle('hidden', stored);
  $('unlock').classList.toggle('hidden', !(stored && !open));
  $('bar').classList.toggle('hidden', !open);
  for (const v of Object.keys(TITLES)) $(`v-${v}`).classList.toggle('hidden', !open || state.view !== v);
  for (const b of document.querySelectorAll('#bar button')) b.setAttribute('aria-pressed', b.dataset.go === state.view ? 'true' : 'false');
  $('title').textContent = open ? TITLES[state.view] : 'Hem';
  $('live').classList.toggle('hidden', !open);
  if (!open) $('offline').classList.add('hidden');
}

// ---------- Inställningar ----------

function fillSelect(sel, options, value) {
  sel.replaceChildren(...options.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = options.some(([v]) => v === value) ? value : options.length ? options[0][0] : '';
}

function renderSettings() {
  const p = prefs();
  fillSelect($('setZone'), ZONES.map(z => [z, z]), p.zone);

  const autoMeter = energy.meterCandidates()[0];
  fillSelect($('setMeter'), [['', `Automatiskt${autoMeter ? ` (${autoMeter.name})` : ''}`],
    ...energy.meterCandidates().map(d => [d.id, d.name || '(namnlös)'])], p.meterId);
  const autoPrice = energy.priceCandidates()[0];
  fillSelect($('setPrice'), [['', `Automatiskt${autoPrice ? ` (${autoPrice.name})` : ''}`],
    ...energy.priceCandidates().map(d => [d.id, d.name || '(namnlös)'])], p.priceId);

  const ul = $('roomList');
  ul.replaceChildren(...rooms.list().map(r => {
    const z = state.zones.find(x => x.id === r.zoneId);
    return h('li',
      h('div', h('div', r.name), h('div.meta', `${z ? z.name : 'zon saknas i Homey'}${r.withChildren ? ' + underzoner' : ''}`)),
      h('button.danger', {
        onclick: () => {
          if (!confirm(`Ta bort rummet "${r.name}" från appen? Inget ändras i Homey.`)) return;
          rooms.remove(r.id);
          render();
        },
      }, 'Ta bort'));
  }));
  const sel = $('roomZone');
  const keep = sel.value;
  sel.replaceChildren(...rooms.zonesInTreeOrder(state.zones).map(z => {
    let depth = 0, pz = z.parent;
    while (pz && depth < 8) { const x = state.zones.find(y => y.id === pz); if (!x) break; depth += 1; pz = x.parent; }
    return h('option', { value: z.id }, `${'· '.repeat(depth)}${z.name || '(namnlös zon)'}`);
  }));
  if (keep) sel.value = keep;

  $('ruleCheck').textContent = state.devices.size ? `Reglage: ${roomsview.ruleCheck()}` : 'Reglage: –';
  const homey = state.homey;
  $('connInfo').textContent = !homey ? '–'
    : `Anslutning: ${homey.active === 'local' ? 'lokalt' : homey.active === 'cloud' ? 'moln' : 'ingen'} · realtid: ${rtStatus} · ${state.devices.size} enheter · ${state.zones.length} zoner · ${connText()}`;
  // Anonym diagnos per datakälla – inga namn, ID eller värden.
  $('diag').replaceChildren(...Object.entries(state.diag).sort().map(([k, v]) =>
    h('li', { dataset: { s: String(v).startsWith('ok') ? 'ok' : 'warn' } }, `${k}: ${v}`)));
  $('version').textContent = `Version ${APP_VERSION}`;
}

$('setZone').addEventListener('change', (e) => { setPref('zone', e.target.value); state.spot = null; energy.loadSpot(); });
$('setMeter').addEventListener('change', (e) => { setPref('meterId', e.target.value); state.energy = null; energyAt = Date.now(); energy.loadEnergy(); render(); });
$('setPrice').addEventListener('change', (e) => { setPref('priceId', e.target.value); state.energy = null; energyAt = Date.now(); energy.loadEnergy(); render(); });

$('roomAdd').addEventListener('click', () => {
  try {
    const r = rooms.add($('roomName').value, $('roomZone').value, $('roomChildren').checked);
    roomsview.openRoom(r.id);
    $('roomName').value = ''; $('roomChildren').checked = false;
    setView('rooms');
  } catch (e) {
    toast({ name: 'Ange ett namn.', zone: 'Välj en zon.', full: 'För många rum.', storage: 'Kunde inte spara (privat läge?).' }[e.message] || 'Kunde inte lägga till.');
  }
});

// ---------- Nyckel och lås ----------

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
  clearInterval(tickTimer);
  showOffline(false);
  state.homey = null; state.zones = []; state.devices.clear();
  state.energy = null; state.weather = null; state.diag = {};
  roomsview.clearPending();
  energy.resetLogs();
  weather.forgetPosition();
  for (const id of ['ovKpi', 'ovFlow', 'ovPresence', 'ovQuick', 'ovTips', 'ovWx', 'ovIns', 'energyRoot', 'weatherRoot', 'planRoot', 'roomsRoot']) $(id).replaceChildren();
  setLive('off');
}

for (const id of ['forgetBtn', 'forgetBtn2']) {
  $(id).addEventListener('click', () => {
    if (!confirm('Radera sparad nyckel från den här webbläsaren?')) return;
    keystore.forget();
    teardown(); state.view = 'home'; showView();
    toast('Raderad. Ta bort nyckeln i Homey om den inte ska användas mer.');
  });
}

$('lockBtn').addEventListener('click', () => {
  keystore.lock();
  teardown(); state.view = 'home'; showView();
});

for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => setView(b.dataset.go));
$('retryBtn').addEventListener('click', () => connect());

roomsview.init({ onRender: () => { if (state.view === 'rooms') roomsview.renderRooms($('roomsRoot')); else scheduleRender(); }, onRefetch: refetchSoon });
plan.init({ onOpenRoom: () => { roomsview.renderRooms($('roomsRoot')); requestAnimationFrame(() => $('roomsRoot').scrollIntoView({ block: 'start' })); } });

async function onUnlocked() {
  state.homey = createHomey(keystore.get());
  state.view = 'home';
  showView();
  render();
  startTick();
  await connect();
}

// ---------- Start ----------

purgeLegacy();
plan.purgeOld();
renderClock();
showView();

// ---------- PWA: installation och uppdatering ----------
// Uppdateringar kräver ingen ominstallation: service workern hämtar egna filer från nätet
// först, och en ny version tar över direkt. Sidan laddas om en gång när den nya är aktiv.
let swReg = null;
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // första installationen: ingen omladdning
    reloading = true;
    toast('Ny version – laddar om…');
    setTimeout(() => location.reload(), 600);
  });
  navigator.serviceWorker.register(swUrl).then((r) => { swReg = r; }).catch(() => { /* appen fungerar utan */ });
  // Sök efter ny version när appen kommer tillbaka från bakgrunden.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && swReg) swReg.update().catch(() => {}); });
}

let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  $('installBtn').classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
  installEvt = null;
  $('installBtn').classList.add('hidden');
  $('installInfo').textContent = 'Installerad. Uppdateringar kommer automatiskt, utan ominstallation.';
});
if (matchMedia('(display-mode: standalone)').matches) {
  $('installInfo').textContent = 'Körs som installerad app. Uppdateringar kommer automatiskt, utan ominstallation.';
}
$('installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => null);
  installEvt = null;
  $('installBtn').classList.add('hidden');
});
$('updateBtn').addEventListener('click', async () => {
  if (!swReg) { toast('Ingen service worker – ladda om sidan.'); return; }
  try {
    await swReg.update();
    toast(swReg.installing || swReg.waiting ? 'Ny version hittad – laddar om…' : `Senaste versionen (${APP_VERSION}).`);
  } catch { toast('Kunde inte söka efter uppdatering.'); }
});

// Diagrammen ritas i faktisk bredd; rita om när fönstret ändrar storlek eller vänds.
let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(scheduleRender, 200); });
