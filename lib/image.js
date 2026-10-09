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
