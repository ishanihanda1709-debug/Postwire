import { articleText } from './rss.js';
import { fetchText } from './util.js';
import { loadAiCache, saveAiCache } from './store.js';

const API = 'https://api.anthropic.com/v1/messages';
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const STYLE = `Voice rules for LinkedIn drafts:
- Write like a thoughtful marketer talking to peers, in first person, plain words, varied sentence length.
- Open with a specific observation, not a greeting or a generic claim. No "In today's fast-paced world", "game-changer", "let's dive in", "here's the thing", "unlock", "leverage", "delve".
- No em dashes. No hashtag walls (max 3 at the end, optional). Emoji: none, or one at most.
- 90-180 words. Short paragraphs. End with a real question or a clear takeaway, not "thoughts?".
- Never invent facts, numbers, quotes, results or intent. Only use what is in the SOURCE below. Where the author's personal experience or opinion is needed, leave a [bracketed placeholder].
- Mention the source publication by name and keep the link line "Source: <url>".`;

async function callClaude(system, user, maxTokens = 1800) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || '').join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('Model returned no JSON');
  return JSON.parse(text.slice(a, b + 1));
}

async function sourceBundle(item) {
  let body = '';
  if (!item.via) {
    try {
      const { text } = await fetchText(item.url, { timeout: 8000, maxBytes: 600_000 });
      body = articleText(text);
    } catch { /* fall back to feed summary */ }
  }
  const basis = body.length > 600 ? 'article_text' : 'feed_summary_only';
  const bundle = `SOURCE (publisher: ${item.source}; published: ${item.publishedAt || 'unknown'}; url: ${item.url})
HEADLINE: ${item.title}
FEED SUMMARY: ${item.summary || '(none)'}
${body ? `ARTICLE TEXT (excerpt):\n${body}` : ''}`;
  return { bundle, basis };
}

async function cached(key, fn, force) {
  const cache = await loadAiCache();
  if (!force && cache[key]) return cache[key];
  const val = await fn();
  const next = await loadAiCache();
  next[key] = val;
  await saveAiCache(next);
  return val;
}

export function analyse(item, force = false) {
  return cached(`analysis:${item.id}`, async () => {
    const { bundle, basis } = await sourceBundle(item);
    const system = `You are a marketing strategist writing a case-study breakdown for a practitioner's personal notes. You are strict about evidence.
Rules:
- Every field must be grounded in the SOURCE. If the source does not say something, write exactly "Not stated in the source" for that field. Never guess brand intent, budgets, metrics, agencies or results.
- "why_it_worked" is the analyst's inference: only offer it if the source reports an outcome or the mechanism is evident; start with "Inference:" and be modest. Otherwise "Not stated in the source".
- Keep each field to 1-3 sentences.
Return ONLY JSON: {"idea":"","audience":"","strategy":"","execution":"","why_it_worked":"","things_to_verify":["..."],"confidence":"high|medium|low"}`;
    const out = await callClaude(system, bundle);
    return { ...out, basis, model: MODEL(), generatedAt: new Date().toISOString() };
  }, force);
}

export function writePosts(item, force = false) {
  return cached(`posts:${item.id}`, async () => {
    const { bundle } = await sourceBundle(item);
    const system = `You ghost-write LinkedIn post drafts for a marketing professional building a personal brand. ${STYLE}
Write 3 drafts with different angles: (1) a story-led observation, (2) a short lesson/takeaway list, (3) a respectful contrarian or question-led take.
Return ONLY JSON: {"posts":[{"angle":"","text":""}]}`;
    const out = await callClaude(system, bundle, 2000);
    return { posts: out.posts.slice(0, 3).map((p) => ({ ...p, generated: true })), model: MODEL(), generatedAt: new Date().toISOString() };
  }, force);
}
