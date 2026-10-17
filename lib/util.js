import { createHash } from 'node:crypto';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(html = '') {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

export function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n).replace(/\s+\S*$/, '');
  return cut + '…';
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|cmpid|cid$|source$|amp$)/i;

export function canonicalUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
    url.searchParams.sort();
    let out = url.toString();
    if (url.pathname !== '/' ) out = out.replace(/\/(\?|$)/, '$1');
    return out;
  } catch { return null; }
}

export function safeHttpUrl(u) {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch { return null; }
}

export const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

const STOP = new Set('the a an and or of to in on for with at by from is are as it its this that be new has have will how why what who after before into over out up your you their his her than more most about says say said'.split(' '));

export function titleTokens(t = '') {
  return new Set(
    t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }));
  return results;
}

export async function fetchText(url, { timeout = 15000, maxBytes = 1_500_000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; TheMarketingBrief/1.0; personal feed reader)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      chunks.push(value);
      if (total > maxBytes) { await reader.cancel(); break; }
    }
    return { text: Buffer.concat(chunks).toString('utf8'), finalUrl: res.url };
  } finally { clearTimeout(timer); }
}

// Google News titles end with " - Publisher", and some publishers are written as a web address.
export function cleanPublisher(p) {
  let s = String(p || '').trim();
  const u = s.match(/https?:\/\/[^\s,]+/i);   // a URL buried in the text (or with stray commas around it)
  if (u) s = u[0];
  if (/^https?:\/\//i.test(s)) { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return s; } }
  return s.replace(/^www\./i, '');
}
