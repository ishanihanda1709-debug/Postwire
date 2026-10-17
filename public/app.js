import { parseChatPosts, headlineFrom } from './parse.js';
import { drawCreative, SIZES, TEMPLATES } from './creatives.js';

const $ = (s, r = document) => r.querySelector(s);
const PAGE = 18;
const ROUTES = ['home', 'marketing', 'product', 'finance', 'others', 'style', 'saved', 'account', 'upgrade'];
const state = { me: null, doms: {}, cur: null, saved: new Map(), timer: null, rt: 0 };

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
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Please log in.'); }
  if (res.status === 402) { if (location.hash !== '#/upgrade') location.hash = '#/upgrade'; throw Object.assign(new Error('Your free trial has ended.'), { code: 402 }); }
  if (!res.ok && !data.posts) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, action) {
  const t = $('#toast'); t.replaceChildren(msg);
  if (action) t.append(' ', h('button', { class: 'linkbtn', type: 'button', style: 'color:inherit', text: action.label, onclick: () => { action.run(); t.hidden = true; } }));
  t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), action ? 6000 : 2600);
}

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not given';
function relDate(iso) {
  if (!iso) return 'Date not given';
  const hrs = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  if (hrs < 1) return 'Just now';
  if (hrs < 24) return `${hrs} h ago`;
  if (hrs < 48) return 'Yesterday';
  return fmtDate(iso);
}
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
const domainById = (id) => state.me.domains.find((d) => d.id === id) || state.me.domains[0];
const colorVar = { marketing: '--mkt', product: '--prd', finance: '--fin', others: '--oth' };

// Stories hidden with the ✕ are remembered in this browser, per account.
const hiddenKey = () => `pw-hidden-${state.me.user.id}`;
let hidden = new Set();
const loadHidden = () => { try { hidden = new Set(JSON.parse(localStorage.getItem(hiddenKey()) || '[]')); } catch { hidden = new Set(); } };
const saveHidden = () => { try { localStorage.setItem(hiddenKey(), JSON.stringify([...hidden].slice(-600))); } catch { /* storage unavailable */ } };

// ---------- shell ----------
function buildNav() {
  $('#nav-domains').replaceChildren(...state.me.domains.map((d) => h('a', { href: `#/${d.id}`, 'data-r': d.id }, h('i'), d.label)));
  const u = state.me.user;
  $('#me').replaceChildren(h('span', { class: 'av', text: (u.name || u.email).slice(0, 1).toUpperCase() }), h('span', { style: 'min-width:0' }, h('b', { text: u.name }), h('small', { text: planLabel(u) })));
}
function planLabel(u) {
  if (u.plan === 'owner') return 'Owner';
  if (u.plan === 'trial') return `Trial · ${u.daysLeft} day${u.daysLeft === 1 ? '' : 's'} left`;
  if (u.plan === 'active') return 'Subscribed';
  return 'Trial ended';
}
function markNav(r) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r));
  document.body.dataset.domain = state.me.domains.some((d) => d.id === r) ? r : 'none';
}
const updateSavedCount = () => { $('#saved-n').textContent = state.saved.size || ''; };

const themeBtn = () => $('#theme');
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const themeLabel = () => { themeBtn().textContent = isDark() ? 'Light mode' : 'Dark mode'; };

