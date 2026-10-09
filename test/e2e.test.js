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
  assert.equal((await get('/api/items?q=otherco')).total, 1);
  assert.equal((await get('/api/items?region=india')).total, 1);

  const status = await get('/api/status');
  assert.equal(status.sources.find((s) => s.id === 'bad').ok, false);
  assert.equal(status.aiEnabled, false);

  // Without an API key the post route returns an honest outline.
  const post0 = await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{}' }).then((x) => x.json());
  assert.equal(post0.scaffold, true);
  assert.match(post0.post, /Source: Outlet/);

  // With a key: mock the Anthropic endpoint, check prompt rules + caching.
  let calls = 0, lastBody;
  const fakeAi = http.createServer(async (rq, rs) => {
    calls++; let b = ''; for await (const c of rq) b += c; lastBody = JSON.parse(b);
    rs.setHeader('content-type', 'application/json');
    rs.end(JSON.stringify({ content: [{ type: 'text', text: '{"post":"Hook line\\n\\nSource: Outlet A","card":{"headline":"Sharp takeaway","subline":"Short line"}}' }] }));
  });
  await new Promise((ok) => fakeAi.listen(0, '127.0.0.1', ok));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${fakeAi.address().port}/v1/messages`;
  await fs.writeFile(path.join(dir, 'my-posts.md'), 'Paste one of your own\n\n---\n\n' + 'This is my real past post. '.repeat(10));
  process.env.VOICE_FILE = path.join(dir, 'my-posts.md');
  const withKey = await fetch(`${api}/api/items/${camp.id}/post`, { method: 'POST', body: '{}' }).then((x) => x.json());
  assert.equal(withKey.scaffold, undefined);
  assert.equal(withKey.card.headline, 'Sharp takeaway');
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
