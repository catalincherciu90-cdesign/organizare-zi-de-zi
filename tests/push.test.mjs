/**
 * Teste Web Push — fără dependențe externe.
 * Rulare: node --import /tmp/cf-register.mjs tests/push.test.mjs
 */

import assert from 'node:assert/strict';
import * as store from '../src/store.js';
import handler from '../src/index.js';

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
    createRequest:           (input)          => store.createRequest(s, input),
    getRequest:              (id)             => store.getRequest(s, id),
    updateRequest:           (id, patch)      => store.updateRequest(s, id, patch),
    listRequests:            (limit)          => store.listRequests(s, limit),
    listByOwner:             (accId, limit)   => store.listByOwner(s, accId, limit),
    getAuth:                 ()               => store.getAuth(s),
    setPassword:             (pw)             => store.setPassword(s, pw),
    verifyPassword:          (pw)             => store.verifyPassword(s, pw),
    createAccount:           (e, p)           => store.createAccount(s, e, p),
    getAccount:              (e)              => store.getAccount(s, e),
    getAccountById:          (id)             => store.getAccountById(s, id),
    verifyAccount:           (e, p)           => store.verifyAccount(s, e, p),
    createSession:           (accId)          => store.createSession(s, accId),
    getSession:              (token)          => store.getSession(s, token),
    deleteSession:           (token)          => store.deleteSession(s, token),
    setAccountBilling:       (accId, billing) => store.setAccountBilling(s, accId, billing),
    linkCustomer:            (cId, accId)     => store.linkCustomer(s, cId, accId),
    getAccountIdByCustomer:  (cId)            => store.getAccountIdByCustomer(s, cId),
    createTemplate:          (accId, input)   => store.createTemplate(s, accId, input),
    listTemplates:           (accId)          => store.listTemplates(s, accId),
    getTemplate:             (accId, id)      => store.getTemplate(s, accId, id),
    deleteTemplate:          (accId, id)      => store.deleteTemplate(s, accId, id),
    createOrgTemplate:       (input)          => store.createOrgTemplate(s, input),
    listOrgTemplates:        ()               => store.listOrgTemplates(s),
    getOrgTemplate:          (id)             => store.getOrgTemplate(s, id),
    deleteOrgTemplate:       (id)             => store.deleteOrgTemplate(s, id),
    orgStats:                ()               => store.orgStats(s),
    // ————— Web Push —————
    getVapid:                ()               => store.getVapid(s),
    setVapid:                (v)              => store.setVapid(s, v),
    savePushSub:             (code, sub)      => store.savePushSub(s, code, sub),
    getPushSub:              (code)           => store.getPushSub(s, code),
    deletePushSub:           (code)           => store.deletePushSub(s, code),
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

