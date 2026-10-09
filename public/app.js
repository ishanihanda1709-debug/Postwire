const $ = (s, r = document) => r.querySelector(s);
const state = { view: 'all', region: 'all', category: '', q: '', offset: 0, status: null, current: null, portfolio: new Map() };
const PAGE = 24;
const KIND_LABEL = { campaign: 'Campaign', casestudy: 'Case study', news: 'News' };

// Safe element builder: text is always set via textContent, never innerHTML.
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
    const t = prompt('Access token required:');
    if (t) { sessionStorage.setItem('mb-token', t); return api(path, opts); }
  }
  if (!res.ok && !data.posts) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not given';
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

// ---------- media ----------
function mediaBox(item, { badge = true } = {}) {
  const box = h('div', { class: 'media' });
  if (item.image) {
    const img = h('img', { src: item.image.url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { img.replaceWith(placeholder(item)); });
    box.append(img);
  } else box.append(placeholder(item));
  if (badge) box.append(h('span', { class: 'badge', text: KIND_LABEL[item.kind] || 'News' }));
  if (item.video) box.append(h('span', { class: 'vid', text: '▶ VIDEO' }));
  return box;
}
const placeholder = (item) => h('div', { class: 'ph', text: item.source });

function card(item) {
  const el = h('button', { class: 'card', type: 'button', onclick: () => openItem(item.id) },
    mediaBox(item),
    h('div', { class: 'body' },
      h('h3', { text: item.title }),
      h('p', { class: 'sum', text: item.summary }),
      h('div', { class: 'meta' }, h('b', { text: item.source }), '·', fmtDate(item.publishedAt),
        item.region === 'india' ? h('span', { class: 'pill', text: 'India' }) : null,
        item.also?.length ? h('span', { class: 'pill', text: `+${item.also.length} outlets` }) : null)));
  return el;
}

// ---------- browse ----------
async function loadStatus() {
  const s = await api('/api/status');
  state.status = s;
  $('#dot').className = 'dot ' + (s.refreshing ? 'busy' : s.updatedAt ? 'ok' : '');
  $('#status-text').textContent = s.refreshing ? 'Refreshing sources…' : s.updatedAt ? `Updated ${ago(s.updatedAt)}` : 'Not refreshed yet';
  if (!$('#chips').children.length) {
    $('#chips').append(chip('', 'All topics'), ...Object.entries(s.categories).map(([k, v]) => chip(k, v)));
  }
  return s;
}
const chip = (key, label) => h('button', { class: 'chip' + (state.category === key ? ' on' : ''), 'data-c': key, type: 'button', text: label,
  onclick: () => { state.category = key; for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', c.dataset.c === key); reload(); } });

async function reload() {
  state.offset = 0;
  $('#grid').replaceChildren();
  await Promise.all([loadFeatured(), loadPage()]);
}

function params() {
  const p = new URLSearchParams({ limit: PAGE, offset: state.offset });
  if (['campaign', 'casestudy', 'news'].includes(state.view)) p.set('kind', state.view);
  if (state.region !== 'all') p.set('region', state.region);
  if (state.category) p.set('category', state.category);
  if (state.q) p.set('q', state.q);
  return p;
}

async function loadFeatured() {
  const box = $('#featured');
  if (state.q || state.category || state.view === 'news') { box.hidden = true; return; }
  const p = new URLSearchParams(); if (state.region !== 'all') p.set('region', state.region);
  const { items } = await api('/api/featured?' + p);
  if (!items.length) { box.hidden = true; return; }
  const [hero, ...rest] = items;
  box.replaceChildren(
    h('article', { class: 'hero', onclick: () => openItem(hero.id) },
      mediaBox(hero),
      h('span', { class: 'eyebrow', text: 'Featured · ' + (KIND_LABEL[hero.kind] || 'News') }),
      h('h2', { text: hero.title }),
      h('p', { text: hero.summary }),
      h('div', { class: 'meta' }, h('b', { text: hero.source }), '·', fmtDate(hero.publishedAt))),
    h('div', { class: 'side' }, rest.map(card)));
  box.hidden = false;
}

async function loadPage() {
  const { items, total } = await api('/api/items?' + params());
  const grid = $('#grid');
  items.forEach((i) => grid.append(card(i)));
  state.offset += items.length;
  $('#more').hidden = state.offset >= total;
  $('#list-count').textContent = `${total} ${total === 1 ? 'story' : 'stories'}`;
  $('#list-title').textContent = { all: 'Latest', campaign: 'Latest campaigns', casestudy: 'Case studies', news: 'Marketing news' }[state.view];
  if (!total && !grid.children.length) grid.append(emptyState());
}

function emptyState() {
  const s = state.status;
  if (s && !s.updatedAt) return h('div', { class: 'empty' }, h('h3', { text: 'Fetching your first stories…' }), 'The first refresh pulls from every source. This usually takes under a minute. Check the Sources tab if it stays empty.');
  if (state.q || state.category || state.region !== 'all') return h('div', { class: 'empty' }, h('h3', { text: 'Nothing matches those filters' }), 'Try a broader search or clear the topic filter.');
  const failed = s?.sources.filter((x) => x.ok === false).length;
  return h('div', { class: 'empty' }, h('h3', { text: 'No stories yet' }), failed ? `${failed} source(s) failed on the last refresh. Open the Sources tab to see why.` : 'Hit Refresh to fetch stories.');
}

// ---------- detail ----------
async function openItem(id) {
  const item = await api('/api/items/' + id);
  const saved = state.portfolio.get(id);
  state.current = { item, saved, posts: [], active: 0, breakdown: { ...(saved?.breakdown || {}) } };
  renderSheet();
  $('#modal').hidden = false; document.body.style.overflow = 'hidden';
  $('#close').focus();
  loadPosts(false);
}
function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; state.current = null; }

function videoBlock(v) {
  const thumb = v.provider === 'youtube' ? `https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/hqdefault.jpg` : null;
  const box = h('div', { class: 'media' });
  const play = () => {
    const src = v.provider === 'youtube' ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1` : `https://player.vimeo.com/video/${encodeURIComponent(v.id)}?autoplay=1`;
    box.replaceChildren(h('iframe', { src, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, style: 'width:100%;height:100%;border:0', title: 'Campaign video' }));
  };
  box.append(thumb ? h('img', { src: thumb, alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'ph', text: 'Video' }),
    h('button', { class: 'btn', style: 'position:absolute;inset:auto auto 12px 12px', onclick: play, text: '▶ Play video' }));
  return box;
}

function renderSheet() {
  const { item, saved } = state.current;
  const body = $('#sheet-body');
  const sourceBlock = h('div', {},
    h('span', { class: 'pill src', text: 'Sourced' }),
    h('span', { class: 'eyebrow', style: 'margin-left:8px', text: `${KIND_LABEL[item.kind]} · ${item.region === 'india' ? 'India' : 'Global'}` }),
    h('h2', { id: 'm-title', text: item.title }),
    h('p', { class: 'facts' }, h('b', { text: item.source }), item.via ? ` (via ${item.via})` : '', ` · Published ${fmtDate(item.publishedAt)} · `,
      h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: 'Read the original ↗' })),
    item.video ? videoBlock(item.video) : item.image ? mediaBox(item, { badge: false }) : null,
    item.image && !item.video ? h('div', { class: 'credit' }, `Image: ${item.image.credit}, via the original article. `, h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: 'Source' })) : null,
    item.video ? h('div', { class: 'credit', text: `Video embedded from ${item.video.provider === 'youtube' ? 'YouTube' : 'Vimeo'}; rights remain with the owner.` }) : null,
    item.summary ? h('p', { text: item.summary }) : null,
    item.also?.length ? h('div', { class: 'also' }, 'Also covered by: ', item.also.map((a, i) => [i ? ', ' : '', h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: a.source })])) : null);

  body.replaceChildren(sourceBlock, breakdownPanel(), postsPanel(), h('div', { class: 'row' },
    h('button', { class: 'btn', id: 'save-pf', onclick: saveToPortfolio, text: saved ? 'Update portfolio entry' : '★ Save to my portfolio' }),
    saved ? h('button', { class: 'btn ghost', onclick: removeFromPortfolio, text: 'Remove' }) : null));
}

