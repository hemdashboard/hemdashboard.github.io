// homey.js – Homey-lagret: anslutning via moln och lokalt, läsa, styra, realtid.
// Egna fetch-anrop mot Homeys Web API med användarens API-nyckel som Bearer-token.
// Ingen husdata här – allt hämtas vid körning.
//
// Antaganden (A) som testsidan prövar:
//   moln:   https://<homey-id>.connect.athom.com/api/...
//   lokalt: https://<ip-med-bindestreck>.homey.homeylocal.com/api/...   (localUrlSecure)
//   realtid: socket.io (Engine.IO v4) över WebSocket, namespace /api

import { request } from '../core/http.js';

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
    insightsEntries: (log, resolution = 'last24Hours', mode) =>
      get(`/insights/log/${encodeURIComponent(log.ownerUri)}/${encodeURIComponent(log.id)}/entry/?resolution=${encodeURIComponent(resolution)}`, mode, 10000),

    setCapability(id, capability, value, mode) {
      return request(
        base(mode) + API + `/devices/device/${encodeURIComponent(id)}/capability/${encodeURIComponent(capability)}`,
        { method: 'PUT', headers: auth, body: { value }, timeout: 8000 }
      );
    },

    // Realtidsprov: öppnar socket.io över WebSocket och rapporterar hur långt det kom.
    // Steg: ws-open → eio-open → ns-ok → sub-ok → events. Stängs efter `seconds`.
    // onEvent(count) anropas vid varje inkommande händelse.
    realtimeProbe(mode, seconds, onEvent) {
      return new Promise(resolve => {
        const url = base(mode).replace(/^https:/, 'wss:') + '/socket.io/?EIO=4&transport=websocket';
        const r = { stage: 'start', events: 0, firstEventMs: null, err: null };
        const t0 = performance.now();
        let ws;
        const finish = (err) => {
          if (err && !r.err) r.err = err;
          try { ws && ws.close(); } catch { /* ignore */ }
          clearTimeout(timer);
          resolve(r);
        };
        const timer = setTimeout(() => finish(null), seconds * 1000);
        try { ws = new WebSocket(url); } catch { return finish('ws-blocked'); }

        ws.onopen = () => { r.stage = 'ws-open'; };
        ws.onerror = () => { if (r.stage === 'start') finish('ws-error'); };
        ws.onclose = () => { if (r.stage === 'start' || r.stage === 'ws-open') finish(r.err || 'ws-closed'); };
        ws.onmessage = (ev) => {
          const msg = typeof ev.data === 'string' ? ev.data : '';
          if (msg === '2') { ws.send('3'); return; }               // ping → pong
          if (msg.startsWith('0')) {                                // Engine.IO open
            r.stage = 'eio-open';
            ws.send('40/api,' + JSON.stringify({ token: key }));
            return;
          }
          if (msg.startsWith('40/api')) {                           // namespace ansluten
            r.stage = 'ns-ok';
            ws.send('42/api,1' + JSON.stringify(['subscribe', 'homey:manager:devices']));
            return;
          }
          if (msg.startsWith('44/api')) { finish('ns-refused'); return; }
          if (msg.startsWith('43/api,1')) { r.stage = 'sub-ok'; return; } // ack på subscribe
          if (msg.startsWith('42/api')) {                           // händelse
            r.events += 1;
            if (r.events === 1) r.firstEventMs = Math.round(performance.now() - t0);
            if (r.stage !== 'events') r.stage = 'events';
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
