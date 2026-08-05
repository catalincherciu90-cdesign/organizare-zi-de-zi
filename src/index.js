// Worker principal — Organizare Zi de Zi
// Servește site-ul static (binding ASSETS), API-ul de organizare și panoul organizatorului.
// Persistența e într-un Durable Object (binding STORE), creat automat la deploy.

import { handlePlan, normalizePlan, sanitizeProfile } from './plan.js';
import { toSummary } from './store.js';
import { Store, storeStub } from './do.js';

export { Store }; // clasa Durable Object trebuie exportată din modulul principal

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ————— API abonat —————
    if (path === '/api/plan') return only('POST', request, () => handlePlan(request, env));
    if (path === '/api/submit') return only('POST', request, () => submit(request, env));
    if (path === '/api/my') return only('GET', request, () => myPlan(request, env, url));

    // ————— API plăți (Stripe) — degradare grațioasă când lipsesc secretele —————
    if (path === '/api/billing/state') return only('GET', request, () => billingState(env));
    if (path === '/api/billing/checkout') return only('POST', request, () => billingCheckout(request, env));
    if (path === '/api/billing/portal') return only('POST', request, () => billingPortal(request, env));
    if (path === '/api/billing/webhook') return only('POST', request, () => billingWebhook(request, env));

    // ————— API cont abonat —————
    if (path === '/api/account/register') return only('POST', request, () => accRegister(request, env));
    if (path === '/api/account/login') return only('POST', request, () => accLogin(request, env));
    if (path === '/api/account/logout') return only('POST', request, () => accLogout(request, env));
    if (path === '/api/account/me') return only('GET', request, () => accMe(request, env));
    if (path === '/api/account/days') return only('GET', request, () => accDays(request, env));
    if (path === '/api/account/templates') {
      if (request.method === 'GET') return accListTemplates(request, env);
      if (request.method === 'POST') return accCreateTemplate(request, env);
      return methodNotAllowed('GET, POST');
    }
    if (path === '/api/account/template') {
      if (request.method === 'GET') return accGetTemplate(request, env, url);
      if (request.method === 'DELETE') return accDeleteTemplate(request, env, url);
      return methodNotAllowed('GET, DELETE');
    }

    // ————— Web Push —————
    if (path === '/api/push/key') return only('GET', request, () => pushKey(env));
    if (path === '/api/push/subscribe') return only('POST', request, () => pushSubscribe(request, env));
    if (path === '/api/push/unsubscribe') return only('POST', request, () => pushUnsubscribe(request, env));

    // ————— API organizator —————
    if (path === '/api/org/state') return only('GET', request, () => orgState(env));
    if (path === '/api/org/setup') return only('POST', request, () => orgSetup(request, env));
    if (path === '/api/org/requests') return only('GET', request, () => orgList(request, env));
    if (path === '/api/org/request') {
      if (request.method === 'GET') return orgGet(request, env, url);
      if (request.method === 'PUT') return orgUpdate(request, env, url);
      return methodNotAllowed('GET, PUT');
    }
    if (path === '/api/org/templates') {
      if (request.method === 'GET') return orgListTemplates(request, env);
      if (request.method === 'POST') return orgCreateTemplate(request, env);
      return methodNotAllowed('GET, POST');
    }
    if (path === '/api/org/template') {
      if (request.method === 'GET') return orgGetTemplate(request, env, url);
      if (request.method === 'DELETE') return orgDeleteTemplate(request, env, url);
      return methodNotAllowed('GET, DELETE');
    }
    if (path === '/api/org/stats') return only('GET', request, () => orgGetStats(request, env));

    // URL prietenos pentru panou
    if (path === '/organizator' || path === '/organizator/') {
      return env.ASSETS.fetch(new Request(new URL('/organizator.html', url), request));
    }

    // Fișiere statice
    return env.ASSETS.fetch(request);
  },
};

// ————— Helper: rezolvă accId din header-ul x-acc-token —————
// Dacă token-ul lipsește sau e invalid → null (nu blochează cererea).
async function resolveToken(request, env) {
  const token = request.headers.get('x-acc-token');
  if (!token || !hasStore(env)) return null;
  return storeStub(env).getSession(token);
}

// ————— Abonat —————

