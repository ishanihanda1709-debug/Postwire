import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

// Test-only fixtures served from a local mock. None of this ships as site content.
const H = 3600e3;
const feed = (items) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>${new Date(Date.now() - i.ago * H).toUTCString()}</pubDate><description>Feed summary for ${i.t}, long enough to be used as input.</description></item>`).join('')}</channel></rss>`;

test('Postwire end to end: sections, accounts, trial and paywall, privacy, AI limits, security', async (t) => {
  const closers = [];
  t.after(() => closers.forEach((f) => { try { f(); } catch { /* already closed */ } }));
  const mock = http.createServer((req, res) => {
    const b = 'http://127.0.0.1:' + mock.address().port;
    const shared = { t: 'Fintech app adds UPI feature', l: 'https://shared.example/a?utm_source=x', ago: 5 };
    if (req.url === '/m') res.end(feed([
      { t: 'Fixtureco launches Spring campaign film', l: b + '/x/1?utm_source=a', ago: 2 },
      { t: 'Case study: how Otherco grew', l: b + '/x/2', ago: 5 },
      { t: 'Plain marketing story', l: b + '/x/3', ago: 3 },
      { t: 'Stale marketing story', l: b + '/x/4', ago: 96 },
      { t: 'Ancient marketing story', l: b + '/x/5', ago: 24 * 200 },
    ]));
    else if (req.url === '/m2') res.end(feed([{ t: 'Fixtureco unveils Spring campaign film', l: b + '/y/1', ago: 1 }]));
    else if (req.url === '/p') res.end(feed([
      { t: 'Notion launches a new AI tool', l: b + '/x/6', ago: 2 },
      { t: 'Slack adds a new feature for huddles', l: b + '/x/7', ago: 3 },
      { t: 'How product managers build a roadmap people trust', l: b + '/x/8', ago: 4 },
      shared,
    ]));
    else if (req.url === '/f') res.end(feed([
      { t: 'Sensex and Nifty rally as banks gain', l: b + '/x/9', ago: 1 },
      { t: 'RBI holds repo rate, flags inflation risk', l: b + '/x/10', ago: 6 },
      { t: 'Startup raises $20M Series B', l: b + '/x/11', ago: 2 },
      shared,
    ]));
    else if (req.url === '/o') res.end(feed([
      { t: 'Cricket team wins the test series', l: b + '/x/12', ago: 1 },
      { t: 'Scientists find water on a distant moon', l: b + '/x/13', ago: 2 },
      { t: 'New film tops the box office', l: b + '/x/14', ago: 3 },
      { t: 'Hospital opens a new cancer ward', l: b + '/x/15', ago: 4 },
      { t: 'Council approves a new bridge', l: b + '/x/16', ago: 5 },
    ]));
    else { res.statusCode = 500; res.end('x'); }
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  closers.push(() => { mock.closeAllConnections?.(); mock.close(); });
  const base = 'http://127.0.0.1:' + mock.address().port;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-'));
  await fs.writeFile(path.join(dir, 'sources.json'), JSON.stringify({ sources: [
    { id: 'm1', name: 'Outlet A', url: base + '/m', domain: 'marketing', region: 'global', defaultKind: 'news' },
    { id: 'm2', name: 'Outlet B', url: base + '/m2', domain: 'marketing', region: 'india', defaultKind: 'news' },
    { id: 'p1', name: 'Product Wire', url: base + '/p', domain: 'product', region: 'global' },
    { id: 'f1', name: 'Money Wire', url: base + '/f', domain: 'finance', region: 'global' },
    { id: 'o1', name: 'Daily World', url: base + '/o', domain: 'others', region: 'global' },
    { id: 'bad', name: 'Broken', url: base + '/broken', domain: 'finance', region: 'global' },
  ] }));
  Object.assign(process.env, { SOURCES_FILE: path.join(dir, 'sources.json'), DATA_DIR: dir, TRIAL_DAYS: '7', AI_DAILY_LIMIT: '2', APP_NAME: 'Postwire' });
  delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_BASE_URL; delete process.env.REQUIRE_LOGIN; delete process.env.ALLOW_SIGNUP;

  const { refreshAll } = await import('../lib/refresh.js');
  const { createServer } = await import('../server.js');
  const auth = await import('../lib/auth.js');

  // ---------- 1. fetching: three sections, headlines only ----------
  const run = await refreshAll();
  assert.equal(run.byDomain.marketing, 4, 'ancient story pruned; stale one kept for the 7/30 day views; merged duplicate counted once');
  assert.equal(run.byDomain.product, 4);
  assert.equal(run.byDomain.finance, 4);
  assert.equal(run.byDomain.others, 5);
  assert.equal(run.merged, 1);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'store.json'), 'utf8'));
  const all = Object.values(stored.items);
  assert.ok(all.every((i) => !('image' in i) && !('video' in i)), 'no publisher photos are stored');
  const sharedItems = all.filter((i) => i.canonical === 'https://shared.example/a');
  assert.equal(sharedItems.length, 2, 'same URL in two sections stays two separate stories');
  assert.notEqual(sharedItems[0].id, sharedItems[1].id);
  assert.equal(stored.sources.bad.ok, false);

  const srv = createServer(); await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  closers.push(() => { srv.closeAllConnections?.(); srv.close(); });
  const api = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, p, body, headers = {}) => {
      const res = await fetch(api + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.includes('Max-Age=0') ? '' : sc.split(';')[0];
      const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers, setCookie: sc };
    };
    return { call, get: (p, h) => call('GET', p, undefined, h), post: (p, b, h) => call('POST', p, b ?? {}, h), put: (p, b) => call('PUT', p, b), del: (p) => call('DELETE', p) };
  };

  // ---------- 2. logged out: pages and API ----------
  const anon = client();
  assert.equal((await anon.get('/api/items')).status, 401);
  assert.equal((await anon.get('/api/saved')).status, 401);
  const root = await anon.get('/');
  assert.equal(root.status, 200, 'logged-out visitors see the landing page at the home address');
  assert.match(root.data, /Today's news, <span>ready to post/); assert.match(root.data, /name="served-by-app" content="1"/);
  assert.ok(!root.data.includes('{{'), 'landing placeholders are filled in');
  assert.match(root.data, /data-app="\/login\.html#signup"/, 'Get started points at the sign-up page, not GitHub');
  assert.doesNotMatch(root.data, /href="https:\/\/github\.com/, 'no link sends visitors to GitHub');
  assert.equal((await anon.get('/landing.js')).status, 200);
  const login = await anon.get('/login.html');
  assert.equal(login.status, 200); assert.match(login.data, /Postwire/); assert.ok(!login.data.includes('{{'), 'placeholders are filled in');
  assert.match(login.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(login.headers.get('x-frame-options'), 'DENY');
  assert.match((await anon.get('/terms.html')).data, /DRAFT TEMPLATE/);
  assert.match((await anon.get('/privacy.html')).data, /DRAFT TEMPLATE/);
  const cfg = (await anon.get('/api/config')).data;
  assert.equal(cfg.name, 'Postwire'); assert.equal(cfg.signupOpen, true); assert.equal(cfg.trialDays, 7);
  assert.equal((await anon.get('/app.js')).status, 200);
  assert.equal((await anon.get('/..%2f..%2fetc/passwd')).status, 404);
  assert.equal((await anon.get('/server.js')).status, 404);
  const idx = await anon.get('/index.html');
  assert.equal(idx.status, 302); assert.equal(idx.headers.get('location'), '/');

  // ---------- 2b. public headlines for the landing page ----------
  const pub = await anon.get('/api/public/headlines');
  assert.equal(pub.status, 200); assert.equal(pub.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(pub.data.sections.map((s) => s.id), ['marketing', 'product', 'finance', 'others']);
  for (const sct of pub.data.sections) {
    assert.ok(sct.items.length >= 1 && sct.items.length <= 6);
    for (const i of sct.items) assert.deepEqual(Object.keys(i).sort(), ['publishedAt', 'source', 'title', 'url'], 'headline, publisher, link and date only');
  }
  assert.ok(!pub.data.sections.find((s) => s.id === 'marketing').items.some((i) => /Stale|Ancient/.test(i.title)), 'only fresh headlines');
  assert.doesNotMatch(JSON.stringify(pub.data), /Feed summary/, 'no summaries leave the building');
  assert.doesNotMatch(root.data, /Try the sample|class="demo"/, 'the placeholder sample is gone from the landing page');
  process.env.PUBLIC_HEADLINES = '0';
  assert.deepEqual((await anon.get('/api/public/headlines')).data, { sections: [] });
  delete process.env.PUBLIC_HEADLINES;

  // ---------- 3. sign-up (first account is the owner) and login ----------
  assert.equal((await anon.post('/api/auth/signup', { email: 'bad', password: 'longenough1' })).status, 400);
  assert.equal((await anon.post('/api/auth/signup', { email: 'o@x.com', password: 'short' })).status, 400);
  const owner = client();
  const su = await owner.post('/api/auth/signup', { name: 'Olive Owner', email: 'Owner@Example.com', password: 'owner-password-1' });
  assert.equal(su.status, 200); assert.equal(su.data.user.role, 'admin'); assert.equal(su.data.user.plan, 'owner');
  assert.match(su.setCookie, /HttpOnly/); assert.match(su.setCookie, /SameSite=Lax/); assert.doesNotMatch(su.setCookie, /Secure/);
  assert.equal('passHash' in su.data.user, false);
  const bob = client();
  const sb = await bob.post('/api/auth/signup', { name: 'Bob', email: 'bob@example.com', password: 'bob-password-1' });
  assert.equal(sb.data.user.role, 'user'); assert.equal(sb.data.user.plan, 'trial'); assert.equal(sb.data.user.daysLeft, 7);
  assert.equal((await client().post('/api/auth/signup', { email: 'BOB@example.com', password: 'another-pass-1' })).status, 409, 'duplicate email');
  const sessionsFile = await fs.readFile(path.join(dir, 'sessions.json'), 'utf8');
  const usersFile = await fs.readFile(path.join(dir, 'users.json'), 'utf8');
  assert.ok(!usersFile.includes('bob-password-1') && usersFile.includes('scrypt$'), 'passwords are stored scrambled');
  const bobCookie = su && sb.setCookie.split(';')[0].split('=')[1];
  assert.ok(bobCookie && !sessionsFile.includes(bobCookie), 'the session file holds only a hash of each token, never the token itself');

  const again = client();
  assert.equal((await again.post('/api/auth/login', { email: 'bob@example.com', password: 'wrong-wrong' })).status, 401);
  assert.equal((await again.post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong-wrong' })).data.error, 'Wrong email or password.', 'same message for unknown email');
  assert.equal((await again.post('/api/auth/login', { email: 'bob@example.com', password: 'bob-password-1' })).status, 200);
  const limited = client(); let last;
  for (let i = 0; i < 10; i++) last = await limited.post('/api/auth/login', { email: 'victim@example.com', password: 'guess-' + i });
  assert.equal(last.status, 429, 'repeated guesses are throttled');

  const appHome = await owner.get('/');
  assert.equal(appHome.status, 200); assert.match(appHome.data, /id="main"/, 'signed-in visitors get the app at the home address');

  // ---------- 4. the app: sections, filters, freshness, headlines only ----------
  const me = (await owner.get('/api/me')).data;
  assert.deepEqual(me.domains.map((d) => d.id), ['marketing', 'product', 'finance', 'others']);
  assert.ok(Array.isArray(me.sources) && me.sources.length === 6, 'owner sees source health');
  assert.equal((await bob.get('/api/me')).data.sources.length, 0, 'normal users do not');
  assert.equal((await owner.get('/api/items')).headers.get('cache-control'), 'no-store');

  const items = async (c, q = '') => (await c.get('/api/items?' + q)).data;
  const mk = await items(bob, 'domain=marketing');
  assert.equal(mk.total, 3, 'default window is 3 days: the stale story is hidden');
  assert.equal((await items(bob, 'domain=marketing&days=7')).total, 4);
  assert.ok(mk.items.every((i) => i.domain === 'marketing' && !('summary' in i) && !('image' in i)), 'headlines only: no summary, no picture');
  assert.equal(mk.items.find((i) => /Spring/.test(i.title)).also.length, 1, 'duplicate story merged into one card');
  assert.deepEqual(Object.keys(mk.items[0].also[0]).sort(), ['source', 'url']);
  assert.equal((await items(bob, 'domain=marketing&kind=casestudy')).total, 1);
  assert.equal((await items(bob, 'domain=marketing&kind=campaign')).total, 1);
  const pr = await items(bob, 'domain=product');
  assert.equal(pr.total, 4);
  assert.equal((await items(bob, 'domain=product&tag=launch')).total, 1);
  assert.equal((await items(bob, 'domain=product&tag=feature')).items.length >= 1, true);
  assert.equal((await items(bob, 'domain=product&tag=pm')).total, 1);
  const fi = await items(bob, 'domain=finance');
  assert.equal(fi.total, 4);
  assert.equal((await items(bob, 'domain=finance&tag=markets')).total, 1);
  assert.equal((await items(bob, 'domain=finance&tag=funding')).total, 1);
  assert.equal((await items(bob, 'domain=finance&tag=economy')).total, 1);
  assert.equal((await items(bob, 'domain=finance&q=sensex')).total, 1);
  const ot = await items(bob, 'domain=others');
  assert.equal(ot.total, 5);
  assert.equal((await items(bob, 'domain=others&tag=sport')).total, 1);
  assert.equal((await items(bob, 'domain=others&tag=tech')).total, 1);
  assert.equal((await items(bob, 'domain=others&tag=entertainment')).total, 1);
  assert.equal((await items(bob, 'domain=others&tag=health')).total, 1);
  assert.ok(ot.items.every((i) => i.domain === 'others' && !('summary' in i)));
  assert.equal((await items(bob, 'domain=nonsense')).total, mk.total, 'unknown section falls back to marketing');
  assert.equal((await items(bob, 'domain=marketing&days=0.1')).total, 1, '2.4 hour window keeps only the newest');
  const sh1 = await items(bob, 'domain=finance&shuffle=7'), sh2 = await items(bob, 'domain=finance&shuffle=7');
  assert.deepEqual(sh1.items.map((i) => i.id), sh2.items.map((i) => i.id), 'same shuffle seed, same order');
  const ex = await items(bob, `domain=finance&shuffle=7&exclude=${sh1.items[0].id}`);
  assert.equal(ex.total, sh1.total - 1); assert.ok(!ex.items.some((i) => i.id === sh1.items[0].id));

  // ---------- 5. owner-only actions ----------
  assert.equal((await bob.post('/api/refresh')).status, 403);
  assert.equal((await owner.post('/api/refresh')).status, 202);

  // ---------- 6. writing posts: outline without AI; chatbot prompt; AI with limits ----------
  const productItem = pr.items.find((i) => /Notion/.test(i.title)), financeItem = fi.items.find((i) => /Sensex/.test(i.title)), mkItem = mk.items.find((i) => /Plain/.test(i.title));
  const outline = (await bob.post(`/api/items/${productItem.id}/post`)).data;
  assert.equal(outline.scaffold, true); assert.equal(outline.posts.length, 3);
  const chat = (await bob.post(`/api/items/${financeItem.id}/prompt`)).data.prompt;
  assert.match(chat, /finance professional/); assert.match(chat, /NEVER give investment advice/); assert.match(chat, /HEADLINE: Sensex and Nifty rally/);
  assert.match((await bob.post(`/api/items/${productItem.id}/prompt`)).data.prompt, /product manager/);

  let calls = 0, lastSystem = '', failNext = false;
  const fakeAi = http.createServer(async (rq, rs) => {
    calls++; let b = ''; for await (const c of rq) b += c; lastSystem = JSON.parse(b).system;
    if (failNext) { failNext = false; rs.statusCode = 500; return rs.end('boom'); }
    rs.setHeader('content-type', 'application/json');
    rs.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ posts: ['Story-led', 'Lesson-led', 'Question-led'].map((a) => ({ angle: a, post: `Hook ${a}\n\nSource: X`, card: { headline: 'Sharp takeaway', subline: 'Short line' } })) }) }] }));
  });
  await new Promise((ok) => fakeAi.listen(0, '127.0.0.1', ok));
  closers.push(() => { fakeAi.closeAllConnections?.(); fakeAi.close(); });
  process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${fakeAi.address().port}/v1/messages`;
  assert.equal((await bob.get('/api/me')).data.aiEnabled, true);

  assert.equal((await bob.post('/api/voice', { text: 'too short' })).status, 400);
  const bobSample = 'This is Bob\'s own LinkedIn post about shipping small things quickly. '.repeat(3);
  const voiceEntry = (await bob.post('/api/voice', { text: bobSample })).data;
  assert.equal((await bob.get('/api/voice')).data.posts.length, 1);
  assert.equal((await owner.get('/api/voice')).data.posts.length, 0, "one user never sees another's samples");
  assert.equal((await bob.get('/api/me')).data.voiceCount, 1);

  const p1 = await bob.post(`/api/items/${productItem.id}/post`);
  assert.equal(p1.status, 200); assert.equal(p1.data.posts.length, 3); assert.equal(p1.data.posts[0].card.headline, 'Sharp takeaway');
  assert.match(lastSystem, /a product manager/); assert.match(lastSystem, /Do not invent personal experiences/); assert.match(lastSystem, /Bob's own LinkedIn post/);
  assert.equal(calls, 1);
  await bob.post(`/api/items/${productItem.id}/post`);
  assert.equal(calls, 1, 'repeat request served from cache and not counted');
  assert.equal((await bob.get('/api/me')).data.aiUsedToday, 1);
  await bob.post(`/api/items/${financeItem.id}/post`);
  assert.match(lastSystem, /a finance professional/); assert.match(lastSystem, /NEVER give investment advice/);
  assert.equal((await bob.get('/api/me')).data.aiUsedToday, 2);
  const over = await bob.post(`/api/items/${mkItem.id}/post`);
  assert.equal(over.status, 429); assert.match(over.data.error, /today's 2 AI posts/); assert.equal(over.data.scaffold, true);
  const callsBefore = calls;
  await owner.post(`/api/items/${productItem.id}/post`);
  assert.equal(calls, callsBefore + 1, 'cache is per user: the owner gets their own posts, in their own voice');
  assert.doesNotMatch(lastSystem, /Bob's own LinkedIn post/);
  failNext = true;
  const failed = await owner.post(`/api/items/${financeItem.id}/post`);
  assert.equal(failed.status, 502); assert.equal(failed.data.scaffold, true);
  assert.equal((await owner.get('/api/me')).data.aiUsedToday, 1, 'one real call counted; the failed one was refunded');
  assert.equal((await owner.post(`/api/items/${'0'.repeat(16)}/post`)).status, 404);

  // ---------- 7. saved posts: private per user ----------
  const bobSave = (await bob.put('/api/saved', { itemId: productItem.id, angle: 'Story-led', text: 'Bob saved this' })).data;
  assert.equal((await bob.put('/api/saved', { itemId: productItem.id, angle: 'Story-led', text: 'Bob edited' })).data.id, bobSave.id);
  assert.equal((await bob.get('/api/saved')).data.entries.length, 1);
  assert.equal((await owner.get('/api/saved')).data.entries.length, 0);
  await owner.del(`/api/saved/${bobSave.id}`);
  assert.equal((await bob.get('/api/saved')).data.entries.length, 1, "another user cannot delete someone's saved post");
  assert.match((await bob.get('/api/saved/export.md')).data, /> Bob edited/);
  assert.doesNotMatch((await owner.get('/api/saved/export.md')).data, /Bob edited/);
  assert.equal((await bob.put('/api/saved', { itemId: 'deadbeef', angle: 'x', text: 'y' })).status, 404);
  assert.equal((await bob.put('/api/saved', { itemId: productItem.id, angle: 'x', text: '  ' })).status, 400);

  // ---------- 8. trial ends: paywall, then access returns when paid ----------
  const bobId = (await auth.findUserByEmail('bob@example.com')).id;
  await auth.updateUser(bobId, (u) => { u.trialEndsAt = new Date(Date.now() - 1000).toISOString(); });
  assert.equal((await bob.get('/api/items?domain=product')).status, 402);
  assert.equal((await bob.post(`/api/items/${productItem.id}/post`)).status, 402);
  assert.equal((await bob.get('/api/saved')).status, 402);
  const expired = await bob.get('/api/me');
  assert.equal(expired.status, 200); assert.equal(expired.data.user.plan, 'expired'); assert.equal(expired.data.user.access, false);
  await auth.updateUser(bobId, (u) => { u.paidUntil = new Date(Date.now() + 30 * 864e5).toISOString(); });
  assert.equal((await bob.get('/api/items?domain=product')).status, 200);
  const paid = (await bob.get('/api/me')).data.user; assert.equal(paid.plan, 'active'); assert.equal(paid.daysLeft, 30);

  // ---------- 9. security basics ----------
  const evil = await owner.post('/api/voice', { text: 'x'.repeat(100) }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403, 'cross-site writes are refused');
  const https = await client().post('/api/auth/login', { email: 'owner@example.com', password: 'owner-password-1' }, { 'x-forwarded-proto': 'https' });
  assert.match(https.setCookie, /Secure/); assert.match(https.headers.get('strict-transport-security'), /max-age/);

  // ---------- 10. delete account, owner protected, logout ----------
  assert.equal((await owner.post('/api/account/delete', { password: 'owner-password-1' })).status, 403, 'owner account cannot be deleted from the page');
  assert.equal((await bob.post('/api/account/delete', { password: 'wrong' })).status, 401);
  const del = await bob.post('/api/account/delete', { password: 'bob-password-1' });
  assert.equal(del.status, 200);
  assert.equal((await bob.get('/api/me')).status, 401, 'signed out after deleting');
  assert.equal((await client().post('/api/auth/login', { email: 'bob@example.com', password: 'bob-password-1' })).status, 401);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'saved.json'), 'utf8')).entries && Object.values(JSON.parse(await fs.readFile(path.join(dir, 'saved.json'), 'utf8')).entries).some((e) => e.userId === bobId), false, 'saved posts removed');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'voice.json'), 'utf8')).posts.some((p) => p.id === voiceEntry.id), false, 'style samples removed');
  assert.equal((await owner.post('/api/auth/logout')).status, 200);
  assert.equal((await owner.get('/api/me')).status, 401);

  // ---------- 11. closed sign-ups and single-user mode ----------
  process.env.ALLOW_SIGNUP = '0';
  assert.equal((await client().post('/api/auth/signup', { email: 'late@example.com', password: 'late-password-1' })).status, 403);
  assert.equal((await anon.get('/api/config')).data.signupOpen, false);
  delete process.env.ALLOW_SIGNUP;
  process.env.REQUIRE_LOGIN = '0';
  const local = client();
  const lm = await local.get('/api/me');
  assert.equal(lm.status, 200); assert.equal(lm.data.user.role, 'admin');
  assert.equal((await local.get('/')).status, 200);
  assert.match((await local.get('/')).data, /id="main"/, 'single-user mode opens the app straight away');
  assert.equal((await local.get('/login.html')).status, 302);
  assert.equal((await local.get('/api/items?domain=product')).data.total, 4);
  delete process.env.REQUIRE_LOGIN;

});
