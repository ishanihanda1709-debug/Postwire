import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../lib/rss.js';
import { canonicalUrl, jaccard, titleTokens, cleanPublisher } from '../lib/util.js';
import { classify, detectRegion } from '../lib/classify.js';
import { scaffoldPosts } from '../lib/drafts.js';
import { parseTimes, isStale, nextLabel } from '../lib/schedule.js';
import { parseChatPosts, headlineFrom } from '../public/parse.js';
import { hashPassword, verifyPassword, accessInfo, normalizeEmail, validEmail, rateLimit } from '../lib/auth.js';
import { DOMAINS, publicDomains } from '../lib/domains.js';

const RSS = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title><![CDATA[Brand X &amp; Y launch "Test" campaign]]></title><link>https://example.com/a?utm_source=rss</link>
<pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>A <b>short</b> summary.</p>]]></description>
<media:content url="https://example.com/i.jpg" medium="image"/></item>
<item><title>No link</title></item>
<item><title>Javascript link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test('parses RSS, strips HTML, decodes entities, drops bad links, ignores images', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Brand X & Y launch "Test" campaign');
  assert.equal(items[0].summary, 'A short summary.');
  assert.equal(items[0].publishedAt, '2026-10-06T08:00:00.000Z');
  assert.equal('image' in items[0], false, 'publisher photos are never taken');
  assert.equal('video' in items[0], false);
});

test('parses Atom', () => {
  const atom = '<feed><entry><title>Hi there</title><link rel="alternate" href="https://e.com/p"/><published>2026-10-01T00:00:00Z</published><summary>S</summary></entry></feed>';
  assert.equal(parseFeed(atom)[0].url, 'https://e.com/p');
});

test('canonicalUrl removes tracking and normalises', () => {
  assert.equal(canonicalUrl('https://www.Example.com/a/?utm_source=x&b=1#frag'), 'https://example.com/a?b=1');
  assert.equal(canonicalUrl('ftp://x.com'), null);
});

test('title similarity detects the same story across outlets', () => {
  const a = titleTokens('Zomato launches new brand campaign ahead of Diwali');
  const b = titleTokens('Zomato unveils Diwali brand campaign');
  const c = titleTokens('Google updates search ranking systems');
  assert.ok(jaccard(a, b) >= 0.5);
  assert.ok(jaccard(a, c) < 0.2);
});

test('publisher names are cleaned', () => {
  assert.equal(cleanPublisher('https://safariindia.com/'), 'safariindia.com');
  assert.equal(cleanPublisher('www.menafn.com'), 'menafn.com');
  assert.equal(cleanPublisher('Adweek'), 'Adweek');
});

test('marketing classification only uses what the text says', () => {
  const src = { domain: 'marketing', defaultKind: 'news', region: 'global' };
  assert.equal(classify({ title: 'Case study: how a brand grew 3x' }, src).kind, 'casestudy');
  assert.equal(classify({ title: 'Brand launches new campaign film' }, src).kind, 'campaign');
  assert.equal(classify({ title: 'Quarterly earnings call notes' }, src).kind, 'news');
  assert.equal(detectRegion({ title: 'Amul unveils new ad' }, src), 'india');
  assert.equal(detectRegion({ title: 'Nike unveils new ad' }, src), 'global');
});

test('product and finance classification', () => {
  const prod = { domain: 'product', region: 'global' }, fin = { domain: 'finance', region: 'global' };
  assert.equal(classify({ title: 'Notion launches a new AI tool' }, prod).kind, 'launch');
  assert.ok(classify({ title: 'Slack adds a new feature for huddles' }, prod).tags.includes('feature'));
  assert.ok(classify({ title: 'How product managers build a roadmap people trust' }, prod).tags.includes('pm'));
  assert.deepEqual(classify({ title: 'Quiet weekend' }, prod).tags, []);
  assert.ok(classify({ title: 'Sensex and Nifty rally as banks gain' }, fin).tags.includes('markets'));
  assert.ok(classify({ title: 'Fintech startup raises $20M Series B' }, fin).tags.includes('funding'));
  assert.ok(classify({ title: 'RBI holds repo rate, flags inflation risk' }, fin).tags.includes('economy'));
  assert.ok(classify({ title: 'UPI payments cross new monthly record' }, fin).tags.includes('fintech'));
  assert.equal(detectRegion({ title: 'Sensex jumps' }, fin), 'india');
});

test('domains: four sections with sub-tabs, and the public view hides prompt internals', () => {
  assert.deepEqual(Object.keys(DOMAINS), ['marketing', 'product', 'finance', 'others']);
  assert.match(DOMAINS.others.guidance, /do not take sides/);
  assert.match(DOMAINS.finance.guidance, /NEVER give investment advice/);
  for (const d of publicDomains()) { assert.ok(d.subtabs.length >= 3); assert.equal('persona' in d, false); assert.equal('guidance' in d, false); }
});

