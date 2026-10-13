import { loadAiCache, saveAiCache } from './store.js';

// Illustrative stock photos for a story. Queries are built ONLY from generic topic words
// (never from brand or people names), so results are never mistaken for the campaign itself.
const TOPICS = [
  [/airline|airways|flight|airport|travel|tourism|hotel|resort/i, 'travel airplane'],
  [/ice cream|food|restaurant|cafe|coffee|snack|beverage|drink|brew|dessert|chocolate/i, 'food and drink'],
  [/\bcars?\b|automobile|\bev\b|electric vehicle|motor|scooter|\bbikes?\b/i, 'car on road'],
  [/bank|fintech|payment|\bupi\b|credit card|insurance|loan|invest/i, 'finance payment'],
  [/smartphone|\bapp\b|mobile|software|\bai\b|artificial intelligence|tech\b/i, 'technology smartphone'],
  [/fashion|apparel|clothing|footwear|jewel|sneaker|denim/i, 'fashion style'],
  [/beauty|skincare|cosmetic|perfume|fragrance|makeup|hair/i, 'beauty skincare'],
  [/cookware|kitchen|furniture|appliance|\bhome\b/i, 'home kitchen'],
  [/cricket|\bipl\b|football|sport|olympic|fitness|gym|athlete/i, 'sports stadium'],
  [/festival|diwali|holi|eid|christmas|wedding|celebrat/i, 'festival celebration'],
  [/retail|store|shop|ecommerce|e-commerce|mall|marketplace/i, 'shopping retail'],
  [/music|film|movie|cinema|\bott\b|streaming|bollywood|series|concert/i, 'cinema entertainment'],
  [/health|pharma|wellness|hospital|medical/i, 'wellness health'],
  [/education|school|college|learning|student/i, 'students education'],
];
const BY_TAG = { activation: 'event crowd stage', casestudy: 'team strategy meeting', digital: 'social media smartphone', ai: 'technology abstract', trend: 'consumer shopping', launch: 'product launch', campaign: 'advertising billboard city' };

export function stockQueries(item) {
  const text = `${item.title} ${item.summary || ''}`.slice(0, 400);
  const topic = TOPICS.find(([re]) => re.test(text))?.[1];
  const tag = (item.tags || []).map((t) => BY_TAG[t]).find(Boolean) || (item.kind === 'news' ? 'business team' : BY_TAG.campaign);
  return [...new Set([topic, tag, 'marketing creative team'].filter(Boolean))].slice(0, 2);
}

const pexelsUrl = () => process.env.PEXELS_API_URL || 'https://api.pexels.com/v1/search';
const openverseUrl = () => process.env.OPENVERSE_API_URL || 'https://api.openverse.org/v1/images/';

async function getJson(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'TheMarketingBrief/1.0', accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

async function searchOne(query) {
  if (process.env.PEXELS_API_KEY) {
    const d = await getJson(`${pexelsUrl()}?query=${encodeURIComponent(query)}&per_page=8`, { authorization: process.env.PEXELS_API_KEY });
    return { source: 'Pexels', photos: (d.photos || []).map((p) => ({
      url: p.src?.large2x || p.src?.large || p.src?.original, thumb: p.src?.medium || p.src?.small,
      credit: `Photo by ${p.photographer} on Pexels`, license: 'Pexels License (free to use)', landing: p.url,
    })) };
  }
  const d = await getJson(`${openverseUrl()}?q=${encodeURIComponent(query)}&page_size=8&category=photograph&license_type=commercial`);
  return { source: 'Openverse', photos: (d.results || []).map((r) => ({
    url: r.url, thumb: r.thumbnail || r.url,
    credit: r.attribution || `"${r.title || 'Photo'}" by ${r.creator || 'unknown'} (${String(r.license || '').toUpperCase()} ${r.license_version || ''})`.trim(),
    license: `${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), landing: r.foreign_landing_url,
  })) };
}

// Results are cached for a day so each query is only looked up once.
export async function findStock(item) {
  const queries = stockQueries(item);
  const key = `stock:${process.env.PEXELS_API_KEY ? 'pexels' : 'openverse'}:${queries.join('|')}`;
  const cache = await loadAiCache();
  if (cache[key] && Date.now() - cache[key].at < 86_400_000) return cache[key].value;
  const seen = new Set(); let photos = [], source = '';
  for (const q of queries) {
    const r = await searchOne(q);
    source = r.source;
    for (const p of r.photos) if (p.url && !seen.has(p.url)) { seen.add(p.url); photos.push(p); }
    if (photos.length >= 8) break;
  }
  const value = { source, queries, photos: photos.slice(0, 8) };
  const next = await loadAiCache();
  next[key] = { at: Date.now(), value };
  await saveAiCache(next);
  return value;
}
