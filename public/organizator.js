// Panou organizator — listă cereri + editor de plan. Autorizare prin token.

const TOKEN_KEY = 'ozz.org.token';
const CATS = [
  { v: 'meal', l: '🥗 Masă' },
  { v: 'sport', l: '💪 Sport' },
  { v: 'work', l: '⏰ Focus / muncă' },
  { v: 'free', l: '🌙 Timp liber' },
  { v: 'routine', l: '⏰ Rutină' },
];
const PROFILE_FIELDS = [
  ['obiectiv', 'Obiectiv'],
  ['program', 'Program'],
  ['trezire', 'Trezire'],
  ['culcare', 'Culcare'],
  ['fitness', 'Fitness'],
  ['dieta', 'Dietă'],
  ['timpLiber', 'Timp liber'],
  ['note', 'Notă'],
];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let requests = [];
let current = null; // cererea deschisă în editor
let filter = 'all';
let configured = true; // dacă există deja o parolă/token setat

// ————— Auth —————
function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-org-token': token, ...(opts.headers || {}) },
  });
}

$('#login-btn').addEventListener('click', login);
$('#token').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('#logout-btn').addEventListener('click', () => {
  token = '';
  sessionStorage.removeItem(TOKEN_KEY);
  showGate();
});

async function checkState() {
  try {
    const res = await fetch('/api/org/state');
    const data = await res.json();
    configured = !!data.configured;
  } catch {
    configured = true;
  }
  applyGateMode();
}

function applyGateMode() {
  if (configured) {
    $('#gate-title').textContent = 'Acces organizator';
    $('#gate-sub').textContent = 'Introdu parola de organizator ca să vezi cererile abonaților.';
    $('#token-label').textContent = 'Parola organizator';
    $('#token').setAttribute('autocomplete', 'current-password');
    $('#login-btn').textContent = 'Intră';
  } else {
    $('#gate-title').textContent = 'Prima configurare';
    $('#gate-sub').textContent = 'Alege o parolă de organizator (minim 6 caractere). O vei folosi de fiecare dată la intrare.';
    $('#token-label').textContent = 'Setează o parolă';
    $('#token').setAttribute('autocomplete', 'new-password');
    $('#login-btn').textContent = 'Setează parola și intră';
  }
}

async function login() {
  const pw = $('#token').value.trim();
  if (!pw) return;

  // Prima configurare → setează parola întâi
  if (!configured) {
    if (pw.length < 6) return gateError('Parola trebuie să aibă minim 6 caractere.');
    try {
      const res = await fetch('/api/org/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (!res.ok) return gateError(data.error || 'Nu am putut seta parola.');
      configured = true;
    } catch {
      return gateError('Eroare de rețea.');
    }
  }

  token = pw;
  const ok = await loadList();
  if (ok) {
    sessionStorage.setItem(TOKEN_KEY, token);
    showList();
  }
}

// ————— Navigare între vederi —————
function showGate() {
  $('#gate').classList.remove('hidden');
  $('#list-view').classList.add('hidden');
  $('#editor-view').classList.add('hidden');
  $('#logout-btn').classList.add('hidden');
}
function showList() {
  $('#gate').classList.add('hidden');
  $('#list-view').classList.remove('hidden');
  $('#editor-view').classList.add('hidden');
  $('#logout-btn').classList.remove('hidden');
  renderList();
}
function showEditor() {
  $('#gate').classList.add('hidden');
  $('#list-view').classList.add('hidden');
  $('#editor-view').classList.remove('hidden');
}

// ————— Listă —————
async function loadList() {
  try {
    const res = await api('/api/org/requests');
    const data = await res.json();
    if (!res.ok) {
      gateError(data.error || 'Acces refuzat.');
      return false;
    }
    requests = data.requests || [];
    return true;
  } catch {
    gateError('Eroare de rețea.');
    return false;
  }
}

function gateError(msg) {
  const el = $('#gate-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
}

const STATUS_BADGE = {
  nou: { l: '🕐 Nou', c: 'work' },
  in_lucru: { l: '✍️ În lucru', c: 'sport' },
  gata: { l: '✅ Gata', c: 'meal' },
};

function renderList() {
  const list = $('#req-list');
  list.innerHTML = '';
  const items = requests.filter((r) => filter === 'all' || r.status === filter);
  $('#empty').classList.toggle('hidden', items.length > 0);

  const counts = requests.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  $('#list-sub').textContent = `${requests.length} cereri · ${counts.nou || 0} noi · ${counts.in_lucru || 0} în lucru · ${counts.gata || 0} gata`;

  items.forEach((r) => {
    const badge = STATUS_BADGE[r.status] || STATUS_BADGE.nou;
    const card = document.createElement('button');
    card.className = 'req-card';
    card.innerHTML = `
      <div class="req-main">
        <b>${esc(r.nume)}</b>
        <span class="req-obj">${esc(r.obiectiv || '')}</span>
      </div>
      <div class="req-meta">
        <span class="status-pill" style="--c:var(--${badge.c})">${badge.l}</span>
        <span class="req-date">${fmtDate(r.updatedAt || r.createdAt)}</span>
      </div>`;
    card.addEventListener('click', () => openEditor(r.id));
    list.appendChild(card);
  });
}

$('#reload-btn').addEventListener('click', async () => {
  if (await loadList()) renderList();
});
$$('.chip-filter').forEach((b) =>
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    $$('.chip-filter').forEach((x) => x.classList.toggle('active', x === b));
    renderList();
  }),
);