// ---------- router ----------
const currentRoute = () => { const r = location.hash.replace(/^#\//, ''); return ROUTES.includes(r) ? r : 'home'; };

async function render() {
  closeModal();
  const my = ++state.rt;   // a slow page must not paint over the page you have since moved to
  const r = currentRoute();
  markNav(r);
  $('#main').scrollIntoView?.({ block: 'start' });
  try {
    if (r === 'home') await renderHome(my);
    else if (state.me.domains.some((d) => d.id === r)) renderDomain(r);
    else if (r === 'style') await renderStyle(my);
    else if (r === 'saved') await renderSaved(my);
    else if (r === 'account') await renderAccount(my);
    else renderUpgrade();
  } catch (e) { if (e.code !== 402) toast(e.message); }
}

// ---------- home: the first page after logging in ----------
const greeting = () => { const hr = new Date().getHours(); return hr < 5 ? 'Hello' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'; };

async function renderHome(my) {
  const u = state.me.user, first = (u.name || '').includes('@') ? '' : (u.name || '').trim().split(/\s+/)[0];
  const tiles = state.me.domains.map((d, i) => {
    const count = h('span', { class: 'tcount', text: ' ' }), top = h('p', { class: 'ttop', text: 'Loading the latest…' });
    api(`/api/items?domain=${d.id}&limit=1&sort=trending&days=${state.me.freshDays}`).then((r) => {
      count.textContent = r.total ? `${r.total} fresh ${r.total === 1 ? 'story' : 'stories'}` : 'No fresh stories yet';
      top.textContent = r.items[0]?.title || 'Check back after the next fetch.';
    }).catch(() => { count.textContent = ''; top.textContent = ''; });
    return h('a', { class: 'tile', href: `#/${d.id}`, style: `--dom:var(${colorVar[d.id] || '--prd'});--i:${i}` },
      h('span', { class: 'tbar' }), h('div', { class: 'thead' }, h('h3', { text: d.label }), count), h('p', { class: 'tblurb', text: d.blurb }), top, h('span', { class: 'tgo', text: `Open ${d.label} →` }));
  });
  const steps = [['1', 'Pick a headline', 'Open any story from the four sections.'], ['2', 'Get three posts', 'Story-led, lesson-led and question-led, in your style. Use the built-in AI or copy the prompt into any chatbot.'], ['3', 'Add a picture and post', 'Download a graphic or copy an image prompt, then paste it into LinkedIn.']];
  $('#main').replaceChildren(h('div', { class: 'home' },
    h('section', { class: 'hero' },
      h('div', { class: 'orbs', 'aria-hidden': 'true' }, h('i', { class: 'orb o1' }), h('i', { class: 'orb o2' }), h('i', { class: 'orb o3' }), h('i', { class: 'orb o4' })),
      h('p', { class: 'eyebrow', text: state.me.name }),
      h('h1', { text: `${greeting()}${first ? ', ' + first : ''}.` }),
      h('p', { class: 'lede', text: 'Here is what is moving today. Pick a section, open a headline and turn it into a LinkedIn post in your own voice.' }),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/marketing', text: 'Start with Marketing' }), h('a', { class: 'btn ghost', href: '#/style', text: 'Set up My style' }))),
    h('div', { class: 'tiles' }, tiles),
    h('h2', { class: 'hsub', text: 'How it works' }),
    h('ol', { class: 'hsteps' }, steps.map(([n, t, d], i) => h('li', { style: `--i:${i}` }, h('b', { text: n }), h('div', {}, h('h4', { text: t }), h('p', { text: d })))))));
}

// A short welcome animation, once per visit after logging in. Press any key or click to skip.
function splash() {
  try { if (sessionStorage.getItem('pw-splash')) return; sessionStorage.setItem('pw-splash', '1'); } catch { return; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols = ['--mkt', '--prd', '--fin', '--oth'];
  const el = h('div', { class: 'splash', role: 'presentation' },
    h('div', { class: 'sbars' }, cols.map((c, i) => h('i', { style: `--c:var(${c});--i:${i}` }))),
    h('div', { class: 'sname' }, h('span', { class: 'mark', text: (state.me.name || 'P').slice(0, 1) }), h('b', { text: state.me.name })));
  const done = () => { el.classList.add('out'); setTimeout(() => el.remove(), 500); };
  el.addEventListener('click', done); document.addEventListener('keydown', done, { once: true });
  document.body.append(el); setTimeout(done, 1900);
}

// ---------- news page for one section ----------
function domState(id) {
  state.doms[id] ||= { sub: 'all', region: 'all', days: state.me.freshDays, q: '', seed: 0, seen: new Set(), shown: [], offset: 0, updatedAt: null };
  return state.doms[id];
}

function renderDomain(id) {
  const d = domainById(id), st = domState(id);
  const isAdmin = state.me.user.role === 'admin';
  const grid = h('div', { class: 'grid' });
  const more = h('button', { class: 'btn', type: 'button', hidden: true, text: 'Show more', onclick: () => loadPage() });
  const reset = h('button', { class: 'linkbtn', type: 'button', hidden: true, onclick: () => { hidden = new Set(); saveHidden(); updateReset(); reload(); } });
  const status = h('span', { class: 'status' });

  const resetShuffle = () => { st.seed = 0; st.seen = new Set(); };
  const setStatus = () => {
    status.replaceChildren(h('i', { class: 'dot ' + (state.me.refreshing ? 'busy' : state.me.updatedAt ? 'ok' : '') }),
      state.me.refreshing ? 'Fetching new stories…' : state.me.updatedAt ? `Updated ${ago(state.me.updatedAt)}${state.me.nextRefresh ? ` · next ${state.me.nextRefresh}` : ''}` : 'Waiting for the first fetch');
  };
  const updateReset = () => { reset.hidden = hidden.size === 0; reset.textContent = `Show ${hidden.size} hidden ${hidden.size === 1 ? 'story' : 'stories'} again`; };

  const query = () => {
    const p = new URLSearchParams({ domain: id, limit: PAGE, offset: st.offset, days: st.days });
    const f = d.subtabs.find((s) => s.id === st.sub)?.filter;
    if (f?.kind) p.set('kind', f.kind);
    if (f?.tag) p.set('tag', f.tag);
    if (st.region !== 'all') p.set('region', st.region);
    if (st.q) p.set('q', st.q);
    if (!st.seed) p.set('sort', 'trending');
    if (st.seed) p.set('shuffle', st.seed);
    const ex = [...hidden, ...(st.seed ? st.seen : [])].slice(-500);
    if (ex.length) p.set('exclude', ex.join(','));
    return p;
  };

  async function loadPage() {
    const { items, total } = await api('/api/items?' + query());
    items.forEach((i) => { st.shown.push(i.id); grid.append(card(i, d, st, (el) => { hidden.add(i.id); saveHidden(); el.remove(); st.offset = Math.max(0, st.offset - 1); updateReset(); toast('Hidden. It will not show again.', { label: 'Undo', run: () => { hidden.delete(i.id); saveHidden(); updateReset(); reload(); } }); if (!grid.children.length) reload(); })); });
    st.offset += items.length;
    more.hidden = st.offset >= total;
    if (!grid.children.length) grid.append(emptyState());
  }
  async function reload() { st.offset = 0; st.shown = []; grid.replaceChildren(); try { await loadPage(); } catch (e) { if (e.code !== 402) toast(e.message); } }

  async function shuffle() {
    const prev = [...st.shown];
    st.shown.forEach((x) => st.seen.add(x));
    st.seed = Math.floor(Math.random() * 2 ** 31) + 1;
    await reload();
    if (grid.querySelectorAll('.cardw').length < PAGE / 2 && st.seen.size) {   // fresh stories running low: mix earlier ones back in
      st.seen = new Set([...prev, ...st.shown]); st.seed = Math.floor(Math.random() * 2 ** 31) + 1;
      await reload(); toast('Fresh stories are running low, mixing in earlier ones.');
    }
  }

  function emptyState() {
    if (!state.me.updatedAt) return h('div', { class: 'empty' }, h('h3', { text: 'Fetching the first stories…' }), isAdmin ? 'This takes about a minute the first time.' : 'The first stories are on their way. Check back shortly.');
    if (st.q || st.region !== 'all' || st.sub !== 'all') return h('div', { class: 'empty' }, h('h3', { text: 'Nothing matches' }), `Nothing from the last ${st.days} days matches. Try All, a broader search, or 7 or 30 days.`);
    if (st.days < 30) return h('div', { class: 'empty' }, h('h3', { text: `Nothing from the last ${st.days} days` }), 'Pick 7 or 30 days above to see older stories.');
    return h('div', { class: 'empty' }, h('h3', { text: 'No stories yet' }), isAdmin ? 'Check Account > Sources for feeds that failed.' : 'Check back soon.');
  }

  const chips = d.subtabs.map((s) => h('button', { class: 'chip' + (st.sub === s.id ? ' on' : ''), type: 'button', text: s.label, onclick: (e) => {
    st.sub = s.id; resetShuffle(); chips.forEach((c) => c.classList.toggle('on', c === e.currentTarget)); reload(); } }));
  const seg = (options, current, onPick, label) => {
    const buttons = options.map(([val, text]) => h('button', { type: 'button', class: String(val) === String(current) ? 'on' : '', text, onclick: (e) => { buttons.forEach((b) => b.classList.toggle('on', b === e.currentTarget)); onPick(val); } }));
    return h('div', { class: 'seg', role: 'group', 'aria-label': label }, buttons);
  };
  const ages = [...new Set([state.me.freshDays, 7, 30])].sort((a, b) => a - b).map((n) => [n, n === 1 ? '24 h' : `${n} days`]);
  let debounce;

  $('#main').replaceChildren(
    h('div', { class: 'pagehead' },
      h('div', {}, h('h1', { text: d.label }), h('p', { text: d.blurb })),
      h('div', { class: 'row', style: 'margin:0' }, status,
        isAdmin ? h('button', { class: 'btn ghost', type: 'button', text: '↻ Fetch new stories', onclick: async () => { try { await api('/api/refresh', { method: 'POST' }); toast('Fetching new stories…'); pollRefresh(reload, setStatus); } catch (e) { toast(e.message); } } }) : null)),
    h('div', { class: 'controls' },
      h('div', { class: 'subtabs' }, chips),
      h('span', { class: 'grow' }),
      seg([['all', 'All'], ['india', 'India'], ['global', 'Global']], st.region, (v) => { st.region = v; resetShuffle(); reload(); }, 'Region'),
      seg(ages, st.days, (v) => { st.days = Number(v); resetShuffle(); reload(); }, 'How recent'),
      h('label', { class: 'search' }, h('span', { class: 'sr', text: 'Search headlines' }), h('input', { type: 'search', placeholder: 'Search headlines', autocomplete: 'off', value: st.q, oninput: (e) => { clearTimeout(debounce); debounce = setTimeout(() => { st.q = e.target.value.trim(); resetShuffle(); reload(); }, 250); } })),
      h('button', { class: 'btn', type: 'button', text: '⟳ Show me different ones', title: 'Swap these for a fresh set', onclick: shuffle })),
    grid, h('div', { class: 'more' }, more), h('p', { class: 'reset' }, reset));
  setStatus(); updateReset();
  state.refreshView = () => { setStatus(); };
  state.reloadView = reload;
  reload();
}

function card(item, d, st, onHide) {
  const labels = d.subtabs.filter((s) => s.filter && ((s.filter.kind && item.kind === s.filter.kind) || (s.filter.tag && item.tags.includes(s.filter.tag)))).map((s) => s.tag || s.label).slice(0, 2);
  const tags = h('div', { class: 'tags' }, labels.map((l) => h('span', { class: 'tag', text: l })),
    item.region === 'india' ? h('span', { class: 'tag neutral', text: 'India' }) : null,
    item.also?.length ? h('span', { class: 'tag neutral', text: `${item.also.length + 1} outlets` }) : null);
  const wrap = h('div', { class: 'cardw' },
    h('button', { class: 'card', type: 'button', onclick: () => openItem(item, d) }, tags, h('h3', { text: item.title }),
      h('div', { class: 'meta' }, h('b', { text: item.source }), '·', relDate(item.publishedAt), h('span', { class: 'cta', style: 'margin-left:auto', text: 'Write a post →' }))),
    h('button', { class: 'skip', type: 'button', title: 'Not for me: hide this story', 'aria-label': `Hide: ${item.title}`, text: '✕', onclick: () => onHide(wrap) }));
  return wrap;
}

async function pollRefresh(reload, setStatus) {
  for (let i = 0; i < 90; i++) {
    state.me = { ...state.me, ...(await api('/api/me')) };
    setStatus?.();
    if (!state.me.refreshing) { reload?.(); toast('Up to date'); return; }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ---------- story panel ----------
async function openItem(item, d) {
  const cur = { item, d, posts: [], active: 0, size: 'portrait' }; state.cur = cur;
  $('#modal').hidden = false; document.body.style.overflow = 'hidden';
  paint(cur, true);
  $('#close').focus();
  await loadPost(cur, false);
}

async function loadPost(cur, force) {
  paint(cur, true);
  try {
    const r = await api(`/api/items/${cur.item.id}/post`, { method: 'POST', body: { force } });
    if (state.cur !== cur) return;
    cur.posts = r.posts; cur.scaffold = !!r.scaffold; cur.error = r.error; cur.active = 0;
    if (r.error && !r.scaffold) cur.error = r.error;
    paint(cur, false);
    api('/api/me').then((m) => { state.me.aiUsedToday = m.aiUsedToday; if (state.cur === cur) paint(cur, false); }).catch(() => {});
  } catch (e) { toast(e.message); if (state.cur === cur) paint(cur, false); }
}

const savedKey = (cur) => `${cur.item.id}|${cur.posts?.[cur.active || 0]?.angle}`;
const isSaved = (cur) => state.saved.has(savedKey(cur));

function paint(cur, loading) {
  const { item, d } = cur, posts = cur.posts || [], active = cur.active || 0, ai = state.me.aiEnabled;
  const ta = h('textarea', { id: 'post', 'aria-label': 'LinkedIn post', style: 'min-height:380px', placeholder: loading ? 'Writing your post options…' : '' });
  ta.value = posts[active]?.text || '';
  ta.addEventListener('input', () => { posts[active].text = ta.value; $('#cc').textContent = `${ta.value.length} characters`; if (isSaved(cur)) { clearTimeout(cur.t); cur.t = setTimeout(() => putSaved(cur), 600); } });
  $('#sheet-body').replaceChildren(
    h('div', { class: 'tags' }, h('span', { class: 'tag', text: d.label })),
    h('h2', { id: 'm-title', text: item.title }),
    h('p', { class: 'facts' }, h('b', { text: item.source }), ` · ${fmtDate(item.publishedAt)} · `, h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: 'Read the original ↗' }),
      item.also?.length ? [' · Also: ', item.also.map((a, i) => [i ? ', ' : '', h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', text: a.source })])] : null),
    h('div', { class: 'cols' },
      h('div', {},
        h('h4', { class: 'lbl', text: loading ? 'Writing your post options…' : `Your LinkedIn post · ${posts.length} options` }),
        !ai ? freeBox(cur) : null,
        ai && !state.me.voiceCount ? h('div', { class: 'notice', text: 'Tip: add 3 or more of your own posts under "My style" so these sound like you.' }) : null,
        cur.error ? h('div', { class: 'notice', text: cur.error }) : null,
        d.id === 'finance' ? h('p', { class: 'muted', text: 'News only, not investment advice. Check facts at the source before you post.' }) : null,
        h('div', { class: 'opts', role: 'tablist' }, posts.map((p, i) => h('button', { class: 'chip' + (i === active ? ' on' : ''), type: 'button', role: 'tab', text: `${i + 1}. ${p.angle}`, onclick: () => { cur.active = i; paint(cur, false); } }))),
        ta,
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', disabled: !posts.length, onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied. Paste it into LinkedIn.'); } catch { ta.select(); toast('Press Ctrl/Cmd+C to copy'); } }, text: 'Copy this post' }),
          ai ? h('button', { class: 'btn ghost', type: 'button', disabled: !!loading, onclick: () => loadPost(cur, true), text: '↻ More options' }) : null,
          h('button', { class: 'heart' + (isSaved(cur) ? ' on' : ''), type: 'button', disabled: !posts.length, 'aria-pressed': String(isSaved(cur)), onclick: () => toggleSave(cur, ta), text: isSaved(cur) ? '♥ Saved' : '♡ Save this post' }),
          h('span', { class: 'muted grow', id: 'cc', text: `${ta.value.length} characters` })),
        ai ? h('p', { class: 'muted', text: `AI posts used today: ${state.me.aiUsedToday || 0} of ${state.me.aiLimit}` }) : null),
      h('div', {}, h('h4', { class: 'lbl', text: 'Pictures for your post' }), h('div', { id: 'pics' }))));
  if (!loading) drawPics(cur);
}

const graphicsOn = () => { try { return localStorage.getItem('pw-graphics') !== 'off'; } catch { return true; } };
const IMG_STYLES = [
  { label: 'Flat illustration', desc: 'a clean, modern flat vector illustration with bold simple shapes' },
  { label: 'Abstract', desc: 'a minimal abstract composition of geometric shapes and soft gradients that suggests the topic' },
  { label: 'Photo-style scene', desc: 'a realistic, softly lit editorial photo-style scene of objects and places that suggest the topic (no people)' },
];
const RATIOS = { portrait: '4:5 portrait', square: '1:1 square', landscape: '1.91:1 landscape' };
// Each section gets its own look, so a finance picture does not look like a marketing one.
const LOOKS = {
  marketing: { colours: 'coral red (#E8475F), warm cream and deep navy', mood: 'bold, energetic and creative', scene: 'a billboard, a megaphone, speech bubbles, a camera or a campaign storyboard' },
  product: { colours: 'electric violet (#6D5BF6), soft lilac and deep navy', mood: 'clean, modern and focused', scene: 'a phone or app screen, interface cards, a roadmap, toggles, puzzle pieces or a launch rocket' },
  finance: { colours: 'teal green (#0E9F8E), pale mint and deep navy', mood: 'calm, trustworthy and precise', scene: 'rising bars, a line chart, coins, a rupee symbol, a balance scale or city skyline' },
  others: { colours: 'amber (#B45309), warm sand and deep charcoal', mood: 'warm, human and thoughtful', scene: 'a globe, a newspaper, open window light, or objects that hint at the story' },
};
// Extra scene ideas when the story's own topic is known.
const TOPIC_SCENE = {
  sport: 'a stadium, a ball and floodlights', entertainment: 'a film reel, a stage spotlight and a ticket', health: 'a heartbeat line, a leaf and a stethoscope shape', tech: 'a circuit pattern, a lab flask or a satellite',
  funding: 'a seedling growing from coins', markets: 'candlestick-style bars and an upward arrow', economy: 'a factory outline, a shopping basket and a gauge', fintech: 'a phone with a payment tick and a card',
  launch: 'a rocket lifting off', feature: 'a toggle switch and a glowing interface card', pm: 'sticky notes on a roadmap',
  campaign: 'a billboard and a film clapper', casestudy: 'a magnifying glass over a chart',
};
const ANGLES = ['a single strong focal object, like a story told in one frame', 'a clear before-and-after contrast that shows the lesson', 'an open, curious composition with a question-mark shape or an empty doorway'];
const brandColours = () => { try { return (localStorage.getItem('pw-brand') || '').trim(); } catch { return ''; } };
const brandHex = () => (brandColours().match(/#[0-9a-f]{6}\b/i) || [])[0] || '';

// A ready-made prompt for any AI image tool. Built from the headline and section only: no invented details, no people, no logos.
function imagePrompt(cur) {
  const s = IMG_STYLES[cur.imgStyle || 0], look = LOOKS[cur.d.id] || LOOKS.product, brand = brandColours();
  const topic = (cur.item.tags || []).map((t) => TOPIC_SCENE[t]).find(Boolean) || look.scene;
  const angle = ANGLES[cur.active || 0] || ANGLES[0];
  return `Create ${s.desc} for a LinkedIn post about this news headline: "${cur.item.title}".\n\nMood: ${look.mood}.\nCould include: ${topic}.\nComposition: ${angle}, with calm empty space where a headline could sit.\nColours: ${brand ? `use the brand colours ${brand}, with deep navy or white where contrast is needed` : look.colours}.\nRules: no text or lettering, no logos or brand names, no real people or recognisable faces.\nFormat: ${RATIOS[cur.size || 'portrait']}.`;
}

function imageIdeaBlock(cur) {
  const ta = h('textarea', { id: 'img-prompt', readonly: true, 'aria-label': 'Image prompt', style: 'min-height:130px;font-size:14px' });
  ta.value = imagePrompt(cur);
  return h('div', { class: 'panel', style: 'max-width:none;margin:16px 0 0;padding:14px' },
    h('h2', { text: 'Want a picture made for this post?' }),
    h('p', { text: 'Copy this prompt into any AI image tool and it will draw a picture to match the post. It describes the topic only, with no people, logos or text.' }),
    h('div', { class: 'opts' }, IMG_STYLES.map((s, i) => h('button', { class: 'chip' + (i === (cur.imgStyle || 0) ? ' on' : ''), type: 'button', text: s.label, onclick: () => { cur.imgStyle = i; drawPics(cur); } }))),
    h('label', { class: 'lbl', for: 'brand', text: 'Your brand colours (optional)' }),
    h('input', { id: 'brand', type: 'text', maxlength: '80', placeholder: 'e.g. #0A66C2 and white. Leave empty to use this section\'s colours', value: brandColours(), 'aria-label': 'Brand colours',
      oninput: (e) => { try { localStorage.setItem('pw-brand', e.target.value); } catch { /* storage unavailable */ } ta.value = imagePrompt(cur); }, onchange: () => drawPics(cur) }),
    ta,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Copy image prompt', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Image prompt copied. Paste it into an AI image tool.'); } catch { ta.select(); toast('Press Ctrl/Cmd+C to copy'); } } })),
    h('p', { class: 'muted', style: 'margin-top:10px', text: 'Check the image tool\'s terms before you use its pictures commercially, and look the picture over before you post it.' }));
}

