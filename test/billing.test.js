import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

const SECRET = 'whsec_' + Buffer.from('a-test-signing-key-123456').toString('base64');
const sign = (body, id = 'msg_1', ts = Math.floor(Date.now() / 1000), secret = SECRET) => {
  const key = Buffer.from(secret.slice(6), 'base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64') };
};

test('webhook signatures: valid passes, tampered, wrong secret, old and missing headers fail', async () => {
  const { verifyWebhook } = await import('../lib/dodo.js');
  const body = JSON.stringify({ type: 'subscription.active' });
  assert.equal(verifyWebhook(body, sign(body), SECRET), true);
  assert.equal(verifyWebhook(body + ' ', sign(body), SECRET), false);
  assert.equal(verifyWebhook(body, sign(body, 'm', undefined, 'whsec_' + Buffer.from('other').toString('base64')), SECRET), false);
  assert.equal(verifyWebhook(body, sign(body, 'm', Math.floor(Date.now() / 1000) - 3600), SECRET), false);
  assert.equal(verifyWebhook(body, {}, SECRET), false);
  assert.equal(verifyWebhook(body, sign(body), ''), false);
  const two = sign(body); two['webhook-signature'] = 'v1,AAAA ' + two['webhook-signature'];   // several signatures are allowed
  assert.equal(verifyWebhook(body, two, SECRET), true);
});

test('Dodo checkout, billing portal and subscription events switch paid access on and off', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.startsWith('/checkouts') ? { session_id: 's1', checkout_url: 'https://pay.example/c/s1' } : { link: 'https://pay.example/portal' }));
  }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pw-dodo-'));
  const prev = { ...process.env };
  try {
    Object.assign(process.env, { DATA_DIR: dir, DODO_API_KEY: 'k', DODO_API_BASE: `http://127.0.0.1:${srv.address().port}`, DODO_PRODUCT_MONTHLY: 'pdt_m', DODO_PRODUCT_YEARLY: 'pdt_y', PRICE_LABEL: '₹399 / month', PRICE_LABEL_YEARLY: '₹3,499 / year' });
    delete process.env.UPSTASH_REDIS_REST_URL;
    const d = await import('../lib/dodo.js'); const st = await import('../lib/store.js');
    assert.equal(d.dodoEnabled(), true);
    assert.deepEqual(d.publicPlans().map((p) => p.id), ['monthly', 'yearly']);
    const user = { id: 'u1', name: 'Asha', email: 'asha@example.com', role: 'user', trialEndsAt: '2020-01-01T00:00:00Z', paidUntil: null };
    await st.saveUsers({ users: { u1: user } });

    assert.equal(await d.createCheckout(user, 'monthly', 'https://postwire.in'), 'https://pay.example/c/s1');
    assert.equal(seen[0].auth, 'Bearer k');
    assert.deepEqual(seen[0].body.product_cart, [{ product_id: 'pdt_m', quantity: 1 }]);
    assert.equal(seen[0].body.metadata.postwire_user_id, 'u1');
    assert.equal(seen[0].body.return_url, 'https://postwire.in/?paid=1#/account');
    await assert.rejects(() => d.createCheckout(user, 'lifetime', 'https://postwire.in'));

    const next = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const active = { type: 'subscription.active', data: { subscription_id: 'sub_1', status: 'active', next_billing_date: next, customer: { customer_id: 'cus_1', email: 'ASHA@example.com' }, metadata: { postwire_user_id: 'u1' } } };
    assert.equal((await d.applyEvent(active)).handled, true);
    let u = (await st.loadUsers()).users.u1;
    assert.equal(u.billingStatus, 'active'); assert.equal(u.dodoCustomerId, 'cus_1');
    assert.ok(Date.parse(u.paidUntil) > Date.parse(next));                  // renewal slack on top of the billing date

    const before = u.paidUntil;
    await d.applyEvent({ type: 'subscription.renewed', data: { ...active.data, next_billing_date: new Date(Date.now() + 10 * 86_400_000).toISOString() } });   // an older, out-of-order event
    assert.equal((await st.loadUsers()).users.u1.paidUntil, before);        // never moves backwards

    await d.applyEvent({ type: 'subscription.cancelled', data: { subscription_id: 'sub_1', customer: { customer_id: 'cus_1' } } });
    u = (await st.loadUsers()).users.u1;
    assert.equal(u.billingStatus, 'cancelled'); assert.equal(u.paidUntil, before);   // keeps what was paid for

    assert.equal(await d.createPortal(u, 'https://postwire.in'), 'https://pay.example/portal');
    assert.ok(seen.at(-1).url.startsWith('/customers/cus_1/customer-portal/session'));

    await d.applyEvent({ type: 'subscription.expired', data: { subscription_id: 'sub_1', customer: { customer_id: 'cus_1' } } });
    u = (await st.loadUsers()).users.u1;
    assert.equal(u.billingStatus, 'expired'); assert.ok(Date.parse(u.paidUntil) <= Date.now());

    assert.equal((await d.applyEvent({ type: 'subscription.active', data: { customer: { email: 'nobody@example.com' } } })).handled, false);
    assert.equal((await d.applyEvent({ type: 'payment.succeeded', data: {} })).handled, false);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    Object.assign(process.env, prev);
    await new Promise((r) => srv.close(r)); await fsp.rm(dir, { recursive: true, force: true });
  }
});