async function submit(request, env) {
  if (!hasStore(env)) return storeMissing();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body invalid.' }, 400);
  }
  const profile = sanitizeProfile(body.profile || {});
  const plan = normalizePlan(body.plan || {});
  if (!plan.blocks.length) return json({ error: 'Planul e gol.' }, 400);

  // Cererea trebuie să vină de la un utilizator autentificat
  const owner = await resolveToken(request, env);
  if (!owner) return json({ error: 'Autentifică-te ca să trimiți planul.' }, 401);

  const rec = await storeStub(env).createRequest({ profile, plan, owner });
  return json({ id: rec.id, status: rec.status });
}

async function myPlan(request, env, url) {
  if (!hasStore(env)) return storeMissing();
  const id = code(url);
  const rec = await storeStub(env).getRequest(id);
  if (!rec) return json({ error: 'Cod inexistent.' }, 404);
  return json({ status: rec.status, plan: rec.plan, note: rec.note, nume: rec.profile?.nume || '', updatedAt: rec.updatedAt, shoppingList: rec.shoppingList || [], recipes: rec.recipes || [] });
}

// ————— Cont abonat —————

async function accRegister(request, env) {
  if (!hasStore(env)) return storeMissing();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body invalid.' }, 400); }
  try {
    const { id, email } = await storeStub(env).createAccount(
      String(body.email || ''),
      String(body.password || ''),
    );
    const token = await storeStub(env).createSession(id);
    return json({ token, email });
  } catch (err) {
    if (err.message === 'exists') return json({ error: 'Adresa de email este deja înregistrată.' }, 409);
    return json({ error: err.message || 'Eroare la înregistrare.' }, 400);
  }
}

async function accLogin(request, env) {
  if (!hasStore(env)) return storeMissing();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body invalid.' }, 400); }
  const accId = await storeStub(env).verifyAccount(
    String(body.email || ''),
    String(body.password || ''),
  );
  if (!accId) return json({ error: 'Email sau parolă incorectă.' }, 401);
  const token = await storeStub(env).createSession(accId);
  const acc = await storeStub(env).getAccount(String(body.email || ''));
  return json({ token, email: acc?.email || String(body.email || '').trim().toLowerCase() });
}

async function accLogout(request, env) {
  if (!hasStore(env)) return storeMissing();
  const token = request.headers.get('x-acc-token');
  if (token) await storeStub(env).deleteSession(token);
  return json({ ok: true });
}

async function accMe(request, env) {
  if (!hasStore(env)) return storeMissing();
  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);
  const acc = await storeStub(env).getAccountById(accId);
  if (!acc) return json({ error: 'Cont negăsit.' }, 401);
  return json({
    email: acc.email,
    plan: acc.plan || 'start',
    subStatus: acc.subStatus || 'inactive',
  });
}

async function accDays(request, env) {
  if (!hasStore(env)) return storeMissing();
  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);
  const recs = await storeStub(env).listByOwner(accId);
  return json({ days: recs.map(toSummary) });
}

// ————— Șabloane abonat —————

async function accListTemplates(request, env) {
  if (!hasStore(env)) return storeMissing();
  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);
  const templates = await storeStub(env).listTemplates(accId);
  return json({ templates });
}

async function accCreateTemplate(request, env) {
  if (!hasStore(env)) return storeMissing();
  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body invalid.' }, 400); }
  const plan = normalizePlan(body.plan || {});
  try {
    const result = await storeStub(env).createTemplate(accId, { name: body.name, plan });
    return json(result);
  } catch (err) {
    return json({ error: err.message || 'Eroare la salvare.' }, 400);
  }
}

async function accGetTemplate(request, env, url) {
  if (!hasStore(env)) return storeMissing();
  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);
  const template = await storeStub(env).getTemplate(accId, code(url));
  if (!template) return json({ error: 'Rutină inexistentă.' }, 404);
  return json({ template });
}

async function accDeleteTemplate(request, env, url) {
  if (!hasStore(env)) return storeMissing();
  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);
  const ok = await storeStub(env).deleteTemplate(accId, code(url));
  if (!ok) return json({ error: 'Rutină inexistentă.' }, 404);
  return json({ ok: true });
}

// ————— Organizator —————

async function isConfigured(env) {
  if (env.ORGANIZER_TOKEN) return true;
  return !!(await storeStub(env).getAuth());
}

