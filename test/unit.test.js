import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseMeta } from '../lib/rss.js';
import { canonicalUrl, jaccard, titleTokens, cleanPublisher, looksLikeThumbnail } from '../lib/util.js';
import { classify, detectRegion } from '../lib/classify.js';
import { scaffoldPosts } from '../lib/drafts.js';
import { parseTimes, isStale, nextLabel } from '../lib/schedule.js';
import { parseChatPosts, headlineFrom } from '../public/parse.js';

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

test('daily schedule: parsing, catch-up and next label (Asia/Kolkata)', () => {
  assert.deepEqual(parseTimes('9:00, 18:30,bad,25:00'), ['09:00', '18:30']);
  const T = ['09:00'];
  // 10:00 IST on 10 Oct = 04:30 UTC
  const now = new Date('2026-10-10T04:30:00Z');
  assert.equal(isStale('2026-10-09T05:00:00Z', T, now), true, 'last ran yesterday 10:30 IST, today 09:00 slot passed');
  assert.equal(isStale('2026-10-10T03:45:00Z', T, now), false, 'ran at 09:15 IST today');
  const early = new Date('2026-10-10T01:00:00Z'); // 06:30 IST, slot not yet reached
  assert.equal(isStale('2026-10-09T05:00:00Z', T, early), false);
  assert.equal(isStale('2026-10-08T00:00:00Z', T, early), true, 'older than 24h');
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
  const inline = parseChatPosts('Post 1: This is a full hook sentence that ends here.\nMore text.\nPost 2: Another full sentence for two.\nBody.');
  assert.equal(inline.length, 2); assert.match(inline[0].text, /^Post 1|This is a full hook/);
  const plain = parseChatPosts('Just one post with no numbering.\n\nSecond paragraph.');
  assert.equal(plain.length, 1); assert.equal(plain[0].angle, 'Pasted post');
  assert.deepEqual(parseChatPosts('   '), []);
  assert.equal(parseChatPosts('Numbers 1. in text only\nand 2 more lines').length, 1, 'a stray number is not a split');
});

test('headline comes from the user\'s own first line, capped at 12 words', () => {
  assert.equal(headlineFrom('\n\nShort hook\nmore'), 'Short hook');
  assert.equal(headlineFrom('one two three four five six seven eight nine ten eleven twelve thirteen'), 'one two three four five six seven eight nine ten eleven twelve…');
});

test('publisher names and thumbnail detection', () => {
  assert.equal(cleanPublisher('https://safariindia.com/'), 'safariindia.com');
  assert.equal(cleanPublisher('www.menafn.com'), 'menafn.com');
  assert.equal(cleanPublisher('Adweek'), 'Adweek');
  assert.equal(looksLikeThumbnail('https://x.com/thumb/123.cms?width=120'), true);
  assert.equal(looksLikeThumbnail('https://x.com/img-150x100.jpg'), true);
  assert.equal(looksLikeThumbnail('https://x.com/photos/big-campaign.jpg'), false);
});
