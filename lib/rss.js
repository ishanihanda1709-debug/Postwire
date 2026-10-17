import { decodeEntities, stripHtml, safeHttpUrl } from './util.js';

const unwrap = (s) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? unwrap(m[1]).trim() : '';
}

function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4]);
  return out;
}

function tagsWithAttrs(block, name) {
  const re = new RegExp(`<${name}\\b([^>]*?)/?>`, 'gi');
  return [...block.matchAll(re)].map((m) => attrs(m[1]));
}

export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  const items = [];
  for (const b of blocks) {
    const title = stripHtml(tag(b, 'title'));
    let link = '';
    if (isAtom) {
      const links = tagsWithAttrs(b, 'link');
      link = (links.find((l) => !l.rel || l.rel === 'alternate') || links[0] || {}).href || '';
    } else {
      link = stripHtml(tag(b, 'link')) || (tagsWithAttrs(b, 'link')[0] || {}).href || '';
    }
    const url = safeHttpUrl(link.trim());
    if (!title || !url) continue;
    const body = tag(b, 'content:encoded') || tag(b, 'content') || tag(b, 'description') || tag(b, 'summary');
    const rawDate = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const t = Date.parse(rawDate);
    items.push({
      title,
      url,
      publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
      summary: stripHtml(tag(b, 'description') || tag(b, 'summary') || body),
      categories: [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => stripHtml(unwrap(m[1]))).filter(Boolean),
    });
  }
  return items;
}

export function articleText(html, max = 7000) {
  const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
  const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripHtml(m[1])).filter((p) => p.length > 40);
  return paras.join('\n').slice(0, max);
}
