// Turns a chatbot reply ("1. **Story-led** ... 2. **Lesson-led** ... 3. ...") into separate post options.
// Pure functions, so they can be tested in Node without a browser.
const MARKER = /^[ \t]*(?:#{1,3}[ \t]*)?(?:\*\*)?[ \t]*(?:option|post)?[ \t]*([1-3])[ \t]*[.):\-][ \t]*(?:\*\*)?[ \t]*([^\n]*)$/gim;

const clean = (s) => s.replace(/\*\*/g, '').replace(/^\s*[-_*]{3,}\s*$/gm, '').replace(/\r\n/g, '\n').trim();

export function parseChatPosts(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const marks = [...text.matchAll(MARKER)];
  // Only trust numbering if it runs 1, 2, (3) in order.
  const ordered = marks.filter((m, i) => Number(m[1]) === i + 1);
  if (ordered.length < 2) return [{ angle: 'Pasted post', text: clean(text) }].filter((p) => p.text);
  return ordered.map((m, i) => {
    const end = i + 1 < ordered.length ? ordered[i + 1].index : text.length;
    // The marker line may be just the angle ("1. **Story-led**") or already the first line of the post.
    const head = clean(m[2]).replace(/[:.]$/, '');
    const rest = text.slice(m.index + m[0].length, end);
    const looksLikeLabel = head.length > 0 && head.length <= 40 && !/[.!?]$/.test(m[2].trim()) && rest.trim().length > 0;
    return looksLikeLabel
      ? { angle: head, text: clean(rest) }
      : { angle: ['Story-led', 'Lesson-led', 'Question-led'][i] || `Option ${i + 1}`, text: clean(`${m[2]}\n${rest}`) };
  }).filter((p) => p.text);
}

// A picture-card headline taken from the user's own post: its first line, at most 12 words. Nothing is invented.
export function headlineFrom(text) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const words = first.split(/\s+/);
  return words.length > 12 ? words.slice(0, 12).join(' ') + '…' : first;
}

// One-tap photo-search suggestions taken from a headline: its proper names, minus marketing filler words.
const FILLER = new Set(('brand brands campaign campaigns launches launch launched appoints appoint appointed unveils unveil introduces introduce announces announce channels channel first new years year ' +
  'ambassador marketing magazine how why what who when where the and for with from into over says say said gets get gives give goes go makes make takes take returns return brings bring ' +
  'its their this that these those answer answers questions toughest most best top big new next last one two three four five six seven eight nine ten monday tuesday wednesday thursday friday saturday sunday ' +
  'january february march april may june july august september october november december india indian global world ads ad advertising film films ad-film jingle').split(/\s+/));
const SMALL = /^(by|as|of|in|on|at|to|for|with|from|the|a|an|and|or|vs|is|are|its|ki|ka|ke|ko|se|mein|hai|aur)$/i;

export function brandTerms(title, source = '') {
  const src = new Set(String(source).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const words = String(title || '').replace(/[“”"]/g, ' ').replace(/[‘’]/g, "'").split(/\s+/);
  const out = []; let run = [];
  const flush = () => { if (run.length) out.push((run.length > 3 ? run.slice(0, 2) : run).join(' ')); run = []; };
  for (const raw of words) {
    const w = raw.replace(/[:,;!?()]+$/g, '').replace(/^[('"]+/, '').replace(/['"]+$/, '');
    const possessive = /'s$/i.test(w);
    const bare = w.replace(/'s$/i, '').replace(/[.'-]+$/, '');
    const isName = /^[A-Z0-9][\p{L}\p{N}&'.-]*$/u.test(bare) && !FILLER.has(bare.toLowerCase()) && !SMALL.test(bare) && !src.has(bare.toLowerCase()) && bare.length > 1;
    if (isName) run.push(bare); else flush();
    if (possessive || /[:,;]$/.test(raw)) flush();
  }
  flush();
  return [...new Set(out)].filter((t) => t.length > 2).slice(0, 5);
}