function breakdownPanel() {
  const { item, breakdown } = state.current;
  const fields = [['idea', 'The idea'], ['audience', 'Target audience'], ['strategy', 'Strategy'], ['execution', 'Execution'], ['why', 'Why it worked']];
  const ai = state.current.analysis;
  const panel = h('div', { class: 'panel ai' },
    h('h3', {}, 'Case study breakdown', h('span', { class: 'pill gen', text: ai ? 'AI-generated' : 'Your notes' })),
    h('p', { class: 'note', text: ai
      ? `AI analysis based on ${ai.basis === 'article_text' ? 'the article text' : 'only the headline and feed summary (thin evidence)'} · confidence: ${ai.confidence}. "Not stated in the source" means the article didn't say. Edit anything below; verify before posting.`
      : state.status?.aiEnabled ? 'Generate an evidence-bound breakdown from the article, or write your own below. Fields the article does not cover are marked "Not stated in the source".' : 'AI analysis is off (no ANTHROPIC_API_KEY). Use these fields as your own breakdown worksheet; they save to your portfolio.' }),
    h('div', { class: 'bd' }, fields.map(([k, label]) => h('div', {}, h('h4', { text: label }),
      h('textarea', { 'data-k': k, rows: 3, oninput: (e) => { breakdown[k] = e.target.value; }, placeholder: 'Write your read here…' }, ))) ),
    ai?.things_to_verify?.length ? h('ul', { class: 'verify' }, h('li', { text: 'Verify: ' + ai.things_to_verify.join(' · ') })) : null,
    state.status?.aiEnabled ? h('div', { class: 'row' }, h('button', { class: 'btn sm', id: 'gen-bd', onclick: generateBreakdown, text: ai ? '↻ Regenerate' : '✦ Generate with AI' })) : null);
  panel.querySelectorAll('textarea').forEach((t) => { t.value = breakdown[t.dataset.k] || ''; });
  return panel;
}

