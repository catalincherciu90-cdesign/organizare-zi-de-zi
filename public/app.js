// Organizare Zi de Zi — logică frontend
// Navigare între landing/app, colectare profil, apel /api/plan, checklist cu progres.

const STORE_KEY = 'ozz.state.v1';
const CAT_LABEL = { meal: '🥗 Masă', sport: '💪 Sport', work: '⏰ Focus', free: '🌙 Timp liber', routine: '⏰ Rutină' };
const STATUS_LABEL = {
  nou: '🕐 Trimis — în așteptare',
  in_lucru: '✍️ Organizatorul lucrează la planul tău',
  gata: '✅ Gata — pregătit de organizatorul tău',
};
const THINKING_STEPS = [
  'Analizăm programul tău...',
  'Pregătim mesele zilei...',
  'Punem la punct mișcarea...',
  'Structurăm timpul de muncă și pauzele...',
  'Adăugăm timp de relaxare și somn...',
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let state = load();

// ————— Navigare —————
function show(view) {
  $$('[data-view]').forEach((v) => v.classList.toggle('hidden', v.id !== view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-goto]');
  if (!trigger) return;
  e.preventDefault();
  const target = trigger.dataset.goto;
  if (target === 'app') {
    show('app');
    // dacă avem deja un plan salvat, îl arătăm direct
    if (state.plan) renderResult(state.plan, state.checked);
    else showAppStep('form');
  } else {
    show('landing');
  }
});

function showAppStep(step) {
  $('#form-view').classList.toggle('hidden', step !== 'form');
  $('#loading-view').classList.toggle('hidden', step !== 'loading');
  $('#result-view').classList.toggle('hidden', step !== 'result');
  if (step === 'form') {
    $('#app-title').textContent = 'Hai să-ți construim ziua';
    $('#app-sub').textContent = 'Completează câteva detalii — ne ocupăm noi de rest.';
  } else if (step === 'result') {
    $('#app-title').textContent = state.profile?.nume ? `Ziua ta, ${state.profile.nume}` : 'Planul tău de azi';
    $('#app-sub').textContent = 'Bifează pe măsură ce avansezi.';
  }
}

// ————— Form —————
$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  state.profile = data;
  await generate();
});

$('#edit-btn')?.addEventListener('click', () => {
  fillForm(state.profile);
  showAppStep('form');
});
$('#regen-btn')?.addEventListener('click', () => generate());

function fillForm(profile = {}) {
  Object.entries(profile).forEach(([k, v]) => {
    const el = $(`#profile-form [name="${k}"]`);
    if (el) el.value = v;
  });
}

// ————— Generare plan —————
async function generate() {
  showAppStep('loading');
  const cycle = startThinking();
  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state.profile),
    });
    if (!res.ok) throw new Error('request failed');
    const { plan, note } = await res.json();
    state.plan = plan;
    state.checked = {};
    state.code = null; // plan nou → încă netrimis
    state.shopping = []; // plan nou → fără listă de cumpărături încă
    save();
    if (note) toast(note);
    renderResult(plan, state.checked);
  } catch (err) {
    toast('Nu am putut genera planul. Încearcă din nou.');
    showAppStep('form');
  } finally {
    clearInterval(cycle);
  }
}

function startThinking() {
  let i = 0;
  $('#thinking').textContent = THINKING_STEPS[0];
  return setInterval(() => {
    i = (i + 1) % THINKING_STEPS.length;
    $('#thinking').textContent = THINKING_STEPS[i];
  }, 1100);
}

// ————— Randare rezultat —————
// opts.lookup = true → plan vizualizat după cod (venit de la organizator)
function renderResult(plan, checked = {}, opts = {}) {
  showAppStep('result');

  $('#plan-summary-text').textContent = plan.summary || '';
  $('#plan-src').textContent = opts.lookup ? '🗓️ Planul tău, de la organizator' : '🗓️ Planul tău de azi';

  renderStatusBoxes(opts);

  const timeline = $('#timeline');
  timeline.innerHTML = '';
  (plan.blocks || []).forEach((b, idx) => {
    const id = `blk-${idx}`;
    const color = `var(--${b.category || 'routine'})`;
    const card = document.createElement('div');
    card.className = 'block-card' + (checked[id] ? ' done' : '');
    card.style.setProperty('--c', color);
    card.innerHTML = `
      <div class="b-time">${escapeHtml(b.time || '')}</div>
      <div>
        <div class="b-title">${escapeHtml(b.title || '')}
          <span class="b-cat">${escapeHtml(CAT_LABEL[b.category] || '')}</span>
        </div>
        <div class="b-detail">${escapeHtml(b.detail || '')}</div>
      </div>
      <input type="checkbox" class="check" ${checked[id] ? 'checked' : ''} aria-label="Bifează ${escapeHtml(b.title || '')}" />
    `;
    const box = $('.check', card);
    box.addEventListener('change', () => {
      state.checked[id] = box.checked;
      card.classList.toggle('done', box.checked);
      save();
      updateProgress(plan);
    });
    timeline.appendChild(card);
  });

  // Tips
  const tipsBox = $('#tips-box');
  const tipsList = $('#tips-list');
  tipsList.innerHTML = '';
  if (plan.tips && plan.tips.length) {
    plan.tips.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      tipsList.appendChild(li);
    });
    tipsBox.classList.remove('hidden');
  } else {
    tipsBox.classList.add('hidden');
  }

  // Lista de cumpărături — apare doar dacă există produse
  renderShopping(state.shopping || [], state.checked);

  updateProgress(plan);
}

