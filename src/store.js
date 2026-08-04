// Stratul de stocare — cererile abonaților, persistate în Cloudflare KV (binding OZZ).
// Fiecare cerere: profilul abonatului + planul zilei + status + o notă de la organizator.
//
// Fără binding-ul KV configurat, hasStore() întoarce false, iar Worker-ul răspunde
// cu un mesaj clar de setup în loc să pice.

export function hasStore(env) {
  return !!(env && env.OZZ);
}

const KEY = (id) => `req:${id}`;
const STATUSES = ['nou', 'in_lucru', 'gata'];

export async function createRequest(env, { profile, plan }) {
  const id = genId();
  const now = nowISO();
  const rec = {
    id,
    profile: profile || {},
    plan: plan || { summary: '', blocks: [], tips: [] },
    status: 'nou',
    note: '',
    createdAt: now,
    updatedAt: now,
  };
  await env.OZZ.put(KEY(id), JSON.stringify(rec));
  return rec;
}

export async function getRequest(env, id) {
  if (!id) return null;
  const raw = await env.OZZ.get(KEY(id));
  return raw ? JSON.parse(raw) : null;
}

export async function updateRequest(env, id, patch = {}) {
  const rec = await getRequest(env, id);
  if (!rec) return null;
  const next = {
    ...rec,
    plan: patch.plan !== undefined ? patch.plan : rec.plan,
    status: STATUSES.includes(patch.status) ? patch.status : rec.status,
    note: patch.note !== undefined ? String(patch.note).slice(0, 500) : rec.note,
    id: rec.id,
    profile: rec.profile,
    createdAt: rec.createdAt,
    updatedAt: nowISO(),
  };
  await env.OZZ.put(KEY(id), JSON.stringify(next));
  return next;
}

export async function listRequests(env, limit = 200) {
  const list = await env.OZZ.list({ prefix: 'req:', limit });
  const recs = [];
  for (const k of list.keys) {
    const raw = await env.OZZ.get(k.name);
    if (raw) recs.push(JSON.parse(raw));
  }
  recs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return recs;
}

// Rezumat pentru lista organizatorului (fără planul complet).
export function toSummary(rec) {
  return {
    id: rec.id,
    nume: rec.profile?.nume || '—',
    obiectiv: rec.profile?.obiectiv || '',
    status: rec.status,
    blocks: rec.plan?.blocks?.length || 0,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

function genId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // fără caractere ambigue
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const n of bytes) s += alphabet[n % alphabet.length];
  return s;
}

function nowISO() {
  return new Date().toISOString();
}
