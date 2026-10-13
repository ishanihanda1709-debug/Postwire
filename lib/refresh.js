import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseFeed, parseMeta } from './rss.js';
import { classify, detectRegion } from './classify.js';
import { loadStore, saveStore } from './store.js';
import { BROWSER_UA, canonicalUrl, cleanPublisher, fetchText, jaccard, looksLikeThumbnail, pool, sha, titleTokens, truncate } from './util.js';

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
  return m ? { title: m[1], publisher: cleanPublisher(m[2]) } : { title, publisher: null };
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

  // Tidy publisher names stored by earlier runs (for example a web address used as the name).
  for (const i of Object.values(items)) {
    i.source = cleanPublisher(i.source);
    for (const a of i.also || []) a.source = cleanPublisher(a.source);
    if (i.image) i.image.credit = cleanPublisher(i.image.credit);
  }

  // Enrich: look in the article page for a photo (og:image), a better summary and a video.
  // Newest stories first, including ones from earlier runs that are still missing a photo.
  const recent = Date.now() - 7 * DAY;
  const candidates = Object.values(items)
    .filter((i) => !i.via && Date.parse(i.publishedAt || 0) > recent && (i.pageTries || 0) < 3
      && (!i.image || (looksLikeThumbnail(i.image.url) && !i.imageUpgraded) || i.summary.length < 60))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 100);
  const photos = { tried: candidates.length, found: 0, noPhotoOnPage: 0, failed: 0, reasons: {} };
  await pool(candidates, 6, async (i) => {
    i.pageTries = (i.pageTries || 0) + 1;
    try {
      const { text, finalUrl } = await fetchText(i.url, { timeout: 6000, maxBytes: 400_000, headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.8' } });
      const meta = parseMeta(text, finalUrl);
      if (meta.image && (!i.image || (looksLikeThumbnail(i.image.url) && !i.imageUpgraded))) {
        i.image = { url: meta.image, credit: i.image?.credit || i.source };
        i.imageUpgraded = true; photos.found++;
      } else if (!meta.image && !i.image) photos.noPhotoOnPage++;
      if (i.summary.length < 60 && meta.description) i.summary = truncate(meta.description, 420);
      if (!i.video && meta.video) i.video = meta.video;
    } catch (e) {
      photos.failed++;
      const why = String(e.message || e).replace(/[0-9a-f]{16,}/g, '');
      photos.reasons[why] = (photos.reasons[why] || 0) + 1;
    }
  });
  if (photos.tried) console.log(`Photos: looked at ${photos.tried} stories, found ${photos.found}, ${photos.noPhotoOnPage} pages have no usable photo, ${photos.failed} pages could not be opened`, Object.keys(photos.reasons).length ? photos.reasons : '');

  // Prune old items.
  const keepAfter = Date.now() - KEEP_DAYS * DAY;
  for (const [id, i] of Object.entries(items)) {
    const t = Date.parse(i.publishedAt || i.firstSeenAt);
    if (t < keepAfter) delete items[id];
  }

  store.updatedAt = new Date().toISOString();
  store.lastRun = { durationMs: Date.now() - started, new: newCount, merged, total: Object.keys(items).length, photos };
  await saveStore(store);
  return store.lastRun;
}