function drawPics(cur) {
  const { item, d } = cur, box = $('#pics'), size = cur.size || 'portrait';
  const card = cur.posts?.[cur.active || 0]?.card;
  const headline = card?.headline || item.title, subline = card?.subline || '';
  const accent = brandHex() || getComputedStyle(document.body).getPropertyValue(colorVar[d.id] || '--prd').trim() || d.color;
  const toggle = h('button', { class: 'linkbtn', type: 'button', text: graphicsOn() ? 'Hide the graphics' : 'Show the graphics', onclick: () => { try { localStorage.setItem('pw-graphics', graphicsOn() ? 'off' : 'on'); } catch { /* storage unavailable */ } drawPics(cur); } });
  const build = () => {
    if (state.cur !== cur) return;
    const parts = [h('div', { class: 'row', style: 'margin:0 0 8px' }, toggle)];
    if (graphicsOn()) {
      parts.push(
        h('div', { class: 'sizes', role: 'group', 'aria-label': 'Graphic size' }, Object.entries(SIZES).map(([k, s]) => h('button', { class: 'chip' + (k === size ? ' on' : ''), type: 'button', text: s.label, onclick: () => { cur.size = k; drawPics(cur); } }))),
        h('p', { class: 'muted', text: `${TEMPLATES.length} designs, made from your headline. Download one and add it to your LinkedIn post.` }),
        h('div', { class: 'pic-grid' }, TEMPLATES.map((t) => {
          let canvas;
          try { canvas = drawCreative({ template: t.id, size, headline, subline, source: item.source, author: state.me.user.name, accent }); }
          catch (e) { console.error('Graphic failed', e); return h('div', { class: 'pic' }, h('p', { class: 'muted', style: 'padding:14px', text: 'This graphic could not be drawn in this browser.' })); }
          return h('div', { class: 'pic' }, canvas, h('div', { class: 'pic-foot' }, h('b', { text: t.label }),
            h('button', { class: 'btn ghost', type: 'button', text: 'Download', onclick: () => canvas.toBlob((b) => { if (!b) { toast('Could not save the image in this browser.'); return; } const a = h('a', { href: URL.createObjectURL(b), download: `${t.id}-${size}.png` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png') })));
        })));
    } else parts.push(h('p', { class: 'muted', text: 'Graphics are hidden.' }));
    parts.push(imageIdeaBlock(cur));
    box.replaceChildren(...parts);
  };
  if (!graphicsOn()) { build(); return; }
  Promise.race([document.fonts.load('700 80px Sora'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {}).then(build);
}

// No-key flow: copy a prompt for any AI chatbot, then paste its answer back to get three editable options.
function freeBox(cur) {
  const copy = h('button', { class: 'btn', type: 'button', text: '1. Copy the prompt', onclick: async () => {
    try { const { prompt } = await api(`/api/items/${cur.item.id}/prompt`, { method: 'POST', body: {} }); await navigator.clipboard.writeText(prompt); toast('Prompt copied. Now paste it into an AI chatbot.'); }
    catch (e) { toast(e.message || 'Could not copy the prompt'); }
  } });
  if (!cur.pasting) {
    return h('div', { class: 'notice howto' },
      h('b', { text: cur.pasted ? 'Using the posts you pasted. Edit them below.' : 'Get your three posts in three steps. No AI key needed.' }),
      cur.pasted ? null : h('ol', {},
        h('li', { text: 'Copy the prompt. It asks for three LinkedIn posts about this headline (story-led, lesson-led and question-led) in your own style.' }),
        h('li', { text: 'Paste it into any AI chatbot: ChatGPT, Gemini, Claude, or an open-source one such as Llama or Mistral.' }),
        h('li', { text: 'Paste its answer back here. Pick one, edit it and copy it.' })),
      h('div', { class: 'row', style: 'margin-top:8px' }, copy, h('button', { class: 'btn ghost', type: 'button', text: '2. Paste the answer back', onclick: () => { cur.pasting = true; paint(cur, false); } })));
  }
  const ta = h('textarea', { id: 'paste-in', 'aria-label': 'Paste the chatbot answer', style: 'min-height:150px', placeholder: 'Paste the chatbot\'s whole answer here…' });
  return h('div', { class: 'notice howto' }, h('b', { text: 'Paste the chatbot\'s answer.' }), ' It is split into separate options automatically.', ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Use these posts', onclick: () => {
        const parsed = parseChatPosts(ta.value);
        if (!parsed.length) { toast('Nothing to use yet. Paste the chatbot answer first.'); return; }
        cur.posts = parsed.map((p) => ({ angle: p.angle, text: p.text, card: { headline: headlineFrom(p.text), subline: '' } }));
        cur.active = 0; cur.pasting = false; cur.pasted = true; cur.scaffold = false; paint(cur, false);
        toast(`${parsed.length} ${parsed.length === 1 ? 'post' : 'options'} ready.`);
      } }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => { cur.pasting = false; paint(cur, false); } })));
}

function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; state.cur = null; }

// ---------- saved posts ----------
async function putSaved(cur) {
  const p = cur.posts[cur.active || 0];
  const e = await api('/api/saved', { method: 'PUT', body: { itemId: cur.item.id, angle: p.angle, text: p.text } });
  state.saved.set(savedKey(cur), e); updateSavedCount();
}
async function toggleSave(cur, ta) {
  const p = cur.posts[cur.active || 0];
  try {
    if (isSaved(cur)) { await api('/api/saved/' + state.saved.get(savedKey(cur)).id, { method: 'DELETE' }); state.saved.delete(savedKey(cur)); toast('Removed from saved'); }
    else { p.text = ta.value; await putSaved(cur); toast('Saved. Find it under Saved.'); }
  } catch (e) { toast(e.message); }
  updateSavedCount(); paint(cur, false);
}
async function loadSaved() {
  const { entries } = await api('/api/saved');
  state.saved = new Map(entries.map((e) => [`${e.itemId}|${e.angle}`, e])); updateSavedCount(); return entries;
}
async function renderSaved(my = state.rt) {
  const entries = await loadSaved();
  if (my !== state.rt) return;
  const linkedin = (t) => 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(t);
  $('#main').replaceChildren(
    h('div', { class: 'pagehead' }, h('div', {}, h('h1', { text: 'Saved posts' }), h('p', { text: `${entries.length} saved` })),
      entries.length ? h('a', { class: 'btn ghost', href: '/api/saved/export.md', download: 'saved-posts.md', text: 'Export all (.md)' }) : null),
    entries.length ? h('div', { class: 'savedgrid' }, entries.map((e) => h('article', { class: 'sv', style: `--dom:var(${colorVar[e.item.domain] || '--prd'})` },
      h('div', { class: 'tags' }, h('span', { class: 'tag', text: e.angle })),
      h('h3', { text: e.item.title }),
      h('div', { class: 'meta' }, h('b', { text: e.item.source }), '·', fmtDate(e.item.publishedAt), '·', h('a', { href: e.item.url, target: '_blank', rel: 'noopener noreferrer', text: 'original ↗' })),
      h('pre', { text: e.text }),
      h('div', { class: 'row', style: 'margin-top:0' },
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(e.text); toast('Copied'); } catch { toast('Copy failed. Select the text instead.'); } }, text: 'Copy' }),
        h('a', { class: 'btn ghost', href: linkedin(e.text), target: '_blank', rel: 'noopener noreferrer', title: "Opens LinkedIn's post box with this text. You review and post it yourself.", text: 'Open in LinkedIn ↗' }),
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await api('/api/saved/' + e.id, { method: 'DELETE' }); renderSaved(); }, text: 'Delete' }))))
    ) : h('div', { class: 'empty' }, h('h3', { text: 'Nothing saved yet' }), 'Open a story and press "Save this post". Saved posts live here so you can copy or share them later.'));
}