async function checkAuth(request, env) {
  const t = request.headers.get('x-org-token');
  if (!t) return false;
  if (env.ORGANIZER_TOKEN) return t === env.ORGANIZER_TOKEN;
  return storeStub(env).verifyPassword(t);
}

async function orgState(env) {
  if (!hasStore(env)) return storeMissing();
  return json({ configured: await isConfigured(env), viaSecret: !!env.ORGANIZER_TOKEN });
}

async function orgSetup(request, env) {
  if (!hasStore(env)) return storeMissing();
  if (env.ORGANIZER_TOKEN) return json({ error: 'Accesul e deja configurat printr-un secret (ORGANIZER_TOKEN).' }, 409);
  if (await storeStub(env).getAuth()) return json({ error: 'Parola e deja setată.' }, 409);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body invalid.' }, 400);
  }
  const password = String(body.password || '');
  if (password.length < 6) return json({ error: 'Parola trebuie să aibă minim 6 caractere.' }, 400);
  await storeStub(env).setPassword(password);
  return json({ ok: true });
}

async function guard(request, env) {
  if (!hasStore(env)) return storeMissing();
  if (!(await isConfigured(env))) return json({ error: 'not_configured' }, 401);
  if (!(await checkAuth(request, env))) return json({ error: 'Token invalid.' }, 401);
  return null;
}

async function orgList(request, env) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const recs = await storeStub(env).listRequests();
  return json({ requests: recs.map(toSummary) });
}

async function orgGet(request, env, url) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const rec = await storeStub(env).getRequest(code(url));
  if (!rec) return json({ error: 'Cerere inexistentă.' }, 404);
  return json({ request: rec });
}

async function orgUpdate(request, env, url) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body invalid.' }, 400);
  }
  const reqId = code(url);
  // Citim starea anterioară pentru a detecta tranziția la 'gata'.
  const prev = await storeStub(env).getRequest(reqId);
  const patch = {};
  if (body.plan !== undefined) patch.plan = normalizePlan(body.plan);
  if (body.status !== undefined) patch.status = body.status;
  if (body.note !== undefined) patch.note = body.note;
  if (body.shoppingList !== undefined) patch.shoppingList = body.shoppingList;
  if (body.recipes !== undefined) patch.recipes = body.recipes;
  const rec = await storeStub(env).updateRequest(reqId, patch);
  if (!rec) return json({ error: 'Cerere inexistentă.' }, 404);
  // Best-effort: trimite push dacă statusul tocmai a devenit 'gata'.
  if (rec.status === 'gata' && prev && prev.status !== 'gata') {
    try { await sendPushGata(env, reqId); } catch (_) { /* ignorat — best-effort */ }
  }
  return json({ request: rec });
}

// ————— Organizator: șabloane globale + statistici —————

async function orgListTemplates(request, env) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const templates = await storeStub(env).listOrgTemplates();
  return json({ templates });
}

async function orgCreateTemplate(request, env) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body invalid.' }, 400); }
  const plan = normalizePlan(body.plan || {});
  try {
    const result = await storeStub(env).createOrgTemplate({ name: body.name, plan });
    return json(result);
  } catch (err) {
    return json({ error: err.message || 'Eroare la salvare.' }, 400);
  }
}

async function orgGetTemplate(request, env, url) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const template = await storeStub(env).getOrgTemplate(code(url));
  if (!template) return json({ error: 'Șablon inexistent.' }, 404);
  return json({ template });
}

async function orgDeleteTemplate(request, env, url) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const ok = await storeStub(env).deleteOrgTemplate(code(url));
  if (!ok) return json({ error: 'Șablon inexistent.' }, 404);
  return json({ ok: true });
}

async function orgGetStats(request, env) {
  const blocked = await guard(request, env);
  if (blocked) return blocked;
  const stats = await storeStub(env).orgStats();
  return json(stats);
}

// ————— Billing (Stripe) —————

// true dacă secretul Stripe e configurat; false = billing neconfigurat
function billingConfigured(env) {
  return !!env.STRIPE_SECRET_KEY;
}

// GET /api/billing/state — public, fără autentificare
function billingState(env) {
  return json({ configured: billingConfigured(env) });
}

