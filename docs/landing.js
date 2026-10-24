const $ = (i) => document.getElementById(i);
const root = document.documentElement, tb = $('theme');
const dark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const lab = () => { tb.textContent = dark() ? 'Light mode' : 'Dark mode'; };

// ---- theme: same saved choice as the app ----
try { const t = localStorage.getItem('pw-theme'); if (t === 'light' || t === 'dark') root.dataset.theme = t; } catch { /* storage unavailable */ }
tb.addEventListener('click', () => { root.dataset.theme = dark() ? 'light' : 'dark'; try { localStorage.setItem('pw-theme', root.dataset.theme); } catch { /* ignore */ } lab(); });
lab();

// ---- "Get started" and "Log in" go to the app ----
// When this page is served by the app itself, the links are same-site. When it is hosted somewhere else (GitHub Pages, a preview),
// set APP_URL to the app's address once it is live, for example 'https://postwire.example'. Until then the buttons explain.
const APP_URL = '';
const servedByApp = document.querySelector('meta[name="served-by-app"]')?.content === '1';
const appLive = servedByApp || APP_URL !== '';
const appBase = APP_URL.replace(/\/$/, '');
let toastTimer;
let signedIn = false;
function wireApp() {
  document.querySelectorAll('[data-app]:not([data-wired])').forEach((a) => {
    a.dataset.wired = '1';
    if (signedIn && a.dataset.app.startsWith('/login.html')) {   // already logged in: go straight to the app
      a.href = '/#/home';
      if (a.classList.contains('login')) a.textContent = 'Open the app'; else if (a.classList.contains('btn')) a.textContent = 'Open the app →';
      return;
    }
    if (appLive) { a.href = appBase + a.dataset.app; return; }
    a.href = '#';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const t = $('toast'); t.textContent = 'Preview only: the app is not hosted yet. To try it, run it on your computer and open http://localhost:3000.';
      t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
    });
  });
}
// Already logged in (the app's brand link leads here)? Then the sign-up buttons become "open the app".
const whoami = (async () => {
  if (!servedByApp) return;
  try { signedIn = !!(await (await fetch('/api/auth/status')).json()).signedIn; } catch { /* not signed in */ }
})();
whoami.then(() => document.querySelectorAll('[data-app]').forEach((a) => { delete a.dataset.wired; })).then(wireApp);

// ---- live headlines (only when there is an app to ask; otherwise the section stays hidden) ----
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const age = (iso) => { const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000); return h < 1 ? 'Just now' : h < 24 ? `${h} h ago` : h < 48 ? 'Yesterday' : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const safeUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol) ? u : '#'; } catch { return '#'; } };

async function loadLive() {
  if (!appLive) return;
  await whoami;
  let data;
  try { const r = await fetch(`${appBase}/api/public/headlines`); if (!r.ok) return; data = await r.json(); } catch { return; }
  const sections = (data.sections || []).filter((s) => s.items?.length);
  if (!sections.length) return;
  let cur = 0;
  const tabs = $('live-tabs'), cards = $('live-cards');
  const draw = () => {
    const s = sections[cur];
    $('live').dataset.d = s.id;
    tabs.replaceChildren(...sections.map((x, i) => { const b = el('button', 'tab', x.label); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.d = x.id; b.setAttribute('aria-selected', String(i === cur)); b.onclick = () => { cur = i; draw(); }; return b; }));
    cards.replaceChildren(...s.items.map((i) => {
      const c = el('article', 'hc');
      const meta = el('div', 'meta'); meta.append(el('b', '', i.source), ` · ${age(i.publishedAt)}`);
      const acts = el('div', 'acts');
      const go = el('a', 'go', 'Write a post →'); go.dataset.app = '/login.html#signup';
      const src = el('a', 'src', 'Read the original ↗'); src.href = safeUrl(i.url); src.target = '_blank'; src.rel = 'noopener noreferrer';
      acts.append(go, src);
      c.append(el('span', 'dtag', s.label), el('h3', '', i.title), meta, acts);
      return c;
    }));
    wireApp();
  };
  if (data.updatedAt) { const m = Math.max(0, Math.round((Date.now() - Date.parse(data.updatedAt)) / 60000)); $('live-sub').textContent = `The newest stories, straight from the feeds. Updated ${m < 60 ? `${m} min` : `${Math.round(m / 60)} h`} ago.`; }
  $('live').hidden = false; $('seelive').hidden = false;
  draw();
}
loadLive();

