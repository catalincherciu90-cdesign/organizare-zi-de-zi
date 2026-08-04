// Worker principal — Organizare Zi de Zi
// Servește site-ul static (binding ASSETS), API-ul de organizare și panoul organizatorului.

import { handlePlan, normalizePlan, sanitizeProfile } from './plan.js';
import { hasStore, createRequest, getRequest, updateRequest, listRequests, toSummary } from './store.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ————— API —————
    if (path === '/api/plan') {
      return only('POST', request, () => handlePlan(request, env));
    }
    if (path === '/api/submit') {
      return only('POST', request, () => submit(request, env));
    }
    if (path === '/api/my') {
      return only('GET', request, () => myPlan(request, env, url));
    }
    if (path === '/api/org/requests') {
      return only('GET', request, () => orgList(request, env));
    }
    if (path === '/api/org/request') {
      if (request.method === 'GET') return orgGet(request, env, url);
      if (request.method === 'PUT') return orgUpdate(request, env, url);
      return methodNotAllowed('GET, PUT');
    }

    // URL prietenos pentru panoul organizatorului
    if (path === '/organizator' || path === '/organizator/') {
      return env.ASSETS.fetch(new Request(new URL('/organizator.html', url), request));
    }

    // ————— Fișiere statice (index.html, styles.css, app.js, ...) —————
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

  const rec = await createRequest(env, { profile, plan });
  return json({ id: rec.id, status: rec.status });
}

async function myPlan(request, env, url) {
  if (!hasStore(env)) return storeMissing();
  const id = (url.searchParams.get('id') || '').trim().toLowerCase();
  const rec = await getRequest(env, id);
  if (!rec) return json({ error: 'Cod inexistent.' }, 404);
  return json({
    status: rec.status,
    plan: rec.plan,
    note: rec.note,
    nume: rec.profile?.nume || '',
    updatedAt: rec.updatedAt,
  });
}

// ————— Organizator (protejat prin token) —————

function orgAuth(request, env) {
  if (!env.ORGANIZER_TOKEN) return 'unset';
  const t = request.headers.get('x-org-token');
  return t && t === env.ORGANIZER_TOKEN ? 'ok' : 'denied';
}

function guard(request, env) {
  if (!hasStore(env)) return storeMissing();
  const a = orgAuth(request, env);
  if (a === 'unset') return json({ error: 'ORGANIZER_TOKEN nu e setat în Worker. Vezi README.' }, 503);
  if (a === 'denied') return json({ error: 'Token invalid.' }, 401);
  return null;
}

async function orgList(request, env) {
  const blocked = guard(request, env);
  if (blocked) return blocked;
  const recs = await listRequests(env);
  return json({ requests: recs.map(toSummary) });
}

async function orgGet(request, env, url) {
  const blocked = guard(request, env);
  if (blocked) return blocked;
  const rec = await getRequest(env, (url.searchParams.get('id') || '').trim().toLowerCase());
  if (!rec) return json({ error: 'Cerere inexistentă.' }, 404);
  return json({ request: rec });
}

async function orgUpdate(request, env, url) {
  const blocked = guard(request, env);
  if (blocked) return blocked;
  const id = (url.searchParams.get('id') || '').trim().toLowerCase();
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
  const rec = await updateRequest(env, id, patch);
  if (!rec) return json({ error: 'Cerere inexistentă.' }, 404);
  return json({ request: rec });
}

// ————— utilitare HTTP —————

function only(method, request, handler) {
  if (request.method !== method) return methodNotAllowed(method);
  return handler();
}

function methodNotAllowed(allow) {
  return new Response('Method Not Allowed', { status: 405, headers: { allow } });
}

function storeMissing() {
  return json(
    { error: 'Stocarea (Cloudflare KV) nu e configurată. Creează un namespace KV și leagă-l ca OZZ. Vezi README.' },
    503,
  );
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
