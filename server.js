import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshAll, isRefreshing, loadSources } from './lib/refresh.js';
import { loadStore, loadSaved, saveSaved } from './lib/store.js';
import { sha } from './lib/util.js';
import { aiEnabled, writePost } from './lib/ai.js';
import { scaffoldPosts } from './lib/drafts.js';
import { fetchImage } from './lib/image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency). Real environment variables win over the file.
try {
  for (const line of (await fs.readFile(path.join(__dirname, '.env'), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env file */ }

const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 60);
const TOKEN = process.env.ACCESS_TOKEN || '';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png' };

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req, max = 100_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('Body too large'), { code: 413 }); chunks.push(c); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON'), { code: 400 }); }
}

const publicItem = (i) => ({
  id: i.id, title: i.title, url: i.url, source: i.source, via: i.via, region: i.region, kind: i.kind, tags: i.tags,
  publishedAt: i.publishedAt, firstSeenAt: i.firstSeenAt, summary: i.summary, image: i.image, video: i.video, also: i.also || [],
});

// Trending = covered by several outlets, recent, has a picture, is a campaign. No fabricated social metrics.
function scoreTrending(i) {
  const age = Math.max(0, (Date.now() - Date.parse(i.publishedAt || i.firstSeenAt)) / 86_400_000);
  return (i.also?.length || 0) * 3 + (i.image ? 2 : 0) + (i.kind === 'campaign' ? 1.5 : 0) + (i.video ? 0.5 : 0) - age * 0.8;
}

