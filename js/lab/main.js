// main.js – testsidans UI. Ingen innerHTML med data från Homey: allt via textContent.

import * as keystore from '../core/keystore.js';
import { hasControls, isControlClass, purgeLegacy } from '../core/controls.js';
import { createHomey } from '../adapters/homey.js';
import { ZONES } from '../adapters/spotpris.js';
import * as C from './checks.js';

// Ramspärr: meta-CSP kan inte sätta frame-ancestors, och GitHub Pages kan inte sätta
// headers. Ligger sidan i en ram visas den aldrig (skydd mot klickkapning av reglagen).
if (window.top !== window.self) {
  throw new Error('framed');
}
document.documentElement.classList.remove('boot');

// Trusted Types: enda tillåtna skript-URL är den egna service workern.
const swUrl = window.trustedTypes
  ? window.trustedTypes.createPolicy('hd-sw', {
      createScriptURL: (u) => { if (u !== './sw.js') throw new Error('tt-url'); return u; },
    }).createScriptURL('./sw.js')
  : './sw.js';

const $ = (id) => document.getElementById(id);
const state = C.initialState();
let homey = null;
let devices = [];

// ---------- Rendering ----------

function renderChecks() {
  const ol = $('checks');
  ol.replaceChildren();
  for (const c of C.CHECKS) {
    const s = state[c.id];
    const li = document.createElement('li');
    const id = document.createElement('span'); id.className = 'id'; id.textContent = c.id;
    const body = document.createElement('span'); body.textContent = c.title;
    if (s.detail || c.note) {
      const n = document.createElement('span'); n.className = 'note';
      n.textContent = s.detail || c.note;
      body.append(n);
    }
    const st = document.createElement('span'); st.className = 'st'; st.dataset.s = s.status;
    st.textContent = { ok: 'OK', warn: 'VARNING', fail: 'FEL', skip: 'HOPPAD', wait: '–', run: '…' }[s.status];
    li.append(id, body, st);
    ol.append(li);
  }
  $('result').textContent = C.summary(state, { active: homey && homey.active }, $('place').value);
}

function set(id, status, detail) {
  state[id] = { status, detail: detail || '' };
  renderChecks();
}

function renderDevices() {
  const ul = $('devices');
  ul.replaceChildren();
  const shown = devices
    .filter(d => isControlClass(d) || (d.capabilities || []).includes('onoff'))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'sv'));
  for (const d of shown) {
    const li = document.createElement('li');
    const ctlOk = hasControls(d);
    li.dataset.ctl = ctlOk ? '1' : '0';

    const left = document.createElement('div');
    const name = document.createElement('div'); name.textContent = d.name || '(namnlös)';
    const meta = document.createElement('div'); meta.className = 'meta';
    const on = d.capabilitiesObj && d.capabilitiesObj.onoff ? d.capabilitiesObj.onoff.value : null;
    meta.textContent = `${d.class || '?'}${on === null ? '' : on ? ' · på' : ' · av'}${d.available === false ? ' · ej nåbar' : ''}`;
    left.append(name, meta);

    const ctl = document.createElement('div'); ctl.className = 'ctl';
    if (ctlOk) {
      const btn = document.createElement('button');
      btn.className = 'toggle';
      btn.textContent = 'Växla';
      btn.addEventListener('click', () => toggle(d, btn));
      ctl.append(btn);
    } else {
      const tag = document.createElement('span'); tag.className = 'k';
      tag.textContent = isControlClass(d) ? 'OTILLGÄNGLIG' : 'VISNING';
      ctl.append(tag);
    }
    li.append(left, ctl);
    ul.append(li);
  }
  $('devCount').textContent = `${shown.length} av ${devices.length} enheter visas (lampor och enheter med på/av)`;
  C.runControlRender(ul, devices, set);
}

async function toggle(d, btn) {
  if (!confirm(`Växla "${d.name}"? Välj bara något ofarligt.`)) return;
  btn.disabled = true;
  const fresh = await C.runToggle(homey, d, set);
  if (fresh) {
    const i = devices.findIndex(x => x.id === d.id);
    if (i >= 0) devices[i] = fresh;
  }
  renderDevices();
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function showView() {
  const stored = keystore.hasStored();
  const open = keystore.isUnlocked();
  $('setup').classList.toggle('hidden', stored);
  $('unlock').classList.toggle('hidden', !(stored && !open));
  $('run').classList.toggle('hidden', !open);
  $('devCard').classList.toggle('hidden', !open);
  $('resCard').classList.toggle('hidden', !open);
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

for (const id of ['forgetBtn', 'forgetBtn2']) {
  $(id).addEventListener('click', () => {
    if (!confirm('Radera sparad nyckel från den här webbläsaren?')) return;
    keystore.forget();
    homey = null; devices = [];
    $('devices').replaceChildren();
    showView();
    toast('Raderad. Ta bort nyckeln i Homey om den inte ska användas mer.');
  });
}

$('lockBtn').addEventListener('click', () => {
  keystore.lock();
  homey = null; devices = [];
  $('devices').replaceChildren();
  showView();
});

$('runBtn').addEventListener('click', async () => {
  $('runBtn').disabled = true;
  try {
    const active = await C.runConnection(homey, set);
    devices = await C.runDevices(homey, set);
    renderDevices();
    if (!active) toast('Ingen anslutning till Homey. Övriga tester körs ändå.');
    await Promise.all([
      C.runPresence(homey, devices, set),
      C.runInsights(homey, set),
      C.runSpot($('zone').value, set),
      C.runSmhi(homey, { lat: $('lat').value, lon: $('lon').value }, set),
    ]);
    toast('Klart. Kör realtidstestet separat och prova Växla på en ofarlig lampa.');
  } finally { $('runBtn').disabled = false; }
});

$('rtBtn').addEventListener('click', async () => {
  if (!homey || !homey.active || !devices.length) return toast('Kör testerna först så att anslutning och enheter finns.');
  $('rtBtn').disabled = true;
  try { await C.runRealtime(homey, devices, set, 60); }
  finally { $('rtBtn').disabled = false; }
});

$('place').addEventListener('change', renderChecks);

$('copyBtn').addEventListener('click', async () => {
  const text = $('result').textContent;
  try { await navigator.clipboard.writeText(text); toast('Kopierat.'); }
  catch {
    const r = document.createRange(); r.selectNodeContents($('result'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    toast('Markerat – kopiera manuellt.');
  }
});

function onUnlocked() {
  homey = createHomey(keystore.get());
  showView();
  renderChecks();
}

// ---------- Start ----------

// Clickjacking-skydd: GitHub Pages kan inte skicka frame-ancestors, och CSP i
// meta-tagg ignorerar det direktivet. Sidan vägrar därför att köras i en ram.
if (window.top !== window.self) {
  document.body.replaceChildren();
  throw new Error('framed');
}

purgeLegacy();

for (const z of ZONES) {
  const o = document.createElement('option'); o.value = z; o.textContent = z;
  if (z === 'SE3') o.selected = true;
  $('zone').append(o);
}
renderChecks();
showView();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(swUrl).catch(() => { /* testsidan fungerar utan */ });
}
