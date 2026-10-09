import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

// Test-only fixtures served from a local mock; none of this ships as site content.
const feed = (items) => `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel>${items.map((i) => `<item><title>${i.t}</title><link>${i.l}</link><pubDate>${new Date(Date.now() - i.ago * 3600e3).toUTCString()}</pubDate><description>${i.d || 'Fixture description long enough to be kept as the summary text here.'}</description>${i.img ? `<media:content url="${i.img}" medium="image"/>` : ''}</item>`).join('')}</channel></rss>`;

test('refresh → dedupe → API → portfolio', async () => {
  const mock = http.createServer((req, res) => {
    if (req.url === '/a') res.end(feed([
      { t: 'Fixtureco launches Spring campaign film', l: 'http://127.0.0.1:' + mock.address().port + '/p/1?utm_source=a', ago: 2, img: 'https://img.test/1.jpg' },
      { t: 'Old story', l: 'http://127.0.0.1:' + mock.address().port + '/p/old', ago: 24 * 200 },
    ]));
    else if (req.url === '/b') res.end(feed([
      { t: 'Fixtureco unveils Spring campaign film', l: 'http://127.0.0.1:' + mock.address().port + '/p/dup', ago: 1 },
      { t: 'Case study: how Otherco grew', l: 'http://127.0.0.1:' + mock.address().port + '/p/cs', ago: 5 },
    ]));
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

  // Without an API key: analysis refuses, posts fall back to honest scaffolds.
  const an = await fetch(`${api}/api/items/${camp.id}/analysis`, { method: 'POST', body: '{}' });
  assert.equal(an.status, 501);
  const posts = await fetch(`${api}/api/items/${camp.id}/posts`, { method: 'POST', body: '{}' }).then((x) => x.json());
  assert.equal(posts.scaffold, true);

  // Portfolio round trip + cross-origin guard
  const put = await fetch(`${api}/api/portfolio/${camp.id}`, { method: 'PUT', body: JSON.stringify({ post: 'hello', breakdown: { idea: 'i' } }) });
  assert.equal(put.status, 200);
  assert.equal((await get('/api/portfolio')).entries.length, 1);
  const md = await fetch(`${api}/api/portfolio/export.md`).then((x) => x.text());
  assert.match(md, /Spring campaign/);
  const csrf = await fetch(`${api}/api/refresh`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(csrf.status, 403);
  assert.equal((await fetch(`${api}/../../etc/passwd`)).status, 404);

  srv.close(); mock.close();
});