// ————— Editor —————
async function openEditor(id) {
  try {
    const res = await api('/api/org/request?id=' + encodeURIComponent(id));
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Eroare');
    current = data.request;
    fillEditor(current);
    showEditor();
  } catch {
    toast('Nu am putut deschide cererea.');
  }
}

function fillEditor(rec) {
  const dl = $('#profile-dl');
  dl.innerHTML = `<dt>Nume</dt><dd>${esc(rec.profile?.nume || '—')}</dd>`;
  PROFILE_FIELDS.forEach(([k, label]) => {
    const v = rec.profile?.[k];
    if (v) dl.innerHTML += `<dt>${label}</dt><dd>${esc(v)}</dd>`;
  });

  $('#ed-status').value = rec.status || 'nou';
  $('#ed-note').value = rec.note || '';
  $('#ed-summary').value = rec.plan?.summary || '';
  $('#ed-tips').value = (rec.plan?.tips || []).join('\n');
  $('#ed-shopping').value = (rec.shoppingList || []).join('\n');

  const wrap = $('#ed-blocks');
  wrap.innerHTML = '';
  (rec.plan?.blocks || []).forEach((b) => wrap.appendChild(blockRow(b)));
}

function blockRow(b = {}) {
  const row = document.createElement('div');
  row.className = 'block-edit';
  const opts = CATS.map((c) => `<option value="${c.v}" ${c.v === b.category ? 'selected' : ''}>${c.l}</option>`).join('');
  row.innerHTML = `
    <input class="be-time" type="time" value="${esc(b.time || '')}" />
    <select class="be-cat">${opts}</select>
    <input class="be-title" type="text" placeholder="Titlu" value="${esc(b.title || '')}" />
    <input class="be-detail" type="text" placeholder="Detaliu" value="${esc(b.detail || '')}" />
    <button class="be-del" title="Șterge blocul" aria-label="Șterge blocul">✕</button>`;
  $('.be-del', row).addEventListener('click', () => row.remove());
  return row;
}

$('#add-block').addEventListener('click', () => {
  $('#ed-blocks').appendChild(blockRow({ time: '12:00', category: 'routine' }));
});

$('#back-btn').addEventListener('click', showList);

$('#save-btn').addEventListener('click', async () => {
  if (!current) return;
  const blocks = $$('#ed-blocks .block-edit')
    .map((row) => ({
      time: $('.be-time', row).value,
      category: $('.be-cat', row).value,
      title: $('.be-title', row).value.trim(),
      detail: $('.be-detail', row).value.trim(),
    }))
    .filter((b) => b.title || b.detail);

  const plan = {
    summary: $('#ed-summary').value.trim(),
    blocks,
    tips: $('#ed-tips').value.split('\n').map((t) => t.trim()).filter(Boolean),
  };
  const shoppingList = $('#ed-shopping').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const payload = { plan, status: $('#ed-status').value, note: $('#ed-note').value.trim(), shoppingList };

  const btn = $('#save-btn');
  btn.disabled = true;
  btn.textContent = 'Se salvează...';
  try {
    const res = await api('/api/org/request?id=' + encodeURIComponent(current.id), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    current = data.request;
    // actualizează lista în memorie
    const idx = requests.findIndex((r) => r.id === current.id);
    if (idx >= 0) requests[idx] = { ...requests[idx], status: current.status, updatedAt: current.updatedAt, blocks: current.plan.blocks.length };
    toast('Plan salvat ✓');
    showList();
  } catch (err) {
    toast(err.message || 'Nu am putut salva.');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvează planul';
  }
});

// ————— utilitare —————
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ————— Init —————
(async () => {
  await checkState();
  if (token && configured) {
    const ok = await loadList();
    if (ok) return showList();
  }
  showGate();
})();