// POST /api/billing/checkout — creează un Stripe Checkout Session
async function billingCheckout(request, env) {
  if (!hasStore(env)) return storeMissing();
  if (!billingConfigured(env)) return json({ error: 'Plățile nu sunt configurate.' }, 503);

  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body invalid.' }, 400); }

  const plan = body.plan;
  if (!['echilibru', 'premium'].includes(plan)) {
    return json({ error: 'Plan invalid. Valori acceptate: echilibru, premium.' }, 400);
  }

  const acc = await storeStub(env).getAccountById(accId);
  if (!acc) return json({ error: 'Cont negăsit.' }, 401);

  const priceId = plan === 'echilibru' ? env.STRIPE_PRICE_ECHILIBRU : env.STRIPE_PRICE_PREMIUM;
  if (!priceId) return json({ error: `Price ID pentru planul ${plan} nu e configurat.` }, 503);

  const origin = new URL(request.url).origin;

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: accId,
    customer_email: acc.email,
    'metadata[plan]': plan,
    success_url: origin + '/?billing=success',
    cancel_url: origin + '/#preturi',
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.json().catch(() => ({}));
    return json({ error: err.error?.message || 'Eroare Stripe la creare sesiune.' }, 502);
  }

  const session = await stripeRes.json();
  return json({ url: session.url });
}

// POST /api/billing/portal — creează un Billing Portal Session
async function billingPortal(request, env) {
  if (!hasStore(env)) return storeMissing();
  if (!billingConfigured(env)) return json({ error: 'Plățile nu sunt configurate.' }, 503);

  const accId = await resolveToken(request, env);
  if (!accId) return json({ error: 'Token invalid.' }, 401);

  const acc = await storeStub(env).getAccountById(accId);
  if (!acc) return json({ error: 'Cont negăsit.' }, 401);

  if (!acc.customerId) return json({ error: 'Contul nu are un abonament Stripe asociat.' }, 400);

  const origin = new URL(request.url).origin;

  const params = new URLSearchParams({
    customer: acc.customerId,
    return_url: origin,
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.json().catch(() => ({}));
    return json({ error: err.error?.message || 'Eroare Stripe la portal.' }, 502);
  }

  const session = await stripeRes.json();
  return json({ url: session.url });
}

// POST /api/billing/webhook — primește și verifică evenimente Stripe
async function billingWebhook(request, env) {
  if (!hasStore(env)) return storeMissing();
  if (!billingConfigured(env)) return json({ error: 'Plățile nu sunt configurate.' }, 503);

  const rawBody = await request.text();
  const sigHeader = request.headers.get('stripe-signature') || '';

  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET || '');
  if (!valid) return json({ error: 'Semnătură invalidă.' }, 400);

  let event;
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'Body invalid.' }, 400); }

  const obj = event?.data?.object;

  if (event.type === 'checkout.session.completed') {
    const accId = obj.client_reference_id;
    const customerId = obj.customer;
    const subId = obj.subscription;
    const plan = obj.metadata?.plan || 'echilibru';
    if (accId) {
      await storeStub(env).setAccountBilling(accId, {
        plan,
        subStatus: 'active',
        customerId,
        subId,
      });
      if (customerId) await storeStub(env).linkCustomer(customerId, accId);
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const customerId = obj.customer;
    if (customerId) {
      const accId = await storeStub(env).getAccountIdByCustomer(customerId);
      if (accId) {
        await storeStub(env).setAccountBilling(accId, { plan: 'start', subStatus: 'canceled' });
      }
    }
  } else if (event.type === 'customer.subscription.updated') {
    const customerId = obj.customer;
    const subStatus = obj.status || 'unknown';
    if (customerId) {
      const accId = await storeStub(env).getAccountIdByCustomer(customerId);
      if (accId) {
        await storeStub(env).setAccountBilling(accId, { subStatus });
      }
    }
  }
  // Orice alt tip de eveniment → tot 200 (Stripe re-încearcă altfel)
  return json({ ok: true });
}

