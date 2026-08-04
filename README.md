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
│   └── store.js            # stocarea cererilor în Cloudflare KV
├── wrangler.toml           # Cloudflare Worker + Static Assets
└── package.json
```

## Rulare locală

```bash
npm install
npm run dev          # → http://localhost:8787
```

Pentru panou și trimitere în local, adaugă un fișier `.dev.vars`:

```
ORGANIZER_TOKEN = "un-token-de-test"
```

și un namespace KV de preview (vezi mai jos). Fără KV, site-ul și generarea de plan merg,
dar trimiterea/panoul răspund cu „KV neconfigurat".

## Deploy pe Cloudflare (Workers)

```bash
npm run deploy       # npx wrangler deploy
```

Prin integrarea Git (Workers Builds), un push pe `main` declanșează deploy-ul automat.

### Activarea panoului de organizator (o singură dată)

Panoul și trimiterea planurilor au nevoie de **stocare KV** și de un **token de organizator**:

```bash
# 1. Creează namespace-ul KV
npx wrangler kv namespace create OZZ
#    → copiază id-ul returnat în wrangler.toml (secțiunea [[kv_namespaces]], decomentează)

# 2. Setează tokenul de acces al organizatorului
npx wrangler secret put ORGANIZER_TOKEN

# 3. Redeploy
npm run deploy
```

Organizatorul accesează panoul la **`/organizator`** și se autentifică cu tokenul setat.

> Fără acești doi pași, aplicația tot funcționează: site-ul public + generarea planului de
> start (mod demo). Doar trimiterea și panoul se activează după setup.

## API

| Metodă | Rută | Cine | Descriere |
|--------|------|------|-----------|
| POST | `/api/plan` | abonat | Generează planul de start din profil |
| POST | `/api/submit` | abonat | Trimite planul + profilul → returnează un cod |
| GET | `/api/my?id=COD` | abonat | Vede statusul + planul (posibil ajustat) |
| GET | `/api/org/requests` | organizator | Lista cererilor (necesită `x-org-token`) |
| GET | `/api/org/request?id=ID` | organizator | O cerere completă |
| PUT | `/api/org/request?id=ID` | organizator | Salvează plan / status / notă |

Rutele de organizator cer header-ul `x-org-token: <ORGANIZER_TOKEN>`.
`category` a unui bloc ∈ `meal | sport | work | free | routine`. Statusuri: `nou | in_lucru | gata`.

## Roadmap

- [x] Panou pentru organizator (ajustare manuală a planurilor abonaților)
- [ ] Autentificare abonați (cont + istoric pe zile)
- [ ] Reminder-e (email/push) când planul e „gata"
- [ ] Liste de cumpărături pentru domeniul mese
- [ ] Integrare calendar & apps de fitness/somn (tier Premium)
