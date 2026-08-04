# 🗓️ Organizare Zi de Zi

Serviciu de **abonament** în care o persoană dedicată — **organizatorul personal** —
îți organizează viața de zi cu zi: **mese, sport/mișcare, timp liber, rutine și somn**.

Abonatul completează un profil scurt și primește un plan de start pentru zi. Apoi îl poate
**trimite organizatorului**, care îl ajustează manual dintr-un panou dedicat și îl marchează
ca „gata". Abonatul revine cu un cod și vede planul personalizat.

Organizarea acoperă patru domenii: 🥗 mese & nutriție · 💪 mișcare & sport · ⏰ timp & rutine · 🌙 relaxare & somn.

## Fluxul complet

```
Abonat                          Organizator (/organizator)
──────                          ──────────────────────────
1. Completează profilul
2. Primește un plan de start
3. „Trimite organizatorului" ──▶ 4. Vede cererea în listă
   (primește un cod)              5. Ajustează blocurile, rezumatul,
                                     sfaturile + scrie o notă
6. Revine cu codul          ◀──── 7. Salvează → status „gata"
7. Vede planul personalizat
```

## Structură

```
organizare-zi-de-zi/
├── public/
│   ├── index.html          # landing + aplicația abonatului
│   ├── app.js              # profil, plan, checklist, trimitere + status
│   ├── organizator.html    # panoul organizatorului
│   ├── organizator.js      # listă cereri + editor de plan
│   └── styles.css          # design system (dark theme)
├── src/
│   ├── index.js            # Worker: rutare API + servire assets
│   ├── plan.js             # pregătirea planului (cu fallback demo)
│   ├── store.js            # logica de stocare (pură, testabilă)
│   └── do.js               # Durable Object care persistă datele
├── wrangler.toml           # Cloudflare Worker + Static Assets + Durable Object
└── package.json
```

## Rulare locală

```bash
npm install
npm run dev          # → http://localhost:8787
```

## Deploy pe Cloudflare — fără pași manuali ✨

```bash
npm run deploy       # npx wrangler deploy
```

Prin integrarea Git (Workers Builds), un push pe `main` declanșează deploy-ul automat.

**Nu trebuie să configurezi nimic în dashboard-ul Cloudflare.** Persistența folosește un
**Durable Object** pe care Cloudflare îl creează singur la deploy (vezi `[[migrations]]` din
`wrangler.toml`). Backend-ul SQLite e eligibil pe planul gratuit.

### Panoul de organizator

Organizatorul accesează **`/organizator`** și, la **prima intrare, își setează o parolă**
(minim 6 caractere) — fără niciun secret de configurat. Parola e stocată securizat (SHA-256 +
salt) în Durable Object și e cerută la fiecare intrare ulterioară.

> Alternativ, poți fixa în locul parolei un token ca secret Cloudflare
> (`npx wrangler secret put ORGANIZER_TOKEN`); dacă e setat, are prioritate față de parola din panou.

## API

| Metodă | Rută | Cine | Descriere |
|--------|------|------|-----------|
| POST | `/api/plan` | abonat | Generează planul de start din profil |
| POST | `/api/submit` | abonat | Trimite planul + profilul → returnează un cod |
| GET | `/api/my?id=COD` | abonat | Vede statusul + planul (posibil ajustat) |
| GET | `/api/org/state` | public | Dacă accesul de organizator e configurat |
| POST | `/api/org/setup` | organizator | Setează parola la prima intrare |
| GET | `/api/org/requests` | organizator | Lista cererilor |
| GET | `/api/org/request?id=ID` | organizator | O cerere completă |
| PUT | `/api/org/request?id=ID` | organizator | Salvează plan / status / notă |

Rutele de organizator cer header-ul `x-org-token: <parola>` (parola setată la prima intrare
sau secretul `ORGANIZER_TOKEN`, dacă e configurat).
`category` a unui bloc ∈ `meal | sport | work | free | routine`. Statusuri: `nou | in_lucru | gata`.

## Roadmap

- [x] Panou pentru organizator (ajustare manuală a planurilor abonaților)
- [ ] Autentificare abonați (cont + istoric pe zile)
- [ ] Reminder-e (email/push) când planul e „gata"
- [x] Liste de cumpărături pentru domeniul mese
- [ ] Integrare calendar & apps de fitness/somn (tier Premium)
