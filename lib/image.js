import { safeHttpUrl } from './util.js';

// Only ever called with an image URL that came from a feed, never from user input.
// Still refuse loopback / private hosts so a malicious feed cannot probe the local network.
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/i;

export async function fetchImage(url, maxBytes = 8_000_000) {
  const safe = safeHttpUrl(url);
  if (!safe) throw new Error('Invalid image URL');
  const host = new URL(safe).hostname;
  if (PRIVATE.test(host) && process.env.ALLOW_PRIVATE_IMAGES !== '1') throw new Error('Image host not allowed');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(safe, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; TheMarketingBrief/1.0)', accept: 'image/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) throw new Error('Not an image');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Image too large');
    return { type, data: buf };
  } finally { clearTimeout(timer); }
}

// ---- cache + politeness for remote photo hosts ----
// Free photo services throttle bursts of requests, so: at most 3 downloads at once, each URL downloaded once
// (kept in memory, ~40 MB), and one retry after a short pause when the host says "slow down" (429/5xx).
const CACHE_MAX_BYTES = 40_000_000;
const cache = new Map();
let cacheBytes = 0, active = 0;
const waiters = [], inflight = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function slot() { if (active >= 3) await new Promise((r) => waiters.push(r)); active++; }
function release() { active--; waiters.shift()?.(); }

export function fetchImageCached(url) {
  const hit = cache.get(url);
  if (hit) { cache.delete(url); cache.set(url, hit); return Promise.resolve(hit); }
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    await slot();
    try {
      let img;
      try { img = await fetchImage(url); }
      catch (e) { if (/HTTP (429|5\d\d)/.test(e.message)) { await sleep(800); img = await fetchImage(url); } else throw e; }
      cache.set(url, img); cacheBytes += img.data.length;
      while (cacheBytes > CACHE_MAX_BYTES && cache.size > 1) { const [k, v] = cache.entries().next().value; cache.delete(k); cacheBytes -= v.data.length; }
      return img;
    } finally { release(); }
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