// ---------- my style ----------
async function renderStyle(my = state.rt) {
  const { posts } = await api('/api/voice');
  if (my !== state.rt) return;
  state.me.voiceCount = posts.length;
  const ta = h('textarea', { id: 'style-in', 'aria-label': 'Paste one of your LinkedIn posts', placeholder: 'Paste one of your own LinkedIn posts here, exactly as you posted it…' });
  $('#main').replaceChildren(
    h('div', { class: 'pagehead' }, h('div', {}, h('h1', { text: 'My style' }), h('p', { text: 'Teach it your voice. It copies your rhythm and tone, never your content.' }))),
    h('div', { class: 'panel' },
      h('p', { text: 'Paste 3 to 6 of your own LinkedIn posts, one at a time. They are used for every section. Do not paste anything confidential.' }), ta,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Add to my style', onclick: async () => {
        try { await api('/api/voice', { method: 'POST', body: { text: ta.value } }); toast('Added. New posts will follow this style.'); renderStyle(); } catch (e) { toast(e.message); }
      } }), h('span', { class: 'muted', text: `${posts.length} saved${posts.length >= 3 ? '' : ' · 3 or more works best'}` }))),
    h('div', { class: 'stack' }, posts.map((p) => h('article', { class: 'sp' }, h('pre', { text: p.text }),
      h('button', { class: 'btn ghost', type: 'button', text: 'Delete', onclick: async () => { await api('/api/voice/' + p.id, { method: 'DELETE' }); renderStyle(); } })))));
}

