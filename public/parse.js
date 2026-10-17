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