function seededShuffle(arr, seed) {
  let t = seed >>> 0;
  const rnd = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

async function route(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    if (TOKEN && req.headers['x-access-token'] !== TOKEN) return json(res, 401, { error: 'Access token required' });
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-origin request blocked' });
  }

  if (p === '/api/items' && req.method === 'GET') {
    const store = await loadStore();
    let list = Object.values(store.items);
    const kind = q.get('kind'), cat = q.get('category'), region = q.get('region'), text = (q.get('q') || '').toLowerCase().trim();
    if (kind && kind !== 'all') list = list.filter((i) => i.kind === kind);
    if (cat) list = list.filter((i) => i.tags.includes(cat));
    if (region && region !== 'all') list = list.filter((i) => i.region === region);
    if (text) {
      const words = text.split(/\s+/);
      list = list.filter((i) => { const h = `${i.title} ${i.summary} ${i.source}`.toLowerCase(); return words.every((w) => h.includes(w)); });
    }
    const date = (i) => Date.parse(i.publishedAt || i.firstSeenAt) || 0;
    const exclude = new Set((q.get('exclude') || '').split(',').filter(Boolean).slice(0, 600));
    if (exclude.size) list = list.filter((i) => !exclude.has(i.id));
    const seed = Number(q.get('shuffle'));
    if (seed) {
      // "Show me different ones": take the best 60 matching stories, then shuffle them with the caller's seed.
      list.sort((a, b) => scoreTrending(b) - scoreTrending(a));
      list = seededShuffle(list.slice(0, 60), seed);
    } else if (q.get('sort') === 'trending') list.sort((a, b) => scoreTrending(b) - scoreTrending(a));
    else list.sort((a, b) => date(b) - date(a));
    const limit = Math.min(Number(q.get('limit') || 24), 60), offset = Number(q.get('offset') || 0);
    return json(res, 200, { total: list.length, items: list.slice(offset, offset + limit).map(publicItem) });
  }

  const m = p.match(/^\/api\/items\/([a-f0-9]+)\/(post|image)$/);
  if (m) {
    const store = await loadStore();
    const item = store.items[m[1]];
    if (!item) return json(res, 404, { error: 'Not found' });
    if (m[2] === 'image' && req.method === 'GET') {
      if (!item.image) return json(res, 404, { error: 'No image for this story' });
      try {
        const img = await fetchImage(item.image.url);
        const ext = img.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
        res.writeHead(200, { 'content-type': img.type, 'cache-control': 'private, max-age=86400',
          ...(q.get('download') ? { 'content-disposition': `attachment; filename="${item.source.replace(/[^\w]+/g, '-')}-${item.id.slice(0, 6)}.${ext}"` } : {}) });
        return res.end(img.data);
      } catch (e) { return json(res, 502, { error: 'Could not fetch the image: ' + e.message }); }
    }
    if (m[2] === 'post' && req.method === 'POST') {
      const body = await readBody(req);
      if (!aiEnabled()) return json(res, 200, { posts: scaffoldPosts(item), scaffold: true });
      try { return json(res, 200, await writePost(item, !!body.force)); }
      catch (e) { return json(res, 502, { error: String(e.message), posts: scaffoldPosts(item), scaffold: true }); }
    }
  }

  if (p === '/api/status' && req.method === 'GET') {
    const store = await loadStore();
    const sources = await loadSources();
    const counts = {};
    for (const i of Object.values(store.items)) counts[i.kind] = (counts[i.kind] || 0) + 1;
    return json(res, 200, {
      updatedAt: store.updatedAt, lastRun: store.lastRun || null, refreshing: isRefreshing(), aiEnabled: aiEnabled(),
      refreshMinutes: REFRESH_MINUTES, counts, author: process.env.AUTHOR_NAME || '',
      sources: sources.map((s) => ({ id: s.id, name: s.name, region: s.region, ...(store.sources[s.id] || { ok: null }) })),
    });
  }

  if (p === '/api/refresh' && req.method === 'POST') {
    if (isRefreshing()) return json(res, 202, { status: 'already running' });
    refreshAll().catch((e) => console.error('refresh failed', e));
    return json(res, 202, { status: 'started' });
  }

  if (p === '/api/saved' && req.method === 'GET') {
    const sv = await loadSaved();
    return json(res, 200, { entries: Object.values(sv.entries).sort((a, b) => b.savedAt.localeCompare(a.savedAt)) });
  }

  if (p === '/api/saved/export.md' && req.method === 'GET') {
    const sv = await loadSaved();
    const md = ['# My saved LinkedIn posts', ''];
    for (const e of Object.values(sv.entries).sort((a, b) => b.savedAt.localeCompare(a.savedAt))) {
      md.push(`## ${e.item.title}`, `*${e.angle} · ${e.item.source}${e.item.publishedAt ? ', ' + e.item.publishedAt.slice(0, 10) : ''}* · [Original](${e.item.url})`, '', ...e.text.split('\n').map((l) => '> ' + l), '');
    }
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="saved-posts.md"' });
    return res.end(md.join('\n'));
  }

  if (p === '/api/saved' && req.method === 'PUT') {
    const body = await readBody(req);
    const store = await loadStore();
    const sv = await loadSaved();
    const id = sha(`${body.itemId}|${body.angle}`);
    const item = sv.entries[id]?.item || (store.items[body.itemId] && publicItem(store.items[body.itemId]));
    if (!item) return json(res, 404, { error: 'Story not found' });
    const text = String(body.text ?? '').slice(0, 5000);
    if (!text.trim()) return json(res, 400, { error: 'Nothing to save' });
    sv.entries[id] = { id, itemId: body.itemId, angle: String(body.angle || 'Post').slice(0, 60), text, item,
      savedAt: sv.entries[id]?.savedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    await saveSaved(sv);
    return json(res, 200, sv.entries[id]);
  }

  const sm = p.match(/^\/api\/saved\/([a-f0-9]+)$/);
  if (sm && req.method === 'DELETE') {
    const sv = await loadSaved();
    delete sv.entries[sm[1]];
    await saveSaved(sv);
    return json(res, 200, { ok: true });
  }

  if (p.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

  // Static files
  let rel = p === '/' ? '/index.html' : p;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); }
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    route(req, res, url).catch((e) => {
      if (!res.headersSent) json(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.code ? e.message : 'Server error' });
      if (!e.code) console.error(e);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, async () => {
    console.log(`The Marketing Brief running at http://${HOST}:${PORT}  (AI: ${aiEnabled() ? 'on' : 'off'}, refresh every ${REFRESH_MINUTES} min)`);
    const store = await loadStore();
    const stale = !store.updatedAt || Date.now() - Date.parse(store.updatedAt) > REFRESH_MINUTES * 60_000;
    if (stale) refreshAll().then((r) => console.log('Initial refresh', r)).catch(console.error);
    setInterval(() => refreshAll().then((r) => console.log('Scheduled refresh', r)).catch(console.error), REFRESH_MINUTES * 60_000).unref?.();
  });
}
