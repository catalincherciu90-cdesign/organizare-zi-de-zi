# 🗓️ Organizare Zi de Zi

Asistent AI de **abonament** care ajută abonații să-și organizeze viața de zi cu zi:
**mese, sport/mișcare, timp liber, rutine și somn**. Produsul e construit în jurul unei
echipe de 4 agenți-coach AI care împart ziua utilizatorului între ei:

| Agent | Rol | Se ocupă de |
|-------|-----|-------------|
| 🥗 **Nutri** | Nutriție & mese | Meniuri zilnice, gustări, hidratare, adaptate la restricții |
| 💪 **Forța** | Sport & mișcare | Antrenamente potrivite nivelului și timpului disponibil |
| ⏰ **Ritm** | Organizare & rutine | Blocuri de focus, priorități, rutine care rămân |
| 🌙 **Calm** | Timp liber & wellbeing | Relaxare, deconectare, rutină de somn |

Abonatul completează un profil scurt (obiectiv, program, nivel de fitness, preferințe
alimentare, timp liber), iar agenții generează un **plan personalizat pentru ziua respectivă**,
pe care îl poate bifa punct cu punct.

## Cum funcționează

1. **Landing page** — prezintă serviciul, agenții și cele 3 planuri de abonament (Start / Echilibru / Premium).
2. **Onboarding** — formular scurt cu profilul abonatului.
3. **Generare plan** — frontend-ul apelează `POST /api/plan`, care compune un system prompt
   pentru echipa de agenți și cheamă **Claude API** pentru un program zilnic în format JSON.
4. **Dashboard zilnic** — planul e afișat ca timeline colorat pe categorii, cu checklist și
   bară de progres. Progresul și profilul se salvează local (`localStorage`).

> **Fără cheie API?** Aplicația funcționează integral în **mod demo**: `/api/plan` generează
> un plan realist local (bazat pe orele de trezire/culcare, obiectiv, nivel de fitness și
> preferințe). Adaugi cheia Claude API când vrei planuri complet personalizate de AI.

## Structură

```
organizare-zi-de-zi/
├── public/              # frontend static (servit de Cloudflare Pages)
│   ├── index.html       # landing + aplicația (planner)
│   ├── styles.css       # design system (dark theme)
│   └── app.js           # navigare, apel API, checklist + progres
├── functions/
│   └── api/
│       └── plan.js      # Pages Function → Claude API (cu fallback demo)
├── wrangler.toml
└── package.json
```

## Rulare locală

```bash
npm install
npm run dev          # → http://localhost:8788
```

## Deploy pe Cloudflare Pages

```bash
npm run deploy       # npx wrangler pages deploy public
```

Setează (opțional) cheia Claude API ca secret pentru planuri generate de AI:

```bash
npx wrangler pages secret put ANTHROPIC_API_KEY
# Model configurabil (default: claude-sonnet-5) via env var ANTHROPIC_MODEL
```

## API

### `POST /api/plan`

**Body** (profil abonat):
```json
{
  "nume": "Ana",
  "obiectiv": "energie",
  "trezire": "07:00",
  "culcare": "23:00",
  "program": "9-17",
  "fitness": "mediu",
  "dieta": "vegetarian",
  "timpLiber": "citit, plimbări",
  "note": "prefer sport seara"
}
```

**Răspuns**:
```json
{
  "plan": {
    "summary": "Un plan echilibrat pentru Ana...",
    "blocks": [
      { "time": "07:00", "title": "Trezire & hidratare", "category": "routine", "agent": "Ritm", "detail": "..." }
    ],
    "tips": ["...", "..."]
  },
  "source": "ai"
}
```

`source` este `"ai"` (generat de Claude) sau `"demo"` (fallback local).
`category` ∈ `meal | sport | work | free | routine`. `agent` ∈ `Nutri | Forța | Ritm | Calm`.

## Roadmap

- [ ] Autentificare abonați + planuri persistente pe zile (Cloudflare D1)
- [ ] Reminder-e (email/push) per bloc
- [ ] Feedback loop: agenții învață din bifările utilizatorului
- [ ] Liste de cumpărături generate de Nutri
- [ ] Integrare calendar & apps de fitness/somn (tier Premium)