test('others classification: science and tech, sport, entertainment, health', () => {
  const o = { domain: 'others', region: 'global' };
  assert.ok(classify({ title: 'ISRO schedules a new satellite launch' }, o).tags.includes('tech'));
  assert.ok(classify({ title: 'India win the test series against Australia in cricket' }, o).tags.includes('sport'));
  assert.ok(classify({ title: 'New Bollywood film tops the box office' }, o).tags.includes('entertainment'));
  assert.ok(classify({ title: 'Hospital opens a new cancer ward' }, o).tags.includes('health'));
  assert.deepEqual(classify({ title: 'Council approves a new bridge' }, o), { kind: 'news', tags: [] });
});

test('scaffold posts: three angles, no unsourced facts', () => {
  const ps = scaffoldPosts({ title: 'T', source: 'S', url: 'https://e.com' });
  assert.equal(ps.length, 3);
  assert.equal(new Set(ps.map((p) => p.angle)).size, 3);
  for (const p of ps) { assert.match(p.text, /\[/); assert.match(p.text, /Source: S$/); assert.doesNotMatch(p.text, /\d{2,}/); }
});

test('daily schedule: parsing, catch-up and next label (Asia/Kolkata)', () => {
  assert.deepEqual(parseTimes('9:00, 18:30,bad,25:00'), ['09:00', '18:30']);
  const T = ['09:00'];
  const now = new Date('2026-10-10T04:30:00Z'); // 10:00 IST
  assert.equal(isStale('2026-10-09T05:00:00Z', T, now), true);
  assert.equal(isStale('2026-10-10T03:45:00Z', T, now), false);
  const early = new Date('2026-10-10T01:00:00Z'); // 06:30 IST
  assert.equal(isStale('2026-10-09T05:00:00Z', T, early), false);
  assert.equal(isStale('2026-10-08T00:00:00Z', T, early), true);
  assert.equal(nextLabel(T, early), '9:00 am');
  assert.equal(nextLabel(T, now), '9:00 am tomorrow');
});

test('chatbot answer is split into options (several formats)', () => {
  const md = '1. **Story-led**\n\nHook line one.\n\nSecond para.\n\nSource: X\n\n---\n\n2. **Lesson-led**\n\nLesson hook.\n\nSource: X\n\n3. **Question-led**\n\nIs this smart?\n\nSource: X';
  const a = parseChatPosts(md);
  assert.deepEqual(a.map((p) => p.angle), ['Story-led', 'Lesson-led', 'Question-led']);
  assert.equal(a[0].text, 'Hook line one.\n\nSecond para.\n\nSource: X');
  assert.ok(!a[0].text.includes('---') && !a[0].text.includes('**'));
  const hashes = parseChatPosts('### 1. Story-led\nAlpha post body here\n### 2. Lesson-led\nBeta post body here');
  assert.equal(hashes.length, 2); assert.equal(hashes[1].text, 'Beta post body here');
  const plain = parseChatPosts('Just one post with no numbering.\n\nSecond paragraph.');
  assert.equal(plain.length, 1); assert.equal(plain[0].angle, 'Pasted post');
  assert.deepEqual(parseChatPosts('   '), []);
  assert.equal(parseChatPosts('Numbers 1. in text only\nand 2 more lines').length, 1);
});

test('headline comes from the user\'s own first line, capped at 12 words', () => {
  assert.equal(headlineFrom('\n\nShort hook\nmore'), 'Short hook');
  assert.equal(headlineFrom('one two three four five six seven eight nine ten eleven twelve thirteen'), 'one two three four five six seven eight nine ten eleven twelve…');
});

test('passwords are hashed with scrypt and verified; wrong ones fail', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.match(stored, /^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(stored.includes('correct horse'), false);
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('wrong password', stored), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.notEqual(await hashPassword('correct horse battery'), stored, 'salted: same password, different hash');
});

test('plan and access: trial, paid, expired, owner', () => {
  const now = Date.parse('2026-10-10T00:00:00Z'), day = 86_400_000;
  const iso = (n) => new Date(now + n * day).toISOString();
  assert.deepEqual(accessInfo({ role: 'admin' }, now), { access: true, plan: 'owner', daysLeft: null });
  assert.deepEqual(accessInfo({ role: 'user', trialEndsAt: iso(3) }, now), { access: true, plan: 'trial', daysLeft: 3 });
  assert.deepEqual(accessInfo({ role: 'user', trialEndsAt: iso(-1) }, now), { access: false, plan: 'expired', daysLeft: 0 });
  assert.deepEqual(accessInfo({ role: 'user', trialEndsAt: iso(-1), paidUntil: iso(30) }, now), { access: true, plan: 'active', daysLeft: 30 });
  assert.equal(accessInfo({ role: 'user', trialEndsAt: iso(-1), paidUntil: iso(-2) }, now).access, false);
});

test('email checks and the rate limiter', () => {
  assert.equal(normalizeEmail('  Me@Example.COM '), 'me@example.com');
  assert.equal(validEmail('me@example.com'), true);
  for (const bad of ['', 'no-at', 'a@b', 'a b@c.com', 'x@y.z']) assert.equal(validEmail(bad), false, bad);
  const key = 'test:' + Math.random();
  assert.deepEqual([1, 2, 3, 4].map(() => rateLimit(key, 3, 60_000)), [true, true, true, false]);
});

test('sign-ups are sent to the form, without the password, and the owner is skipped', async () => {
  const http = await import('node:http');
  const { notifySignup } = await import('../lib/notify.js');
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const prev = process.env.SIGNUP_FORM_URL;
  try {
    process.env.SIGNUP_FORM_URL = `http://127.0.0.1:${srv.address().port}/f/x`;
    const user = { name: 'Asha', email: 'asha@example.com', createdAt: '2026-10-17T00:00:00Z', trialEndsAt: '2026-10-24T00:00:00Z', passHash: 'SECRET' };
    assert.equal(await notifySignup(user), true);
    assert.equal(await notifySignup(user, { isOwner: true }), false);
    assert.equal(got.length, 1);
    assert.equal(got[0].email, 'asha@example.com');
    assert.ok(!JSON.stringify(got[0]).includes('SECRET'));
    process.env.SIGNUP_FORM_URL = '';
    assert.equal(await notifySignup(user), false);
    process.env.SIGNUP_FORM_URL = 'http://127.0.0.1:1/none';   // a dead form must not throw
    assert.equal(await notifySignup(user), false);
  } finally { if (prev === undefined) delete process.env.SIGNUP_FORM_URL; else process.env.SIGNUP_FORM_URL = prev; await new Promise((r) => srv.close(r)); }
});

test('accounts can live in a free Redis database instead of on disk', async () => {
  const http = await import('node:http');
  const os = await import('node:os'); const fsp = await import('node:fs/promises'); const path = await import('node:path');
  const kv = new Map(); let auth = '';
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    auth = req.headers.authorization; const [cmd, k, v] = JSON.parse(b);
    let result = null; if (cmd === 'SET') { kv.set(k, v); result = 'OK'; } else if (cmd === 'GET') result = kv.get(k) ?? null;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result })); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pw-redis-'));
  const prev = { ...process.env };
  try {
    Object.assign(process.env, { DATA_DIR: dir, UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${srv.address().port}`, UPSTASH_REDIS_REST_TOKEN: 'tok' });
    const st = await import('../lib/store.js');
    assert.deepEqual(await st.loadUsers(), { users: {} });                 // nothing yet: the default
    await st.saveUsers({ users: { a: { email: 'a@b.co' } } });
    assert.equal((await st.loadUsers()).users.a.email, 'a@b.co');
    assert.equal(auth, 'Bearer tok');
    assert.ok(kv.has('pw:users.json'));
    await st.saveStore({ items: { x: 1 }, sources: {}, updatedAt: null });  // the news store stays on local disk
    assert.ok(!kv.has('pw:store.json'));
    assert.ok((await fsp.readdir(dir)).includes('store.json'));
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';              // an unreachable database must fail loudly, not look empty
    await assert.rejects(() => st.loadUsers());
  } finally {
    for (const k of ['DATA_DIR', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await new Promise((r) => srv.close(r)); await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('sample page: picks the best fresh Marketing story, caches it for the day, and falls back to outlines without AI', async () => {
  const os = await import('node:os'); const fsp = await import('node:fs/promises'); const path = await import('node:path');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pw-sample-'));
  const prev = { ...process.env };
  try {
    Object.assign(process.env, { DATA_DIR: dir });
    delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_BASE_URL; delete process.env.UPSTASH_REDIS_REST_URL;
    const { saveStore, loadSample } = await import('../lib/store.js');
    const { getSample } = await import('../lib/sample.js');
    assert.equal(await getSample(3), null);                                         // nothing fetched yet
    const now = Date.now(), iso = (h) => new Date(now - h * 3_600_000).toISOString();
    await saveStore({ updatedAt: iso(0), sources: {}, items: {
      a: { id: 'a', title: 'Old story', url: 'https://x.test/a', source: 'X', domain: 'marketing', publishedAt: iso(24 * 9), kind: 'news' },
      b: { id: 'b', title: 'Finance story', url: 'https://x.test/b', source: 'X', domain: 'finance', publishedAt: iso(2), kind: 'news' },
      c: { id: 'c', title: 'Plain fresh story', url: 'https://x.test/c', source: 'X', domain: 'marketing', publishedAt: iso(5), kind: 'news' },
      d: { id: 'd', title: 'Brand launches a campaign', url: 'https://x.test/d', source: 'Y', domain: 'marketing', publishedAt: iso(6), kind: 'campaign', also: [{ source: 'Z', url: 'https://z.test/d' }] },
    } });
    const s = await getSample(3);
    assert.equal(s.headline.title, 'Brand launches a campaign');                      // covered by two outlets, and a campaign
    assert.equal(s.by, 'outline'); assert.equal(s.posts.length, 3);
    assert.match(s.posts[0].text, /Brand launches a campaign/);
    assert.equal((await loadSample()).headline.title, s.headline.title);             // saved for the day
    assert.equal(JSON.stringify(s).includes('summary'), false);                      // never the feed's summary
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev); await fsp.rm(dir, { recursive: true, force: true });
  }
});