// ---------- account ----------
async function renderAccount(my = state.rt) {
  state.me = { ...state.me, ...(await api('/api/me')) };
  if (my !== state.rt) return;
  buildNav(); markNav('account');
  const m = state.me, u = m.user, b = m.billing, isAdmin = u.role === 'admin';
  const plan = u.plan === 'owner' ? ['Owner', 'ok', 'Full access, no payment needed.']
    : u.plan === 'active' ? ['Subscribed', 'ok', `Access until ${fmtDate(u.paidUntil)}.`]
    : u.plan === 'trial' ? ['Free trial', 'warn', `${u.daysLeft} day${u.daysLeft === 1 ? '' : 's'} left (ends ${fmtDate(u.trialEndsAt)}).`]
    : ['Trial ended', 'bad', 'Subscribe to keep using it.'];
  const del = h('div', { hidden: true }, h('div', { class: 'field', style: 'margin-top:12px' }, h('label', { for: 'del-pw', text: 'Type your password to confirm' }), h('input', { id: 'del-pw', type: 'password', autocomplete: 'current-password' })),
    h('button', { class: 'btn danger', type: 'button', text: 'Delete my account and all my data', onclick: async () => {
      try { await api('/api/account/delete', { method: 'POST', body: { password: $('#del-pw').value } }); location.href = '/login.html'; } catch (e) { toast(e.message); }
    } }));
  $('#main').replaceChildren(
    h('div', { class: 'pagehead' }, h('div', {}, h('h1', { text: 'Account' }), h('p', { text: `${u.name} · ${u.email}` }))),
    h('div', { class: 'panel' }, h('h2', { text: 'Your plan' }), h('p', {}, h('span', { class: `badge ${plan[1]}`, text: plan[0] }), ' ', plan[2]),
      u.plan === 'owner' ? null : upgradeBlock(b)),
    m.aiEnabled ? h('div', { class: 'panel' }, h('h2', { text: 'AI posts today' }), h('p', { text: `${m.aiUsedToday} of ${m.aiLimit} used. Repeating a story you already opened does not use one. The free chatbot option has no limit.` })) : null,
    h('div', { class: 'panel' }, h('h2', { text: 'Session' }), h('div', { class: 'row', style: 'margin-top:0' },
      m.requireLogin ? h('button', { class: 'btn ghost', type: 'button', text: 'Log out', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; } }) : h('span', { class: 'muted', text: 'Login is switched off (single-user mode).' }),
      !isAdmin && m.requireLogin ? h('button', { class: 'btn danger', type: 'button', text: 'Delete my account…', onclick: () => { del.hidden = !del.hidden; } }) : null), del),
    isAdmin ? adminPanel(m) : null,
    h('p', { class: 'legal' }, h('a', { href: '/terms.html', target: '_blank', rel: 'noopener', text: 'Terms' }), h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener', text: 'Privacy' })));
}

function upgradeBlock(b) {
  return h('div', { class: 'row', style: 'margin-top:0' },
    b.priceLabel ? h('b', { text: b.priceLabel }) : null,
    b.upgradeUrl ? h('a', { class: 'btn', href: b.upgradeUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Subscribe' })
      : h('span', { class: 'muted', text: b.supportEmail ? `To subscribe, email ${b.supportEmail}.` : 'Payments are not switched on yet.' }));
}

function adminPanel(m) {
  const rows = (m.sources || []).map((s) => h('tr', {}, h('td', { text: s.name }), h('td', { text: s.domain }), h('td', { text: s.region }),
    h('td', {}, s.ok === null ? 'Not fetched yet' : s.ok ? h('span', { style: 'color:var(--ok)', text: '● OK' }) : h('span', { style: 'color:var(--bad)', text: '● ' + s.error })),
    h('td', { text: s.fetched ?? '' }), h('td', { text: s.lastOk ? ago(s.lastOk) : '—' })));
  return h('div', { class: 'panel', style: 'max-width:none' }, h('h2', { text: 'Owner tools' }),
    h('p', { text: `Last fetch ${ago(m.updatedAt)}${m.lastRun ? ` · ${m.lastRun.new} new, ${m.lastRun.merged} duplicates merged, ${m.lastRun.total} stories held` : ''}. Give someone paid access from the terminal: npm run users -- grant email@example.com 30` }),
    h('div', { class: 'tscroll' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['Source', 'Section', 'Region', 'Status', 'Items', 'Last OK'].map((t) => h('th', { text: t })))), h('tbody', {}, rows))));
}

function renderUpgrade() {
  const b = state.me.billing, u = state.me.user;
  $('#main').replaceChildren(
    h('div', { class: 'pagehead' }, h('div', {}, h('h1', { text: u.plan === 'expired' ? 'Your free trial has ended' : 'Subscribe' }), h('p', { text: 'Keep the daily news and your ready-to-post drafts.' }))),
    h('div', { class: 'panel' }, h('h2', { text: 'What you get' }),
      h('p', { text: 'Fresh headlines in Marketing, Product and Finance, three LinkedIn post options for every story in your voice, graphics sized for LinkedIn, and your saved posts.' }),
      upgradeBlock(b)),
    h('p', { class: 'muted', text: 'Your saved posts and style samples are kept while you decide.' }));
}

// ---------- wiring ----------
$('#close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
$('#theme').addEventListener('click', () => {
  const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t;
  try { localStorage.setItem('pw-theme', t); } catch { /* storage unavailable */ }
  themeLabel(); if (state.cur) drawPics(state.cur);
});
window.addEventListener('hashchange', render);

(async function init() {
  themeLabel();
  state.me = await api('/api/me');
  document.title = state.me.name;
  loadHidden(); buildNav();
  if (state.me.user.plan === 'expired') location.hash = '#/upgrade';
  try { await loadSaved(); } catch { /* shown on the Saved page */ }
  await render();
  splash();
  if (state.me.refreshing || !state.me.updatedAt) pollRefresh(() => state.reloadView?.(), () => state.refreshView?.());
  // pick up scheduled server refreshes without a page reload
  state.timer = setInterval(async () => {
    try {
      const prev = state.me.updatedAt; const n = await api('/api/me'); state.me = { ...state.me, ...n };
      if (n.updatedAt !== prev && $('#modal').hidden && state.refreshView) { state.refreshView(); state.reloadView?.(); toast('New stories loaded'); }
    } catch { /* ignore */ }
  }, 5 * 60_000);
})();
