import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';

const CLIENT = 'test-client.apps.googleusercontent.com';
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const cookieOf = (res, name) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));

test('Continue with Google: start, callback, new and existing accounts, and every refusal', async () => {
  let claims = {}, tokenStatus = 200, lastToken = null;
  const google = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    lastToken = Object.fromEntries(new URLSearchParams(b));
    res.writeHead(tokenStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(tokenStatus === 200 ? { id_token: jwt(claims) } : { error: 'bad' }));
  }); });
  await new Promise((r) => google.listen(0, '127.0.0.1', r));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pw-google-'));
  await fsp.writeFile(path.join(dir, 'sources.json'), JSON.stringify({ sources: [] }));
  const port = 4300 + Math.floor(Math.random() * 600);
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, SOURCES_FILE: path.join(dir, 'sources.json'), SIGNUP_FORM_URL: '', PUBLIC_URL: `http://127.0.0.1:${port}`,
    GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_AUTH_URL: `http://127.0.0.1:${google.address().port}/auth`, GOOGLE_TOKEN_URL: `http://127.0.0.1:${google.address().port}/token` };
  delete env.UPSTASH_REDIS_REST_URL;
  const srv = spawn('node', ['server.js'], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${base}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.equal((await (await fetch(`${base}/api/config`)).json()).google, true);

    const begin = async () => {
      const r = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      const u = new URL(r.headers.get('location'));
      return { u, cookie: cookieOf(r, 'pw_oauth'), state: u.searchParams.get('state'), nonce: u.searchParams.get('nonce') };
    };
    const callback = (b, { state = b.state, cookie = b.cookie } = {}) => fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    const good = (b, extra = {}) => ({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, nonce: b.nonce, sub: '1234567890', email: 'Asha@Example.com', email_verified: true, name: 'Asha Rao', ...extra });

    // the redirect to Google carries everything it should
    const b1 = await begin();
    assert.equal(b1.u.searchParams.get('client_id'), CLIENT);
    assert.equal(b1.u.searchParams.get('redirect_uri'), `http://127.0.0.1:${port}/api/auth/google/callback`);
    assert.equal(b1.u.searchParams.get('scope'), 'openid email profile');
    assert.equal(b1.u.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(b1.state && b1.nonce && b1.cookie);

    // a new person is created, signed in, and on a free trial
    claims = good(b1);
    const ok = await callback(b1);
    assert.equal(ok.status, 302); assert.equal(ok.headers.get('location'), '/');
    const session = cookieOf(ok, 'pw_session'); assert.ok(session, 'a session cookie is set');
    assert.equal(lastToken.code_verifier.length > 20, true); assert.equal(lastToken.grant_type, 'authorization_code');
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: session } })).json();
    assert.equal(me.user.email, 'asha@example.com'); assert.equal(me.user.name, 'Asha Rao'); assert.equal(me.user.googleOnly, true); assert.equal(me.user.plan, 'owner');   // the first account is the owner

    // a second Google person is a normal trial user
    const b2 = await begin(); claims = good(b2, { sub: '999', email: 'ravi@example.com', name: 'Ravi' });
    const r2 = await callback(b2); const me2 = await (await fetch(`${base}/api/me`, { headers: { cookie: cookieOf(r2, 'pw_session') } })).json();
    assert.equal(me2.user.plan, 'trial'); assert.equal(me2.user.role, 'user');

    // an existing password account with the same verified email is linked, not duplicated
    const su = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'meera@example.com', password: 'password-123', name: 'Meera' }) });
    const meeraId = (await su.json()).user.id;
    const b3 = await begin(); claims = good(b3, { sub: '555', email: 'meera@example.com', name: 'Meera G' });
    const r3 = await callback(b3); const me3 = await (await fetch(`${base}/api/me`, { headers: { cookie: cookieOf(r3, 'pw_session') } })).json();
    assert.equal(me3.user.id, meeraId); assert.equal(me3.user.googleOnly, false);
    const pw = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'meera@example.com', password: 'password-123' }) });
    assert.equal(pw.status, 200, 'the password still works after linking');
    // ...and a different Google account cannot take over that email
    const b3b = await begin(); claims = good(b3b, { sub: 'OTHER', email: 'meera@example.com' });
    assert.match((await callback(b3b)).headers.get('location'), /error=google_failed/);

    // refusals: each one sends the person back to the login page, and none sets a session
    const refuse = async (label, mutate, opts, expected) => {
      const b = await begin(); claims = good(b, mutate); tokenStatus = 200;
      const r = await callback(b, opts?.(b)); assert.equal(r.status, 302, label);
      assert.match(r.headers.get('location'), expected, label); assert.ok(!cookieOf(r, 'pw_session'), `${label}: no session`);
    };
    await refuse('wrong state', {}, (b) => ({ state: 'forged' }), /error=google_failed/);
    await refuse('no cookie', {}, () => ({ cookie: '' }), /error=google_failed/);
    await refuse('unverified email', { email_verified: false, email: 'x@example.com' }, null, /error=google_unverified/);
    await refuse('wrong audience', { aud: 'someone-else' }, null, /error=google_failed/);
    await refuse('wrong issuer', { iss: 'https://evil.example' }, null, /error=google_failed/);
    await refuse('expired', { exp: Math.floor(Date.now() / 1000) - 10 }, null, /error=google_failed/);
    await refuse('wrong nonce', { nonce: 'replayed' }, null, /error=google_failed/);
    const bt = await begin(); tokenStatus = 400; assert.match((await callback(bt)).headers.get('location'), /error=google_failed/); tokenStatus = 200;
    const cancelled = await fetch(`${base}/api/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    assert.match(cancelled.headers.get('location'), /error=google_cancelled/);

    // a Google-only account deletes itself by typing its email, since it has no password
    const del = (body) => fetch(`${base}/api/account/delete`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieOf(r2, 'pw_session') }, body: JSON.stringify(body) });
    assert.equal((await del({ password: 'nope' })).status, 401);
    assert.equal((await del({ password: 'RAVI@example.com' })).status, 200);
  } finally {
    srv.kill(); await new Promise((r) => google.close(r)); await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('Continue with Google is off, and says so, until the client id and secret are set', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pw-google-off-'));
  await fsp.writeFile(path.join(dir, 'sources.json'), JSON.stringify({ sources: [] }));
  const port = 4300 + Math.floor(Math.random() * 600);
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, SOURCES_FILE: path.join(dir, 'sources.json'), SIGNUP_FORM_URL: '' };
  delete env.GOOGLE_CLIENT_ID; delete env.GOOGLE_CLIENT_SECRET; delete env.UPSTASH_REDIS_REST_URL;
  const srv = spawn('node', ['server.js'], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`${base}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.equal((await (await fetch(`${base}/api/config`)).json()).google, false);
    const r = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
    assert.match(r.headers.get('location'), /error=google_off/);
  } finally { srv.kill(); await fsp.rm(dir, { recursive: true, force: true }); }
});
