const $ = (s, r = document) => r.querySelector(s);
const state = { view: 'trending', region: 'all', q: '', offset: 0, status: null, cur: null };
const PAGE = 18;

// Text is always set via textContent, never innerHTML.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  const token = sessionStorage.getItem('mb-token');
  if (token) headers['x-access-token'] = token;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const t = window.prompt('Access token required:');
    if (t) { sessionStorage.setItem('mb-token', t); return api(path, opts); }
  }
  if (!res.ok && !data.post) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not given';
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

// ---------- feed ----------
function card(item, hot) {
  const media = h('div', { class: 'media' });
  if (item.image) {
    const img = h('img', { src: item.image.url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(h('div', { class: 'ph', text: item.source })));
    media.append(img);
  } else media.append(h('div', { class: 'ph', text: item.source }));
  if (hot) media.append(h('span', { class: 'hot', text: `Covered by ${item.also.length + 1} outlets` }));
  return h('button', { class: 'card', type: 'button', onclick: () => openItem(item) }, media,
    h('div', { class: 'body' }, h('h3', { text: item.title }),
      h('div', { class: 'meta' }, h('b', { text: item.source }), ' · ', fmtDate(item.publishedAt), item.region === 'india' ? ' · India' : '')));
}

function query() {
  const p = new URLSearchParams({ limit: PAGE, offset: state.offset });
  if (state.view === 'trending') p.set('sort', 'trending'); else p.set('kind', state.view);
  if (state.region !== 'all') p.set('region', state.region);
  if (state.q) p.set('q', state.q);
  return p;
}

async function loadStatus() {
  const s = await api('/api/status'); state.status = s;
  $('#dot').className = 'dot ' + (s.refreshing ? 'busy' : s.updatedAt ? 'ok' : '');
  $('#status-text').textContent = s.refreshing ? 'Refreshing…' : s.updatedAt ? `Updated ${ago(s.updatedAt)}` : 'Not refreshed yet';
  return s;
}

async function reload() { state.offset = 0; $('#grid').replaceChildren(); await loadPage(); }

async function loadPage() {
  const { items, total } = await api('/api/items?' + query());
  const grid = $('#grid');
  items.forEach((i) => grid.append(card(i, state.view === 'trending' && i.also?.length)));
  state.offset += items.length;
  $('#more').hidden = state.offset >= total;
  if (!grid.children.length) grid.append(emptyState());
}

function emptyState() {
  const s = state.status;
  if (s && !s.updatedAt) return h('div', { class: 'empty' }, h('h3', { text: 'Fetching your first stories…' }), 'This takes under a minute.');
  if (state.q || state.region !== 'all') return h('div', { class: 'empty' }, h('h3', { text: 'Nothing matches' }), 'Try a broader search.');
  const bad = (s?.sources || []).filter((x) => x.ok === false);
  return h('div', { class: 'empty' }, h('h3', { text: 'No stories yet' }),
    bad.length ? `${bad.length} of ${s.sources.length} sources failed. First error: ${bad[0].name}: ${bad[0].error}. Fix or disable them in sources.json.` : 'Press Refresh to fetch stories.');
}

// ---------- story panel ----------
async function openItem(item) {
  const cur = { item, token: Math.random() }; state.cur = cur;
  $('#modal').hidden = false; document.body.style.overflow = 'hidden';
  render(cur, { post: '', loading: true });
  $('#close').focus();
  await loadPost(cur, false);
}

async function loadPost(cur, force) {
  render(cur, { post: cur.post ?? '', loading: true, keep: !!cur.post });
  try {
    const r = await api(`/api/items/${cur.item.id}/post`, { method: 'POST', body: { force } });
    if (state.cur !== cur) return;
    cur.post = r.post; cur.card = r.card; cur.scaffold = !!r.scaffold; cur.error = r.error;
    render(cur, { post: cur.post });
  } catch (e) { toast(e.message); render(cur, { post: cur.post || '' }); }
}

function render(cur, { post, loading }) {
  const { item } = cur;
  const ta = h('textarea', { id: 'post', 'aria-label': 'LinkedIn post', placeholder: loading ? 'Writing your post…' : '' });
  ta.value = post; ta.addEventListener('input', () => { cur.post = ta.value; $('#cc').textContent = `${ta.value.length} characters`; });
  const ai = state.status?.aiEnabled;
  $('#sheet-body').replaceChildren(
    h('h2', { id: 'm-title', text: item.title }),
    h('p', { class: 'facts' }, h('b', { text: item.source }), ` · ${fmtDate(item.publishedAt)} · `, h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: 'Read the original ↗' })),
    h('div', { class: 'cols' },
      h('div', {},
        h('h4', { text: 'Your LinkedIn post' }),
        !ai ? h('div', { class: 'notice', text: 'This is an outline, not a finished post. To get a full post written in your voice, start the app with ANTHROPIC_API_KEY set (see README).' }) : null,
        cur.error ? h('div', { class: 'notice', text: 'The AI call failed, so this is the outline instead: ' + cur.error }) : null,
        ta,
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: !!loading, onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied. Paste it into LinkedIn.'); } catch { ta.select(); toast('Press Ctrl/Cmd+C to copy'); } }, text: 'Copy post' }),
          ai ? h('button', { class: 'btn ghost', disabled: !!loading, onclick: () => loadPost(cur, true), text: '↻ Another version' }) : null,
          h('span', { class: 'muted grow', id: 'cc', text: `${post.length} characters` }))),
      h('div', {}, h('h4', { text: 'Pictures for your post' }), h('div', { class: 'pics', id: 'pics' }))));
  if (!loading) renderPics(cur);
}

