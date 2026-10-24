import { drawCreative } from './creatives.js';

const $ = (id) => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const age = (iso) => { const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000); return h < 1 ? 'Just now' : h < 24 ? `${h} h ago` : h < 48 ? 'Yesterday' : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const safeUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol) ? u : '#'; } catch { return '#'; } };

(async function main() {
  let data;
  try { const r = await fetch('/api/public/sample'); if (!r.ok) throw new Error(); data = await r.json(); }
  catch { $('state').textContent = 'The sample could not be loaded right now. Please try again in a moment.'; return; }
  if (data.empty || !data.posts?.length) { $('state').textContent = 'Today\'s sample is not ready yet. Check back in a little while.'; return; }

  $('state').hidden = true; $('out').hidden = false;
  const h = data.headline;
  $('meta').textContent = `${h.source} · ${age(h.publishedAt)} · Marketing`;
  $('title').textContent = h.title;
  $('orig').href = safeUrl(h.url);
  $('how').textContent = data.by === 'ai'
    ? 'These three drafts were written by the AI from the headline above, using only what the source reports. Yours will follow your own style samples.'
    : 'These are the outlines you get for every story: the headline is filled in and the [brackets] are where your own view goes. With the AI switched on, the drafts are written out in full.';

  let cur = 0;
  const show = (i) => {
    cur = i;
    [...$('tabs').children].forEach((b, n) => { b.classList.toggle('on', n === i); b.setAttribute('aria-selected', String(n === i)); });
    $('post').textContent = data.posts[i].text;
    $('count').textContent = `${data.posts[i].text.length} characters`;
  };
  data.posts.forEach((p, i) => { const b = el('button', 'chip', `${i + 1}. ${p.angle}`); b.type = 'button'; b.setAttribute('role', 'tab'); b.onclick = () => show(i); $('tabs').append(b); });
  show(0);
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(data.posts[cur].text); $('copy').textContent = 'Copied'; }
    catch { const r = document.createRange(); r.selectNodeContents($('post')); getSelection().removeAllRanges(); getSelection().addRange(r); $('copy').textContent = 'Press Ctrl/Cmd+C'; }
    setTimeout(() => { $('copy').textContent = 'Copy this post'; }, 2000);
  };

  try { await document.fonts.ready; } catch { /* draw with the fallback font */ }
  const headline = data.posts[0].card?.headline || h.title, subline = data.posts[0].card?.subline || '';
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--mkt').trim() || data.color;
  for (const [id, label] of [['ink', 'Midnight'], ['accent', 'Colour block']]) {
    try {
      const canvas = drawCreative({ template: id, size: 'portrait', headline, subline, source: h.source, author: '', accent });
      const foot = el('div', 'pic-foot'); foot.append(el('b', '', label));
      const dl = el('button', 'btn ghost', 'Download'); dl.type = 'button';
      dl.onclick = () => canvas.toBlob((b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${id}-sample.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png');
      foot.append(dl);
      const box = el('div', 'pic'); box.append(canvas, foot); $('pics').append(box);
    } catch { /* the graphic is a bonus; the drafts above are the point */ }
  }
})();
