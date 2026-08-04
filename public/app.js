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
  if (step === 'form') {
    $('#app-title').textContent = 'Hai să-ți construim ziua';
    $('#app-sub').textContent = 'Completează câteva detalii — ne ocupăm noi de rest.';
  } else if (step === 'result') {
    $('#app-title').textContent = state.profile?.nume ? `Ziua ta, ${state.profile.nume}` : 'Planul tău de azi';
    $('#app-sub').textContent = 'Bifează pe măsură ce avansezi.';
  } else if (step === 'history') {
    $('#app-title').textContent = 'Istoricul meu';
    $('#app-sub').textContent = 'Planurile trimise organizatorului.';
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

    const prevStatus = state.status;
    const newStatus = data.status;

    state.plan = data.plan;
    state.code = code;
    state.status = newStatus;
    state.orgNote = data.note || '';
    state.shopping = data.shoppingList || [];
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

// ————— Persistență —————
function load() {
  const defaults = { profile: null, plan: null, checked: {}, code: null, status: null, orgNote: '', accToken: null, accEmail: null, notifyOptIn: false, notifiedGata: false };
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

// Verifică token-ul cu serverul la inițializare; curăță dacă e expirat
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
    }
  } catch {
    // eroare de rețea — păstrăm token-ul, va fi verificat la următoarea acțiune
  }
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
    renderAccBar();
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
  save();
  renderAccBar();
  toast('Ai ieșit din cont.');
});

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

  // Dacă permisiunea e deja acordată, activez polling-ul
  if (Notification.permission === 'granted') {
    state.notifyOptIn = true;
    save();
    const btn = $('#notify-opt-in-btn');
    if (btn) btn.classList.add('hidden');
    startPolling();
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

// Pornește polling-ul dacă avem cod și opt-in activ
if (state.code && state.status !== 'gata' && state.notifyOptIn) {
  startPolling();
}
