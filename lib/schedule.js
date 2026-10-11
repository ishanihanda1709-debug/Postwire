// Daily refresh times, e.g. REFRESH_AT="09:00" or "09:00,18:00", in APP_TIMEZONE (default Asia/Kolkata).
export const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

export function parseTimes(spec) {
  return [...new Set(String(spec || '').split(',').map((s) => s.trim()).filter((s) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s)).map((s) => s.padStart(5, '0')))].sort();
}

export function localParts(date, tz = TIMEZONE) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

// Stale = a scheduled slot has passed since the last refresh (or nothing has run for 24h).
export function isStale(updatedAt, times, now = new Date(), tz = TIMEZONE) {
  if (!updatedAt) return true;
  const last = new Date(updatedAt);
  if (now - last > 86_400_000) return true;
  const n = localParts(now, tz), l = localParts(last, tz);
  const passed = times.filter((t) => t <= n.hm);
  if (!passed.length) return false;
  return `${l.ymd} ${l.hm}` < `${n.ymd} ${passed[passed.length - 1]}`;
}

export function nextLabel(times, now = new Date(), tz = TIMEZONE) {
  if (!times.length) return null;
  const hm = localParts(now, tz).hm;
  const next = times.find((t) => t > hm);
  const fmt = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  return `${fmt(next || times[0])}${next ? '' : ' tomorrow'}`;
}