async function generateBreakdown(e) {
  const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Reading the article…';
  try {
    const a = await api(`/api/items/${state.current.item.id}/analysis`, { method: 'POST', body: { force: !!state.current.analysis } });
    state.current.analysis = a;
    const map = { idea: a.idea, audience: a.audience, strategy: a.strategy, execution: a.execution, why: a.why_it_worked };
    Object.assign(state.current.breakdown, map);
    const old = $('.panel.ai'); old.replaceWith(breakdownPanel());
  } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '✦ Generate with AI'; }
}

function postsPanel() {
  const { posts, active, scaffold } = state.current;
  const panel = h('div', { class: 'panel', id: 'posts-panel' }, h('h3', {}, 'LinkedIn post drafts', h('span', { class: 'pill gen', text: scaffold ? 'Scaffold' : posts.length ? 'AI-generated' : '…' })),
    h('p', { class: 'note', text: scaffold ? 'Fill the [brackets] with your own view. These use only facts from the source: headline, publisher, date. Add an API key for full drafts.' : 'Starting points in a human voice, using only facts from the source. Add your own experience before posting.' }));
  if (!posts.length) { panel.append(h('p', { class: 'muted', text: 'Preparing drafts…' })); return panel; }
  panel.append(h('div', { class: 'angles' }, posts.map((p, i) => h('button', { class: 'chip' + (i === active ? ' on' : ''), type: 'button', text: p.angle, onclick: () => { state.current.active = i; refreshPosts(); } }))));
  const ta = h('textarea', { id: 'post-text', 'aria-label': 'Post draft', oninput: (e) => { posts[active].text = e.target.value; $('#cc').textContent = e.target.value.length + ' / 3000'; } });
  ta.value = posts[active].text;
  panel.append(ta, h('div', { class: 'row' },
    h('button', { class: 'btn sm', onclick: async () => { await navigator.clipboard.writeText(posts[active].text); toast('Copied. Paste it into LinkedIn.'); }, text: 'Copy' }),
    state.status?.aiEnabled ? h('button', { class: 'btn ghost sm', onclick: () => loadPosts(true), text: '↻ New drafts' }) : null,
    h('span', { class: 'muted grow', id: 'cc', text: posts[active].text.length + ' / 3000' })));
  return panel;
}
function refreshPosts() { const p = $('#posts-panel'); if (p) p.replaceWith(postsPanel()); }

async function loadPosts(force) {
  const cur = state.current; if (!cur) return;
  if (force) { cur.posts = []; refreshPosts(); }
  try {
    const r = await api(`/api/items/${cur.item.id}/posts`, { method: 'POST', body: { force } });
    if (state.current !== cur) return;
    cur.posts = r.posts; cur.scaffold = !!r.scaffold; cur.active = 0;
    if (cur.saved?.post && !force) cur.posts.unshift({ angle: 'Saved draft', text: cur.saved.post });
    if (r.error) toast('AI drafts unavailable: ' + r.error);
    refreshPosts();
  } catch (e) { toast(e.message); }
}