// Decodează un segment base64url în string UTF-8 (Node.js Buffer, fără atob).
function b64urlDecodeJson(seg) {
  const padding = '='.repeat((4 - (seg.length % 4)) % 4);
  const buf = Buffer.from((seg + padding).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return JSON.parse(buf.toString('utf8'));
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
// TEST 1 — store.js pur: getVapid / setVapid
// ═══════════════════════════════════════════════════════════════
console.log('\n[1] store.js pur — getVapid / setVapid');

try {
  const s = makeMockStorage();

  // Inițial: lipsă
  const empty = await store.getVapid(s);
  assert.equal(empty, null, 'getVapid → null când lipsă');
  ok('getVapid returnează null când nu există');

  // Scriere + citire
  const vapid = { publicKey: 'test-pubkey-b64url', privateJwk: { kty: 'EC', crv: 'P-256', d: 'test' } };
  await store.setVapid(s, vapid);
  const loaded = await store.getVapid(s);
  assert.deepEqual(loaded, vapid, 'getVapid returnează obiectul salvat');
  ok('setVapid/getVapid persistă perechea VAPID');

  // Suprascrie
  const vapid2 = { publicKey: 'alt-key', privateJwk: { kty: 'EC', crv: 'P-256', d: 'alt' } };
  await store.setVapid(s, vapid2);
  const loaded2 = await store.getVapid(s);
  assert.equal(loaded2.publicKey, 'alt-key', 'setVapid suprascrie');
  ok('setVapid suprascrie valoarea anterioară');
} catch (err) {
  ko('getVapid/setVapid', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 2 — store.js pur: savePushSub / getPushSub / deletePushSub
// ═══════════════════════════════════════════════════════════════
console.log('\n[2] store.js pur — savePushSub / getPushSub / deletePushSub');

try {
  const s = makeMockStorage();

  // Cod inexistent → null
  const missing = await store.getPushSub(s, 'abc123');
  assert.equal(missing, null, 'getPushSub → null când nu există');
  ok('getPushSub returnează null pentru cod inexistent');

  // Salvare + citire
  const sub = { endpoint: 'https://push.example.com/send/tok1', keys: { p256dh: 'xxx', auth: 'yyy' } };
  await store.savePushSub(s, 'abc123', sub);
  const loaded = await store.getPushSub(s, 'abc123');
  assert.deepEqual(loaded, sub, 'getPushSub returnează subscription salvat');
  ok('savePushSub/getPushSub funcționează corect');

  // Izolare pe cod diferit
  const other = await store.getPushSub(s, 'zzz999');
  assert.equal(other, null, 'getPushSub izolat pe cod diferit');
  ok('getPushSub izolează subscriptions pe coduri diferite');

  // Ștergere
  await store.deletePushSub(s, 'abc123');
  const afterDelete = await store.getPushSub(s, 'abc123');
  assert.equal(afterDelete, null, 'getPushSub → null după deletePushSub');
  ok('deletePushSub șterge subscription-ul');

  // deletePushSub pe cod inexistent — nu aruncă
  await store.deletePushSub(s, 'inexistent');
  ok('deletePushSub pe cod inexistent nu aruncă');
} catch (err) {
  ko('savePushSub/getPushSub/deletePushSub', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 3 — GET /api/push/key → cheie ne-goală
// ═══════════════════════════════════════════════════════════════
console.log('\n[3] GET /api/push/key — întoarce cheie base64url ne-goală');

let savedKey = null;
let savedKey_env = null;

try {
  const env = makeEnv();

  const res = await handler.fetch(
    new Request('https://test.example.com/api/push/key'),
    env, {},
  );
  assert.equal(res.status, 200, '/api/push/key → 200');
  const data = await res.json();
  assert.ok(typeof data.key === 'string' && data.key.length > 0, 'key string ne-gol');
  // Cheia trebuie să fie un punct necomprimat P-256: 65 bytes = 87-88 car. base64url
  assert.ok(data.key.length >= 80, 'cheia are lungimea corectă pentru P-256 raw (65 bytes)');
  savedKey = data.key;
  savedKey_env = env; // refolosim env-ul la testul următor
  ok('/api/push/key returnează cheie base64url P-256 corectă');
} catch (err) {
  ko('/api/push/key prima cerere', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 4 — GET /api/push/key a doua oară → ACEEAȘI cheie (persistă)
// ═══════════════════════════════════════════════════════════════
console.log('\n[4] GET /api/push/key — a doua cerere returnează ACEEAȘI cheie');

try {
  // Reutilizăm același env (același storage)
  const env = savedKey_env;

  const res2 = await handler.fetch(
    new Request('https://test.example.com/api/push/key'),
    env, {},
  );
  assert.equal(res2.status, 200, 'a doua cerere → 200');
  const data2 = await res2.json();
  assert.equal(data2.key, savedKey, 'cheia e identică la a doua cerere (persistată în DO)');
  ok('cheia VAPID persistă între cereri');
} catch (err) {
  ko('/api/push/key persistență', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 5 — POST /api/push/subscribe cu cod valid → ok; salvat
// ═══════════════════════════════════════════════════════════════
console.log('\n[5] POST /api/push/subscribe — cod valid → ok; subscription salvat');

let testReqId = null;
let testEnv = null;

try {
  const env = makeEnv({ ORGANIZER_TOKEN: 'tok-org' });
  testEnv = env;

  // Creăm o cerere în storage
  const req = await store.createRequest(env._storage, {
    profile: { nume: 'Test' },
    plan: { summary: 'test', blocks: [{ time: '08:00', title: 'dim', category: 'routine', detail: '' }], tips: [] },
  });
  testReqId = req.id;

  const testSub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-token-abc',
    keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
  };

  const res = await handler.fetch(
    new Request('https://test.example.com/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: testReqId, subscription: testSub }),
    }),
    env, {},
  );
  assert.equal(res.status, 200, 'subscribe → 200');
  const data = await res.json();
  assert.equal(data.ok, true, 'ok: true');
  ok('/api/push/subscribe → 200 { ok: true }');

  // Verificăm că e salvat în storage
  const saved = await store.getPushSub(env._storage, testReqId);
  assert.ok(saved, 'subscription salvat în storage');
  assert.equal(saved.endpoint, testSub.endpoint, 'endpoint salvat corect');
  ok('subscription salvat în storage cu endpoint corect');
} catch (err) {
  ko('/api/push/subscribe', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 6 — orgUpdate 'gata': mock fetch capturează POST push
//           + verifică Authorization header (vapid t=... k=...)
//           + decodează JWT payload: aud + exp
// ═══════════════════════════════════════════════════════════════
console.log('\n[6] orgUpdate → gata: mock fetch capturează push + verifică Authorization + JWT');

try {
  const env = testEnv; // același env, testReqId deja creat și subscris

  let capturedUrl = null;
  let capturedOpts = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedOpts = opts;
    return new Response('', { status: 201 });
  };

  try {
    const res = await handler.fetch(
      new Request('https://test.example.com/api/org/request?id=' + testReqId, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-org-token': 'tok-org',
        },
        body: JSON.stringify({ status: 'gata' }),
      }),
      env, {},
    );
    assert.equal(res.status, 200, 'orgUpdate → 200');
    const data = await res.json();
    assert.equal(data.request.status, 'gata', 'status actualizat la gata');
    ok('orgUpdate setează status gata');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Verificăm că fetch a fost apelat cu endpoint-ul corect
  assert.ok(capturedUrl, 'fetch apelat pentru push');
  assert.equal(capturedUrl, 'https://fcm.googleapis.com/fcm/send/test-token-abc', 'POST la endpoint-ul subscription');
  ok('POST trimis la endpoint-ul subscription-ului');

  // Verificăm Authorization header
  const authHeader = capturedOpts?.headers?.['Authorization'];
  assert.ok(authHeader, 'Authorization header prezent');
  assert.ok(authHeader.startsWith('vapid t='), 'Authorization începe cu "vapid t="');
  assert.ok(authHeader.includes(', k='), 'Authorization conține ", k="');
  ok('Authorization header: vapid t=<jwt>, k=<publicKey>');

  // TTL header
  const ttl = capturedOpts?.headers?.['TTL'];
  assert.equal(ttl, '86400', 'TTL header = 86400');
  ok('TTL header setat la 86400');

  // Decodăm JWT din header: <header>.<payload>.<sig>
  // Formatul: "vapid t=<jwt>, k=<key>"
  const jwtMatch = authHeader.match(/vapid t=([^,]+)/);
  assert.ok(jwtMatch, 'JWT extras din Authorization');
  const jwt = jwtMatch[1].trim();
  const parts = jwt.split('.');
  assert.equal(parts.length, 3, 'JWT are 3 segmente');

  const jwtHeader = b64urlDecodeJson(parts[0]);
  assert.equal(jwtHeader.alg, 'ES256', 'JWT header alg=ES256');
  assert.equal(jwtHeader.typ, 'JWT', 'JWT header typ=JWT');
  ok('JWT header: alg=ES256, typ=JWT');

  const jwtPayload = b64urlDecodeJson(parts[1]);
  assert.equal(jwtPayload.aud, 'https://fcm.googleapis.com', 'JWT aud = originul endpoint-ului');
  assert.ok(jwtPayload.exp > Math.floor(Date.now() / 1000), 'JWT exp în viitor');
  assert.ok(jwtPayload.exp <= Math.floor(Date.now() / 1000) + 43201, 'JWT exp ≤ acum + 12h');
  ok('JWT payload: aud = originul endpoint-ului, exp în viitor (12h)');

  // Verificăm că k= conține cheia publică
  const kMatch = authHeader.match(/, k=(.+)$/);
  assert.ok(kMatch, 'k= extras din Authorization');
  const pubKeyInHeader = kMatch[1].trim();
  assert.ok(pubKeyInHeader.length >= 80, 'cheia publică în k= are lungimea corectă');
  ok('k= conține cheia publică P-256 raw (base64url)');
} catch (err) {
  ko('orgUpdate gata + push Authorization + JWT', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 7 — orgUpdate 'gata': răspuns 410 din mock → subscription șters
// ═══════════════════════════════════════════════════════════════
console.log('\n[7] orgUpdate gata + fetch 410 → deletePushSub');

try {
  // Env nou cu o cerere + subscription proaspătă
  const env = makeEnv({ ORGANIZER_TOKEN: 'tok-org2' });
  const req = await store.createRequest(env._storage, {
    profile: { nume: 'Exp' },
    plan: { summary: '', blocks: [], tips: [] },
  });
  const reqId = req.id;
  const testSub = {
    endpoint: 'https://push.example.com/sub/expired-token',
    keys: { p256dh: 'abc', auth: 'def' },
  };
  await store.savePushSub(env._storage, reqId, testSub);

  // Verificăm că subscription există înainte
  const before = await store.getPushSub(env._storage, reqId);
  assert.ok(before, 'subscription exista inainte de orgUpdate');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 410 });

  try {
    await handler.fetch(
      new Request('https://test.example.com/api/org/request?id=' + reqId, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-org-token': 'tok-org2' },
        body: JSON.stringify({ status: 'gata' }),
      }),
      env, {},
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Verificăm că subscription a fost șters
  const after = await store.getPushSub(env._storage, reqId);
  assert.equal(after, null, 'subscription șters după răspuns 410');
  ok('răspuns 410 din push server → deletePushSub (subscription curățat)');
} catch (err) {
  ko('orgUpdate 410 → deletePushSub', err);
}

// ═══════════════════════════════════════════════════════════════
// TEST 8 — orgUpdate 'gata' fără subscription → nu aruncă
// ═══════════════════════════════════════════════════════════════
console.log('\n[8] orgUpdate gata fără subscription → nu aruncă, returnează 200');

try {
  const env = makeEnv({ ORGANIZER_TOKEN: 'tok-org3' });
  const req = await store.createRequest(env._storage, {
    profile: { nume: 'NoSub' },
    plan: { summary: '', blocks: [], tips: [] },
  });

  // Nu salvăm nicio subscription pentru acest cod

  let threwError = false;
  let resStatus = null;

  const originalFetch = globalThis.fetch;
  // fetch NU trebuie să fie apelat deloc (nu există subscription)
  globalThis.fetch = async () => {
    throw new Error('fetch nu ar trebui apelat cand nu exista subscription');
  };

  try {
    const res = await handler.fetch(
      new Request('https://test.example.com/api/org/request?id=' + req.id, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-org-token': 'tok-org3' },
        body: JSON.stringify({ status: 'gata' }),
      }),
      env, {},
    );
    resStatus = res.status;
  } catch (e) {
    threwError = true;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(threwError, false, 'orgUpdate nu a aruncat');
  assert.equal(resStatus, 200, 'orgUpdate returnează 200 chiar fără subscription');
  ok('orgUpdate fără subscription: nu aruncă, returnează 200');
} catch (err) {
  ko('orgUpdate fara subscription', err);
}

// ═══════════════════════════════════════════════════════════════
// Sumar
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(56)}`);
console.log(`Rezultat: ${pass} teste trecute, ${fail} esuate`);
if (fail > 0) process.exit(1);
console.log('TOATE TESTELE PUSH AU TRECUT');
