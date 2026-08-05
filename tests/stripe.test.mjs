/**
 * Teste pentru integrarea Stripe — fără dependențe externe.
 * Rulare: node --import /tmp/cf-register.mjs tests/stripe.test.mjs
 * (cf-loader/cf-register stub-uiesc `cloudflare:workers` cu un DurableObject dummy)
 */

import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import * as store from '../src/store.js';

// ————— Utilitare mock —————

function makeMockStorage() {
  const map = new Map();
  return {
    get: async (k) => (map.has(k) ? map.get(k) : null),
    put: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
    list: async ({ prefix, limit } = {}) => {
      let entries = [...map.entries()];
      if (prefix) entries = entries.filter(([k]) => k.startsWith(prefix));
      return new Map(entries.slice(0, limit != null ? limit : entries.length));
    },
  };
}

function makeStub(s) {
  return {
    createAccount: (e, p) => store.createAccount(s, e, p),
    getAccount: (e) => store.getAccount(s, e),
    getAccountById: (id) => store.getAccountById(s, id),
    verifyAccount: (e, p) => store.verifyAccount(s, e, p),
    createSession: (accId) => store.createSession(s, accId),
    getSession: (token) => store.getSession(s, token),
    deleteSession: (token) => store.deleteSession(s, token),
    setAccountBilling: (accId, billing) => store.setAccountBilling(s, accId, billing),
    linkCustomer: (cId, accId) => store.linkCustomer(s, cId, accId),
    getAccountIdByCustomer: (cId) => store.getAccountIdByCustomer(s, cId),
    createRequest: (input) => store.createRequest(s, input),
    getRequest: (id) => store.getRequest(s, id),
    updateRequest: (id, patch) => store.updateRequest(s, id, patch),
    listRequests: (limit) => store.listRequests(s, limit),
    listByOwner: (accId, limit) => store.listByOwner(s, accId, limit),
    getAuth: () => store.getAuth(s),
    setPassword: (pw) => store.setPassword(s, pw),
    verifyPassword: (pw) => store.verifyPassword(s, pw),
    createTemplate: (accId, input) => store.createTemplate(s, accId, input),
    listTemplates: (accId) => store.listTemplates(s, accId),
    getTemplate: (accId, id) => store.getTemplate(s, accId, id),
    deleteTemplate: (accId, id) => store.deleteTemplate(s, accId, id),
    createOrgTemplate: (input) => store.createOrgTemplate(s, input),
    listOrgTemplates: () => store.listOrgTemplates(s),
    getOrgTemplate: (id) => store.getOrgTemplate(s, id),
    deleteOrgTemplate: (id) => store.deleteOrgTemplate(s, id),
    orgStats: () => store.orgStats(s),
  };
}

function makeEnv(extra = {}) {
  const s = makeMockStorage();
  const stub = makeStub(s);
  return {
    _storage: s,
    _stub: stub,
    STORE: {
      idFromName: () => 'main',
      get: () => stub,
    },
    ASSETS: { fetch: async () => new Response('ok') },
    ...extra,
  };
}

