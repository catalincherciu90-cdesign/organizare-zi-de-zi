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
  loadStats();
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

  const recipesWrap = $('#ed-recipes');
  recipesWrap.innerHTML = '';
  (rec.recipes || []).forEach((r) => recipesWrap.appendChild(recipeCard(r)));
}

function recipeCard(r = {}) {
  const card = document.createElement('div');
  card.className = 'recipe-edit';
  card.innerHTML = `
    <div class="recipe-edit-head">
      <input class="re-name" type="text" placeholder="Nume rețetă (max 80 car.)" value="${esc(r.name || '')}" maxlength="80" />
      <button type="button" class="be-del" title="Șterge rețeta" aria-label="Șterge rețeta">✕</button>
    </div>
    <textarea class="re-ingredients" rows="3" placeholder="Ingrediente (un ingredient pe linie sau liber)">${esc(r.ingredients || '')}</textarea>
    <textarea class="re-steps" rows="4" placeholder="Mod de preparare">${esc(r.steps || '')}</textarea>`;
  $('.be-del', card).addEventListener('click', () => card.remove());
  return card;
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

$('#add-recipe').addEventListener('click', () => {
  $('#ed-recipes').appendChild(recipeCard());
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
  const recipes = $$('#ed-recipes .recipe-edit')
    .map((card) => ({
      name: $('.re-name', card).value.trim(),
      ingredients: $('.re-ingredients', card).value.trim(),
      steps: $('.re-steps', card).value.trim(),
    }))
    .filter((r) => r.name);
  const payload = { plan, status: $('#ed-status').value, note: $('#ed-note').value.trim(), shoppingList, recipes };

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

// ————— Dashboard statistici —————
async function loadStats() {
  try {
    const res = await api('/api/org/stats');
    if (!res.ok) return;
    const data = await res.json();
    renderStats(data);
  } catch {
    // statistici opționale — eșecul nu blochează lista
  }
}

function renderStats(data) {
  const el = $('#org-stats');
  if (!el) return;
  const req = data.requests || {};
  const total = req.total || 0;
  const waiting = (req.nou || 0) + (req.in_lucru || 0);
  const gata = req.gata || 0;
  const accounts = data.accounts || 0;
  const last7 = data.last7days || 0;
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-num">${total}</div>
      <div class="stat-label">Total cereri</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${waiting}</div>
      <div class="stat-label">În așteptare</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${gata}</div>
      <div class="stat-label">Gata</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${accounts}</div>
      <div class="stat-label">Abonați</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${last7}</div>
      <div class="stat-label">Cereri (7 zile)</div>
    </div>`;
}

// ————— Șabloane organizator —————
$('#save-tpl-btn').addEventListener('click', async () => {
  const name = prompt('Nume șablon (max 60 caractere):');
  if (!name || !name.trim()) return;

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

  try {
    const res = await api('/api/org/templates', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    toast('Șablon "' + data.name + '" salvat ✓');
  } catch (err) {
    toast(err.message || 'Nu am putut salva șablonul.');
  }
});

$('#apply-tpl-btn').addEventListener('click', async () => {
  try {
    const res = await api('/api/org/templates');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    showTplPicker(data.templates || []);
  } catch (err) {
    toast(err.message || 'Nu am putut încărca șabloanele.');
  }
});

$('#tpl-picker-close').addEventListener('click', () => {
  $('#tpl-picker-backdrop').classList.add('hidden');
});

$('#tpl-picker-backdrop').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

function showTplPicker(templates) {
  const list = $('#tpl-picker-list');
  list.innerHTML = '';
  if (!templates.length) {
    list.innerHTML = '<p class="tpl-picker-empty">Niciun șablon salvat încă.</p>';
  } else {
    templates.forEach((tpl) => {
      const btn = document.createElement('button');
      btn.className = 'tpl-picker-item';
      btn.innerHTML = `
        <div>
          <b>${esc(tpl.name)}</b><br>
          <small>${tpl.blocks} blocuri · ${fmtDate(tpl.createdAt)}</small>
        </div>
        <span class="btn btn-sm btn-ghost" style="pointer-events:none">Aplică</span>`;
      btn.addEventListener('click', () => applyTemplate(tpl.id));
      list.appendChild(btn);
    });
  }
  $('#tpl-picker-backdrop').classList.remove('hidden');
}

async function applyTemplate(id) {
  try {
    const res = await api('/api/org/template?id=' + encodeURIComponent(id));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    const tpl = data.template;

    // Populează editorul — fără a atinge profilul / statusul / nota / shopping-list
    $('#ed-summary').value = tpl.plan?.summary || '';
    $('#ed-tips').value = (tpl.plan?.tips || []).join('\n');
    const wrap = $('#ed-blocks');
    wrap.innerHTML = '';
    (tpl.plan?.blocks || []).forEach((b) => wrap.appendChild(blockRow(b)));

    $('#tpl-picker-backdrop').classList.add('hidden');
    toast('Șablon "' + tpl.name + '" aplicat ✓');
  } catch (err) {
    toast(err.message || 'Nu am putut aplica șablonul.');
  }
}

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

// ————— PWA: Service Worker —————
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
