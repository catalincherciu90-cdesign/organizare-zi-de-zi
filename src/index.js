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

  const rec = await storeStub(env).createRequest({ profile, plan });
  return json({ id: rec.id, status: rec.status });
}

async function myPlan(request, env, url) {
  if (!hasStore(env)) return storeMissing();
  const id = code(url);
  const rec = await storeStub(env).getRequest(id);
  if (!rec) return json({ error: 'Cod inexistent.' }, 404);
  return json({ status: rec.status, plan: rec.plan, note: rec.note, nume: rec.profile?.nume || '', updatedAt: rec.updatedAt });
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
