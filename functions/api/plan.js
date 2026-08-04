// Cloudflare Pages Function — POST /api/plan
// Primește profilul abonatului și întoarce un plan zilnic personalizat,
// generat de agenții AI (Nutri, Forța, Ritm, Calm) prin Claude API.
//
// Env vars (setate în Cloudflare Pages → Settings → Environment variables):
//   ANTHROPIC_API_KEY  — cheia Claude API (opțional; fără ea rulează în mod demo)
//   ANTHROPIC_MODEL    — model id (default: claude-sonnet-5)

const AGENTS = {
  Nutri: { emoji: '🥗', rol: 'coach de nutriție', focus: 'mese echilibrate, hidratare, gustări sănătoase' },
  Forța: { emoji: '💪', rol: 'coach de sport', focus: 'antrenamente potrivite nivelului, mișcare, recuperare' },
  Ritm:  { emoji: '⏰', rol: 'organizator de timp', focus: 'rutine, blocuri de muncă/focus, priorități' },
  Calm:  { emoji: '🌙', rol: 'coach de wellbeing', focus: 'timp liber, relaxare, somn de calitate' },
};

const SYSTEM_PROMPT = `Ești echipa de agenți AI din aplicația „Organizare Zi de Zi", un serviciu de abonament care ajută oamenii să-și organizeze viața de zi cu zi. Cei 4 agenți-coach sunt:
- 🥗 Nutri (nutriție & mese)
- 💪 Forța (sport & mișcare)
- ⏰ Ritm (organizare timp & rutine)
- 🌙 Calm (timp liber, somn, wellbeing)

Primești profilul unui abonat și construiești un program pentru O ZI, realist și personalizat, în limba română.

Reguli:
- Respectă ora de trezire, ora de culcare și programul de lucru din profil.
- Include 3-5 mese/gustări adaptate obiectivului și restricțiilor alimentare.
- Include mișcare/sport potrivit nivelului de fitness și timpului disponibil.
- Alternează blocuri de muncă/focus cu pauze și timp liber.
- Fiecare bloc are un agent responsabil (Nutri/Forța/Ritm/Calm).
- Ton prietenos, motivant, concret. Fără text în plus.

Răspunde DOAR cu un obiect JSON valid, fără markdown, cu structura:
{
  "summary": "1-2 propoziții care rezumă ziua",
  "blocks": [
    { "time": "07:00", "title": "titlu scurt", "category": "meal|sport|work|free|routine", "agent": "Nutri|Forța|Ritm|Calm", "detail": "1 propoziție cu ce presupune" }
  ],
  "tips": ["3 sfaturi scurte pentru ziua respectivă"]
}
Ordinează blocurile cronologic. Între 8 și 12 blocuri.`;

export async function onRequestPost({ request, env }) {
  let profile;
  try {
    profile = await request.json();
  } catch {
    return json({ error: 'Body invalid — trimite JSON.' }, 400);
  }

  const cleaned = sanitizeProfile(profile);

  // Fără cheie API → mod demo (plan generat local, complet funcțional)
  if (!env.ANTHROPIC_API_KEY) {
    return json({ plan: demoPlan(cleaned), source: 'demo' });
  }

  try {
    const plan = await generateWithClaude(cleaned, env);
    return json({ plan, source: 'ai' });
  } catch (err) {
    // Degradare grațioasă: dacă apelul AI eșuează, tot livrăm un plan util.
    return json({ plan: demoPlan(cleaned), source: 'demo', note: 'AI indisponibil momentan.' });
  }
}

