# Beállítások (a tulajdonosnak)

Egyszer kell megcsinálni. Kulcsot soha ne commitolj, és ne írj be kódba.

## 0. Billingo fejlesztői teszt profil

A Billingo felületén: profilváltó → **Új vállalkozás létrehozása** → kapcsold be a **teszt profil** opciót. A teszt profil ingyenes, nem kapcsolható élesre, nincs NAV kapcsolata, a bizonylatokon „TESZT” felirat van. Benne: **Beállítások → API kulcsok → Új API kulcs**, **V3**, **olvasás és írás** joggal.

## 1. Az e2e kulcsa (GitHub Environment)

Repó → **Settings → Environments → New environment**. A neve pontosan ez legyen: `e2e`.

- **Deployment branches and tags:** *Selected branches* → `main`
- **Environment secrets → Add secret:**

| Név | Érték |
|---|---|
| `BILLINGO_TEST_API_KEY` | A Billingo **teszt profil** V3 API kulcsa (olvasás és írás) |
| `BILLINGO_E2E_EMAIL` | Egy saját e-mail cím. Csak ide küld bizonylatot az e2e |

- **Environment variables:**

| Név | Érték |
|---|---|
| `BILLINGO_E2E_TAX_CODE` | A teszt profil adószáma. Az e2e első lépése ellenőrzi, hogy a kulcs ehhez a NAV kapcsolat nélküli profilhoz tartozik |

Próba: **Actions → Teljes ellenőrzés → Run workflow**.

## 2. Email, ha valami elbukik

github.com → profilkép → **Settings → Notifications → System → Actions**: legyen bekapcsolva az **Email**, és a **Only notify for failed workflows**.

## 3. Ami magától megy (nincs teendő)

| Mi | Mikor |
|---|---|
| Teljes ellenőrzés: CI, friss Billingo spec, típus-szinkron, változásfigyelő, élő e2e | Minden hétfőn 05:17 UTC-kor és minden kiadás előtt |
| Változásfigyelő hibajegy (issue) | Hétfőnként, ha a Billingo spec, a changelog, a hivatalos MCP vagy egy élő útvonal változott |
| Kiadás az npm-re | `feat:` / `fix:` / `perf:` commit a `main`-en, ha minden zöld (az első kiadásig a `"private": true` megakadályozza) |
| Lefedettség-jelvények (`badges` ág) | Minden `main` push után |
| OpenSSF Scorecard | Kedden és minden `main` push után |

## 4. Csak ha gond van

- **Az npm publish elbukik (OIDC hiba):** npmjs.com → `tarca` → **Settings → Trusted Publisher → GitHub Actions**. Repository: `futozs/tarca`, Workflow: `release.yml`.
- **A `badges` ágra nem tud pusholni:** Settings → Rules. Ha egy szabály minden ágon tiltja a force pusht, vedd ki alóla a `badges` ágat.
- **A CI a típus-szinkronon bukik el:** a Billingo módosította a spec-et. `npm run spec:fetch && npm run spec:types`, nézd át a diffet, igazítsd a klienst, majd `npm run drift -- --update`.

## 5. Helyben (a saját gépeden)

- `cp .env.example .env`, töltsd ki, majd `npm run e2e`. A `.env` nincs commitolva.
- Az `npm install` bekapcsolja a commit-üzenet ellenőrzőt. Az üzenet formája: `feat: …`, `fix: …`, `docs: …`, `ci: …`.
