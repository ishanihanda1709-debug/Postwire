import './lib/env.js';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshAll, isRefreshing, loadSources } from './lib/refresh.js';
import { notifySignup } from './lib/notify.js';
import { loadStore, loadSaved, saveSaved, loadVoice, saveVoice, lock, dataDir, remoteEnabled } from './lib/store.js';
import { sha } from './lib/util.js';
import { parseTimes, localParts, isStale, nextLabel, TIMEZONE } from './lib/schedule.js';
import { aiEnabled, writePost, voiceCount, buildChatPrompt, hasCachedPost } from './lib/ai.js';
import { scaffoldPosts } from './lib/drafts.js';
import { DOMAIN_IDS, DOMAINS, publicDomains } from './lib/domains.js';
import {
  requireLogin, trialDays, aiDailyLimit, createUser, findUserByEmail, createSession, destroySession, cookieFor, clearCookie,
  userFromRequest, publicUser, accessInfo, verifyPassword, burnPasswordTime, validEmail, normalizeEmail, userCount,
  consumeAi, refundAi, aiUsedToday, deleteUser, rateLimit,
} from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PUBLIC = path.join(__dirname, 'public');
const DOCS = path.join(__dirname, 'docs');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 60);
const REFRESH_TIMES = parseTimes(process.env.REFRESH_AT);
const FRESH_DAYS = Number(process.env.FRESH_DAYS || 3);
const appName = () => process.env.APP_NAME || 'Postwire';
const tagline = () => process.env.APP_TAGLINE || 'Today’s news, ready to post.';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const json = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

async function readBody(req, max = 100_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('Body too large'), { code: 413 }); chunks.push(c); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('Invalid JSON'), { code: 400 }); }
}