async function generateWithClaude(profile, env) {
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const userMsg = `Profil abonat:\n${JSON.stringify(profile, null, 2)}\n\nGenerează planul zilei în format JSON.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('').trim();
  const parsed = JSON.parse(extractJson(text));
  return normalizePlan(parsed);
}

// ————— utilitare —————

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Fără JSON în răspuns');
  return text.slice(start, end + 1);
}

function normalizePlan(p) {
  const cats = ['meal', 'sport', 'work', 'free', 'routine'];
  const agents = Object.keys(AGENTS);
  return {
    summary: String(p.summary || '').slice(0, 400),
    blocks: (Array.isArray(p.blocks) ? p.blocks : [])
      .map((b) => ({
        time: String(b.time || '').slice(0, 5),
        title: String(b.title || '').slice(0, 80),
        category: cats.includes(b.category) ? b.category : 'routine',
        agent: agents.includes(b.agent) ? b.agent : 'Ritm',
        detail: String(b.detail || '').slice(0, 240),
      }))
      .sort((a, b) => a.time.localeCompare(b.time)),
    tips: (Array.isArray(p.tips) ? p.tips : []).slice(0, 5).map((t) => String(t).slice(0, 160)),
  };
}

function sanitizeProfile(p = {}) {
  const s = (v, n = 60) => String(v ?? '').slice(0, n);
  return {
    nume: s(p.nume, 40),
    obiectiv: s(p.obiectiv, 40),
    trezire: s(p.trezire, 5) || '07:00',
    culcare: s(p.culcare, 5) || '23:00',
    program: s(p.program, 40),
    fitness: s(p.fitness, 20),
    dieta: s(p.dieta, 40),
    timpLiber: s(p.timpLiber, 60),
    note: s(p.note, 300),
  };
}

// ————— plan demo (fallback fără AI) —————

function demoPlan(p) {
  const wake = p.trezire || '07:00';
  const h = parseInt(wake.split(':')[0], 10) || 7;
  const at = (offset, min = 0) => `${String((h + offset) % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

  const sport =
    p.fitness === 'avansat'
      ? 'Antrenament de forță 45 min + 10 min mobilitate'
      : p.fitness === 'incepator'
      ? 'Plimbare alertă 25 min + 8 exerciții de bază'
      : 'Cardio ușor 30 min + stretching';

  const micDejun =
    p.dieta && /vegan|veget/i.test(p.dieta)
      ? 'Ovăz cu fructe, semințe și lapte vegetal'
      : 'Ouă, avocado și pâine integrală';

  const obiectivTip = {
    slabit: 'Ține porțiile moderate și bea apă înainte de mese.',
    masa: 'Adaugă o gustare bogată în proteine după antrenament.',
    energie: 'Evită zahărul rafinat dimineața ca să eviți scăderea de energie.',
    echilibru: 'Păstrează pauze regulate — 5 min la fiecare oră de muncă.',
  };

  const blocks = [
    { time: wake, title: 'Trezire & hidratare', category: 'routine', agent: 'Ritm', detail: 'Un pahar cu apă și 5 min de întindere ca să pornești ziua.' },
    { time: at(0, 30), title: 'Mic dejun', category: 'meal', agent: 'Nutri', detail: micDejun + '.' },
    { time: at(1), title: 'Mișcare de dimineață', category: 'sport', agent: 'Forța', detail: sport + '.' },
    { time: at(2, 30), title: 'Bloc de focus 1', category: 'work', agent: 'Ritm', detail: 'Cea mai importantă sarcină a zilei, fără notificări.' },
    { time: at(5), title: 'Gustare', category: 'meal', agent: 'Nutri', detail: 'Un fruct și o mână de nuci pentru energie constantă.' },
    { time: at(5, 30), title: 'Bloc de focus 2', category: 'work', agent: 'Ritm', detail: 'Sarcini de intensitate medie și răspuns la mesaje.' },
    { time: at(7), title: 'Prânz', category: 'meal', agent: 'Nutri', detail: 'Proteină slabă, legume și o sursă de carbohidrați complecși.' },
    { time: at(8), title: 'Pauză activă', category: 'free', agent: 'Calm', detail: 'Plimbare scurtă sau 10 min fără ecrane.' },
    { time: at(10), title: 'Timp liber', category: 'free', agent: 'Calm', detail: p.timpLiber ? `Timp pentru: ${p.timpLiber}.` : 'Un hobby sau timp cu cei dragi.' },
    { time: at(11, 30), title: 'Cină ușoară', category: 'meal', agent: 'Nutri', detail: 'Masă ușoară cu legume și proteină, cu 3h înainte de somn.' },
    { time: p.culcare || '23:00', title: 'Rutină de somn', category: 'routine', agent: 'Calm', detail: 'Fără ecrane 30 min înainte, lumină scăzută, respirație lentă.' },
  ];

  return {
    summary: `Un plan echilibrat pentru ${p.nume || 'tine'}, construit în jurul obiectivului „${p.obiectiv || 'echilibru'}". Cei 4 agenți ți-au împărțit ziua în mese, mișcare, focus și odihnă.`,
    blocks,
    tips: [
      obiectivTip[p.obiectiv] || 'Bea minim 6 pahare de apă pe parcursul zilei.',
      'Bifează fiecare bloc — micile reușite construiesc obiceiuri.',
      'Dacă sari peste un bloc, nu-l recupera forțat; mergi mai departe.',
    ],
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
