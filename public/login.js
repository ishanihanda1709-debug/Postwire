const $ = (s) => document.querySelector(s);
let firstDone = false;
let mode = 'login', cfg = { signupOpen: true, trialDays: 7 };

function setMode(m) {
  mode = m;
  const signup = m === 'signup';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  $('#f-name').hidden = !signup;
  $('#password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#title').textContent = signup ? 'Create your account' : 'Welcome back';
  $('#sub').textContent = signup ? `Start your ${cfg.trialDays}-day free trial. No card needed.` : "Log in to see today's news.";
  $('#go').textContent = signup ? 'Start free trial' : 'Log in';
  $('#err').textContent = '';
  if (!firstDone && why && problems[why]) $('#err').textContent = problems[why];
  firstDone = true;
}

fetch('/api/config').then((r) => r.json()).then((c) => {
  cfg = c;
  if (c.google) $('#google').hidden = false;
  if (!c.signupOpen) { $('#tab-signup').hidden = true; $('#note').textContent = 'Sign-ups are closed right now. Ask the owner for an account.'; }
  if (location.hash === '#signup' && c.signupOpen) setMode('signup'); else setMode('login');
}).catch(() => setMode('login'));

const problems = {
  google_cancelled: 'Google sign-in was cancelled. You can try again or use your email.',
  google_failed: 'Google sign-in did not work. Please try again, or use your email.',
  google_unverified: 'Google says that email address is not verified, so we cannot use it.',
  google_off: 'Google sign-in is not switched on yet.',
  closed: 'Sign-ups are closed right now. Ask the owner for an account.',
  slow: 'Too many attempts. Wait a few minutes and try again.',
};
const why = new URLSearchParams(location.search).get('error');
if (why && problems[why]) $('#err').textContent = problems[why];

$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: $('#name').value, email: $('#email').value, password: $('#password').value };
  if (!body.email || !body.password) { $('#err').textContent = 'Enter your email and password.'; return; }
  $('#go').disabled = true; $('#err').textContent = '';
  try {
    const res = await fetch(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    location.href = '/';
  } catch (err) { $('#err').textContent = err.message; $('#go').disabled = false; }
});

// Light / dark switch (same saved choice as the app)
const themeBtn = $('#theme');
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
const label = () => { themeBtn.textContent = isDark() ? 'Light mode' : 'Dark mode'; };
themeBtn.addEventListener('click', () => { const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('pw-theme', t); } catch { /* ignore */ } label(); });
label();
