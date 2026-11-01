// homey.js – Homey-lagret: anslutning via moln och lokalt, läsa, styra, realtid.
// Egna fetch-anrop mot Homeys Web API med användarens API-nyckel som Bearer-token.
// Ingen husdata här – allt hämtas vid körning.
//
// Antaganden (A) som testsidan prövar:
//   moln:   https://<homey-id>.connect.athom.com/api/...
//   lokalt: https://<ip-med-bindestreck>.homey.homeylocal.com/api/...   (localUrlSecure)
//   realtid: socket.io (Engine.IO v4) över WebSocket, namespace /api

import { request } from '../core/http.js';
import { assertControl } from '../core/controls.js';

const API = '/api/manager';

export function cloudBase(cloudId) {
  const id = String(cloudId || '').trim().toLowerCase();
  if (!/^[a-z0-9]{8,64}$/.test(id)) return null;
  return `https://${id}.connect.athom.com`;
}

export function localBase(lanIp) {
  const ip = String(lanIp || '').trim();
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m || m.slice(1).some(o => Number(o) > 255)) return null;
  return `https://${ip.replace(/\./g, '-')}.homey.homeylocal.com`;
}

export function createHomey({ key, cloudId, lanIp }) {
  const bases = { cloud: cloudBase(cloudId), local: localBase(lanIp) };
  let active = null; // 'local' | 'cloud'

  const auth = { Authorization: `Bearer ${key}` };

  function base(mode) {
    const m = mode || active;
    if (!m || !bases[m]) throw new Error('no-base');
    return bases[m];
  }

  function get(path, mode, timeout) {
    return request(base(mode) + API + path, { headers: auth, timeout });
  }

  return {
    has: mode => Boolean(bases[mode]),
    use(mode) { if (bases[mode]) active = mode; return active; },
    get active() { return active; },

    // Anslutning: systeminfo kräver homey.system.readonly
    ping: (mode) => get('/system/', mode, 6000),

    devices: (mode) => get('/devices/device/', mode, 10000),
    device: (id, mode) => get(`/devices/device/${encodeURIComponent(id)}`, mode),
    zones: (mode) => get('/zones/zone/', mode),
    users: (mode) => get('/users/user/', mode),
    // Homeys position (homey.geolocation.readonly). Antagande (A): ligger under
    // optionen location; /geolocation/ prövas som reserv. Returnerar bara siffror.
    async location(mode) {
      const tried = [];
      for (const path of ['/geolocation/option/location', '/geolocation/']) {
        const res = await get(path, mode);
        if (!res.ok) { tried.push(res.err); continue; }
        const d = res.data && typeof res.data === 'object' && res.data.value && typeof res.data.value === 'object' ? res.data.value : res.data;
        const lat = d && Number(d.latitude), lon = d && Number(d.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return { ok: true, lat, lon, via: path === '/geolocation/' ? 'reserv' : 'option' };
        tried.push('fält saknas');
      }
      return { ok: false, err: tried.join(', ') };
    },

    insightsLogs: (mode) => get('/insights/log/', mode, 10000),
    // Loggens ägare och id. Homey vill ha loggens fullständiga id i sökvägen, t.ex.
    // /insights/log/homey:device:<x>/homey:device:<x>:energy_power/entry (O 1/11: kortat id
    // gav 404). Saknas ägaren tas den ur det sammansatta id:t; id:t skickas alltid oförändrat.
    insightsEntries(log, resolution = 'last24Hours', mode) {
      const id = String(log.id || '');
      const owner = log.ownerUri || log.uri || (id.match(/^(homey:[a-z]+:[^:]+):/) || [])[1] || '';
      return get(`/insights/log/${encodeURIComponent(owner)}/${encodeURIComponent(id)}/entry/?resolution=${encodeURIComponent(resolution)}`, mode, 10000);
    },

    // Enda skrivvägen. Spärren (controls.js) prövas här, före varje anrop:
    // bara class 'light', tillgänglig, capability onoff/dim, giltigt värde.
    // Nekat anrop skickas aldrig och returneras som fel 'control-denied'/'control-value'.
    control(device, capability, value, mode) {
      let v;
      try { v = assertControl(device, capability, value); }
      catch (e) { return Promise.resolve({ ok: false, status: 0, ms: 0, err: e.message, data: null }); }
      return request(
        base(mode) + API + `/devices/device/${encodeURIComponent(device.id)}/capability/${encodeURIComponent(capability)}`,
        { method: 'PUT', headers: auth, body: { value: v }, timeout: 8000 }
      );
    },

    // Beständig realtid med återanslutning (samma protokoll som provet nedan, O 31/10):
    // rot → handshakeClient → namnrymd → subscribe på managern och per enhet.
    // Händelser skickas som onEvent(uri, event, data), t.ex.
    //   ('homey:device:<id>', 'capability', { capabilityId, value })   (typ O, form A)
    // onStatus: 'connecting' | 'live' | 'down' | 'refused' | 'off'.
    // Returnerar { close() }.
    realtime({ deviceIds = [], onEvent, onStatus } = {}) {
      let ws = null, ns = null, closed = false, retry = 0, retryTimer = null, stepTimer = null;
      const status = (s) => { try { onStatus && onStatus(s); } catch { /* ignore */ } };
      const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
      const kill = () => { clearTimeout(stepTimer); try { ws && ws.close(); } catch { /* ignore */ } };
      const expect = () => { clearTimeout(stepTimer); stepTimer = setTimeout(kill, 8000); };
      const schedule = () => {
        if (closed) return;
        clearTimeout(retryTimer);
        const delay = Math.min(60000, 1000 * 2 ** Math.min(retry, 6)) + Math.floor(Math.random() * 500);
        retry += 1;
        retryTimer = setTimeout(connect, delay);
      };

      function connect() {
        if (closed) return;
        let b;
        try { b = base(); } catch { status('off'); return; }
        status('connecting');
        ns = null;
        try { ws = new WebSocket(b.replace(/^https:/, 'wss:') + '/socket.io/?EIO=4&transport=websocket'); }
        catch { status('down'); schedule(); return; }
        const sock = ws;
        sock.onopen = expect;
        sock.onerror = () => { /* onclose följer */ };
        sock.onclose = () => {
          clearTimeout(stepTimer);
          if (ws === sock) ws = null;
          if (!closed) { status('down'); schedule(); }
        };
        sock.onmessage = (ev) => {
          const msg = typeof ev.data === 'string' ? ev.data : '';
          if (msg === '2') { sock.send('3'); return; }
          if (msg[0] === '0') { sock.send('40'); expect(); return; }
          if (!ns && (msg === '40' || msg.startsWith('40{'))) {
            const p = { token: key };
            if (cloudId) p.homeyId = String(cloudId).trim();
            sock.send('420' + JSON.stringify(['handshakeClient', p]));
            expect();
            return;
          }
          if (!ns && msg.startsWith('44')) { status('refused'); kill(); return; }
          if (!ns && msg.startsWith('430')) {
            const ack = parse(msg.slice(3));
            const [err, res] = Array.isArray(ack) ? ack : [null, null];
            if (err) { status('refused'); kill(); return; }
            ns = res && typeof res.namespace === 'string' && res.namespace.startsWith('/') ? res.namespace : '/api';
            sock.send(`40${ns},`);
            expect();
            return;
          }
          if (!ns) return;
          if (msg.startsWith(`40${ns},`)) {
            clearTimeout(stepTimer);
            const uris = ['homey:manager:devices', ...deviceIds.map(id => `homey:device:${id}`)];
            uris.forEach((u, i) => sock.send(`42${ns},${i + 1}` + JSON.stringify(['subscribe', u])));
            retry = 0;
            status('live');
            return;
          }
          if (msg.startsWith(`44${ns},`)) { status('refused'); kill(); return; }
          if (msg.startsWith(`42${ns},`)) {
            const arr = parse(msg.slice(`42${ns},`.length));
            if (Array.isArray(arr) && typeof arr[0] === 'string') {
              try { onEvent && onEvent(arr[0], arr[1], arr[2]); } catch { /* ignore */ }
            }
          }
          // 43… = kvittenser på subscribe; nekade enheter ger bara uteblivna händelser.
        };
      }

      connect();
      return {
        close() {
          closed = true;
          clearTimeout(retryTimer);
          kill();
          ws = null;
          status('off');
        },
      };
    },

    // Realtidsprov: socket.io (protokoll 5, Engine.IO 4) över WebSocket.
    // Antagande (A) om Homeys flöde, efter att /api med token i auth nekades (O 31/10):
    //   1. anslut till rotnamnrymden /
    //   2. emit handshakeClient { token, homeyId } med kvittens → svaret anger namnrymd
    //   3. anslut till namnrymden (reserv /api)
    //   4. emit subscribe 'homey:manager:devices' med kvittens → händelser kommer
    // Varje steg rapporteras i r.stage, fel i r.err. Inga data ur händelserna sparas.
    // deviceIds: enheter att prenumerera på per enhet (homey:device:<id>), utöver managern.
    // Rapporten innehåller bara antal och händelsetyper – inga ID eller värden.
    realtimeProbe(mode, seconds, onEvent, deviceIds = []) {
      return new Promise(resolve => {
        const url = base(mode).replace(/^https:/, 'wss:') + '/socket.io/?EIO=4&transport=websocket';
        const r = { stage: 'start', events: 0, firstEventMs: null, err: null,
          subs: { sent: 0, ok: 0, refused: 0 }, byChannel: { manager: 0, device: 0, other: 0 }, types: {} };
        const typeName = (v) => (typeof v === 'string' && /^[a-z][a-z0-9._-]{0,31}$/i.test(v) ? v : 'annat');
        const t0 = performance.now();
        let ws, ns = null, stepTimer = null;
        const finish = (err) => {
          if (err && !r.err) r.err = err;
          clearTimeout(stepTimer);
          clearTimeout(timer);
          try { ws && ws.close(); } catch { /* ignore */ }
          resolve(r);
        };
        // Varje steg före händelser måste svara inom 8 s
        const expect = (label) => { clearTimeout(stepTimer); stepTimer = setTimeout(() => finish(`${label}-timeout`), 8000); };
        const timer = setTimeout(() => finish(null), seconds * 1000);
        const parseAck = (body) => { try { return JSON.parse(body); } catch { return null; } };

        try { ws = new WebSocket(url); } catch { return finish('ws-blocked'); }
        ws.onopen = () => { r.stage = 'ws-open'; expect('eio'); };
        ws.onerror = () => { if (r.stage === 'start') finish('ws-error'); };
        ws.onclose = () => { if (r.stage !== 'events') finish(r.err || 'ws-closed'); };

        ws.onmessage = (ev) => {
          const msg = typeof ev.data === 'string' ? ev.data : '';
          if (msg === '2') { ws.send('3'); return; }                       // ping → pong
          if (msg[0] === '0') {                                            // Engine.IO open
            r.stage = 'eio-open';
            ws.send('40');                                                 // anslut till /
            expect('root');
            return;
          }
          if (msg.startsWith('40{') || msg === '40') {                     // / ansluten
            r.stage = 'root-ok';
            const payload = { token: key };
            if (cloudId) payload.homeyId = String(cloudId).trim();
            ws.send('420' + JSON.stringify(['handshakeClient', payload])); // emit med kvittens 0
            expect('handshake');
            return;
          }
          if (msg.startsWith('44{') || msg === '44') { finish('root-refused'); return; }
          if (msg.startsWith('430')) {                                     // kvittens på handskakning
            const ack = parseAck(msg.slice(3));
            const [err, res] = Array.isArray(ack) ? ack : [null, null];
            if (err) { finish('handshake-refused'); return; }
            r.stage = 'handshake-ok';
            ns = res && typeof res.namespace === 'string' && res.namespace.startsWith('/') ? res.namespace : '/api';
            r.nsFromHandshake = Boolean(res && res.namespace);
            ws.send(`40${ns},`);
            expect('ns');
            return;
          }
          if (ns && msg.startsWith(`40${ns},`)) {                          // namnrymd ansluten
            r.stage = 'ns-ok';
            // Kvittens-ID 1 = managern, 2.. = enheterna
            const uris = ['homey:manager:devices', ...deviceIds.map(id => `homey:device:${id}`)];
            uris.forEach((uri, i) => ws.send(`42${ns},${i + 1}` + JSON.stringify(['subscribe', uri])));
            r.subs.sent = uris.length;
            expect('sub');
            return;
          }
          if (ns && msg.startsWith(`44${ns},`)) { finish('ns-refused'); return; }
          if (ns && msg.startsWith(`43${ns},`)) {                          // kvittens på subscribe
            const m = msg.slice(`43${ns},`.length).match(/^(\d+)(.*)$/);
            if (!m) return;
            const ack = parseAck(m[2]);
            if (Array.isArray(ack) && ack[0]) r.subs.refused += 1; else r.subs.ok += 1;
            if (r.subs.ok + r.subs.refused === r.subs.sent) {
              clearTimeout(stepTimer);
              if (r.subs.ok === 0) { finish('sub-refused'); return; }
            }
            if (r.subs.ok > 0 && r.stage !== 'events') r.stage = 'sub-ok';
            return;
          }
          if (ns && msg.startsWith(`42${ns},`)) {                          // händelse
            clearTimeout(stepTimer);
            const arr = parseAck(msg.slice(`42${ns},`.length));
            const head = Array.isArray(arr) ? arr[0] : null;
            let channel = 'other', type = 'annat';
            if (typeof head === 'string' && head.startsWith('homey:')) {
              channel = head.startsWith('homey:manager:devices') ? 'manager' : head.startsWith('homey:device:') ? 'device' : 'other';
              const t = arr[1];
              type = typeName(typeof t === 'string' ? t : (t && t.event));
            } else {
              type = typeName(head);
            }
            r.byChannel[channel] += 1;
            r.types[type] = (r.types[type] || 0) + 1;
            r.events += 1;
            if (r.events === 1) r.firstEventMs = Math.round(performance.now() - t0);
            r.stage = 'events';
            onEvent && onEvent(r.events);
          }
        };
      });
    },
  };
}

// Hjälp: Homey returnerar samlingar som objekt nyckelade på ID.
export function asList(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : Object.values(data);
}