function renderPics(cur) {
  const { item } = cur, box = $('#pics');
  const headline = cur.card?.headline || item.title;
  const subline = cur.card?.subline || '';
  const author = state.status?.author || '';
  const add = (title, canvas, name, note) => {
    box.append(h('div', { class: 'pic' }, canvas, h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => canvas.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png'), text: `Download ${title}` }),
      h('span', { class: 'cap', text: note }))));
  };
  const imgUrl = `/api/items/${item.id}/image`;
  const done = (src) => {
    add('text card', drawCard({ headline, subline, source: item.source, author }), 'text-card.png', 'Your own graphic. Free to post.');
    if (src) add('photo card', drawCard({ headline, subline, source: item.source, author, photo: src }), 'photo-card.png', `Uses the publisher's image (${item.image.credit}). Credit them in your post.`);
  };
  if (!item.image) { done(null); return; }
  const img = new Image();
  img.onload = () => {
    done(img);
    box.append(h('div', { class: 'pic' }, h('img', { src: imgUrl, alt: '' }), h('div', { class: 'row' },
      h('a', { class: 'btn ghost', href: imgUrl + '?download=1', text: 'Download original image' }),
      h('span', { class: 'cap', text: `Image: ${item.image.credit}. Belongs to the publisher. Credit them or check usage rights before posting.` }))));
  };
  img.onerror = () => done(null);
  img.src = imgUrl;
}

// 1080x1350 (LinkedIn portrait). Text and layout are drawn here; nothing is invented.
function drawCard({ headline, subline, source, author, photo }) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const serif = '"Fraunces", Georgia, serif', sans = 'Inter, system-ui, sans-serif';
  x.fillStyle = '#14110f'; x.fillRect(0, 0, W, H);
  if (photo) {
    const r = Math.max(W / photo.width, (H * 0.55) / photo.height), pw = photo.width * r, ph = photo.height * r;
    x.save(); x.beginPath(); x.rect(0, 0, W, H * 0.55); x.clip(); x.drawImage(photo, (W - pw) / 2, (H * 0.55 - ph) / 2, pw, ph); x.restore();
    const g = x.createLinearGradient(0, H * 0.35, 0, H * 0.58); g.addColorStop(0, 'rgba(20,17,15,0)'); g.addColorStop(1, '#14110f'); x.fillStyle = g; x.fillRect(0, H * 0.35, W, H * 0.23);
  }
  x.fillStyle = '#e5381f'; x.fillRect(80, photo ? 760 : 150, 90, 10);
  x.fillStyle = '#f1ece3'; x.textBaseline = 'top';
  const top = photo ? 800 : 190, size = headline.length > 70 ? 66 : headline.length > 45 ? 78 : 92;
  x.font = `900 ${size}px ${serif}`;
  let y = wrap(x, headline, 80, top, W - 160, size * 1.08);
  if (subline) { x.fillStyle = '#a39a8c'; x.font = `400 36px ${sans}`; wrap(x, subline, 80, y + 28, W - 160, 50); }
  x.fillStyle = '#a39a8c'; x.font = `600 28px ${sans}`;
  x.fillText(`Source: ${source}`.toUpperCase().slice(0, 48), 80, H - 120);
  if (author) { x.textAlign = 'right'; x.fillStyle = '#f1ece3'; x.fillText(author, W - 80, H - 120); x.textAlign = 'left'; }
  return c;
}
function wrap(x, text, left, top, max, lh) {
  let line = '', y = top;
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > max && line) { x.fillText(line, left, y); y += lh; line = w; } else line = t;
  }
  x.fillText(line, left, y); return y + lh;
}

function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; state.cur = null; }

// ---------- wiring ----------
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.view = b.dataset.v; document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); reload(); });
$('#region').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.region = b.dataset.r; document.querySelectorAll('#region button').forEach((x) => x.classList.toggle('on', x === b)); reload(); });
let debounce; $('#q').addEventListener('input', (e) => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = e.target.value.trim(); reload(); }, 250); });
$('#more').addEventListener('click', loadPage);
$('#close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

async function pollRefresh() {
  for (let i = 0; i < 60; i++) {
    const s = await loadStatus();
    if (!s.refreshing) { await reload(); return; }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
$('#refresh').addEventListener('click', async () => { await api('/api/refresh', { method: 'POST' }); toast('Refreshing…'); pollRefresh(); });

(async function init() {
  const s = await loadStatus();
  await reload();
  if (s.refreshing || !s.updatedAt) pollRefresh();
  setInterval(async () => {
    const prev = state.status?.updatedAt; const n = await loadStatus();
    if (n.updatedAt !== prev && $('#modal').hidden) { reload(); toast('New stories loaded'); }
  }, 5 * 60_000);
})();
