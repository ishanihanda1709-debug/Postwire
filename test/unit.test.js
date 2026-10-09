import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseMeta } from '../lib/rss.js';
import { canonicalUrl, jaccard, titleTokens } from '../lib/util.js';
import { classify, detectRegion } from '../lib/classify.js';
import { scaffoldPosts } from '../lib/drafts.js';

const RSS = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title><![CDATA[Brand X &amp; Y launch "Test" campaign]]></title><link>https://example.com/a?utm_source=rss</link>
<pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[<p>A <b>short</b> summary.</p>]]></description>
<media:content url="https://example.com/i.jpg" medium="image"/>
<content:encoded><![CDATA[<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>]]></content:encoded></item>
<item><title>No link</title></item>
<item><title>Javascript link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test('parses RSS, strips HTML, decodes entities, drops bad links', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Brand X & Y launch "Test" campaign');
  assert.equal(items[0].summary, 'A short summary.');
  assert.equal(items[0].image, 'https://example.com/i.jpg');
  assert.deepEqual(items[0].video, { provider: 'youtube', id: 'abcdefghijk' });
  assert.equal(items[0].publishedAt, '2026-10-06T08:00:00.000Z');
});

test('parses Atom', () => {
  const atom = `<feed><entry><title>Hi there</title><link rel="alternate" href="https://e.com/p"/><published>2026-10-01T00:00:00Z</published><summary>S</summary></entry></feed>`;
  const [i] = parseFeed(atom);
  assert.equal(i.url, 'https://e.com/p');
});

test('canonicalUrl removes tracking and normalises', () => {
  assert.equal(canonicalUrl('https://www.Example.com/a/?utm_source=x&b=1#frag'), 'https://example.com/a?b=1');
  assert.equal(canonicalUrl('ftp://x.com'), null);
});

test('title similarity detects same story across outlets', () => {
  const a = titleTokens('Zomato launches new brand campaign ahead of Diwali');
  const b = titleTokens('Zomato unveils Diwali brand campaign');
  const c = titleTokens('Google updates search ranking systems');
  assert.ok(jaccard(a, b) >= 0.5);
  assert.ok(jaccard(a, c) < 0.2);
});

test('classification only uses what the text says', () => {
  const src = { defaultKind: 'news', region: 'global' };
  assert.equal(classify({ title: 'Case study: how a brand grew 3x' }, src).kind, 'casestudy');
  assert.equal(classify({ title: 'Brand launches new campaign film' }, src).kind, 'campaign');
  assert.equal(classify({ title: 'Quarterly earnings call notes' }, src).kind, 'news');
  assert.equal(detectRegion({ title: 'Amul unveils new ad' }, src), 'india');
  assert.equal(detectRegion({ title: 'Nike unveils new ad' }, src), 'global');
});

test('parseMeta extracts og tags and resolves relative image', () => {
  const m = parseMeta('<meta property="og:image" content="/img/x.jpg"><meta name="description" content="Desc">', 'https://e.com/a');
  assert.equal(m.image, 'https://e.com/img/x.jpg');
  assert.equal(m.description, 'Desc');
});

test('scaffold posts: three angles, no unsourced facts', () => {
  const ps = scaffoldPosts({ title: 'T', source: 'S', url: 'https://e.com' });
  assert.equal(ps.length, 3);
  assert.equal(new Set(ps.map((p) => p.angle)).size, 3);
  for (const p of ps) { assert.match(p.text, /\[/); assert.match(p.text, /Source: S$/); assert.doesNotMatch(p.text, /\d{2,}/); }
});
