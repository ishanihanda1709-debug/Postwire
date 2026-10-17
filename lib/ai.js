import { articleText } from './rss.js';
import { fetchText } from './util.js';
import { loadAiCache, saveAiCache, loadVoice, lock } from './store.js';
import { domainOf } from './domains.js';

const API = () => process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
// Two ways to connect an AI: Anthropic (ANTHROPIC_API_KEY), or any OpenAI-compatible endpoint
// (LLM_BASE_URL + LLM_MODEL, plus LLM_API_KEY if the provider needs one). The second covers free tiers and local models such as Ollama.
const compat = () => !!process.env.LLM_BASE_URL;
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY || compat();
const MODEL = () => (compat() ? process.env.LLM_MODEL : process.env.ANTHROPIC_MODEL) || 'claude-sonnet-5-5';

// House style, distilled from the author's reference post: curiosity hook, one idea per line,
// a turn near the end, then a short contrast line that names the real lesson.
const STYLE = `Write ONE LinkedIn post. It must be crisp and on point, never a wall of text.

Format:
- 110 to 170 words. 12 to 20 short lines. A blank line between lines or pairs of lines, so it scans on a phone.
- Line 1 is a hook that makes people curious in under 100 characters. Specific, not a generic claim. It must work before the "see more" fold.
- One idea per line. Plain, spoken English. Contractions are fine. British spelling.
- Shape: hook, what actually happened (facts only: who did what), the turn ("And that's the part most people miss"), the real lesson, then a short contrast line such as "Everyone talks about X. Very few notice Y."
- Emphasise one to three words in CAPS at most. At most one emoji, usually none. No hashtags. No em dashes. No bullet symbols; use short lines instead.
- Finish with one human line or a real question. Not "Thoughts?".
- The last line is "Source: <publisher name>".

Never use: "In today's fast-paced world", "game-changer", "let's dive in", "here's the thing", "unlock", "leverage", "delve", "masterclass", "ever-evolving".

Truth rules:
- Use only facts present in the SOURCE. No invented numbers, quotes, results, budgets, agencies or intent.
- Do not invent personal experiences. Do not say the author was there, met anyone or bought anything. Write as someone who read about it and has a point of view: "I came across...", "What stood out to me...".
- If the source is thin, make the post about the one clear move and the lesson, and say less rather than guess.`;

export async function voiceCount(userId) { return (await voiceExamples(userId)).length; }

// The user's own pasted posts (from "My style"), newest first. Each user only ever sees their own.
async function voiceExamples(userId) {
  const pasted = (await loadVoice()).posts.filter((p) => p.userId === userId).map((p) => p.text.trim()).filter((t) => t.length > 80).reverse();
  return pasted.slice(0, 6).map((s) => s.slice(0, 1800));
}

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('Model returned no JSON. Small models sometimes struggle here: try "More options" or a larger model.');
  try { return JSON.parse(text.slice(a, b + 1)); } catch { throw new Error('Model returned broken JSON. Try "More options" or a larger model.'); }
}

async function callLLM(system, user, maxTokens = 1400) {
  if (compat()) {
    if (!process.env.LLM_MODEL) throw new Error('LLM_MODEL is not set (the model name your provider uses).');
    const res = await fetch(`${process.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(process.env.LLM_API_KEY ? { authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
      body: JSON.stringify({ model: process.env.LLM_MODEL, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`AI provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return extractJson(data.choices?.[0]?.message?.content || '');
  }
  const res = await fetch(API(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return extractJson((data.content || []).map((b) => b.text || '').join(''));
}

async function sourceBundle(item) {
  let body = '';
  // Reading the full article is off by default (headline + the feed's own summary are enough and keep us clear of
  // copying publishers' pages). Set FETCH_ARTICLE_TEXT=1 to give the AI more to work with.
  if (process.env.FETCH_ARTICLE_TEXT === '1' && !item.via) {
    try {
      const { text } = await fetchText(item.url, { timeout: 8000, maxBytes: 600_000 });
      body = articleText(text);
    } catch { /* fall back to feed summary */ }
  }
  return `SOURCE (publisher: ${item.source}; published: ${item.publishedAt || 'unknown'}; url: ${item.url})
HEADLINE: ${item.title}
FEED SUMMARY: ${item.summary || '(none)'}
${body ? `ARTICLE TEXT (excerpt):\n${body}` : ''}`;
}

function instructions(examples, force, domain) {
  const d = domainOf(domain);
  return `${STYLE.replace('Write ONE LinkedIn post.', 'Write THREE different LinkedIn posts about the same story. Each one follows the rules below.')}

The three posts must take clearly different angles:
1. "Story-led": tell the move as a tight mini story.
2. "Lesson-led": open with the takeaway, then show the evidence from the source.
3. "Question-led": open with a sharp question or a respectful contrarian view, then answer it.
${examples.length ? `\nHere are real past posts by the author. Match their rhythm, vocabulary and tone. Do not reuse their content:\n\n${examples.map((e, i) => `EXAMPLE ${i + 1}:\n${e}`).join('\n\n')}\n` : ''}
${force ? 'These are a second round: use different hooks and wording from the obvious ones.' : ''}
${d.guidance}`;
}

// For people without an API key: a complete prompt to paste into any chatbot (Claude.ai, ChatGPT, Gemini...).
export async function buildChatPrompt(item, user) {
  const examples = await voiceExamples(user.id);
  return `You ghost-write LinkedIn posts for ${domainOf(item.domain).persona}.

${instructions(examples, false, item.domain)}

Reply with the three posts only, numbered 1 to 3, each starting with its angle in bold. No commentary.

${await sourceBundle(item)}`;
}

const cacheKey = (item, user) => `posts:${user.id}:${item.id}`;
export async function hasCachedPost(item, user) { return !!(await loadAiCache())[cacheKey(item, user)]; }

export async function writePost(item, user, force = false) {
  const key = cacheKey(item, user);
  const cache = await loadAiCache();
  if (!force && cache[key]) return cache[key];
  const examples = await voiceExamples(user.id);
  const system = `You ghost-write LinkedIn posts for ${domainOf(item.domain).persona}.
${instructions(examples, force, item.domain)}
For each post also write text for a picture card: a headline of at most 12 words with the sharpest takeaway, and a subline of at most 14 words. Same truth rules.
Return ONLY JSON: {"posts":[{"angle":"","post":"","card":{"headline":"","subline":""}}]}`;
  const out = await callLLM(system, await sourceBundle(item), 3200);
  const posts = (out.posts || []).slice(0, 3).map((p) => ({ angle: String(p.angle || 'Option'), text: String(p.post || '').trim(), card: p.card || null })).filter((p) => p.text);
  if (!posts.length) throw new Error('Model returned no posts');
  const val = { posts, model: MODEL(), generatedAt: new Date().toISOString() };
  await lock(async () => {
    const next = await loadAiCache();
    next[key] = val;
    const old = Date.now() - 14 * 86_400_000;   // keep the cache small: drop anything older than two weeks
    for (const [k, v] of Object.entries(next)) if (Date.parse(v?.generatedAt || 0) < old) delete next[k];
    await saveAiCache(next);
  });
  return val;
}
