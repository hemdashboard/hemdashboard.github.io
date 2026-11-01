// sun.js – soluppgång och solnedgång för en position och ett datum (NOAA:s förenklade
// solekvation, ±1–2 min på våra breddgrader). Inga nätanrop. Positionen lagras inte.
//
// Returnerar { rise, set } i ms, eller { polar: 'day' | 'night' } vid midnattssol/polarnatt.

const RAD = Math.PI / 180;

export function sunTimes(dateMs, lat, lon) {
  const d = new Date(dateMs);
  // Dagnummer från J2000 vid lokal middag
  const noonUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) - lon / 15 * 3600000;
  const n = Math.round((noonUtc - Date.UTC(2000, 0, 1, 12)) / 86400000);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosH < -1) return { polar: 'day' };
  if (cosH > 1) return { polar: 'night' };
  const H = Math.acos(cosH) / RAD;
  const toMs = (j) => (j - 2440587.5) * 86400000;
  return { rise: toMs(jTransit - H / 360), set: toMs(jTransit + H / 360) };
}
