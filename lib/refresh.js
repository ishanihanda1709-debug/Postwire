import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFeed } from './rss.js';
import { classify, detectRegion } from './classify.js';
import { loadStore, saveStore } from './store.js';
import { canonicalUrl, cleanPublisher, fetchText, jaccard, pool, sha, titleTokens, truncate } from './util.js';

const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 14);
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 30);
const SIMILARITY = 0.6;
const DAY = 86_400_000;

export async function loadSources() {
  const file = process.env.SOURCES_FILE || path.join(process.cwd(), 'sources.json');
  return JSON.parse(await fs.readFile(file, 'utf8')).sources.filter((s) => s.enabled !== false).map((s) => ({ domain: 'marketing', ...s }));
}

// Google News titles look like "Headline - Publisher"; split so we can credit the real publisher.
function splitAggregator(title) {
  const m = title.match(/^(.*\S)\s+-\s+([^-]{2,60})$/);
  const publisher = m ? cleanPublisher(m[2]) : null;
  return m && publisher && !/https?:|news\.google\./i.test(publisher) ? { title: m[1], publisher } : { title, publisher: null };
}

let running = null;

export function refreshAll() {
  if (running) return running;
  running = doRefresh().finally(() => { running = null; });
  return running;
}
export const isRefreshing = () => !!running;

// What we keep per story: headline, publisher, link, date and the feed's own short summary (the summary is only
// ever used as input for writing posts; it is not shown). We never copy publishers' photos or full articles.
async function doRefresh() {
  const started = Date.now();
  const sources = await loadSources();
  const store = await loadStore();
  const cutoff = Date.now() - MAX_AGE_DAYS * DAY;
  const fresh = [];

  await pool(sources, 6, async (src) => {
    const status = { lastAttempt: new Date().toISOString(), name: src.name, region: src.region, domain: src.domain };
    try {
      const { text } = await fetchText(src.url);
      const parsed = parseFeed(text);
      if (!parsed.length) throw new Error('Feed parsed but contained no items');
      let added = 0;
      for (const p of parsed) {
        const t = p.publishedAt ? Date.parse(p.publishedAt) : null;
        if (t && t < cutoff) continue;
        let { title } = p;
        let publisher = null;
        if (src.aggregator) ({ title, publisher } = splitAggregator(p.title));
        const url = canonicalUrl(p.url);
        if (!url) continue;
        const { kind, tags } = classify({ ...p, title }, src);
        fresh.push({
          id: sha(src.domain === 'marketing' ? url : `${src.domain}|${url}`),
          title,
          url: p.url,
          canonical: url,
          source: publisher || src.name,
          sourceId: src.id,
          via: publisher ? src.name : null,
          domain: src.domain,
          region: detectRegion({ title, summary: p.summary }, src),
          publishedAt: t && t <= Date.now() + DAY ? new Date(t).toISOString() : null,
          summary: truncate(p.summary, 420),
          kind,
          tags,
        });
        added++;
      }
      Object.assign(status, { ok: true, lastOk: new Date().toISOString(), fetched: added, error: null });
    } catch (e) {
      Object.assign(status, { ok: false, error: String(e.message || e), lastOk: store.sources[src.id]?.lastOk || null, fetched: 0 });
    }
    store.sources[src.id] = status;
  });

  // Dedupe within each domain: exact canonical URL, then fuzzy headline match against stories already held.
  const items = store.items;
  for (const i of Object.values(items)) {   // tidy anything stored by earlier versions
    i.domain ||= 'marketing';
    delete i.image; delete i.video; delete i.pageTries; delete i.imageUpgraded;
    i.source = cleanPublisher(i.source);
    for (const a of i.also || []) a.source = cleanPublisher(a.source);
  }
  const bucket = Object.values(items).map((i) => ({ item: i, tok: titleTokens(i.title) }));
  let newCount = 0, merged = 0;
  fresh.sort((a, b) => (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0));
  for (const c of fresh) {
    if (items[c.id]) continue;
    const tok = titleTokens(c.title);
    const near = bucket.find((b) => {
      if (b.item.domain !== c.domain) return false;
      const sim = jaccard(tok, b.tok);
      return sim >= SIMILARITY && (b.item.source !== c.source || sim >= 0.9);
    });
    if (near) {
      const dup = near.item;
      dup.also = dup.also || [];
      if (!dup.also.some((a) => a.url === c.url) && dup.url !== c.url) {
        dup.also.push({ source: c.source, url: c.url, title: c.title });
        merged++;
      }
      continue;
    }
    c.firstSeenAt = new Date().toISOString();
    items[c.id] = c;
    bucket.push({ item: c, tok });
    newCount++;
  }

  // Prune old items.
  const keepAfter = Date.now() - KEEP_DAYS * DAY;
  for (const [id, i] of Object.entries(items)) {
    const t = Date.parse(i.publishedAt || i.firstSeenAt);
    if (t < keepAfter) delete items[id];
  }

  store.updatedAt = new Date().toISOString();
  const byDomain = {};
  for (const i of Object.values(items)) byDomain[i.domain] = (byDomain[i.domain] || 0) + 1;
  store.lastRun = { durationMs: Date.now() - started, new: newCount, merged, total: Object.keys(items).length, byDomain };
  await saveStore(store);
  return store.lastRun;
}