// Calculează HMAC-SHA256 hex cu node:crypto (pentru a construi header-ul de test)
function signStripe(body, secret, timestamp) {
  const payload = timestamp + '.' + body;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

let pass = 0;
let fail = 0;

function ok(label) {
  console.log('  PASS ' + label);
  pass++;
}
function ko(label, err) {
  console.error('  FAIL ' + label, err?.message || err);
  fail++;
}

// ═══════════════════════════════════════════════════════════════
// TEST 1 — store.js pur: billing functions
// ═══════════════════════════════════════════════════════════════
console.log('\n[1] store.js pur — setAccountBilling / linkCustomer / getAccountIdByCustomer');

try {
  const s = makeMockStorage();
  const { id: accId } = await store.createAccount(s, 'billing@test.com', 'parola123');

  // Contul nou trebuie să aibă plan 'start' și subStatus 'inactive'
  const freshAcc = await store.getAccountById(s, accId);
  assert.equal(freshAcc.plan, 'start', 'plan implicit = start');
  assert.equal(freshAcc.subStatus, 'inactive', 'subStatus implicit = inactive');
  ok('cont nou are plan=start si subStatus=inactive');

  // setAccountBilling — actualizează câmpuri de billing
  await store.setAccountBilling(s, accId, {
    plan: 'echilibru',
    subStatus: 'active',
    customerId: 'cus_abc123',
    subId: 'sub_xyz456',
  });
  const updated = await store.getAccountById(s, accId);
  assert.equal(updated.plan, 'echilibru', 'plan actualizat');
  assert.equal(updated.subStatus, 'active', 'subStatus actualizat');
  assert.equal(updated.customerId, 'cus_abc123', 'customerId setat');
  assert.equal(updated.subId, 'sub_xyz456', 'subId setat');
  ok('setAccountBilling actualizează plan, subStatus, customerId, subId');

  // setAccountBilling parțial (doar subStatus)
  await store.setAccountBilling(s, accId, { subStatus: 'past_due' });
  const partial = await store.getAccountById(s, accId);
  assert.equal(partial.plan, 'echilibru', 'plan nemodificat la update partial');
  assert.equal(partial.subStatus, 'past_due', 'subStatus actualizat partial');
  ok('setAccountBilling update partial pastreaza campurile nemodificate');

  // linkCustomer + getAccountIdByCustomer
  await store.linkCustomer(s, 'cus_abc123', accId);
  const foundId = await store.getAccountIdByCustomer(s, 'cus_abc123');
  assert.equal(foundId, accId, 'getAccountIdByCustomer returnează accId corect');
  ok('linkCustomer + getAccountIdByCustomer functioneaza');

  // Customer inexistent → null
  const notFound = await store.getAccountIdByCustomer(s, 'cus_nonexistent');
  assert.equal(notFound, null, 'customer inexistent → null');
  ok('getAccountIdByCustomer returnează null pentru customer necunoscut');

  // setAccountBilling cu accId inexistent → null
  const res = await store.setAccountBilling(s, 'nonexistent_id', { plan: 'premium' });
  assert.equal(res, null, 'accId inexistent → null');
  ok('setAccountBilling cu accId inexistent returnează null');
} catch (err) {
  ko('store.js pur', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 2 — index.js: /api/billing/state
// ═══════════════════════════════════════════════════════════════
console.log('\n[2] GET /api/billing/state — configured flag');

import handler from '../src/index.js';

try {
  // Fără STRIPE_SECRET_KEY → configured: false
  const env1 = makeEnv();
  const res1 = await handler.fetch(
    new Request('https://test.example.com/api/billing/state'),
    env1, {},
  );
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.configured, false, 'configured=false fara STRIPE_SECRET_KEY');
  ok('/api/billing/state → configured:false fara cheie Stripe');

  // Cu STRIPE_SECRET_KEY → configured: true
  const env2 = makeEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' });
  const res2 = await handler.fetch(
    new Request('https://test.example.com/api/billing/state'),
    env2, {},
  );
  const data2 = await res2.json();
  assert.equal(data2.configured, true, 'configured=true cu STRIPE_SECRET_KEY');
  ok('/api/billing/state → configured:true cu cheie Stripe');
} catch (err) {
  ko('/api/billing/state', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 3 — /api/billing/checkout: 503 fără STRIPE_SECRET_KEY
// ═══════════════════════════════════════════════════════════════
console.log('\n[3] POST /api/billing/checkout — 503 fara STRIPE_SECRET_KEY');

try {
  const env = makeEnv();
  const res = await handler.fetch(
    new Request('https://test.example.com/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'echilibru' }),
    }),
    env, {},
  );
  assert.equal(res.status, 503, 'checkout fara STRIPE_SECRET_KEY → 503');
  ok('/api/billing/checkout fara STRIPE_SECRET_KEY → 503');
} catch (err) {
  ko('/api/billing/checkout 503', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4 — /api/billing/checkout: 401 fără token
// ═══════════════════════════════════════════════════════════════
console.log('\n[4] POST /api/billing/checkout — 401 fara token valid');

try {
  const env = makeEnv({
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_PRICE_ECHILIBRU: 'price_ech',
  });
  const res = await handler.fetch(
    new Request('https://test.example.com/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'echilibru' }),
    }),
    env, {},
  );
  assert.equal(res.status, 401, 'checkout fara token → 401');
  ok('/api/billing/checkout fara token → 401');
} catch (err) {
  ko('/api/billing/checkout 401', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 5 — /api/billing/checkout: succes cu fetch mock
// ═══════════════════════════════════════════════════════════════
console.log('\n[5] POST /api/billing/checkout — succes cu fetch mock');

try {
  const env = makeEnv({
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_PRICE_ECHILIBRU: 'price_ech_TEST123',
    STRIPE_PRICE_PREMIUM: 'price_prem_TEST456',
  });

  // Creare cont + sesiune în storage-ul mock
  const { id: accId } = await store.createAccount(env._storage, 'pay@test.com', 'parola123');
  const token = await store.createSession(env._storage, accId);

  // Mock global fetch pentru a intercepta apelul Stripe
  let capturedFetchUrl = null;
  let capturedFetchOpts = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedFetchUrl = url;
    capturedFetchOpts = opts;
    return new Response(
      JSON.stringify({ id: 'cs_test_session', url: 'https://checkout.stripe.com/x' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const res = await handler.fetch(
      new Request('https://test.example.com/api/billing/checkout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-acc-token': token,
        },
        body: JSON.stringify({ plan: 'echilibru' }),
      }),
      env, {},
    );

    assert.equal(res.status, 200, 'checkout cu token valid → 200');
    const data = await res.json();
    assert.equal(data.url, 'https://checkout.stripe.com/x', 'url checkout corect');
    ok('checkout returneaza url-ul de la Stripe');

    // Verificăm că fetch a fost apelat cu URL-ul corect Stripe
    assert.ok(capturedFetchUrl, 'fetch a fost apelat');
    assert.equal(
      capturedFetchUrl,
      'https://api.stripe.com/v1/checkout/sessions',
      'URL Stripe checkout sessions corect',
    );
    ok('fetch apelat catre URL-ul Stripe corect');

    // Verificăm parametrii trimiși
    const sentBody = new URLSearchParams(capturedFetchOpts.body);
    assert.equal(sentBody.get('line_items[0][price]'), 'price_ech_TEST123', 'price ID corect');
    assert.equal(sentBody.get('client_reference_id'), accId, 'client_reference_id = accId');
    assert.equal(sentBody.get('metadata[plan]'), 'echilibru', 'metadata[plan] setat');
    assert.equal(sentBody.get('mode'), 'subscription', 'mode=subscription');
    assert.equal(sentBody.get('line_items[0][quantity]'), '1', 'quantity=1');
    ok('parametrii URLSearchParams corect: price, client_reference_id, metadata[plan], mode, quantity');

    // Verificăm Authorization header
    const authHeader = capturedFetchOpts.headers?.Authorization || capturedFetchOpts.headers?.authorization;
    assert.ok(authHeader?.includes('sk_test_xxx'), 'Authorization header cu cheia Stripe');
    ok('Authorization header contine STRIPE_SECRET_KEY');
  } finally {
    globalThis.fetch = originalFetch;
  }
} catch (err) {
  ko('/api/billing/checkout succes cu fetch mock', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 6 — webhook: semnătură invalidă → 400
// ═══════════════════════════════════════════════════════════════
console.log('\n[6] POST /api/billing/webhook — semnatura invalida → 400');

try {
  const env = makeEnv({
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  });

  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
  const res = await handler.fetch(
    new Request('https://test.example.com/api/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1234567890,v1=invalidsignaturehex0000000000000000',
      },
      body,
    }),
    env, {},
  );
  assert.equal(res.status, 400, 'semnatura invalida → 400');
  ok('webhook cu semnatura invalida → 400');
} catch (err) {
  ko('webhook semnatura invalida', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 7 — webhook: checkout.session.completed cu semnătură validă
// ═══════════════════════════════════════════════════════════════
console.log('\n[7] POST /api/billing/webhook — checkout.session.completed cu semnatura valida');

try {
  const WEBHOOK_SECRET = 'whsec_test_known_secret_xyz789';
  const env = makeEnv({
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  // Creare cont în storage-ul mock
  const { id: accId } = await store.createAccount(env._storage, 'webhook@test.com', 'parola123');

  const timestamp = String(Math.floor(Date.now() / 1000));
  const eventBody = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: accId,
        customer: 'cus_webhook_test_001',
        subscription: 'sub_webhook_test_001',
        metadata: { plan: 'echilibru' },
      },
    },
  });

  // Calculăm HMAC cu node:crypto (la fel cum va verifica index.js cu Web Crypto)
  const sig = signStripe(eventBody, WEBHOOK_SECRET, timestamp);
  const stripeSignatureHeader = `t=${timestamp},v1=${sig}`;

  const res = await handler.fetch(
    new Request('https://test.example.com/api/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignatureHeader,
      },
      body: eventBody,
    }),
    env, {},
  );
  assert.equal(res.status, 200, 'webhook cu semnatura valida → 200');
  const data = await res.json();
  assert.equal(data.ok, true, 'raspuns ok:true');
  ok('webhook checkout.session.completed → 200 { ok: true }');

  // Verificăm că contul a fost actualizat
  const acc = await store.getAccountById(env._storage, accId);
  assert.equal(acc.plan, 'echilibru', 'plan actualizat la echilibru');
  assert.equal(acc.subStatus, 'active', 'subStatus actualizat la active');
  assert.equal(acc.customerId, 'cus_webhook_test_001', 'customerId setat din webhook');
  assert.equal(acc.subId, 'sub_webhook_test_001', 'subId setat din webhook');
  ok('contul a fost actualizat corect dupa checkout.session.completed');

  // Verificăm că linkul customer → acc a fost creat
  const linkedAccId = await store.getAccountIdByCustomer(env._storage, 'cus_webhook_test_001');
  assert.equal(linkedAccId, accId, 'linkCustomer a fost apelat');
  ok('linkCustomer a creat cust:<customerId> → accId');
} catch (err) {
  ko('webhook checkout.session.completed', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 8 — webhook: customer.subscription.deleted
// ═══════════════════════════════════════════════════════════════
console.log('\n[8] POST /api/billing/webhook — customer.subscription.deleted');

try {
  const WEBHOOK_SECRET = 'whsec_del_test_secret';
  const env = makeEnv({
    STRIPE_SECRET_KEY: 'sk_test_xxx',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  // Creare cont pe plan plătit + linkCustomer
  const { id: accId } = await store.createAccount(env._storage, 'del@test.com', 'parola123');
  await store.setAccountBilling(env._storage, accId, {
    plan: 'premium',
    subStatus: 'active',
    customerId: 'cus_del_test',
  });
  await store.linkCustomer(env._storage, 'cus_del_test', accId);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const eventBody = JSON.stringify({
    type: 'customer.subscription.deleted',
    data: {
      object: {
        customer: 'cus_del_test',
        status: 'canceled',
      },
    },
  });

  const sig = signStripe(eventBody, WEBHOOK_SECRET, timestamp);
  const res = await handler.fetch(
    new Request('https://test.example.com/api/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${sig}`,
      },
      body: eventBody,
    }),
    env, {},
  );
  assert.equal(res.status, 200, 'subscription.deleted → 200');

  const acc = await store.getAccountById(env._storage, accId);
  assert.equal(acc.plan, 'start', 'plan resetat la start dupa stergere');
  assert.equal(acc.subStatus, 'canceled', 'subStatus = canceled');
  ok('customer.subscription.deleted → plan=start, subStatus=canceled');
} catch (err) {
  ko('webhook subscription.deleted', err);
}

// ═══════════════════════════════════════════════════════════════
// Sumar
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(56)}`);
console.log(`Rezultat: ${pass} teste trecute, ${fail} esuate`);
if (fail > 0) {
  process.exit(1);
}
console.log('TOATE TESTELE STRIPE AU TRECUT');