// Verifică semnătura HMAC-SHA256 a unui webhook Stripe.
// Formatul header-ului: t=<timestamp>,v1=<hex>,v1=<hex>,...
// Payload semnat: <timestamp>.<rawBody>
// Comparație în timp constant per valoare v1.
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const t = sigHeader.match(/t=(\d+)/)?.[1];
  const v1s = [...sigHeader.matchAll(/v1=([a-f0-9]+)/g)].map((m) => m[1]);

  if (!t || !v1s.length) return false;

  const signedPayload = `${t}.${rawBody}`;
  const enc = new TextEncoder();

  let key;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return false;
  }

  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(signedPayload));
  const computed = [...new Uint8Array(sigBytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Comparăm împotriva fiecărei valori v1 (Stripe poate trimite mai multe)
  for (const v1 of v1s) {
    if (v1.length !== computed.length) continue;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}

// ————— Web Push —————

// Convertește bytes la base64url (fără padding).
function b64urlBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Encodează un string UTF-8 la base64url.
function b64urlStr(str) {
  return b64urlBytes(new TextEncoder().encode(str));
}

// Construiește un VAPID JWT ES256 (JOSE format: r||s raw, 64 bytes).
async function buildVapidJwt(privateJwk, audience, subEmail) {
  const headerB64 = b64urlStr(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payloadB64 = b64urlStr(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200, // 12 ore
    sub: subEmail,
  }));
  const toSign = headerB64 + '.' + payloadB64;
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    new TextEncoder().encode(toSign),
  );
  return toSign + '.' + b64urlBytes(new Uint8Array(sig));
}

// Returnează perechea VAPID din DO; o generează și o salvează dacă nu există încă.
async function getOrCreateVapid(env) {
  const stub = storeStub(env);
  const existing = await stub.getVapid();
  if (existing) return existing;
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const vapid = { publicKey: b64urlBytes(new Uint8Array(pubRaw)), privateJwk };
  await stub.setVapid(vapid);
  return vapid;
}

// Trimite un bare push (fără payload) la subscription-ul salvat pentru un cod.
// Best-effort: nu aruncă niciodată (apelantul prinde erorile proprii).
async function sendPushGata(env, code) {
  const stub = storeStub(env);
  const sub = await stub.getPushSub(code);
  if (!sub) return;
  const vapid = await getOrCreateVapid(env);
  const audience = new URL(sub.endpoint).origin;
  const jwt = await buildVapidJwt(vapid.privateJwk, audience, 'mailto:organizare@example.com');
  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': 'vapid t=' + jwt + ', k=' + vapid.publicKey,
      'TTL': '86400',
      'Content-Length': '0',
    },
  });
  // Subscription expirat sau invalid → curățăm din storage.
  if (resp.status === 404 || resp.status === 410) {
    await stub.deletePushSub(code);
  }
}

// GET /api/push/key → { key: vapidPublicBase64url }
async function pushKey(env) {
  if (!hasStore(env)) return storeMissing();
  const vapid = await getOrCreateVapid(env);
  return json({ key: vapid.publicKey });
}

// POST /api/push/subscribe { code, subscription } → { ok: true }
async function pushSubscribe(request, env) {
  if (!hasStore(env)) return storeMissing();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body invalid.' }, 400); }
  const reqCode = String(body.code || '').trim().toLowerCase();
  if (!reqCode) return json({ error: 'Cod lipsă.' }, 400);
  const rec = await storeStub(env).getRequest(reqCode);
  if (!rec) return json({ error: 'Cod inexistent.' }, 404);
  const subscription = body.subscription;
  if (!subscription || !subscription.endpoint) return json({ error: 'Subscription invalidă.' }, 400);
  await storeStub(env).savePushSub(reqCode, subscription);
  return json({ ok: true });
}

// POST /api/push/unsubscribe { code } → { ok: true }
async function pushUnsubscribe(request, env) {
  if (!hasStore(env)) return storeMissing();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body invalid.' }, 400); }
  const reqCode = String(body.code || '').trim().toLowerCase();
  if (!reqCode) return json({ error: 'Cod lipsă.' }, 400);
  await storeStub(env).deletePushSub(reqCode);
  return json({ ok: true });
}

// ————— utilitare HTTP —————

function hasStore(env) {
  return !!(env && env.STORE);
}
function code(url) {
  return (url.searchParams.get('id') || '').trim().toLowerCase();
}
function only(method, request, handler) {
  if (request.method !== method) return methodNotAllowed(method);
  return handler();
}
function methodNotAllowed(allow) {
  return new Response('Method Not Allowed', { status: 405, headers: { allow } });
}
function storeMissing() {
  return json({ error: 'Stocarea (Durable Object) nu e disponibilă. Verifică wrangler.toml.' }, 503);
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
