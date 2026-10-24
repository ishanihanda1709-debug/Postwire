// The public "See a sample" page: one real, fresh headline with three drafts and a graphic, no login needed.
// Written once a day (by the AI when it is switched on, otherwise as the usual outline), then reused for everyone.
import { loadStore, loadSample, saveSample } from './store.js';
import { aiEnabled, writePost } from './ai.js';
import { scaffoldPosts } from './drafts.js';
import { DOMAINS } from './domains.js';

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

// The best story of the day from Marketing: covered by several outlets, recent, and a campaign if there is one.
function pickItem(store, freshDays) {
  const oldest = Date.now() - freshDays * DAY;
  const score = (i) => (i.also?.length || 0) * 3 + (i.kind === 'campaign' ? 1.5 : 0) - Math.max(0, (Date.now() - Date.parse(i.publishedAt || i.firstSeenAt)) / DAY) * 0.8;
  return Object.values(store.items)
    .filter((i) => (i.domain || 'marketing') === 'marketing' && i.publishedAt && Date.parse(i.publishedAt) >= oldest && /^https?:/i.test(i.url))
    .sort((a, b) => score(b) - score(a))[0] || null;
}

let inflight = null;
export function getSample(freshDays = 3) {
  inflight ||= build(freshDays).finally(() => { inflight = null; });
  return inflight;
}

async function build(freshDays) {
  const saved = await loadSample();
  // Reuse today's AI-written sample; an outline-only one is rebuilt (cheap) so it improves as soon as AI is switched on.
  if (saved && saved.day === today() && (saved.by === 'ai' || !aiEnabled())) return saved;
  const store = await loadStore();
  const item = pickItem(store, freshDays);
  if (!item) return null;
  let posts, by = 'outline';
  if (aiEnabled()) {
    try {
      const out = await writePost({ ...item, domain: 'marketing' }, { id: 'sample' }, false);
      posts = out.posts.map((p) => ({ angle: p.angle, text: p.text, card: p.card || null }));
      by = 'ai';
    } catch (e) { console.warn(`Sample drafts by AI failed, showing outlines: ${e.message}`); }
  }
  posts ||= scaffoldPosts(item).map((p) => ({ angle: p.angle, text: p.text, card: null }));
  const value = {
    day: today(), by, domain: 'marketing', color: DOMAINS.marketing.color,
    headline: { title: item.title, source: item.source, url: item.url, publishedAt: item.publishedAt },
    posts,
  };
  await saveSample(value);
  return value;
}