const clientIp = (req) => (process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';

// What the page may see about a story. Never the feed's summary: that is only used to help write posts.
const publicItem = (i) => ({
  id: i.id, title: i.title, url: i.url, source: i.source, via: i.via, domain: i.domain || 'marketing', region: i.region, kind: i.kind, tags: i.tags,
  publishedAt: i.publishedAt, firstSeenAt: i.firstSeenAt, also: (i.also || []).map(({ source, url }) => ({ source, url })),
});

// Trending = covered by several outlets, recent, and (for marketing) a campaign. No invented social metrics.
function scoreTrending(i) {
  const age = Math.max(0, (Date.now() - Date.parse(i.publishedAt || i.firstSeenAt)) / 86_400_000);
  return (i.also?.length || 0) * 3 + (i.kind === 'campaign' ? 1.5 : 0) - age * 0.8;
}

function seededShuffle(arr, seed) {
  let t = seed >>> 0;
  const rnd = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

let headlinesCache = { at: 0, stamp: null, value: null };
async function publicHeadlines() {
  const store = await loadStore();
  if (headlinesCache.value && headlinesCache.stamp === store.updatedAt && Date.now() - headlinesCache.at < 300_000) return headlinesCache.value;
  const oldest = Date.now() - FRESH_DAYS * 86_400_000;
  const sections = DOMAIN_IDS.map((id) => ({
    id, label: DOMAINS[id].label,
    items: Object.values(store.items).filter((i) => (i.domain || 'marketing') === id && i.publishedAt && Date.parse(i.publishedAt) >= oldest)
      .sort((a, b) => scoreTrending(b) - scoreTrending(a)).slice(0, 6)
      .map((i) => ({ title: i.title, source: i.source, url: i.url, publishedAt: i.publishedAt })),
  })).filter((sct) => sct.items.length);
  headlinesCache = { at: Date.now(), stamp: store.updatedAt, value: { updatedAt: store.updatedAt, sections } };
  return headlinesCache.value;
}

async function html(res, file, dir = PUBLIC) {
  let body = await fs.readFile(path.join(dir, file), 'utf8');
  const name = appName();
  body = body.replaceAll('{{APP_NAME}}', name).replaceAll('{{APP_INITIAL}}', name.slice(0, 1).toUpperCase()).replaceAll('{{TAGLINE}}', tagline()).replaceAll('{{SERVED_BY_APP}}', '1');
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache', 'content-security-policy': CSP });
  res.end(body);
}

async function route(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  // ---------- pages and static files ----------
  if (p === '/healthz') {   // for uptime pingers (they often send HEAD); public, reveals nothing
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : 'ok');
  }
  if (!p.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const user = await userFromRequest(req);
    if (p === '/' || p === '/index.html') {
      // Signed-in visitors get the app. Everyone else sees the public landing page (docs/index.html) at the home address.
      if (requireLogin() && !user) {
        if (p === '/index.html') { res.writeHead(302, { location: '/' }); return res.end(); }
        return html(res, 'index.html', DOCS);
      }
      return html(res, 'index.html');
    }
    if (p === '/welcome') return html(res, 'index.html', DOCS);   // the public website page, for logged-in visitors too (the brand link in the app)
    if (p === '/landing.js') {
      res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-cache' });
      return res.end(await fs.readFile(path.join(DOCS, 'landing.js')));
    }
    if (p === '/login.html') {
      if (!requireLogin() || user) { res.writeHead(302, { location: '/' }); return res.end(); }
      return html(res, 'login.html');
    }
    if (p === '/terms.html' || p === '/privacy.html') return html(res, p.slice(1));
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep) || path.extname(file) === '.html') { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return res.end(data);
    } catch { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
  }

  // ---------- API ----------
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin && new URL(origin).host !== host) return json(res, 403, { error: 'Cross-origin request blocked' });
  }

  if (p === '/api/config' && (req.method === 'GET' || req.method === 'HEAD')) {
    return json(res, 200, { name: appName(), tagline: tagline(), requireLogin: requireLogin(), signupOpen: process.env.ALLOW_SIGNUP !== '0' || (await userCount()) === 0, trialDays: trialDays() });
  }

  // Public, for the landing page: today's top headlines per section. Headline, publisher, link and age only:
  // no summaries and nothing else a publisher owns. Switch off with PUBLIC_HEADLINES=0.
  if (p === '/api/public/headlines' && req.method === 'GET') {
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' };
    if (process.env.PUBLIC_HEADLINES === '0') return json(res, 200, { sections: [] }, cors);
    if (!rateLimit(`pub:${clientIp(req)}`, 60, 60_000)) return json(res, 429, { error: 'Slow down a little.' });
    return json(res, 200, await publicHeadlines(), cors);
  }

  if (p === '/api/auth/signup' && req.method === 'POST') {
    if (!rateLimit(`signup:${clientIp(req)}`, 10, 3_600_000)) return json(res, 429, { error: 'Too many sign-ups from this network. Try again later.' });
    const body = await readBody(req);
    const first = (await userCount()) === 0;
    if (!first && process.env.ALLOW_SIGNUP === '0') return json(res, 403, { error: 'Sign-ups are closed right now.' });
    const email = normalizeEmail(body.email), password = String(body.password || '');
    if (!validEmail(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 8) return json(res, 400, { error: 'Use a password of at least 8 characters.' });
    if (password.length > 200) return json(res, 400, { error: 'That password is too long.' });
    try {
      const { user, first: isFirst } = await createUser({ name: body.name, email, password });
      if (isFirst) await adoptLegacyData(user.id);
      const token = await createSession(user.id);
      notifySignup(user, { isOwner: isFirst });   // in the background: a slow form must never hold up a sign-up
      return json(res, 200, { user: publicUser(user) }, { 'set-cookie': cookieFor(token, req) });
    } catch (e) {
      if (e.code === 409) return json(res, 409, { error: e.message });
      throw e;
    }
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = normalizeEmail(body.email), password = String(body.password || '').slice(0, 200);
    if (!rateLimit(`login:${clientIp(req)}:${email}`, 8, 900_000) || !rateLimit(`loginip:${clientIp(req)}`, 40, 900_000)) {
      return json(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
    }
    const user = await findUserByEmail(email);
    if (!user) await burnPasswordTime(password);
    if (!user || !(await verifyPassword(password, user.passHash))) return json(res, 401, { error: 'Wrong email or password.' });
    const token = await createSession(user.id);
    return json(res, 200, { user: publicUser(user) }, { 'set-cookie': cookieFor(token, req) });
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    await destroySession(req);
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookie() });
  }

  // Everything below needs a signed-in user.
  const user = await userFromRequest(req);
  if (!user) return json(res, 401, { error: 'login_required' });
  const access = accessInfo(user);

  if (p === '/api/me' && req.method === 'GET') {
    const store = await loadStore();
    const sources = user.role === 'admin' ? await loadSources() : [];
    return json(res, 200, {
      user: publicUser(user), name: appName(), aiEnabled: aiEnabled(), domains: publicDomains(), freshDays: FRESH_DAYS,
      updatedAt: store.updatedAt, refreshing: isRefreshing(), nextRefresh: REFRESH_TIMES.length ? nextLabel(REFRESH_TIMES) : null,
      refreshMinutes: REFRESH_MINUTES, author: user.name, voiceCount: await voiceCount(user.id),
      aiLimit: aiDailyLimit(), aiUsedToday: aiUsedToday(user),
      billing: { priceLabel: process.env.PRICE_LABEL || '', upgradeUrl: process.env.UPGRADE_URL || '', supportEmail: process.env.SUPPORT_EMAIL || '', trialDays: trialDays() },
      lastRun: user.role === 'admin' ? store.lastRun || null : undefined,
      sources: sources.map((s) => ({ id: s.id, name: s.name, domain: s.domain, region: s.region, ...(store.sources[s.id] || { ok: null }) })),
      requireLogin: requireLogin(),
    });
  }

  if (p === '/api/account/delete' && req.method === 'POST') {
    const body = await readBody(req);
    if (user.role === 'admin') return json(res, 403, { error: 'The owner account cannot be deleted here.' });
    if (!(await verifyPassword(String(body.password || ''), user.passHash))) return json(res, 401, { error: 'Wrong password.' });
    await lock(async () => {
      const sv = await loadSaved(); for (const [k, e] of Object.entries(sv.entries)) if (e.userId === user.id) delete sv.entries[k]; await saveSaved(sv);
      const v = await loadVoice(); v.posts = v.posts.filter((x) => x.userId !== user.id); await saveVoice(v);
    });
    await deleteUser(user.id);
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookie() });
  }

  // Everything below needs an active trial or subscription.
  if (!access.access) return json(res, 402, { error: 'subscription_required' });

  if (p === '/api/items' && req.method === 'GET') {
    const store = await loadStore();
    const domain = DOMAIN_IDS.includes(q.get('domain')) ? q.get('domain') : 'marketing';
    let list = Object.values(store.items).filter((i) => (i.domain || 'marketing') === domain);
    const kind = q.get('kind'), tag = q.get('tag'), region = q.get('region'), text = (q.get('q') || '').toLowerCase().trim();
    if (kind && kind !== 'all') list = list.filter((i) => i.kind === kind);
    if (tag) list = list.filter((i) => i.tags.includes(tag));
    if (region && region !== 'all') list = list.filter((i) => i.region === region);
    if (text) {
      const words = text.split(/\s+/);
      list = list.filter((i) => { const h = `${i.title} ${i.source}`.toLowerCase(); return words.every((w) => h.includes(w)); });
    }
    const date = (i) => Date.parse(i.publishedAt || i.firstSeenAt) || 0;
    // Freshness: only stories published within the last N days (default FRESH_DAYS=3). Undated stories are left out.
    const days = Math.min(Math.max(Number(q.get('days')) || FRESH_DAYS, 0.01), 90);
    const oldest = Date.now() - days * 86_400_000;
    list = list.filter((i) => i.publishedAt && Date.parse(i.publishedAt) >= oldest);
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

  const m = p.match(/^\/api\/items\/([a-f0-9]+)\/(post|prompt)$/);
  if (m && req.method === 'POST') {
    const item = (await loadStore()).items[m[1]];
    if (!item) return json(res, 404, { error: 'Not found' });
    if (m[2] === 'prompt') return json(res, 200, { prompt: await buildChatPrompt(item, user) });
    const body = await readBody(req);
    if (!aiEnabled()) return json(res, 200, { posts: scaffoldPosts(item), scaffold: true });
    const cached = !body.force && await hasCachedPost(item, user);
    if (!cached && !(await consumeAi(user.id))) {
      return json(res, 429, { error: `You have used today's ${aiDailyLimit()} AI posts. They reset tomorrow. The free chatbot route below has no limit.`, posts: scaffoldPosts(item), scaffold: true });
    }
    try { return json(res, 200, await writePost(item, user, !!body.force)); }
    catch (e) {
      if (!cached) await refundAi(user.id);
      return json(res, 502, { error: String(e.message), posts: scaffoldPosts(item), scaffold: true });
    }
  }

  if (p === '/api/refresh' && req.method === 'POST') {
    if (user.role !== 'admin') return json(res, 403, { error: 'Only the owner can fetch new stories.' });
    if (isRefreshing()) return json(res, 202, { status: 'already running' });
    refreshAll().catch((e) => console.error('refresh failed', e));
    return json(res, 202, { status: 'started' });
  }

  if (p === '/api/saved' && req.method === 'GET') {
    const sv = await loadSaved();
    return json(res, 200, { entries: Object.values(sv.entries).filter((e) => e.userId === user.id).sort((a, b) => b.savedAt.localeCompare(a.savedAt)) });
  }

  if (p === '/api/saved/export.md' && req.method === 'GET') {
    const sv = await loadSaved();
    const md = ['# My saved LinkedIn posts', ''];
    for (const e of Object.values(sv.entries).filter((x) => x.userId === user.id).sort((a, b) => b.savedAt.localeCompare(a.savedAt))) {
      md.push(`## ${e.item.title}`, `*${e.angle} · ${e.item.source}${e.item.publishedAt ? ', ' + e.item.publishedAt.slice(0, 10) : ''}* · [Original](${e.item.url})`, '', ...e.text.split('\n').map((l) => '> ' + l), '');
    }
    res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="saved-posts.md"' });
    return res.end(md.join('\n'));
  }

  if (p === '/api/saved' && req.method === 'PUT') {
    const body = await readBody(req);
    const store = await loadStore();
    const id = sha(`${user.id}|${body.itemId}|${body.angle}`);
    return lock(async () => {
      const sv = await loadSaved();
      const item = sv.entries[id]?.item || (store.items[body.itemId] && publicItem(store.items[body.itemId]));
      if (!item) return json(res, 404, { error: 'Story not found' });
      const text = String(body.text ?? '').slice(0, 5000);
      if (!text.trim()) return json(res, 400, { error: 'Nothing to save' });
      if (!sv.entries[id] && Object.values(sv.entries).filter((e) => e.userId === user.id).length >= 500) return json(res, 400, { error: 'You have 500 saved posts. Delete some to save more.' });
      sv.entries[id] = { id, userId: user.id, itemId: body.itemId, angle: String(body.angle || 'Post').slice(0, 60), text, item,
        savedAt: sv.entries[id]?.savedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      await saveSaved(sv);
      return json(res, 200, sv.entries[id]);
    });
  }

  const sm = p.match(/^\/api\/saved\/([a-f0-9]+)$/);
  if (sm && req.method === 'DELETE') {
    return lock(async () => {
      const sv = await loadSaved();
      if (sv.entries[sm[1]]?.userId === user.id) { delete sv.entries[sm[1]]; await saveSaved(sv); }
      return json(res, 200, { ok: true });
    });
  }

  if (p === '/api/voice' && req.method === 'GET') {
    return json(res, 200, { posts: (await loadVoice()).posts.filter((x) => x.userId === user.id).reverse() });
  }

  if (p === '/api/voice' && req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
    if (text.length < 80) return json(res, 400, { error: 'Paste a full post (at least a few lines) so the style can be learned.' });
    return lock(async () => {
      const v = await loadVoice();
      if (v.posts.filter((x) => x.userId === user.id).length >= 20) return json(res, 400, { error: 'You can keep up to 20 sample posts. Delete one to add another.' });
      const entry = { id: sha(text + Date.now() + user.id), userId: user.id, text, addedAt: new Date().toISOString() };
      v.posts.push(entry);
      await saveVoice(v);
      return json(res, 200, entry);
    });
  }

  const vm = p.match(/^\/api\/voice\/([a-f0-9]+)$/);
  if (vm && req.method === 'DELETE') {
    return lock(async () => {
      const v = await loadVoice();
      v.posts = v.posts.filter((x) => !(x.id === vm[1] && x.userId === user.id));
      await saveVoice(v);
      return json(res, 200, { ok: true });
    });
  }

  return json(res, 404, { error: 'Not found' });
}

// Data saved before accounts existed (single-user days) goes to the first account, i.e. the owner.
async function adoptLegacyData(userId) {
  await lock(async () => {
    const sv = await loadSaved(); let n = 0;
    for (const e of Object.values(sv.entries)) if (!e.userId) { e.userId = userId; n++; }
    if (n) await saveSaved(sv);
    const v = await loadVoice(); let m = 0;
    for (const x of v.posts) if (!x.userId) { x.userId = userId; m++; }
    if (m) await saveVoice(v);
  });
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('strict-transport-security', 'max-age=31536000');
    route(req, res, url).catch((e) => {
      if (!res.headersSent) json(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.code ? e.message : 'Server error' });
      if (!e.code) console.error(e);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, async () => {
    console.log(remoteEnabled() ? 'Accounts and saved posts are stored in your Upstash Redis database.' : `Your data is saved in: ${dataDir()}`);
    console.log(`${appName()} running at http://${HOST}:${PORT}  (login: ${requireLogin() ? 'required' : 'off (single user)'}, AI: ${aiEnabled() ? 'on' : 'off'}, refresh ${REFRESH_TIMES.length ? `daily at ${REFRESH_TIMES.join(', ')} ${TIMEZONE}` : `every ${REFRESH_MINUTES} min`})`);
    if (requireLogin() && HOST !== '127.0.0.1' && process.env.COOKIE_SECURE !== '1') console.log('Reminder: serve this over HTTPS and set COOKIE_SECURE=1 before real users sign in.');
    const store = await loadStore();
    const run = (label) => refreshAll().then((r) => console.log(label, r)).catch(console.error);
    if (REFRESH_TIMES.length) {
      // Catch up if a slot was missed while the app was off, then check once a minute for the next slot.
      if (isStale(store.updatedAt, REFRESH_TIMES)) run('Catch-up refresh');
      let lastKey = '';
      setInterval(() => {
        const { ymd, hm } = localParts(new Date());
        const key = `${ymd} ${hm}`;
        if (REFRESH_TIMES.includes(hm) && key !== lastKey) { lastKey = key; run('Scheduled refresh'); }
      }, 30_000).unref?.();
    } else {
      const stale = !store.updatedAt || Date.now() - Date.parse(store.updatedAt) > REFRESH_MINUTES * 60_000;
      if (stale) run('Initial refresh');
      setInterval(() => run('Scheduled refresh'), REFRESH_MINUTES * 60_000).unref?.();
    }
  });
}
