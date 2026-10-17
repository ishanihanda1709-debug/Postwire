import { randomBytes, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { lock, loadUsers, saveUsers, loadSessions, saveSessions } from './store.js';
import { localParts } from './schedule.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'pw_session';
const SESSION_DAYS = 30;
const DAY = 86_400_000;

export const requireLogin = () => process.env.REQUIRE_LOGIN !== '0';
export const trialDays = () => Number(process.env.TRIAL_DAYS || 7);
export const aiDailyLimit = () => Number(process.env.AI_DAILY_LIMIT || 30);

// ---------- passwords ----------
const N = 16384;
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const key = await scryptAsync(password, Buffer.from(salt, 'hex'), 64, { N: Number(n), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used so that "unknown email" takes as long as "wrong password" (no account-existence timing leak).
let dummyHash;
export async function burnPasswordTime(password) {
  dummyHash ||= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e) && e.length <= 254;

// ---------- users ----------
export async function findUserByEmail(email) {
  const { users } = await loadUsers();
  return Object.values(users).find((u) => u.email === normalizeEmail(email)) || null;
}

export async function getUser(id) {
  const { users } = await loadUsers();
  return users[id] || null;
}

export async function userCount() { return Object.keys((await loadUsers()).users).length; }

export function createUser({ name, email, password, role }) {
  return lock(async () => {
    const db = await loadUsers();
    const e = normalizeEmail(email);
    if (Object.values(db.users).some((u) => u.email === e)) throw Object.assign(new Error('An account with this email already exists.'), { code: 409 });
    const first = Object.keys(db.users).length === 0;
    const now = Date.now();
    const user = {
      id: randomBytes(8).toString('hex'), email: e, name: String(name || '').trim().slice(0, 60) || e.split('@')[0],
      passHash: await hashPassword(password), role: role || (first ? 'admin' : 'user'),
      createdAt: new Date(now).toISOString(), trialEndsAt: new Date(now + trialDays() * DAY).toISOString(), paidUntil: null,
      usage: { date: '', ai: 0 },
    };
    db.users[user.id] = user;
    await saveUsers(db);
    return { user, first };
  });
}

export function updateUser(id, fn) {
  return lock(async () => {
    const db = await loadUsers();
    if (!db.users[id]) return null;
    await fn(db.users[id], db);
    await saveUsers(db);
    return db.users[id];
  });
}

export function deleteUser(id) {
  return lock(async () => {
    const db = await loadUsers(); delete db.users[id]; await saveUsers(db);
    const s = await loadSessions();
    for (const [k, v] of Object.entries(s.sessions)) if (v.userId === id) delete s.sessions[k];
    await saveSessions(s);
  });
}

// ---------- sessions ----------
const hashToken = (t) => createHash('sha256').update(t).digest('hex');
const parseCookies = (h = '') => Object.fromEntries(h.split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));

export function createSession(userId) {
  return lock(async () => {
    const db = await loadSessions();
    const now = Date.now();
    for (const [k, v] of Object.entries(db.sessions)) if (v.expires < now) delete db.sessions[k];
    const token = randomBytes(32).toString('base64url');
    db.sessions[hashToken(token)] = { userId, expires: now + SESSION_DAYS * DAY };
    await saveSessions(db);
    return token;
  });
}

export async function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return;
  await lock(async () => { const db = await loadSessions(); delete db.sessions[hashToken(token)]; await saveSessions(db); });
}

export function cookieFor(token, req) {
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

async function localUser() {
  const db = await loadUsers();
  const found = Object.values(db.users).find((u) => u.email === 'local@localhost');
  if (found) return found;
  try {
    const { user } = await createUser({ name: process.env.AUTHOR_NAME || 'You', email: 'local@localhost', password: randomBytes(18).toString('hex'), role: 'admin' });
    return user;
  } catch (e) {
    if (e.code === 409) return findUserByEmail('local@localhost'); // another request created it a moment ago
    throw e;
  }
}

export async function userFromRequest(req) {
  if (!requireLogin()) return localUser();
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const db = await loadSessions();
  const s = db.sessions[hashToken(token)];
  if (!s || s.expires < Date.now()) return null;
  return getUser(s.userId);
}

// ---------- plan / access ----------
export function accessInfo(user, now = Date.now()) {
  const trialEnds = Date.parse(user.trialEndsAt || 0), paid = Date.parse(user.paidUntil || 0);
  if (user.role === 'admin') return { access: true, plan: 'owner', daysLeft: null };
  if (paid > now) return { access: true, plan: 'active', daysLeft: Math.ceil((paid - now) / DAY) };
  if (trialEnds > now) return { access: true, plan: 'trial', daysLeft: Math.ceil((trialEnds - now) / DAY) };
  return { access: false, plan: 'expired', daysLeft: 0 };
}

export function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, trialEndsAt: u.trialEndsAt, paidUntil: u.paidUntil, ...accessInfo(u) };
}

// ---------- AI daily allowance ----------
export const aiUsedToday = (u) => (u.usage?.date === localParts(new Date()).ymd ? u.usage.ai : 0);

export async function consumeAi(userId) {
  let allowed = false;
  await updateUser(userId, (u) => {
    const today = localParts(new Date()).ymd;
    if (u.usage?.date !== today) u.usage = { date: today, ai: 0 };
    if (u.role === 'admin' || u.usage.ai < aiDailyLimit()) { u.usage.ai++; allowed = true; }
  });
  return allowed;
}

export async function refundAi(userId) {
  await updateUser(userId, (u) => { if (u.usage?.ai > 0) u.usage.ai--; });
}

// ---------- simple in-memory rate limiter ----------
const hits = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