// ---------- portfolio ----------
async function loadPortfolio() {
  const { entries } = await api('/api/portfolio');
  state.portfolio = new Map(entries.map((e) => [e.id, e]));
  $('#pf-count').textContent = entries.length || '';
  return entries;
}
async function saveToPortfolio() {
  const { item, posts, active, breakdown } = state.current;
  const post = posts[active]?.text || '';
  const saved = await api('/api/portfolio/' + item.id, { method: 'PUT', body: { breakdown, post, notes: state.current.saved?.notes || '' } });
  state.current.saved = saved; await loadPortfolio(); toast('Saved to your portfolio'); renderSheet(); refreshPosts();
}
async function removeFromPortfolio() {
  await api('/api/portfolio/' + state.current.item.id, { method: 'DELETE' });
  state.current.saved = null; await loadPortfolio(); toast('Removed'); renderSheet(); loadPosts(false);
  if (state.view === 'portfolio') renderPortfolio();
}
async function renderPortfolio() {
  const entries = await loadPortfolio();
  const box = $('#portfolio');
  box.replaceChildren(h('div', { class: 'section-head' }, h('h2', { text: 'My portfolio' }), h('span', { class: 'muted', text: `${entries.length} saved` }), h('span', { class: 'spacer', style: 'flex:1' }),
    entries.length ? h('a', { class: 'btn sm', href: '/api/portfolio/export.md', download: 'portfolio.md', text: 'Export Markdown' }) : null),
    entries.length ? h('div', { class: 'grid' }, entries.map((e) => card(e.item))) : h('div', { class: 'empty' }, h('h3', { text: 'Nothing saved yet' }), 'Open any story, add your breakdown and a LinkedIn draft, then save it here. Your portfolio is stored on this server in data/portfolio.json.'));
}

// ---------- sources ----------
async function renderSources() {
  const s = await loadStatus();
  $('#sources').replaceChildren(
    h('div', { class: 'section-head' }, h('h2', { text: 'Sources' }), h('span', { class: 'muted', text: `Auto-refresh every ${s.refreshMinutes} min · last run ${ago(s.updatedAt)}${s.lastRun ? ` · ${s.lastRun.new} new, ${s.lastRun.merged} duplicates merged` : ''}` })),
    h('p', { class: 'muted', text: 'Every story links to its publisher. Duplicates across outlets are merged into one card. Edit sources.json to add, fix or disable feeds.' }),
    h('table', { class: 'src-table' }, h('thead', {}, h('tr', {}, ['Source', 'Region', 'Status', 'Items', 'Last OK'].map((t) => h('th', { text: t })))),
      h('tbody', {}, s.sources.map((x) => h('tr', {}, h('td', { text: x.name }), h('td', { text: x.region }),
        h('td', {}, x.ok === null ? 'Not yet fetched' : x.ok ? h('span', { class: 'ok', text: '● OK' }) : h('span', { class: 'bad', text: '● ' + x.error })),
        h('td', { text: x.fetched ?? '' }), h('td', { text: x.lastOk ? ago(x.lastOk) : '—' }))))));
}

// ---------- wiring ----------
function setView(v) {
  state.view = v;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#browse').hidden = ['portfolio', 'sources'].includes(v);
  $('#portfolio').hidden = v !== 'portfolio';
  $('#sources').hidden = v !== 'sources';
  if (v === 'portfolio') renderPortfolio(); else if (v === 'sources') renderSources(); else reload();
}

$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
$('#region').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.region = b.dataset.r; document.querySelectorAll('#region button').forEach((x) => x.classList.toggle('on', x === b)); reload(); });
let debounce; $('#q').addEventListener('input', (e) => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = e.target.value.trim(); reload(); }, 250); });
$('#more').addEventListener('click', loadPage);
$('#close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

$('#refresh').addEventListener('click', async () => {
  await api('/api/refresh', { method: 'POST' }); toast('Refreshing sources…'); pollRefresh();
});
async function pollRefresh() {
  for (let i = 0; i < 60; i++) {
    const s = await loadStatus();
    if (!s.refreshing) { if (state.view === 'sources') renderSources(); else if (state.view !== 'portfolio') reload(); toast('Up to date'); return; }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; }
try { applyTheme(localStorage.getItem('mb-theme')); } catch {}
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const t = dark ? 'light' : 'dark'; applyTheme(t); try { localStorage.setItem('mb-theme', t); } catch {}
});

$('#today').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

(async function init() {
  const s = await loadStatus();
  await loadPortfolio();
  await reload();
  if (s.refreshing || !s.updatedAt) pollRefresh();
  setInterval(async () => {   // pick up scheduled server refreshes without a page reload
    const prev = state.status?.updatedAt; const n = await loadStatus();
    if (n.updatedAt !== prev && state.view !== 'portfolio' && state.view !== 'sources' && $('#modal').hidden) { reload(); toast('New stories loaded'); }
  }, 5 * 60_000);
})();
