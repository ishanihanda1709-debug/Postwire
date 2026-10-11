import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFeed, parseMeta } from './rss.js';
import { classify, detectRegion } from './classify.js';
import { loadStore, saveStore } from './store.js';
import { canonicalUrl, fetchText, jaccard, pool, sha, titleTokens, truncate } from './util.js';

const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 14);
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 120);
const SIMILARITY = 0.6;
const DAY = 86_400_000;

export async function loadSources() {
  const file = process.env.SOURCES_FILE || path.join(process.cwd(), 'sources.json');
  return JSON.parse(await fs.readFile(file, 'utf8')).sources.filter((s) => s.enabled !== false);
}

// Google News titles look like "Headline - Publisher"; split so we can credit the real publisher.
function splitAggregator(title) {
  const m = title.match(/^(.*\S)\s+-\s+([^-]{2,60})$/);
  return m ? { title: m[1], publisher: m[2] } : { title, publisher: null };
}

let running = null;

export function refreshAll() {
  if (running) return running;
  running = doRefresh().finally(() => { running = null; });
  return running;
}
export const isRefreshing = () => !!running;

async function doRefresh() {
  const started = Date.now();
  const sources = await loadSources();
  const store = await loadStore();
  const cutoff = Date.now() - MAX_AGE_DAYS * DAY;
  const fresh = [];

  await pool(sources, 5, async (src) => {
    const status = { lastAttempt: new Date().toISOString(), name: src.name, region: src.region };
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
          id: sha(url),
          title,
          url: p.url,
          canonical: url,
          source: publisher || src.name,
          sourceId: src.id,
          via: publisher ? src.name : null,
          region: detectRegion({ title, summary: p.summary }, src),
          publishedAt: t && t <= Date.now() + DAY ? new Date(t).toISOString() : null,
          summary: truncate(p.summary, 420),
          image: p.image ? { url: p.image, credit: publisher || src.name } : null,
          video: p.video,
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

  // Dedupe: exact canonical URL, then fuzzy title match against recent items.
  const items = store.items;
  const bucket = Object.values(items).map((i) => ({ item: i, tok: titleTokens(i.title) }));
  let newCount = 0, merged = 0;
  const newlyAdded = [];
  fresh.sort((a, b) => (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0));
  for (const c of fresh) {
    if (items[c.id]) {
      const ex = items[c.id];
      if (!ex.image && c.image) ex.image = c.image;
      if (!ex.video && c.video) ex.video = c.video;
      continue;
    }
    const tok = titleTokens(c.title);
    const near = bucket.find((b) => {
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
      if (!dup.image && c.image) dup.image = c.image;
      if (!dup.video && c.video) dup.video = c.video;
      continue;
    }
    c.firstSeenAt = new Date().toISOString();
    items[c.id] = c;
    bucket.push({ item: c, tok });
    newlyAdded.push(c);
    newCount++;
  }

  // Enrich: fetch og:image / description / video for new items that lack them.
  const needs = newlyAdded.filter((i) => !i.image || i.summary.length < 60 || !i.video).slice(0, 40);
  await pool(needs, 4, async (i) => {
    if (i.via) return; // aggregator links redirect through the aggregator; skip
    try {
      const { text, finalUrl } = await fetchText(i.url, { timeout: 8000, maxBytes: 400_000 });
      const meta = parseMeta(text, finalUrl);
      if (!i.image && meta.image) i.image = { url: meta.image, credit: i.source };
      if (i.summary.length < 60 && meta.description) i.summary = truncate(meta.description, 420);
      if (!i.video && meta.video) i.video = meta.video;
    } catch { /* enrichment is best-effort */ }
  });

  // Prune old items.
  const keepAfter = Date.now() - KEEP_DAYS * DAY;
  for (const [id, i] of Object.entries(items)) {
    const t = Date.parse(i.publishedAt || i.firstSeenAt);
    if (t < keepAfter) delete items[id];
  }

  store.updatedAt = new Date().toISOString();
  store.lastRun = { durationMs: Date.now() - started, new: newCount, merged, total: Object.keys(items).length };
  await saveStore(store);
  return store.lastRun;
}
