import { promises as fs } from 'node:fs';
import path from 'node:path';
import { articleText } from './rss.js';
import { fetchText } from './util.js';
import { loadAiCache, saveAiCache } from './store.js';

const API = () => process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

// House style, distilled from the author's reference post: curiosity hook, one idea per line,
// a turn near the end, then a short contrast line that names the real lesson.
const STYLE = `Write ONE LinkedIn post. It must be crisp and on point, never a wall of text.

Format:
- 110 to 170 words. 12 to 20 short lines. A blank line between lines or pairs of lines, so it scans on a phone.
- Line 1 is a hook that makes people curious in under 100 characters. Specific, not a generic claim. It must work before the "see more" fold.
- One idea per line. Plain, spoken English. Contractions are fine. British spelling.
- Shape: hook, what the brand actually did (facts only), the turn ("And that's the part most people miss"), the real lesson, then a short contrast line such as "Everyone talks about X. Very few notice Y."
- Emphasise one to three words in CAPS at most. At most one emoji, usually none. No hashtags. No em dashes. No bullet symbols; use short lines instead.
- Finish with one human line or a real question. Not "Thoughts?".
- The last line is "Source: <publisher name>".

Never use: "In today's fast-paced world", "game-changer", "let's dive in", "here's the thing", "unlock", "leverage", "delve", "masterclass", "ever-evolving".

Truth rules:
- Use only facts present in the SOURCE. No invented numbers, quotes, results, budgets, agencies or intent.
- Do not invent personal experiences. Do not say the author was there, met anyone or bought anything. Write as someone who read about it and has a point of view: "I came across...", "What stood out to me...".
- If the source is thin, make the post about the one clear move and the lesson, and say less rather than guess.`;

async function voiceExamples() {
  const file = process.env.VOICE_FILE || path.join(process.cwd(), 'voice', 'my-posts.md');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.split(/^---\s*$/m).map((s) => s.trim()).filter((s) => s.length > 120 && !s.startsWith('Paste ')).slice(0, 5).map((s) => s.slice(0, 1800));
  } catch { return []; }
}

async function callClaude(system, user, maxTokens = 1400) {
  const res = await fetch(API(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
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
  return `SOURCE (publisher: ${item.source}; published: ${item.publishedAt || 'unknown'}; url: ${item.url})
HEADLINE: ${item.title}
FEED SUMMARY: ${item.summary || '(none)'}
${body ? `ARTICLE TEXT (excerpt):\n${body}` : ''}`;
}

export async function writePost(item, force = false) {
  const key = `post:${item.id}`;
  const cache = await loadAiCache();
  if (!force && cache[key]) return cache[key];
  const examples = await voiceExamples();
  const system = `You ghost-write LinkedIn posts for an Indian marketing professional.
${STYLE}
${examples.length ? `\nHere are real past posts by the author. Match their rhythm, vocabulary and tone. Do not reuse their content:\n\n${examples.map((e, i) => `EXAMPLE ${i + 1}:\n${e}`).join('\n\n')}\n` : ''}
${force ? 'Take a different angle from the usual one.' : ''}
Also write text for a square-ish picture card that goes with the post: a headline of at most 12 words that states the single sharpest takeaway, and a subline of at most 14 words. Same truth rules.
Return ONLY JSON: {"post":"","card":{"headline":"","subline":""}}`;
  const out = await callClaude(system, await sourceBundle(item));
  const val = { post: String(out.post || '').trim(), card: out.card || null, model: MODEL(), generatedAt: new Date().toISOString() };
  const next = await loadAiCache();
  next[key] = val;
  await saveAiCache(next);
  return val;
}
