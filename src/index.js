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

    // ————— API organizator —————
    if (path === '/api/org/state') return only('GET', request, () => orgState(env));
    if (path === '/api/org/setup') return only('POST', request, () => orgSetup(request, env));
    if (path === '/api/org/requests') return only('GET', request, () => orgList(request, env));
    if (path === '/api/org/request') {
      if (request.method === 'GET') return orgGet(request, env, url);
      if (request.method === 'PUT') return orgUpdate(request, env, url);
      return methodNotAllowed('GET, PUT');
    }

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

  // Dacă vine header x-acc-token valid, legăm cererea de cont (token invalid = ignorat, contul e opțional).
  const owner = await resolveToken(request, env);

  const rec = await storeStub(env).createRequest({ profile, plan, owner });
  return json({ id: rec.id, status: rec.status });
}

async function myPlan(request, env, url) {
  if (!hasStore(env)) return storeMissing();
  const id = code(url);
  const rec = await storeStub(env).getRequest(id);
  if (!rec) return json({ error: 'Cod inexistent.' }, 404);
  return json({ status: rec.status, plan: rec.plan, note: rec.note, nume: rec.profile?.nume || '', updatedAt: rec.updatedAt, shoppingList: rec.shoppingList || [] });
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
  return json({ email: acc.email });
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
  const patch = {};
  if (body.plan !== undefined) patch.plan = normalizePlan(body.plan);
  if (body.status !== undefined) patch.status = body.status;
  if (body.note !== undefined) patch.note = body.note;
  if (body.shoppingList !== undefined) patch.shoppingList = body.shoppingList;
  const rec = await storeStub(env).updateRequest(code(url), patch);
  if (!rec) return json({ error: 'Cerere inexistentă.' }, 404);
  return json({ request: rec });
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