// ————— Randare listă de cumpărături —————
function renderShopping(list, checked) {
  const box = $('#shopping-box');
  const ul = $('#shopping-list');
  ul.innerHTML = '';
  if (!list || !list.length) {
    box.classList.add('hidden');
    return;
  }
  list.forEach((item, idx) => {
    const key = 'shop-' + idx;
    const isChecked = !!checked[key];
    const li = document.createElement('li');
    li.className = 'shopping-item';
    li.innerHTML = `
      <input type="checkbox" class="check" id="${key}" ${isChecked ? 'checked' : ''} aria-label="${escapeHtml(item)}" />
      <label for="${key}" class="${isChecked ? 'done-label' : ''}">${escapeHtml(item)}</label>`;
    const chk = li.querySelector('input');
    const lbl = li.querySelector('label');
    chk.addEventListener('change', () => {
      state.checked[key] = chk.checked;
      lbl.classList.toggle('done-label', chk.checked);
      save();
    });
    ul.appendChild(li);
  });
  box.classList.remove('hidden');
}

function updateProgress(plan) {
  const total = (plan.blocks || []).length;
  // Numărăm doar blocurile planului zilnic (chei blk-*), nu bife din shopping
  const done = Object.entries(state.checked || {}).filter(([k, v]) => k.startsWith('blk-') && v).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-label').textContent =
    done === total && total > 0 ? `🎉 Toate cele ${total} blocuri bifate — zi reușită!` : `${done} din ${total} bifate`;
}

// ————— Trimitere către organizator + status —————
function renderStatusBoxes(opts = {}) {
  const submitBox = $('#submit-box');
  const codeBox = $('#code-box');
  if (opts.lookup) {
    // Vizualizare după cod
    submitBox.classList.add('hidden');
    showCodeBox(state.code, opts.status, opts.note);
  } else if (state.code) {
    // Plan propriu, deja trimis
    submitBox.classList.add('hidden');
    showCodeBox(state.code, state.status, state.orgNote);
  } else {
    // Plan propriu, netrimis
    submitBox.classList.remove('hidden');
    codeBox.classList.add('hidden');
  }
}

function showCodeBox(code, status, note) {
  const codeBox = $('#code-box');
  codeBox.classList.remove('hidden');
  $('#status-banner').textContent = STATUS_LABEL[status] || STATUS_LABEL.nou;
  $('#status-banner').dataset.status = status || 'nou';
  $('#code-note').textContent =
    status === 'gata'
      ? 'Organizatorul ți-a pregătit planul. Îl vezi mai sus.'
      : 'Ți-am trimis cererea organizatorului. Revino cu codul de mai jos ca să vezi planul ajustat.';
  $('#code-val').textContent = code || '—';
  const orgNote = $('#org-note');
  if (note) {
    orgNote.textContent = '📝 Mesaj de la organizator: ' + note;
    orgNote.classList.remove('hidden');
  } else {
    orgNote.classList.add('hidden');
  }
}

$('#submit-btn')?.addEventListener('click', async () => {
  if (!state.plan) return;
  const btn = $('#submit-btn');
  btn.disabled = true;
  btn.textContent = 'Se trimite...';
  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: state.profile, plan: state.plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    state.code = data.id;
    state.status = data.status || 'nou';
    state.orgNote = '';
    save();
    renderStatusBoxes({});
    toast('Trimis! Notează-ți codul ca să revii la plan.');
  } catch (err) {
    toast(err.message || 'Nu am putut trimite. Încearcă din nou.');
  } finally {
    btn.disabled = false;
    btn.textContent = '📨 Trimite organizatorului';
  }
});

$('#copy-code')?.addEventListener('click', async () => {
  const code = $('#code-val').textContent;
  try {
    await navigator.clipboard.writeText(code);
    toast('Cod copiat: ' + code);
  } catch {
    toast('Codul tău: ' + code);
  }
});

$('#refresh-code')?.addEventListener('click', () => loadByCode(state.code));
$('#lookup-btn')?.addEventListener('click', () => {
  const code = $('#lookup-code').value.trim().toLowerCase();
  if (code) loadByCode(code);
});

async function loadByCode(code) {
  if (!code) return;
  try {
    const res = await fetch('/api/my?id=' + encodeURIComponent(code));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Cod inexistent');
    state.plan = data.plan;
    state.code = code;
    state.status = data.status;
    state.orgNote = data.note || '';
    state.shopping = data.shoppingList || [];
    state.checked = state.checked || {};
    if (data.nume) state.profile = { ...(state.profile || {}), nume: data.nume };
    save();
    renderResult(data.plan, state.checked, { lookup: true, status: data.status, note: data.note });
    toast(STATUS_LABEL[data.status] || 'Plan încărcat');
  } catch (err) {
    toast(err.message || 'Nu am găsit planul.');
  }
}

// ————— Persistență —————
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { profile: null, plan: null, checked: {}, code: null, status: null, orgNote: '' };
  } catch {
    return { profile: null, plan: null, checked: {}, code: null, status: null, orgNote: '' };
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

// ————— Utilitare —————
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// Restaurează profilul în form dacă există
if (state.profile) fillForm(state.profile);
