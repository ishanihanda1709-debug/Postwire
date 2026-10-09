import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshAll, isRefreshing, loadSources } from './lib/refresh.js';
import { loadStore, loadPortfolio, savePortfolio } from './lib/store.js';
import { CATEGORY_LABELS } from './lib/classify.js';
import { aiEnabled, analyse, writePosts } from './lib/ai.js';
import { scaffoldDrafts } from './lib/drafts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

function scoreFeatured(i) {
  const age = (Date.now() - Date.parse(i.publishedAt || i.firstSeenAt)) / 86_400_000;
  return (i.image ? 3 : 0) + (i.kind === 'campaign' ? 2 : i.kind === 'casestudy' ? 1.5 : 0) + (i.video ? 1 : 0) + (i.also?.length || 0) * 1.5 - age * 0.4;
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
    list.sort((a, b) => date(b) - date(a));
    const limit = Math.min(Number(q.get('limit') || 24), 60), offset = Number(q.get('offset') || 0);
    return json(res, 200, { total: list.length, items: list.slice(offset, offset + limit).map(publicItem) });
  }

  if (p === '/api/featured' && req.method === 'GET') {
    const store = await loadStore();
    const region = q.get('region');
    const pool = Object.values(store.items).filter((i) => i.image && (!region || region === 'all' || i.region === region));
    pool.sort((a, b) => scoreFeatured(b) - scoreFeatured(a));
    return json(res, 200, { items: pool.slice(0, 4).map(publicItem) });
  }

  const m = p.match(/^\/api\/items\/([a-f0-9]+)(?:\/(analysis|posts))?$/);
  if (m) {
    const store = await loadStore();
    const item = store.items[m[1]];
    if (!item) return json(res, 404, { error: 'Not found' });
    if (!m[2] && req.method === 'GET') return json(res, 200, publicItem(item));
    if (m[2] === 'analysis' && req.method === 'POST') {
      if (!aiEnabled()) return json(res, 501, { error: 'ANTHROPIC_API_KEY is not set, so AI analysis is disabled.' });
      const body = await readBody(req);
      try { return json(res, 200, await analyse(item, !!body.force)); }
      catch (e) { return json(res, 502, { error: String(e.message) }); }
    }
    if (m[2] === 'posts' && req.method === 'POST') {
      const body = await readBody(req);
      if (!aiEnabled()) return json(res, 200, { posts: scaffoldDrafts(item), scaffold: true });
      try { return json(res, 200, await writePosts(item, !!body.force)); }
      catch (e) { return json(res, 502, { error: String(e.message), posts: scaffoldDrafts(item), scaffold: true }); }
    }
  }

  if (p === '/api/status' && req.method === 'GET') {
    const store = await loadStore();
    const sources = await loadSources();
    const counts = {};
    for (const i of Object.values(store.items)) counts[i.kind] = (counts[i.kind] || 0) + 1;
    return json(res, 200, {
      updatedAt: store.updatedAt, lastRun: store.lastRun || null, refreshing: isRefreshing(), aiEnabled: aiEnabled(),
      refreshMinutes: REFRESH_MINUTES, counts, categories: CATEGORY_LABELS,
      sources: sources.map((s) => ({ id: s.id, name: s.name, region: s.region, ...(store.sources[s.id] || { ok: null }) })),
    });
  }

  if (p === '/api/refresh' && req.method === 'POST') {
    if (isRefreshing()) return json(res, 202, { status: 'already running' });
    refreshAll().catch((e) => console.error('refresh failed', e));
    return json(res, 202, { status: 'started' });
  }

  if (p === '/api/portfolio' && req.method === 'GET') {
    const pf = await loadPortfolio();
    return json(res, 200, { entries: Object.values(pf.entries).sort((a, b) => b.savedAt.localeCompare(a.savedAt)) });
  }

  if (p === '/api/portfolio/export.md' && req.method === 'GET') {
    const pf = await loadPortfolio();
    const md = ['# My Marketing Portfolio', ''];
    for (const e of Object.values(pf.entries).sort((a, b) => b.savedAt.localeCompare(a.savedAt))) {
      md.push(`## ${e.item.title}`, `*${e.item.source}${e.item.publishedAt ? ', ' + e.item.publishedAt.slice(0, 10) : ''}* · [Original](${e.item.url})`, '');
      const b = e.breakdown || {};
      for (const [k, label] of [['idea', 'Idea'], ['audience', 'Audience'], ['strategy', 'Strategy'], ['execution', 'Execution'], ['why', 'Why it worked']]) if (b[k]) md.push(`**${label}:** ${b[k]}`, '');
      if (e.notes) md.push(`**My notes:** ${e.notes}`, '');
      if (e.post) md.push('**LinkedIn draft:**', '', ...e.post.split('\n').map((l) => '> ' + l), '');
    }
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="portfolio.md"' });
    return res.end(md.join('\n'));
  }

  const pm = p.match(/^\/api\/portfolio\/([a-f0-9]+)$/);
  if (pm) {
    const pf = await loadPortfolio();
    if (req.method === 'PUT') {
      const store = await loadStore();
      const existing = pf.entries[pm[1]];
      const item = existing?.item || (store.items[pm[1]] && publicItem(store.items[pm[1]]));
      if (!item) return json(res, 404, { error: 'Not found' });
      const body = await readBody(req);
      const clip = (s, n) => String(s ?? '').slice(0, n);
      const b = body.breakdown || {};
      pf.entries[pm[1]] = {
        id: pm[1], item, savedAt: existing?.savedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
        notes: clip(body.notes, 5000), post: clip(body.post, 5000),
        breakdown: { idea: clip(b.idea, 1500), audience: clip(b.audience, 1500), strategy: clip(b.strategy, 1500), execution: clip(b.execution, 1500), why: clip(b.why, 1500) },
      };
      await savePortfolio(pf);
      return json(res, 200, pf.entries[pm[1]]);
    }
    if (req.method === 'DELETE') { delete pf.entries[pm[1]]; await savePortfolio(pf); return json(res, 200, { ok: true }); }
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
