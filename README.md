# 🗓️ Organizare Zi de Zi

Serviciu de **abonament** în care o persoană dedicată — **organizatorul tău personal** —
îți organizează viața de zi cu zi: **mese, sport/mișcare, timp liber, rutine și somn**.

Abonatul completează un profil scurt (obiectiv, program, nivel de fitness, preferințe
alimentare, timp liber), iar aplicația îi pregătește un **plan personalizat pentru ziua
respectivă**, pe care îl poate bifa punct cu punct.

Organizarea acoperă patru domenii:

| Domeniu | Se ocupă de |
|---------|-------------|
| 🥗 **Mese & nutriție** | Meniuri zilnice, gustări, hidratare, adaptate la restricții |
| 💪 **Mișcare & sport** | Antrenamente potrivite nivelului și timpului disponibil |
| ⏰ **Timp & rutine** | Blocuri de focus, priorități, rutine care rămân |
| 🌙 **Relaxare & somn** | Timp liber, deconectare, rutină de somn |

## Cum funcționează

1. **Landing page** — prezintă serviciul, domeniile organizate și cele 3 planuri de abonament (Start / Echilibru / Premium).
2. **Onboarding** — formular scurt cu profilul abonatului.
3. **Pregătire plan** — frontend-ul apelează `POST /api/plan` (tratat de Worker), care
   construiește programul zilei în format JSON.
4. **Dashboard zilnic** — planul e afișat ca timeline colorat pe categorii, cu checklist și
   bară de progres. Progresul și profilul se salvează local (`localStorage`).

> **Mod demo (implicit):** `/api/plan` generează un plan realist local (bazat pe orele de
> trezire/culcare, obiectiv, nivel de fitness și preferințe), fără nicio configurare. Opțional,
> planul poate fi generat printr-un model (setând `ANTHROPIC_API_KEY`), dar nu e necesar.

## Structură

```
organizare-zi-de-zi/
├── public/              # frontend static (servit de Worker prin binding ASSETS)
│   ├── index.html       # landing + aplicația (planner)
│   ├── styles.css       # design system (dark theme)
│   └── app.js           # navigare, apel API, checklist + progres
├── src/
│   ├── index.js         # Worker: rutare (/api/plan) + servire assets statice
│   └── plan.js          # logica de pregătire a planului (cu fallback demo)
├── wrangler.toml        # Cloudflare Worker + Static Assets
└── package.json
```

> Aplicația e un **Cloudflare Worker cu Static Assets**: Worker-ul (`src/index.js`) servește
> fișierele din `public/` și tratează ruta `POST /api/plan`.

## Rulare locală

```bash
npm install
npm run dev          # → http://localhost:8787
```

## Deploy pe Cloudflare (Workers)

```bash
npm run deploy       # npx wrangler deploy
```

Prin integrarea Git (Workers Builds), un push pe `main` declanșează automat deploy-ul.
Comanda de deploy folosită de build: `npx wrangler deploy`.

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
      { "time": "07:00", "title": "Trezire & hidratare", "category": "routine", "detail": "..." }
    ],
    "tips": ["...", "..."]
  },
  "source": "demo"
}
```

`category` ∈ `meal | sport | work | free | routine`.

## Roadmap

- [ ] Autentificare abonați + planuri persistente pe zile (Cloudflare D1)
- [ ] Panou pentru organizator (ajustare manuală a planurilor abonaților)
- [ ] Reminder-e (email/push) per bloc
- [ ] Liste de cumpărături pentru domeniul mese
- [ ] Integrare calendar & apps de fitness/somn (tier Premium)
