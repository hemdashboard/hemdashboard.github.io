// http.js – fetch med tidsgräns, tidtagning och felkategorier.
// Felkategorier är generiska med flit: de går att rapportera utan att läcka
// namn, ID eller adresser.
//   network  – nätverk, CORS eller blockerad av CSP (går inte att skilja i webbläsaren)
//   timeout  – inget svar inom tidsgränsen
//   http-NNN – svar med felstatus
//   parse    – svaret var inte giltig JSON

export async function request(url, { method = 'GET', headers = {}, body, timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = performance.now();
  const init = { method, headers: { ...headers }, signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  try {
    const res = await fetch(url, init);
    const ms = Math.round(performance.now() - t0);
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { return { ok: false, status: res.status, ms, err: res.ok ? 'parse' : `http-${res.status}`, data: null }; }
    }
    return { ok: res.ok, status: res.status, ms, err: res.ok ? null : `http-${res.status}`, data };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { ok: false, status: 0, ms, err: e && e.name === 'AbortError' ? 'timeout' : 'network', data: null };
  } finally {
    clearTimeout(timer);
  }
}
