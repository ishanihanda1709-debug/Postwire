import { parseChatPosts, headlineFrom } from './parse.js';
const $ = (s, r = document) => r.querySelector(s);
const state = { view: 'trending', region: 'all', q: '', offset: 0, status: null, cur: null, seed: 0, seen: new Set(), shown: [] };
// Stories the user hid with "Not for me". Stored in this browser only.
let saved = new Map();
let dismissed = new Set();
try { dismissed = new Set(JSON.parse(localStorage.getItem('mb-hidden') || '[]')); } catch { /* storage unavailable */ }
const saveHidden = () => { try { localStorage.setItem('mb-hidden', JSON.stringify([...dismissed].slice(-600))); } catch { /* ignore */ } };
const PAGE = 18;
const phClass = (s) => 'ph c' + ([...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 4);
const phBox = (item) => h('div', { class: phClass(item.source), text: item.source });

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
    if (t) {
      sessionStorage.setItem('mb-token', t);
      document.cookie = `mb_token=${encodeURIComponent(t)}; path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;  // lets downloads and images carry it too
      return api(path, opts);
    }
  }
  if (!res.ok && !data.posts) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, action) {
  const t = $('#toast'); t.replaceChildren(msg);
  if (action) t.append(' ', h('button', { class: 'linkbtn inv', type: 'button', text: action.label, onclick: () => { action.run(); t.hidden = true; } }));
  t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), action ? 6000 : 2600);
}
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
    img.addEventListener('error', () => img.replaceWith(phBox(item)));
    media.append(img);
  } else media.append(phBox(item));
  if (hot) media.append(h('span', { class: 'hot', text: `Covered by ${item.also.length + 1} outlets` }));
  const main = h('button', { class: 'card', type: 'button', onclick: () => openItem(item) }, media,
    h('div', { class: 'body' }, h('h3', { text: item.title }),
      h('div', { class: 'meta' }, h('b', { text: item.source }), ' · ', fmtDate(item.publishedAt), item.region === 'india' ? ' · India' : '')));
  const wrap = h('div', { class: 'cardw' }, main,
    h('button', { class: 'skip', type: 'button', title: 'Not for me: hide this story', 'aria-label': `Hide: ${item.title}`, text: '✕', onclick: () => hideItem(item, wrap) }));
  return wrap;
}

function hideItem(item, el) {
  dismissed.add(item.id); saveHidden(); el.remove();
  state.offset = Math.max(0, state.offset - 1);
  updateReset();
  toast('Hidden. It won\'t show again.', { label: 'Undo', run: () => { dismissed.delete(item.id); saveHidden(); updateReset(); reload(); } });
  if (!$('#grid').children.length) reload();
}

function updateReset() {
  const b = $('#reset'); b.hidden = dismissed.size === 0;
  b.textContent = `Show ${dismissed.size} hidden ${dismissed.size === 1 ? 'story' : 'stories'} again`;
}

function query() {
  const p = new URLSearchParams({ limit: PAGE, offset: state.offset });
  if (state.view === 'trending') p.set('sort', 'trending'); else p.set('kind', state.view);
  if (state.region !== 'all') p.set('region', state.region);
  if (state.q) p.set('q', state.q);
  if (state.seed) p.set('shuffle', state.seed);
  const ex = [...dismissed, ...(state.seed ? state.seen : [])].slice(-500);
  if (ex.length) p.set('exclude', ex.join(','));
  return p;
}

async function loadStatus() {
  const s = await api('/api/status'); state.status = s;
  $('#dot').className = 'dot ' + (s.refreshing ? 'busy' : s.updatedAt ? 'ok' : '');
  $('#status-text').textContent = s.refreshing ? 'Refreshing…' : s.updatedAt ? `Updated ${ago(s.updatedAt)}${s.nextRefresh ? ` · next ${s.nextRefresh}` : ''}` : 'Not refreshed yet';
  const ai = $('#ai'); ai.textContent = s.aiEnabled ? '✦ AI connected' : 'AI not connected'; ai.className = 'ai' + (s.aiEnabled ? '' : ' off');
  ai.title = s.aiEnabled ? 'Posts are written by the AI' : 'Add ANTHROPIC_API_KEY to a .env file and restart to get finished posts';
  return s;
}

async function reload() { state.offset = 0; state.shown = []; $('#grid').replaceChildren(); await loadPage(); }

// "Show me different ones": new random set from the best matches, never repeating what was already shown or hidden.
async function shuffle() {
  const prev = [...state.shown];
  state.shown.forEach((id) => state.seen.add(id));
  state.seed = Math.floor(Math.random() * 2 ** 31) + 1;
  await reload();
  const count = () => document.querySelectorAll('#grid .cardw').length;
  if (count() < PAGE / 2 && state.seen.size) {
    // Fresh stories are running low: keep what is on screen out, and mix earlier ones back in.
    state.seen = new Set([...prev, ...state.shown]);
    state.seed = Math.floor(Math.random() * 2 ** 31) + 1;
    await reload();
    toast('Fresh ones are running low, mixing in earlier stories.');
  }
}

async function loadPage() {
  const { items, total } = await api('/api/items?' + query());
  const grid = $('#grid');
  items.forEach((i) => { state.shown.push(i.id); grid.append(card(i, state.view === 'trending' && i.also?.length)); });
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
  render(cur, { loading: true });
  $('#close').focus();
  await loadPost(cur, false);
}

async function loadPost(cur, force) {
  render(cur, { loading: true });
  try {
    const r = await api(`/api/items/${cur.item.id}/post`, { method: 'POST', body: { force } });
    if (state.cur !== cur) return;
    cur.posts = r.posts; cur.scaffold = !!r.scaffold; cur.error = r.error; cur.active = 0;
    render(cur, {});
  } catch (e) { toast(e.message); render(cur, {}); }
}

function render(cur, { loading }) {
  const { item } = cur, posts = cur.posts || [], active = cur.active || 0, ai = state.status?.aiEnabled;
  const ta = h('textarea', { id: 'post', 'aria-label': 'LinkedIn post', placeholder: loading ? 'Writing your post options…' : '' });
  ta.value = posts[active]?.text || '';
  ta.addEventListener('input', () => { posts[active].text = ta.value; $('#cc').textContent = `${ta.value.length} characters`; if (isSaved(cur)) { clearTimeout(cur.t); cur.t = setTimeout(() => putSaved(cur), 600); } });
  $('#sheet-body').replaceChildren(
    h('h2', { id: 'm-title', text: item.title }),
    h('p', { class: 'facts' }, h('b', { text: item.source }), ` · ${fmtDate(item.publishedAt)} · `, h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: 'Read the original ↗' })),
    h('div', { class: 'cols' },
      h('div', {},
        h('h4', { text: loading ? 'Writing your post options…' : `Your LinkedIn post · ${posts.length} options` }),
        !ai ? freeBox(cur) : null,
        ai && !state.status?.voiceCount ? h('div', { class: 'notice', text: 'Tip: add 3 or more of your own posts under "My style" so these sound like you.' }) : null,
        cur.error ? h('div', { class: 'notice', text: 'The AI call failed, so these are outlines instead: ' + cur.error }) : null,
        h('div', { class: 'opts', role: 'tablist' }, posts.map((p, i) => h('button', { class: 'chip' + (i === active ? ' on' : ''), type: 'button', role: 'tab', text: `${i + 1}. ${p.angle}`, onclick: () => { cur.active = i; render(cur, {}); } }))),
        ta,
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: !posts.length, onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied. Paste it into LinkedIn.'); } catch { ta.select(); toast('Press Ctrl/Cmd+C to copy'); } }, text: 'Copy this post' }),
          ai ? h('button', { class: 'btn ghost', disabled: !!loading, onclick: () => loadPost(cur, true), text: '↻ More options' }) : null,
          h('button', { class: 'heart' + (isSaved(cur) ? ' on' : ''), type: 'button', id: 'heart', disabled: !posts.length, 'aria-pressed': String(isSaved(cur)), onclick: () => toggleSave(cur, ta), text: isSaved(cur) ? '♥ Saved' : '♡ Save this post' }),
          h('span', { class: 'muted grow', id: 'cc', text: `${ta.value.length} characters` }))),
      h('div', {}, h('h4', { text: 'Pictures for your post' }), h('div', { class: 'pics', id: 'pics' }))));
  if (!loading) renderPics(cur);
}

// No-key flow: copy a prompt for a free chatbot, then paste its answer back to get three editable options.
function freeBox(cur) {
  const { item } = cur;
  const copy = h('button', { class: 'btn ghost', type: 'button', text: '1. Copy prompt for a free chatbot', onclick: async () => {
    try { const { prompt } = await api(`/api/items/${item.id}/prompt`, { method: 'POST', body: {} }); await navigator.clipboard.writeText(prompt); toast('Prompt copied. Paste it into Claude.ai, ChatGPT or Gemini.'); }
    catch (e) { toast(e.message || 'Could not copy the prompt'); }
  } });
  if (!cur.pasting) {
    return h('div', { class: 'notice' }, cur.pasted ? 'Using the posts you pasted. Edit them below.' : 'These are outlines. For finished posts at no cost, use a free chatbot: ',
      h('div', { class: 'row' }, copy, h('button', { class: 'btn ghost', type: 'button', text: '2. Paste the answer', onclick: () => { cur.pasting = true; render(cur, {}); } })));
  }
  const ta = h('textarea', { id: 'paste-in', 'aria-label': 'Paste the chatbot answer', style: 'min-height:160px', placeholder: 'Paste the chatbot\'s whole answer here…' });
  return h('div', { class: 'notice' }, 'Paste the chatbot\'s answer. It is split into separate options automatically.', ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Use these posts', onclick: () => {
        const parsed = parseChatPosts(ta.value);
        if (!parsed.length) { toast('Nothing to use yet. Paste the chatbot answer first.'); return; }
        cur.posts = parsed.map((p) => ({ angle: p.angle, text: p.text, card: { headline: headlineFrom(p.text), subline: '' } }));
        cur.active = 0; cur.pasting = false; cur.pasted = true; cur.scaffold = false; render(cur, {});
        toast(`${parsed.length} ${parsed.length === 1 ? 'post' : 'options'} ready.`);
      } }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => { cur.pasting = false; render(cur, {}); } })));
}

function renderPics(cur) {
  Promise.race([document.fonts.load('800 80px "Bricolage Grotesque"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}).then(() => { if (state.cur === cur) drawPics(cur); });
}

function drawPics(cur) {
  const { item } = cur, box = $('#pics');
  box.replaceChildren();
  const card = cur.posts?.[cur.active || 0]?.card;
  const headline = card?.headline || item.title;
  const subline = card?.subline || '';
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
  const disp = '"Bricolage Grotesque", "Arial Black", sans-serif', sans = '"DM Sans", system-ui, sans-serif';
  x.fillStyle = '#3b4bff'; x.fillRect(0, 0, W, H);
  if (photo) {
    const r = Math.max(W / photo.width, (H * 0.5) / photo.height), pw = photo.width * r, ph = photo.height * r;
    x.save(); x.beginPath(); x.rect(0, 0, W, H * 0.5); x.clip(); x.drawImage(photo, (W - pw) / 2, (H * 0.5 - ph) / 2, pw, ph); x.restore();
    x.fillStyle = '#0b0b1e'; x.fillRect(0, H * 0.5 - 6, W, 12);
  }
  x.textBaseline = 'top';
  const top = photo ? 760 : 170, size = headline.length > 70 ? 64 : headline.length > 45 ? 78 : 94;
  if (!photo) { x.fillStyle = '#ffd43b'; x.fillRect(80, 110, 120, 16); }
  x.fillStyle = '#ffffff'; x.font = `800 ${size}px ${disp}`;
  const y = wrap(x, headline, 80, top, W - 160, size * 1.05);
  if (subline) { x.fillStyle = '#dfe2ff'; x.font = `500 38px ${sans}`; wrap(x, subline, 80, y + 26, W - 160, 52); }
  x.fillStyle = '#ffd43b'; x.fillRect(0, H - 150, W, 150);
  x.fillStyle = '#0b0b1e'; x.font = `700 28px ${sans}`; x.textBaseline = 'middle';
  x.fillText(`SOURCE: ${source}`.toUpperCase().slice(0, 40), 80, H - 75);
  if (author) { x.textAlign = 'right'; x.fillText(author, W - 80, H - 75); x.textAlign = 'left'; }
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

// ---------- saved posts ----------
const savedKey = (cur) => `${cur.item.id}|${cur.posts?.[cur.active || 0]?.angle}`;
const isSaved = (cur) => saved.has(savedKey(cur));
async function putSaved(cur) {
  const p = cur.posts[cur.active || 0];
  const e = await api('/api/saved', { method: 'PUT', body: { itemId: cur.item.id, angle: p.angle, text: p.text } });
  saved.set(savedKey(cur), e); updateSavedCount();
}
async function toggleSave(cur, ta) {
  const p = cur.posts[cur.active || 0];
  if (isSaved(cur)) {
    await api('/api/saved/' + saved.get(savedKey(cur)).id, { method: 'DELETE' });
    saved.delete(savedKey(cur)); toast('Removed from saved');
  } else { p.text = ta.value; await putSaved(cur); toast('Saved. Find it under ♥ Saved.'); }
  updateSavedCount(); render(cur, {});
}
async function loadSaved() {
  const { entries } = await api('/api/saved');
  saved = new Map(entries.map((e) => [`${e.itemId}|${e.angle}`, e])); updateSavedCount(); return entries;
}
const updateSavedCount = () => { $('#saved-n').textContent = saved.size || ''; };
async function renderSaved() {
  const entries = await loadSaved();
  const box = $('#saved');
  const linkedin = (t) => 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(t);
  box.replaceChildren(
    h('div', { class: 'saved-head' }, h('h2', { text: 'Saved posts' }), h('span', { class: 'muted grow', text: `${entries.length} saved` }),
      entries.length ? h('a', { class: 'btn ghost', href: '/api/saved/export.md', download: 'saved-posts.md', text: 'Export all (.md)' }) : null),
    entries.length ? h('div', { class: 'saved-list' }, entries.map((e) => h('article', { class: 'sv' },
      h('span', { class: 'tag', text: e.angle }),
      h('h3', { text: e.item.title }),
      h('div', { class: 'meta' }, h('b', { text: e.item.source }), ' · ', fmtDate(e.item.publishedAt), ' · ', h('a', { href: e.item.url, target: '_blank', rel: 'noopener noreferrer', text: 'original ↗' })),
      h('pre', { text: e.text }),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(e.text); toast('Copied'); } catch { toast('Copy failed. Select the text instead.'); } }, text: 'Copy' }),
        h('a', { class: 'btn ghost', href: linkedin(e.text), target: '_blank', rel: 'noopener noreferrer', title: "Opens LinkedIn's post box with this text. You review and post it yourself.", text: 'Open in LinkedIn ↗' }),
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await api('/api/saved/' + e.id, { method: 'DELETE' }); renderSaved(); }, text: 'Delete' }))))
    ) : h('div', { class: 'empty' }, h('h3', { text: 'Nothing saved yet' }), 'Open a story and press ♡ Save this post. Saved posts live here so you can copy or share them later.'));
}

// ---------- my style (sample posts) ----------
async function renderStyle() {
  const { posts } = await api('/api/voice');
  $('#style-n').textContent = posts.length || '';
  const ta = h('textarea', { id: 'style-in', 'aria-label': 'Paste one of your LinkedIn posts', placeholder: 'Paste one of your own LinkedIn posts here, exactly as you posted it…' });
  const add = h('button', { class: 'btn', type: 'button', text: 'Add to my style', onclick: async () => {
    try { await api('/api/voice', { method: 'POST', body: { text: ta.value } }); toast('Added. New posts will follow this style.'); renderStyle(); }
    catch (e) { toast(e.message); }
  } });
  $('#style').replaceChildren(
    h('div', { class: 'style-box' },
      h('h2', { text: 'My style' }),
      h('p', { text: 'Paste 3 to 6 of your own LinkedIn posts, one at a time. The app copies your rhythm, tone and word choices, not your content. Stories you already opened keep their old posts until you press "More options".' }),
      ta, h('div', { class: 'row' }, add, h('span', { class: 'muted', text: `${posts.length} saved${posts.length >= 3 ? '' : ' · 3 or more works best'}` }))),
    h('div', { class: 'style-list' }, posts.map((p) => h('article', { class: 'sp' }, h('pre', { text: p.text }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Delete', onclick: async () => { await api('/api/voice/' + p.id, { method: 'DELETE' }); renderStyle(); } })))));
}

function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; state.cur = null; }

// ---------- wiring ----------
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.view = b.dataset.v; resetShuffle(); document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); showView(); });
$('#region').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.region = b.dataset.r; resetShuffle(); document.querySelectorAll('#region button').forEach((x) => x.classList.toggle('on', x === b)); reload(); });
let debounce; $('#q').addEventListener('input', (e) => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = e.target.value.trim(); resetShuffle(); reload(); }, 250); });
function showView() {
  const other = ['saved', 'style'].includes(state.view);
  // 'more' and 'reset' visibility is managed by loadPage/updateReset, so only force them hidden here.
  for (const id of ['grid', 'shuffle', 'region']) $('#' + id).hidden = other;
  $('#q').closest('.search').hidden = other;
  if (other) { $('#more').hidden = true; $('#reset').hidden = true; }
  $('#saved').hidden = state.view !== 'saved';
  $('#style').hidden = state.view !== 'style';
  if (state.view === 'saved') renderSaved();
  else if (state.view === 'style') renderStyle();
  else { updateReset(); reload(); }
}
const resetShuffle = () => { state.seed = 0; state.seen = new Set(); };
$('#shuffle').addEventListener('click', shuffle);
$('#reset').addEventListener('click', () => { dismissed = new Set(); saveHidden(); updateReset(); reload(); });
$('#more').addEventListener('click', loadPage);
$('#close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

async function pollRefresh() {
  for (let i = 0; i < 60; i++) {
    const s = await loadStatus();
    if (!s.refreshing) { resetShuffle(); await reload(); return; }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
$('#refresh').addEventListener('click', async () => { await api('/api/refresh', { method: 'POST' }); toast('Refreshing…'); pollRefresh(); });

(async function init() {
  const s = await loadStatus();
  updateReset();
  await loadSaved();
  await reload();
  if (s.refreshing || !s.updatedAt) pollRefresh();
  setInterval(async () => {
    const prev = state.status?.updatedAt; const n = await loadStatus();
    if (n.updatedAt !== prev && $('#modal').hidden) { reload(); toast('New stories loaded'); }
  }, 5 * 60_000);
})();
