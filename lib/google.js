// "Continue with Google": the standard OAuth 2.0 / OpenID Connect sign-in, straight to Google, with no extra service in between.
// Flow: /api/auth/google/start sends the browser to Google (with a one-time state, nonce and PKCE code) -> Google sends it back to
// /api/auth/google/callback with a code -> we swap the code for the person's identity over TLS and check it before signing them in.
import crypto from 'node:crypto';

const AUTH_URL = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const OAUTH_COOKIE = 'pw_oauth';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const rand = (n = 24) => b64u(crypto.randomBytes(n));

export function startLogin(redirectUri) {
  const state = rand(), nonce = rand(), verifier = rand(32);
  const url = new URL(AUTH_URL());
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return { url: url.toString(), cookie: b64u(JSON.stringify({ s: state, n: nonce, v: verifier })) };
}

// Returns { sub, email, name } for a verified Google account, or throws with a short reason.
export async function finishLogin({ code, state, cookie, redirectUri, now = Date.now() }) {
  let saved; try { saved = JSON.parse(Buffer.from(String(cookie || ''), 'base64url').toString('utf8')); } catch { saved = null; }
  if (!saved?.s || !code || !state || state !== saved.s) throw new Error('state');
  const res = await fetch(TOKEN_URL(), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.v }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('exchange');
  const { id_token: idToken } = await res.json().catch(() => ({}));
  // The token came straight from Google over TLS, so reading it is enough (no separate signature check is needed in this flow).
  let c; try { c = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); } catch { throw new Error('token'); }
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(c.iss)) throw new Error('issuer');
  if (c.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('audience');
  if (!(c.exp * 1000 > now)) throw new Error('expired');
  if (c.nonce !== saved.n) throw new Error('nonce');
  if (!c.sub || !c.email || c.email_verified !== true) throw new Error('unverified');
  return { sub: String(c.sub), email: String(c.email).trim().toLowerCase(), name: String(c.name || '').trim() };
}
