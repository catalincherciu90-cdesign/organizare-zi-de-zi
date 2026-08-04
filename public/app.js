// Organizare Zi de Zi — logică frontend
// Navigare între landing/app, colectare profil, apel /api/plan, checklist cu progres.

const STORE_KEY = 'ozz.state.v1';
const CAT_LABEL = { meal: '🥗 Masă', sport: '💪 Sport', work: '⏰ Focus', free: '🌙 Timp liber', routine: '⏰ Rutină' };
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
    if (state.plan) renderResult(state.plan, state.source, state.checked);
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
    const { plan, source, note } = await res.json();
    state.plan = plan;
    state.source = source;
    state.checked = {};
    save();
    if (note) toast(note);
    renderResult(plan, source, state.checked);
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
function renderResult(plan, source, checked = {}) {
  showAppStep('result');

  $('#plan-summary-text').textContent = plan.summary || '';
  $('#plan-src').textContent = '🗓️ Planul tău de azi';

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

  updateProgress(plan);
}

function updateProgress(plan) {
  const total = (plan.blocks || []).length;
  const done = Object.values(state.checked || {}).filter(Boolean).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#progress-fill').style.width = pct + '%';
  $('#progress-label').textContent =
    done === total && total > 0 ? `🎉 Toate cele ${total} blocuri bifate — zi reușită!` : `${done} din ${total} bifate`;
}

// ————— Persistență —————
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { profile: null, plan: null, source: null, checked: {} };
  } catch {
    return { profile: null, plan: null, source: null, checked: {} };
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
