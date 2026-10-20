// Dodo Payments subscriptions. The server makes a hosted checkout for the signed-in user, Dodo takes the payment, and then
// tells us by webhook; only the webhook (signature checked) ever switches paid access on. Nothing here ever sees a card.
import crypto from 'node:crypto';
import { loadUsers, saveUsers, lock } from './store.js';

const DAY = 86_400_000;
const base = () => process.env.DODO_API_BASE || (process.env.DODO_ENV === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com');

// Plans come from settings: DODO_PRODUCT_MONTHLY (and optionally DODO_PRODUCT_YEARLY) are product ids made in the Dodo dashboard.
export function plans() {
  const out = [];
  if (process.env.DODO_PRODUCT_MONTHLY) out.push({ id: 'monthly', productId: process.env.DODO_PRODUCT_MONTHLY, label: process.env.PRICE_LABEL || 'Monthly', days: 33 });
  if (process.env.DODO_PRODUCT_YEARLY) out.push({ id: 'yearly', productId: process.env.DODO_PRODUCT_YEARLY, label: process.env.PRICE_LABEL_YEARLY || 'Yearly', days: 372 });
  return out;
}
export const dodoEnabled = () => !!(process.env.DODO_API_KEY && plans().length);
export const publicPlans = () => (dodoEnabled() ? plans().map(({ id, label }) => ({ id, label })) : []);

async function dodo(path, body) {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.DODO_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Dodo ${res.status}: ${String(out.message || out.error || out.code || 'request failed').slice(0, 200)}`);
  return out;
}

export async function createCheckout(user, planId, appUrl) {
  const plan = plans().find((p) => p.id === planId);
  if (!plan) throw Object.assign(new Error('Unknown plan'), { code: 400 });
  const out = await dodo('/checkouts', {
    product_cart: [{ product_id: plan.productId, quantity: 1 }],
    customer: user.dodoCustomerId ? { customer_id: user.dodoCustomerId } : { email: user.email, name: user.name || user.email },
    return_url: `${appUrl}/?paid=1#/account`,
    metadata: { postwire_user_id: user.id },
  });
  const url = out.checkout_url || out.url;
  if (!url) throw new Error('Dodo did not return a checkout link');
  return url;
}

export async function createPortal(user, appUrl) {
  if (!user.dodoCustomerId) throw Object.assign(new Error('No billing account yet'), { code: 400 });
  const out = await dodo(`/customers/${encodeURIComponent(user.dodoCustomerId)}/customer-portal/session?return_url=${encodeURIComponent(`${appUrl}/#/account`)}`);
  if (!out.link) throw new Error('Dodo did not return a billing link');
  return out.link;
}

// Standard Webhooks signature: HMAC-SHA256 over "<webhook-id>.<webhook-timestamp>.<raw body>", base64, in the webhook-signature header ("v1,<sig>").
export function verifyWebhook(rawBody, headers, secret = process.env.DODO_WEBHOOK_SECRET, now = Date.now()) {
  if (!secret) return false;
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sigs = headers['webhook-signature'];
  if (!id || !ts || !sigs) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;                 // too old or from the future: replay protection
  const key = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest();
  return String(sigs).split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

// Apply one verified event. Safe to run twice and in any order: paid access only ever moves forward, except on "expired".
export async function applyEvent(event, now = Date.now()) {
  const type = String(event?.type || ''), d = event?.data || {};
  if (!type.startsWith('subscription.')) return { handled: false };
  return lock(async () => {
    const db = await loadUsers();
    const users = Object.values(db.users);
    const email = String(d.customer?.email || '').trim().toLowerCase();
    const user = db.users[d.metadata?.postwire_user_id]
      || users.find((u) => d.customer?.customer_id && u.dodoCustomerId === d.customer.customer_id)
      || users.find((u) => d.subscription_id && u.dodoSubscriptionId === d.subscription_id)
      || users.find((u) => email && u.email === email);
    if (!user) return { handled: false, reason: 'no matching account' };
    if (d.customer?.customer_id) user.dodoCustomerId = d.customer.customer_id;
    if (d.subscription_id) user.dodoSubscriptionId = d.subscription_id;
    const status = String(d.status || '').toLowerCase();
    const paid = Date.parse(user.paidUntil || 0) || 0;
    const interval = String(d.payment_frequency_interval || '').toLowerCase();
    const fallbackDays = interval.startsWith('year') ? 372 : 33;
    const goodUntil = (() => {                                                // paid period end, plus two days of slack for a late renewal
      const next = Date.parse(d.next_billing_date || 0);
      return (next > now ? next : now + fallbackDays * DAY) + (next > now ? 2 * DAY : 0);
    })();
    if (type === 'subscription.expired') { user.billingStatus = 'expired'; if (paid > now) user.paidUntil = new Date(now).toISOString(); }
    else if (type === 'subscription.cancelled' || status === 'cancelled') user.billingStatus = 'cancelled';   // they keep what they paid for
    else if (type === 'subscription.on_hold' || type === 'subscription.failed' || status === 'on_hold' || status === 'failed') user.billingStatus = 'payment_problem';
    else if (['subscription.active', 'subscription.renewed', 'subscription.plan_changed', 'subscription.updated'].includes(type) && (!status || status === 'active')) {
      user.billingStatus = 'active';
      user.paidUntil = new Date(Math.max(paid, goodUntil)).toISOString();
    } else return { handled: false, reason: 'ignored' };
    await saveUsers(db);
    return { handled: true, userId: user.id, status: user.billingStatus };
  });
}
