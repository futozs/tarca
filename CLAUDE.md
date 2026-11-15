# tárca

Nyílt forráskódú Billingo API v3 kliens (TypeScript, npm csomag: `tarcajs`), a [kassza](../kassza) testvére. Az architektúra, a konvenciók és a release folyamat az `AGENTS.md`-ben van: munka előtt olvasd el. Ha van `kezdo-docs/` mappa (gitignored), előbb a `kezdo-docs/00-OLVASS-EL.md`-t olvasd el: ott van a kutatás, a terv, a roadmap és a következő lépések.

## Források
- Fejlesztői portál: https://developers.billingo.hu (API leírás: `/post/api-v3`, changelog: `/changelogs`)
- OpenAPI spec: SwaggerHub `Billingo/Billingo` (alapértelmezett 3.0.14, legújabb 3.0.15). Lokális másolat: `.spec-cache/` (`npm run spec:fetch`, gitignored)
- A hivatalos Billingo MCP (valós API-viselkedés): https://github.com/octonull/billingo-mcp
- Minta a felépítéshez: `../kassza`

## Konvenciók
- Kommentek nincsenek a kódban (se `//`, se JSDoc)
- Angol azonosítók, magyar hibaüzenetek és tesztnevek
- Dátum mindig `Europe/Budapest` (`src/core/dates.ts`)
- A publikus API camelCase, a Billingo snake_case: csak a határon alakítunk (`src/core/case.ts`)
- A típusok a spec-ből generálódnak (`src/generated/billingo.ts`), kézzel ne szerkeszd: `npm run spec:types`
- Írást (POST, PUT, DELETE) soha nem ismétlünk automatikusan; a pontosan egyszeri kiállítás a `vendorId`-ra épül
- Nulla runtime függőség, futtatókörnyezet-független `src/`
- Teszt minden új modulhoz, contract teszt minden kéréstörzshöz, e2e lépés minden megvalósított művelethez; a coverage küszöb 80%
- A tesztek nem hívják az éles API-t, kivéve a `tests/e2e/live.test.ts`-t (csak `npm run e2e`)

## Parancsok
- `npm test`, `npm run ci` (lint + typecheck + README check + coverage + build + publint/attw)
- `npm run spec:fetch` és `npm run spec:types`: a friss Billingo spec és a belőle generált típusok
- `npm run drift`: változásfigyelő (spec, changelog, hivatalos MCP, kulcs nélküli útvonal-próba)
- `npm run e2e`: élő futás a Billingo fejlesztői teszt profilján (`BILLINGO_TEST_API_KEY`, `BILLINGO_E2E_TAX_CODE` kell, nem része a `ci`-nek). Kulcsot soha ne kérj el, ne írj ki és ne commitolj. Részletek: `AGENTS.md`, E2E rész.
- `npm run readme`: a `README.md` generált fájl, kézzel ne szerkeszd. A forrás a `readme/template.md`, a változók a `readme/config.json`-ban vannak.

## Publikálás
A csomag még nincs kint az npm-en (`"private": true`). A kiadást a GitHub Actions végzi a `main`-re érkező `feat`, `fix`, `perf` és törő commitokból (`.github/workflows/release.yml`, `scripts/release.mjs`). A `private` kivétele és az első kiadás a tulajdonos döntése.
