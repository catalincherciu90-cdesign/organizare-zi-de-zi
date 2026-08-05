// Organizare Zi de Zi — logică frontend
// Navigare între landing/app, colectare profil, apel /api/plan, checklist cu progres.

const STORE_KEY = 'ozz.state.v1';
let billingConfigured = false; // setat după GET /api/billing/state la init
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

  // Dacă billing e configurat și butonul are un plan plătit, pornim checkout
  if (billingConfigured && trigger.dataset.plan) {
    const plan = trigger.dataset.plan;
    if (!state.accToken) {
      show('app');
      openAccForm('login');
      toast('Autentifică-te ca să te abonezi');
      return;
    }
    startCheckout(plan);
    return;
  }

  const target = trigger.dataset.goto;
  if (target === 'app') {
    // Gate: utilizator nelogat nu poate accesa planificatorul
    if (!state.accToken) {
      show('app');
      openAccForm('register');
      toast('Creează un cont sau autentifică-te ca să începi');
      return;
    }
    closeAccForm(); // închide formularul de auth dacă era deschis
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
  $('#history-view').classList.toggle('hidden', step !== 'history');
  $('#templates-view')?.classList.toggle('hidden', step !== 'templates');
  $('#week-view')?.classList.toggle('hidden', step !== 'week');
  if (step === 'form') {
    $('#app-title').textContent = 'Hai să-ți construim ziua';
    $('#app-sub').textContent = 'Completează câteva detalii — ne ocupăm noi de rest.';
  } else if (step === 'result') {
    $('#app-title').textContent = state.profile?.nume ? `Ziua ta, ${state.profile.nume}` : 'Planul tău de azi';
    $('#app-sub').textContent = 'Bifează pe măsură ce avansezi.';
  } else if (step === 'history') {
    $('#app-title').textContent = 'Istoricul meu';
    $('#app-sub').textContent = 'Planurile trimise organizatorului.';
  } else if (step === 'templates') {
    $('#app-title').textContent = 'Rutinele mele';
    $('#app-sub').textContent = 'Planuri salvate pe care le poți refolosi oricând.';
  } else if (step === 'week') {
    $('#app-title').textContent = 'Săptămâna mea';
    $('#app-sub').textContent = 'Privire de ansamblu asupra zilelor din această săptămână.';
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
    state.recipes = []; // plan nou → fără rețete încă
    state.notifiedGata = false; // Resetez marcajul de notificare
    state.notifyOptIn = false; // Resetez opt-in
    stopPolling(); // Opresc polling-ul
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
  // Butonul de salvare ca rutină — vizibil doar dacă utilizatorul e logat
  const saveTplBtn = $('#save-template-btn');
  if (saveTplBtn) saveTplBtn.classList.toggle('hidden', !state.accToken);

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

  // Rețete — apar doar dacă există
  renderRecipes(state.recipes || []);

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

// ————— Randare rețete —————
function renderRecipes(list) {
  const box = $('#recipes-box');
  const container = $('#recipes-list');
  if (!box || !container) return;
  container.innerHTML = '';
  if (!list || !list.length) {
    box.classList.add('hidden');
    return;
  }
  list.forEach((recipe) => {
    const article = document.createElement('article');
    article.className = 'recipe-card';
    let html = `<h5 class="recipe-name">${escapeHtml(recipe.name || '')}</h5>`;
    if (recipe.ingredients) {
      html += `<div class="recipe-section"><span class="recipe-section-label">Ingrediente</span><p class="recipe-text">${escapeHtml(recipe.ingredients)}</p></div>`;
    }
    if (recipe.steps) {
      html += `<div class="recipe-section"><span class="recipe-section-label">Mod de preparare</span><p class="recipe-text">${escapeHtml(recipe.steps)}</p></div>`;
    }
    article.innerHTML = html;
    container.appendChild(article);
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

  // Modifica textul — utilizatorul e logat, planul apare în "Istoricul meu"
  $('#code-note').textContent =
    status === 'gata'
      ? 'Organizatorul ți-a pregătit planul. Îl vezi mai sus.'
      : 'Îți urmărim planul — vezi statusul aici sau în «Istoricul meu».';

  // Ascunde code display (utilizatorul e logat, nu mai trebuie cod manual)
  $('#code-display')?.classList.add('hidden');

  const orgNote = $('#org-note');
  if (note) {
    orgNote.textContent = '📝 Mesaj de la organizator: ' + note;
    orgNote.classList.remove('hidden');
  } else {
    orgNote.classList.add('hidden');
  }

  // Arată/ascunde butonul de opt-in pentru notificări
  const notifyBtn = $('#notify-opt-in-btn');
  if (notifyBtn) {
    // Ascunde butonul dacă status e 'gata' sau dacă notificările sunt deja activate
    if (status === 'gata' || state.notifyOptIn) {
      notifyBtn.classList.add('hidden');
    } else {
      notifyBtn.classList.remove('hidden');
    }
  }
}

$('#submit-btn')?.addEventListener('click', async () => {
  if (!state.plan) return;
  const btn = $('#submit-btn');
  btn.disabled = true;
  btn.textContent = 'Se trimite...';
  try {
    // Dacă abonatul e autentificat, trimitem token-ul ca planul să intre în istoricul lui
    const headers = { 'content-type': 'application/json' };
    if (state.accToken) headers['x-acc-token'] = state.accToken;
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers,
      body: JSON.stringify({ profile: state.profile, plan: state.plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    state.code = data.id;
    state.status = data.status || 'nou';
    state.orgNote = '';
    state.notifiedGata = false; // Resetez marcajul pentru plan nou
    state.notifyOptIn = false; // Resetez opt-in (utilizatorul alege din nou dacă vrea notificări)
    stopPolling(); // Opresc polling-ul anterior
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

async function loadByCode(code) {
  if (!code) return;
  try {
    const res = await fetch('/api/my?id=' + encodeURIComponent(code));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Cod inexistent');

    const prevStatus = state.status;
    const newStatus = data.status;

    state.plan = data.plan;
    state.code = code;
    state.status = newStatus;
    state.orgNote = data.note || '';
    state.shopping = data.shoppingList || [];
    state.recipes = data.recipes || [];
    state.checked = state.checked || {};
    if (data.nume) state.profile = { ...(state.profile || {}), nume: data.nume };

    // Dacă am schimbat codul, resetez marcajul de notificare
    if (code !== localStorage.getItem('ozz.lastCode')) {
      state.notifiedGata = false;
    }
    localStorage.setItem('ozz.lastCode', code);

    // Verifică dacă trebuie să anunțe (tranziție la 'gata')
    if (shouldNotify(prevStatus, newStatus)) {
      notifyPlanReady(code);
    }

    save();
    renderResult(data.plan, state.checked, { lookup: true, status: newStatus, note: data.note });
    toast(STATUS_LABEL[newStatus] || 'Plan încărcat');

    // Pornește polling dacă statusul nu e 'gata' și avem opt-in
    if (state.notifyOptIn && newStatus !== 'gata') {
      startPolling();
    } else if (newStatus === 'gata') {
      stopPolling();
    }
  } catch (err) {
    toast(err.message || 'Nu am găsit planul.');
  }
}

// ————— Export calendar (.ics) —————
const CAT_ICON = { meal: '🥗', sport: '💪', work: '⏰', free: '🌙', routine: '⏰' };

$('#ics-btn')?.addEventListener('click', () => {
  if (state.plan && state.plan.blocks && state.plan.blocks.length) downloadICS(state.plan);
  else toast('Nu ai încă un plan de exportat.');
});

function downloadICS(plan) {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
  const stamp = dateStr + 'T' + p2(now.getHours()) + p2(now.getMinutes()) + '00';
  const blocks = plan.blocks || [];

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Organizare Zi de Zi//RO', 'CALSCALE:GREGORIAN'];
  blocks.forEach((b, i) => {
    if (!b.time || !/^\d{1,2}:\d{2}$/.test(b.time)) return;
    const [hh, mm] = b.time.split(':');
    const start = `${dateStr}T${p2(hh)}${p2(mm)}00`;
    // Sfârșit: ora blocului următor, sau +45 min
    let end;
    const next = blocks[i + 1];
    if (next && /^\d{1,2}:\d{2}$/.test(next.time || '') && next.time > b.time) {
      const [nh, nm] = next.time.split(':');
      end = `${dateStr}T${p2(nh)}${p2(nm)}00`;
    } else {
      let eh = parseInt(hh, 10);
      let em = parseInt(mm, 10) + 45;
      if (em >= 60) { eh = (eh + 1) % 24; em -= 60; }
      end = `${dateStr}T${p2(eh)}${p2(em)}00`;
    }
    lines.push(
      'BEGIN:VEVENT',
      `UID:${dateStr}-${i}@organizare-zi-de-zi`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${icsEscape((CAT_ICON[b.category] || '') + ' ' + (b.title || ''))}`,
      `DESCRIPTION:${icsEscape(b.detail || '')}`,
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ziua-mea.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Am pregătit fișierul pentru calendar 📅');
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// ————— Notificări la schimbare status —————
// Funcție pură: returnează true doar când statusul devine 'gata' dintr-o stare anterioară
function shouldNotify(prevStatus, newStatus) {
  return newStatus === 'gata' && prevStatus !== 'gata';
}

// Polling control
let pollingInterval = null;

function startPolling() {
  // Nu porni polling-ul dacă nu avem cod sau status e deja 'gata'
  if (!state.code || state.status === 'gata' || pollingInterval) return;

  // Polling la fiecare 45 de secunde
  pollingInterval = setInterval(() => {
    if (state.code && state.status !== 'gata') {
      loadByCodeForPolling(state.code);
    } else {
      stopPolling();
    }
  }, 45000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Variantă a loadByCode pentru polling — nu arată toast la status neschimbat
async function loadByCodeForPolling(code) {
  if (!code) return;
  try {
    const res = await fetch('/api/my?id=' + encodeURIComponent(code));
    const data = await res.json();
    if (!res.ok) {
      // Eroare de rețea — păstrăm polling-ul, va încerca din nou
      return;
    }

    const prevStatus = state.status;
    const newStatus = data.status;

    // Actualizează state
    state.plan = data.plan;
    state.code = code;
    state.status = newStatus;
    state.orgNote = data.note || '';
    state.shopping = data.shoppingList || [];
    state.recipes = data.recipes || [];
    state.checked = state.checked || {};
    if (data.nume) state.profile = { ...(state.profile || {}), nume: data.nume };

    // Verifică dacă trebuie să anunțe
    if (shouldNotify(prevStatus, newStatus)) {
      notifyPlanReady(code);
    }

    save();

    // Actualizează UI dacă planul este vizualizat
    if ($('#result-view') && !$('#result-view').classList.contains('hidden')) {
      renderResult(data.plan, state.checked, { lookup: true, status: newStatus, note: data.note });
      renderStatusBoxes({ lookup: true, status: newStatus, note: data.note });
    }

    // Oprește polling-ul dacă status e 'gata'
    if (newStatus === 'gata') {
      stopPolling();
    }
  } catch (err) {
    // Eroare de rețea — păstrăm polling-ul, va încerca din nou
  }
}

// Arată notificare și banner când planul devine gata
function notifyPlanReady(code) {
  // Marcează că am notificat deja pentru acest plan
  state.notifiedGata = true;
  save();

  // Arată notificare în browser dacă permisiunea e acordată
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Planul tău e gata 🎉', {
      body: 'Organizatorul ți-a pregătit planul personalizat. Accesează-l acum!',
      tag: 'plan-ready-' + code,
    });
  }

  // Arată banner în pagină (întotdeauna)
  showNotificationBanner(code);
}

// Arată banner de notificare în pagină
function showNotificationBanner(code) {
  let banner = $('#gata-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'gata-banner';
    banner.className = 'notification-banner';
    const resultView = $('#result-view');
    if (resultView) {
      resultView.insertBefore(banner, resultView.firstChild);
    }
  }

  banner.innerHTML = `
    <div class="banner-content">
      <span>✅ Planul tău e gata! Organizatorul ți-a pregătit o zi complectă.</span>
      <button class="btn btn-sm banner-btn" id="banner-view-btn">Vezi planul</button>
    </div>
  `;
  banner.classList.remove('hidden');

  // Click pe buton → reîncarcă planul
  const viewBtn = $('#banner-view-btn');
  if (viewBtn) {
    viewBtn.addEventListener('click', () => {
      loadByCode(code);
    });
  }
}

// ————— Web Push —————

// Convertește un string base64url în Uint8Array (necesar pentru applicationServerKey).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const result = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) result[i] = raw.charCodeAt(i);
  return result;
}

// Încearcă abonarea Web Push după ce permisiunea de notificări e acordată.
// Cade grațios dacă PushManager nu e disponibil sau oricare pas eșuează —
// polling-ul existent rămâne activ ca fallback.
async function subscribePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!state.code) return;
    const reg = await navigator.serviceWorker.ready;
    const keyRes = await fetch('/api/push/key');
    if (!keyRes.ok) return;
    const { key } = await keyRes.json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: state.code, subscription: sub.toJSON() }),
    });
  } catch (_) {
    // Web Push indisponibil sau refuzat — polling rămâne activ ca fallback.
  }
}

// ————— Persistență —————
function load() {
  const defaults = { profile: null, plan: null, checked: {}, code: null, status: null, orgNote: '', shopping: [], recipes: [], accToken: null, accEmail: null, accPlan: 'start', accSubStatus: 'inactive', notifyOptIn: false, notifiedGata: false };
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    // merge cu defaults — câmpurile noi (accToken, accEmail, notifyOptIn, notifiedGata) apar chiar dacă lipsesc din localStorage vechi
    return stored ? { ...defaults, ...stored } : defaults;
  } catch {
    return defaults;
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

// ————— Cont abonat —————

const STATUS_COLOR = { nou: 'work', in_lucru: 'sport', gata: 'meal' };

let accFormMode = 'login'; // 'login' | 'register'

// Randează bara de cont (guest sau logat) în funcție de state.accToken/accEmail
function renderAccBar() {
  const guest = $('#acc-guest');
  const user = $('#acc-user');
  if (!guest || !user) return;
  if (state.accToken && state.accEmail) {
    guest.classList.add('hidden');
    user.classList.remove('hidden');
    const display = $('#acc-email-display');
    if (display) display.textContent = state.accEmail;

    // Badge plan
    const badge = $('#acc-plan-badge');
    if (badge) {
      const plan = state.accPlan || 'start';
      const planLabel = { start: 'Start', echilibru: 'Echilibru', premium: 'Premium' };
      badge.textContent = planLabel[plan] || plan;
      badge.dataset.plan = plan;
      badge.classList.toggle('hidden', !billingConfigured);
    }

    // Buton portal — vizibil doar pe plan plătit și billing configurat
    const manageBtn = $('#acc-manage-billing-btn');
    if (manageBtn) {
      const isPaid = ['echilibru', 'premium'].includes(state.accPlan);
      manageBtn.classList.toggle('hidden', !(billingConfigured && isPaid));
    }
  } else {
    guest.classList.remove('hidden');
    user.classList.add('hidden');
  }
}

// Deschide panoul de autentificare în modul cerut
function openAccForm(mode) {
  accFormMode = mode || 'login';
  const isReg = accFormMode === 'register';
  const title = $('#acc-form-title');
  const submit = $('#acc-form-submit');
  const toggle = $('#acc-form-toggle');
  const pass = $('#acc-pass');
  if (title) title.textContent = isReg ? 'Creează cont' : 'Intră în cont';
  if (submit) submit.textContent = isReg ? 'Creează contul' : 'Intră în cont';
  if (toggle) toggle.textContent = isReg ? 'Am deja cont — intru' : 'Nu am cont — mă înregistrez';
  if (pass) pass.setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
  const errEl = $('#acc-form-error');
  if (errEl) errEl.classList.add('hidden');
  const panel = $('#acc-auth-panel');
  if (panel) panel.classList.remove('hidden');
}

// Ascunde panoul de autentificare
function closeAccForm() {
  const panel = $('#acc-auth-panel');
  if (panel) panel.classList.add('hidden');
}

// Verifică token-ul cu serverul la inițializare; curăță dacă e expirat.
// Capturează și plan/subStatus din răspuns.
async function verifyAccToken() {
  if (!state.accToken) return;
  try {
    const res = await fetch('/api/account/me', {
      headers: { 'x-acc-token': state.accToken },
    });
    if (!res.ok) {
      state.accToken = null;
      state.accEmail = null;
      save();
    } else {
      const data = await res.json();
      state.accPlan = data.plan || 'start';
      state.accSubStatus = data.subStatus || 'inactive';
      save();
    }
  } catch {
    // eroare de rețea — păstrăm token-ul, va fi verificat la următoarea acțiune
  }
}

// Reîmprospătează informațiile de cont (plan, subStatus) fără verificare token.
async function refreshAccInfo() {
  if (!state.accToken) return;
  try {
    const res = await fetch('/api/account/me', {
      headers: { 'x-acc-token': state.accToken },
    });
    if (res.ok) {
      const data = await res.json();
      state.accPlan = data.plan || 'start';
      state.accSubStatus = data.subStatus || 'inactive';
      save();
    }
  } catch {}
}

// Formatare dată pentru lista de istoric
function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Încarcă și randează istoricul abonatului
async function loadHistory() {
  const list = $('#history-list');
  const empty = $('#history-empty');
  if (!list || !empty) return;
  list.innerHTML = '<p style="color:var(--muted);padding:20px 0">Se încarcă...</p>';
  empty.classList.add('hidden');

  try {
    const res = await fetch('/api/account/days', {
      headers: { 'x-acc-token': state.accToken || '' },
    });
    list.innerHTML = '';
    if (!res.ok) {
      empty.textContent = 'Nu am putut încărca istoricul.';
      empty.classList.remove('hidden');
      return;
    }
    const { days } = await res.json();
    if (!days.length) {
      empty.classList.remove('hidden');
      return;
    }
    days.forEach((day) => {
      const color = STATUS_COLOR[day.status] || 'work';
      const card = document.createElement('button');
      card.className = 'req-card';
      card.innerHTML = `
        <div class="req-main">
          <b>${escapeHtml(day.nume || '—')}</b>
          <span class="req-obj">${escapeHtml(day.obiectiv || '')}</span>
        </div>
        <div class="req-meta">
          <span class="status-pill" style="--c:var(--${color})">${escapeHtml(STATUS_LABEL[day.status] || day.status)}</span>
          <span class="req-date">${fmtDate(day.createdAt)}</span>
        </div>`;
      // Click → încarcă planul zilei respective (id-ul zilei = codul de acces)
      card.addEventListener('click', () => loadByCode(day.id));
      list.appendChild(card);
    });
  } catch {
    list.innerHTML = '';
    empty.textContent = 'Eroare la încărcare. Încearcă din nou.';
    empty.classList.remove('hidden');
  }
}

// ————— Event listeners cont —————

$('#acc-login-btn')?.addEventListener('click', () => openAccForm('login'));
$('#acc-register-btn')?.addEventListener('click', () => openAccForm('register'));
$('#acc-form-cancel')?.addEventListener('click', closeAccForm);
$('#acc-form-toggle')?.addEventListener('click', () => {
  openAccForm(accFormMode === 'login' ? 'register' : 'login');
});

$('#acc-form-submit')?.addEventListener('click', async () => {
  const email = ($('#acc-email')?.value || '').trim();
  const password = $('#acc-pass')?.value || '';
  const errEl = $('#acc-form-error');

  if (!email || !password) {
    if (errEl) { errEl.textContent = 'Completează emailul și parola.'; errEl.classList.remove('hidden'); }
    return;
  }

  const btn = $('#acc-form-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Se procesează...'; }

  try {
    const endpoint = accFormMode === 'register' ? '/api/account/register' : '/api/account/login';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (errEl) { errEl.textContent = data.error || 'Eroare la autentificare.'; errEl.classList.remove('hidden'); }
      return;
    }
    state.accToken = data.token;
    state.accEmail = data.email;
    save();
    closeAccForm();
    await refreshAccInfo();
    renderAccBar();
    // După autentificare reușită, dacă utilizatorul e în vederea #app, du-l la planificator
    if ($('#app') && !$('#app').classList.contains('hidden')) {
      if (state.plan) renderResult(state.plan, state.checked);
      else showAppStep('form');
    }
    toast(accFormMode === 'register' ? 'Cont creat! Planurile tale se vor salva automat.' : 'Bine ai revenit!');
  } catch {
    if (errEl) { errEl.textContent = 'Eroare de rețea. Încearcă din nou.'; errEl.classList.remove('hidden'); }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = accFormMode === 'register' ? 'Creează contul' : 'Intră în cont';
    }
  }
});

$('#acc-logout-btn')?.addEventListener('click', async () => {
  if (state.accToken) {
    try {
      await fetch('/api/account/logout', { method: 'POST', headers: { 'x-acc-token': state.accToken } });
    } catch {}
  }
  state.accToken = null;
  state.accEmail = null;
  state.accPlan = 'start';
  state.accSubStatus = 'inactive';
  save();
  renderAccBar();
  toast('Ai ieșit din cont.');
});

$('#acc-manage-billing-btn')?.addEventListener('click', startPortal);

// ————— Billing: checkout + portal —————

async function startCheckout(plan) {
  try {
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-acc-token': state.accToken },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare la checkout.');
    window.location = data.url;
  } catch (err) {
    toast(err.message || 'Nu am putut porni checkout-ul. Încearcă din nou.');
  }
}

async function startPortal() {
  try {
    const res = await fetch('/api/billing/portal', {
      method: 'POST',
      headers: { 'x-acc-token': state.accToken },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare la portal.');
    window.location = data.url;
  } catch (err) {
    toast(err.message || 'Nu am putut deschide portalul de plată. Încearcă din nou.');
  }
}

// Inițializează billing: verifică dacă e configurat, actualizează UI,
// gestionează redirect-ul de la Stripe cu ?billing=success.
async function initBilling() {
  try {
    const res = await fetch('/api/billing/state');
    if (!res.ok) return;
    const data = await res.json();
    billingConfigured = !!data.configured;

    if (billingConfigured) {
      // Actualizăm textul butoanelor de prețuri
      $$('[data-plan]').forEach((btn) => {
        if (btn.dataset.plan === 'echilibru' || btn.dataset.plan === 'premium') {
          btn.textContent = 'Abonează-te';
        }
      });
    }

    // Detectăm revenirea de pe Stripe Checkout cu succes
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      // Curățăm querystring-ul din URL fără refresh
      history.replaceState(null, '', window.location.pathname + window.location.hash);
      await refreshAccInfo();
      renderAccBar();
      toast('Abonament activ! Bine ai venit pe planul ales.');
    }
  } catch {
    // billing state nu e critic — continuăm fără
  }
}

$('#acc-history-btn')?.addEventListener('click', () => {
  loadHistory();
  showAppStep('history');
});

$('#history-back-btn')?.addEventListener('click', () => {
  showAppStep(state.plan ? 'result' : 'form');
  if (state.plan) renderResult(state.plan, state.checked);
});

// ————— Event listeners notificări —————
$('#notify-opt-in-btn')?.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    toast('Notificările nu sunt disponibile în browserul tău.');
    return;
  }

  // Dacă permisiunea e deja acordată, activez polling-ul și Web Push
  if (Notification.permission === 'granted') {
    state.notifyOptIn = true;
    save();
    const btn = $('#notify-opt-in-btn');
    if (btn) btn.classList.add('hidden');
    startPolling();
    subscribePush(); // best-effort, nu blocăm pe eroare
    toast('Notificări activate! Te vom anunța când planul e gata.');
    return;
  }

  // Dacă e deja refuzată, arăt doar banner (fără a cere din nou)
  if (Notification.permission === 'denied') {
    toast('Notificările sunt dezactivate. Vei fi anunțat prin banner pe pagină când planul e gata.');
    return;
  }

  // Cere permisiunea
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      state.notifyOptIn = true;
      save();
      const btn = $('#notify-opt-in-btn');
      if (btn) btn.classList.add('hidden');
      startPolling();
      subscribePush(); // best-effort, nu blocăm pe eroare
      toast('Notificări activate! Te vom anunța când planul e gata.');
    } else if (permission === 'denied') {
      toast('Notificările sunt dezactivate. Vei fi anunțat prin banner pe pagină când planul e gata.');
    }
  } catch (err) {
    toast('Eroare la activarea notificărilor.');
  }
});

// Repornește polling-ul când pagina devine vizibilă
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // Pagina a redevenit vizibilă
  if (state.code && state.status !== 'gata' && state.notifyOptIn) {
    // Verifica imediat statusul
    loadByCodeForPolling(state.code);
  }
});

// ————— Inițializare cont —————
// Randare imediată (din localStorage), apoi verificare server în background
renderAccBar();
verifyAccToken().then(() => renderAccBar());
// Inițializăm billing: setăm billingConfigured + actualizăm UI butoane prețuri
initBilling().then(() => renderAccBar());

// Pornește polling-ul dacă avem cod și opt-in activ
if (state.code && state.status !== 'gata' && state.notifyOptIn) {
  startPolling();
}

// ————— Rutine (șabloane salvate) —————

async function loadTemplates() {
  const list = $('#templates-list');
  const empty = $('#templates-empty');
  if (!list || !empty) return;
  list.innerHTML = '<p style="color:var(--muted);padding:20px 0">Se încarcă...</p>';
  empty.classList.add('hidden');
  try {
    const res = await fetch('/api/account/templates', {
      headers: { 'x-acc-token': state.accToken || '' },
    });
    list.innerHTML = '';
    if (!res.ok) {
      empty.textContent = 'Nu am putut încărca rutinele.';
      empty.classList.remove('hidden');
      return;
    }
    const { templates } = await res.json();
    if (!templates.length) {
      empty.classList.remove('hidden');
      return;
    }
    templates.forEach((tpl) => {
      const card = document.createElement('div');
      card.className = 'req-card';
      card.style.cursor = 'default';
      const blocksTxt = tpl.blocks + ' bloc' + (tpl.blocks !== 1 ? 'uri' : '');
      card.innerHTML = `
        <div class="req-main">
          <b>${escapeHtml(tpl.name)}</b>
          <span class="req-obj">${escapeHtml(blocksTxt)} · ${fmtDate(tpl.createdAt)}</span>
        </div>
        <div class="req-meta" style="gap:8px">
          <button class="btn btn-sm btn-primary tpl-use" data-id="${escapeHtml(tpl.id)}">Folosește</button>
          <button class="btn btn-sm btn-ghost tpl-del" data-id="${escapeHtml(tpl.id)}">Șterge</button>
        </div>`;
      card.querySelector('.tpl-use').addEventListener('click', () => useTemplate(tpl.id));
      card.querySelector('.tpl-del').addEventListener('click', () => deleteTemplate(tpl.id));
      list.appendChild(card);
    });
  } catch {
    list.innerHTML = '';
    empty.textContent = 'Eroare la încărcare. Încearcă din nou.';
    empty.classList.remove('hidden');
  }
}

async function useTemplate(id) {
  try {
    const res = await fetch('/api/account/template?id=' + encodeURIComponent(id), {
      headers: { 'x-acc-token': state.accToken || '' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    const { template } = data;
    state.plan = template.plan;
    state.checked = {};
    state.code = null;
    state.shopping = [];
    state.notifiedGata = false;
    save();
    renderResult(template.plan, {});
    toast('Rutina a fost încărcată ca plan curent.');
  } catch (err) {
    toast(err.message || 'Nu am putut încărca rutina.');
  }
}

async function deleteTemplate(id) {
  try {
    const res = await fetch('/api/account/template?id=' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { 'x-acc-token': state.accToken || '' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    toast('Rutina a fost ștearsă.');
    loadTemplates();
  } catch (err) {
    toast(err.message || 'Nu am putut șterge rutina.');
  }
}

$('#acc-templates-btn')?.addEventListener('click', () => {
  loadTemplates();
  showAppStep('templates');
});

$('#templates-back-btn')?.addEventListener('click', () => {
  showAppStep(state.plan ? 'result' : 'form');
  if (state.plan) renderResult(state.plan, state.checked);
});

$('#save-template-btn')?.addEventListener('click', async () => {
  if (!state.plan || !state.accToken) return;
  const name = prompt('Numele rutinei (max. 60 caractere):');
  if (!name || !name.trim()) return;
  try {
    const res = await fetch('/api/account/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-acc-token': state.accToken },
      body: JSON.stringify({ name: name.trim(), plan: state.plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Eroare');
    toast('Rutina „' + data.name + '" a fost salvată.');
  } catch (err) {
    toast(err.message || 'Nu am putut salva rutina.');
  }
});

// ————— Săptămâna mea —————

const DAY_NAMES = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];

let weekOffset = 0; // 0 = săptămâna curentă, -1 = anterioară, +1 = următoare

function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Duminică, 1=Luni...
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function getWeekDates(offset) {
  const monday = getMondayOf(new Date());
  monday.setDate(monday.getDate() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isoLocalDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

async function loadWeek() {
  const grid = $('#week-grid');
  const label = $('#week-label');
  if (!grid || !label) return;

  const dates = getWeekDates(weekOffset);
  const fmtOpts = { day: '2-digit', month: 'short' };
  const startFmt = dates[0].toLocaleDateString('ro-RO', fmtOpts);
  const endFmt = dates[6].toLocaleDateString('ro-RO', { ...fmtOpts, year: 'numeric' });
  label.textContent = startFmt + ' – ' + endFmt;

  grid.innerHTML = '<p style="color:var(--muted);padding:20px 0;grid-column:1/-1;text-align:center">Se încarcă...</p>';

  try {
    const res = await fetch('/api/account/days', {
      headers: { 'x-acc-token': state.accToken || '' },
    });
    if (!res.ok) {
      grid.innerHTML = '<p style="color:var(--muted);padding:20px 0;grid-column:1/-1;text-align:center">Nu am putut încărca datele.</p>';
      return;
    }
    const { days } = await res.json();

    // indexăm prima zi după fiecare dată locală (YYYY-MM-DD)
    const dayMap = {};
    days.forEach((d) => {
      if (!d.createdAt) return;
      const dateStr = isoLocalDate(new Date(d.createdAt));
      if (!dayMap[dateStr]) dayMap[dateStr] = d;
    });

    grid.innerHTML = '';
    dates.forEach((date, i) => {
      const dateStr = isoLocalDate(date);
      const day = dayMap[dateStr] || null;
      const color = day ? (STATUS_COLOR[day.status] || 'work') : null;
      const cell = document.createElement('div');
      cell.className = 'week-cell' + (day ? ' week-cell--has-day' : '');
      cell.innerHTML = `
        <div class="week-cell-head">
          <span class="week-day-name">${DAY_NAMES[i]}</span>
          <span class="week-day-date">${date.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}</span>
        </div>
        <div class="week-cell-body">
          ${day
            ? `<span class="status-pill" style="--c:var(--${color})">${escapeHtml(STATUS_LABEL[day.status] || day.status)}</span>`
            : '<span class="week-cell-empty">—</span>'}
        </div>`;
      if (day) cell.addEventListener('click', () => loadByCode(day.id));
      grid.appendChild(cell);
    });
  } catch {
    grid.innerHTML = '<p style="color:var(--muted);padding:20px 0;grid-column:1/-1;text-align:center">Eroare la încărcare.</p>';
  }
}

$('#acc-week-btn')?.addEventListener('click', () => {
  weekOffset = 0;
  loadWeek();
  showAppStep('week');
});

$('#week-prev-btn')?.addEventListener('click', () => {
  weekOffset--;
  loadWeek();
});

$('#week-next-btn')?.addEventListener('click', () => {
  weekOffset++;
  loadWeek();
});

$('#week-back-btn')?.addEventListener('click', () => {
  showAppStep(state.plan ? 'result' : 'form');
  if (state.plan) renderResult(state.plan, state.checked);
});

// ————— PWA: Service Worker —————
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
