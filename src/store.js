// Logică de stocare (pură) — operează pe un obiect `storage` cu API get/put/list,
// compatibil cu Durable Object storage (this.ctx.storage) și cu un mock în teste.
// Nu importă nimic din runtime-ul Cloudflare, ca să fie ușor de testat.

const STATUSES = ['nou', 'in_lucru', 'gata'];

export async function createRequest(storage, { profile, plan }) {
  const id = genId();
  const now = new Date().toISOString();
  const rec = {
    id,
    profile: profile || {},
    plan: plan || { summary: '', blocks: [], tips: [] },
    status: 'nou',
    note: '',
    shoppingList: [],
    createdAt: now,
    updatedAt: now,
  };
  await storage.put('req:' + id, rec);
  return rec;
}

export async function getRequest(storage, id) {
  if (!id) return null;
  return (await storage.get('req:' + id)) || null;
}

export async function updateRequest(storage, id, patch = {}) {
  const rec = await getRequest(storage, id);
  if (!rec) return null;
  const next = {
    ...rec,
    plan: patch.plan !== undefined ? patch.plan : rec.plan,
    status: STATUSES.includes(patch.status) ? patch.status : rec.status,
    note: patch.note !== undefined ? String(patch.note).slice(0, 500) : rec.note,
    shoppingList: patch.shoppingList !== undefined ? sanitizeShoppingList(patch.shoppingList) : (rec.shoppingList || []),
    id: rec.id,
    profile: rec.profile,
    createdAt: rec.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await storage.put('req:' + id, next);
  return next;
}

export async function listRequests(storage, limit = 500) {
  const map = await storage.list({ prefix: 'req:', limit });
  const recs = [...map.values()];
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

// ————— Parola organizatorului (setată la prima intrare) —————

export async function getAuth(storage) {
  return (await storage.get('auth')) || null;
}

export async function setPassword(storage, password) {
  const salt = randomHex(16);
  const hash = await sha256(salt + ':' + password);
  const auth = { salt, hash, setAt: new Date().toISOString() };
  await storage.put('auth', auth);
  return auth;
}

export async function verifyPassword(storage, password) {
  const auth = await getAuth(storage);
  if (!auth) return false;
  return (await sha256(auth.salt + ':' + password)) === auth.hash;
}

// ————— utilitare —————

// Validează lista de cumpărături: array de string-uri, max 80 iteme, fiecare max 80 caractere.
function sanitizeShoppingList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 80);
}

function genId() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // fără caractere ambigue
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const n of bytes) s += alphabet[n % alphabet.length];
  return s;
}

function randomHex(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
