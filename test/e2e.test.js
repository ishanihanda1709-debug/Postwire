import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

// Test-only fixtures served from a local mock; none of this ships as site content.
const feed = (items) => `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel>${items.map((i) => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>${new Date(Date.now() - i.ago * 3600e3).toUTCString()}</pubDate><description>${i.d || 'Fixture description long enough to be kept as the summary text here.'}</description>${i.img ? `<media:content url="${i.img}" medium="image"/>` : ''}</item>`).join('')}</channel></rss>`;

test('refresh → dedupe → trending → post → image', async () => {
  const mock = http.createServer((req, res) => {
    if (req.url === '/a') res.end(feed([
      { t: 'Fixtureco launches Spring campaign film', l: 'http://127.0.0.1:' + mock.address().port + '/p/1?utm_source=a', ago: 2, img: 'https://img.test/1.jpg' },
      { t: 'Old story', l: 'http://127.0.0.1:' + mock.address().port + '/p/old', ago: 24 * 200 },
    ]));
    else if (req.url === '/b') res.end(feed([
      { t: 'Fixtureco unveils Spring campaign film', l: 'http://127.0.0.1:' + mock.address().port + '/p/dup', ago: 1 },
      { t: 'Case study: how Otherco grew', l: 'http://127.0.0.1:' + mock.address().port + '/p/cs', ago: 5 },
    ]));
    else if (req.url === '/img.png') { res.setHeader('content-type', 'image/png'); res.end(Buffer.from('89504e470d0a1a0a', 'hex')); }
    else if (req.url === '/notimg') { res.setHeader('content-type', 'text/html'); res.end('<html/>'); }
    else if (req.url.startsWith('/p/')) res.end('<meta property="og:image" content="/pg.jpg">');
    else { res.statusCode = 500; res.end('x'); }
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + mock.address().port;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-'));
  await fs.writeFile(path.join(dir, 'sources.json'), JSON.stringify({ sources: [
    { id: 'a', name: 'Outlet A', url: base + '/a', region: 'global', defaultKind: 'news' },
    { id: 'b', name: 'Outlet B', url: base + '/b', region: 'india', defaultKind: 'news' },
    { id: 'bad', name: 'Broken', url: base + '/broken', region: 'global' },
  ] }));
  process.env.SOURCES_FILE = path.join(dir, 'sources.json');
  process.env.DATA_DIR = dir;

  const { refreshAll } = await import('../lib/refresh.js');
  const { createServer } = await import('../server.js');
  const r = await refreshAll();
  assert.equal(r.total, 2, 'old story pruned by age, duplicate merged');
  assert.equal(r.merged, 1);

  const srv = createServer(); await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${srv.address().port}`;
  const get = (p) => fetch(api + p).then((x) => x.json());

  const all = await get('/api/items');
  assert.equal(all.total, 2);
  const camp = all.items.find((i) => i.title.includes('Spring'));
  assert.equal(camp.also.length, 1);
  assert.equal(camp.kind, 'campaign');
  assert.equal((await get('/api/items?kind=casestudy')).total, 1);
  const cs = (await get('/api/items?kind=casestudy')).items[0];
  assert.match(cs.image?.url || '', /\/pg\.jpg$/, 'story with no feed photo gets the article page og:image');
  assert.equal(cs.image.credit, 'Outlet B');
  assert.equal((await get('/api/items?q=otherco')).total, 1);
  assert.equal((await get('/api/items?region=india')).total, 1);

  const status = await get('/api/status');
  assert.equal(status.sources.find((s) => s.id === 'bad').ok, false);
  assert.equal(status.aiEnabled, false);

  // Without an API key the post route returns an honest outline.
  const post0 = await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{}' }).then((x) => x.json());
  assert.equal(post0.scaffold, true);
  assert.equal(post0.posts.length, 3);
  assert.match(post0.posts[0].text, /Source: Outlet/);

  // With a key: mock the Anthropic endpoint, check prompt rules + caching.
  let calls = 0, lastBody;
  const fakeAi = http.createServer(async (rq, rs) => {
    calls++; let b = ''; for await (const c of rq) b += c; lastBody = JSON.parse(b);
    rs.setHeader('content-type', 'application/json');
    rs.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ posts: ['Story-led', 'Lesson-led', 'Question-led'].map((a) => ({ angle: a, post: `Hook ${a}\n\nSource: Outlet A`, card: { headline: 'Sharp takeaway', subline: 'Short line' } })) }) }] }));
  });
  await new Promise((ok) => fakeAi.listen(0, '127.0.0.1', ok));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${fakeAi.address().port}/v1/messages`;
  await fs.writeFile(path.join(dir, 'my-posts.md'), 'Paste one of your own\n\n---\n\n' + 'This is my real past post. '.repeat(10));
  process.env.VOICE_FILE = path.join(dir, 'my-posts.md');
  const withKey = await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{}' }).then((x) => x.json());
  assert.equal(withKey.scaffold, undefined);
  assert.equal(withKey.posts.length, 3);
  assert.equal(withKey.posts[1].angle, 'Lesson-led');
  assert.equal(withKey.posts[0].card.headline, 'Sharp takeaway');
  assert.match(lastBody.system, /THREE different/);
  assert.match(lastBody.system, /Do not invent personal experiences/);
  assert.match(lastBody.system, /EXAMPLE 1/);
  assert.doesNotMatch(lastBody.system, /Paste one of your own/);
  await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{}' });
  assert.equal(calls, 1, 'second request served from cache');
  await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{"force":true}' });
  assert.equal(calls, 2);
  fakeAi.close();

  // Trending: multi-outlet + image + campaign outranks others
  const trending = await get('/api/items?sort=trending');
  assert.equal(trending.items[0].id, camp.id);

  // Freshness: default window is 3 days; a tiny window leaves only the newest story
  assert.equal((await get('/api/items')).total, 2);
  assert.equal((await get('/api/items?days=0.1')).total, 1, '2.4h window: only the 2h-old story');
  assert.equal((await get('/api/items?days=0.1&shuffle=3')).total, 1, 'shuffle respects freshness too');
  assert.equal((await get('/api/status')).freshDays, 3);

  // Shuffle: same seed gives same order, exclude removes stories, different seed can reorder
  const sh1 = await get('/api/items?shuffle=7');
  const sh2 = await get('/api/items?shuffle=7');
  assert.deepEqual(sh1.items.map((i) => i.id), sh2.items.map((i) => i.id));
  const ex = await get(`/api/items?shuffle=7&exclude=${sh1.items[0].id}`);
  assert.equal(ex.total, sh1.total - 1);
  assert.ok(!ex.items.some((i) => i.id === sh1.items[0].id));
  assert.equal((await get(`/api/items?exclude=${all.items.map((i) => i.id).join(',')}`)).total, 0);

  // Saved posts: save, update (same id), list, export, delete
  const sv1 = await fetch(`${api}/api/saved`, { method: 'PUT', body: JSON.stringify({ itemId: camp.id, angle: 'Story-led', text: 'My saved post' }) }).then((x) => x.json());
  const sv2 = await fetch(`${api}/api/saved`, { method: 'PUT', body: JSON.stringify({ itemId: camp.id, angle: 'Story-led', text: 'Edited' }) }).then((x) => x.json());
  assert.equal(sv1.id, sv2.id);
  assert.equal((await get('/api/saved')).entries.length, 1);
  assert.equal((await get('/api/saved')).entries[0].text, 'Edited');
  assert.match(await fetch(`${api}/api/saved/export.md`).then((x) => x.text()), /> Edited/);
  assert.equal((await fetch(`${api}/api/saved`, { method: 'PUT', body: JSON.stringify({ itemId: 'deadbeef', angle: 'x', text: 'y' }) })).status, 404);
  assert.equal((await fetch(`${api}/api/saved`, { method: 'PUT', body: JSON.stringify({ itemId: camp.id, angle: 'x', text: '  ' }) })).status, 400);
  await fetch(`${api}/api/saved/${sv1.id}`, { method: 'DELETE' });
  assert.equal((await get('/api/saved')).entries.length, 0);

  // ACCESS_TOKEN locks every API call, accepts header or cookie, and rejects wrong tokens
  process.env.ACCESS_TOKEN = 'secret-token-123';
  assert.equal((await fetch(`${api}/api/items`)).status, 401);
  assert.equal((await fetch(`${api}/api/saved`)).status, 401);
  assert.equal((await fetch(`${api}/api/items`, { headers: { 'x-access-token': 'wrong' } })).status, 401);
  assert.equal((await fetch(`${api}/api/items`, { headers: { 'x-access-token': 'secret-token-123' } })).status, 200);
  assert.equal((await fetch(`${api}/api/saved`, { headers: { cookie: 'mb_token=secret-token-123' } })).status, 200);
  assert.equal((await fetch(`${api}/`)).status, 200, 'the page itself stays reachable so it can ask for the token');
  delete process.env.ACCESS_TOKEN;

  // My style: add / list / validate / delete, and the pasted post reaches the AI prompt
  const short = await fetch(`${api}/api/voice`, { method: 'POST', body: JSON.stringify({ text: 'too short' }) });
  assert.equal(short.status, 400);
  const mine = 'This is my own LinkedIn post about brands and why small details matter. '.repeat(3);
  const added = await fetch(`${api}/api/voice`, { method: 'POST', body: JSON.stringify({ text: mine }) }).then((x) => x.json());
  assert.equal((await get('/api/voice')).posts.length, 1);
  assert.equal((await get('/api/status')).voiceCount, 1);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const fakeAi2 = http.createServer(async (rq, rs) => { let b = ''; for await (const c of rq) b += c; globalThis.__sys = JSON.parse(b).system; rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ content: [{ type: 'text', text: '{"posts":[{"angle":"A","post":"x","card":null}]}' }] })); });
  await new Promise((ok) => fakeAi2.listen(0, '127.0.0.1', ok));
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${fakeAi2.address().port}/v1/messages`;
  await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{"force":true}' });
  assert.match(globalThis.__sys, /my own LinkedIn post about brands/);
  fakeAi2.close();
  await fetch(`${api}/api/voice/${added.id}`, { method: 'DELETE' });
  assert.equal((await get('/api/voice')).posts.length, 0);

  // Free routes: chatbot prompt without any key, and an OpenAI-compatible provider
  const savedKey = process.env.ANTHROPIC_API_KEY, savedUrl = process.env.ANTHROPIC_API_URL;
  delete process.env.ANTHROPIC_API_KEY;
  const pr = await fetch(`${api}/api/items/${camp.id}/prompt`, { method: 'POST', body: '{}' }).then((x) => x.json());
  assert.match(pr.prompt, /THREE different LinkedIn posts/);
  assert.match(pr.prompt, /HEADLINE: Fixtureco launches Spring campaign film/);
  assert.match(pr.prompt, /Do not invent personal experiences/);
  let compatReq;
  const fakeCompat = http.createServer(async (rq, rs) => { let b = ''; for await (const c of rq) b += c; compatReq = { url: rq.url, auth: rq.headers.authorization, body: JSON.parse(b) }; rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ choices: [{ message: { content: 'Sure!\n```json\n{"posts":[{"angle":"Local","post":"Local model post","card":null}]}\n```' } }] })); });
  await new Promise((ok) => fakeCompat.listen(0, '127.0.0.1', ok));
  process.env.LLM_BASE_URL = `http://127.0.0.1:${fakeCompat.address().port}/v1`;
  process.env.LLM_MODEL = 'llama3.1';
  assert.equal((await get('/api/status')).aiEnabled, true);
  const lc = await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{"force":true}' }).then((x) => x.json());
  assert.equal(lc.posts[0].text, 'Local model post');
  assert.equal(compatReq.url, '/v1/chat/completions');
  assert.equal(compatReq.auth, undefined, 'no key header when LLM_API_KEY is unset');
  assert.equal(compatReq.body.model, 'llama3.1');
  assert.equal(compatReq.body.messages[0].role, 'system');
  fakeCompat.close(); delete process.env.LLM_BASE_URL; delete process.env.LLM_MODEL;
  process.env.ANTHROPIC_API_KEY = savedKey; process.env.ANTHROPIC_API_URL = savedUrl;

  // Image route: private hosts blocked by default, allowed (for this test) when opted in
  const blocked = await fetch(`${api}/api/items/${camp.id}/image`);
  assert.equal(blocked.status, 502, 'unreachable image host is reported, not crashed');
  const { fetchImage } = await import('../lib/image.js');
  await assert.rejects(fetchImage(base + '/img.png'), /not allowed/);
  process.env.ALLOW_PRIVATE_IMAGES = '1';
  const img = await fetchImage(base + '/img.png');
  assert.equal(img.type, 'image/png');
  await assert.rejects(fetchImage(base + '/notimg'), /Not an image/);

  const csrf = await fetch(`${api}/api/refresh`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(csrf.status, 403);
  assert.equal((await fetch(`${api}/../../etc/passwd`)).status, 404);

  srv.close(); mock.close();
});
