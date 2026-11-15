# Közreműködés

Örülünk minden hibajelentésnek és javításnak. A tárca független, nyílt forráskódú projekt, a Billingo API viselkedésében a hivatalos [fejlesztői portál](https://developers.billingo.hu/post/api-v3) és a [SwaggerHub spec](https://app.swaggerhub.com/apis/Billingo/Billingo) az irányadó.

## Előkészület

```bash
npm ci
npm run spec:fetch
```

A `spec:fetch` letölti a hivatalos OpenAPI spec-et a `.spec-cache/` mappába. A szerződéstesztekhez és a típusgenerátorhoz (`npm run spec:types`) ez kell.

## Ellenőrzések

```bash
npm test
npm run ci
```

Az `npm run e2e` a megvalósított műveleteket élőben, egy Billingo fejlesztői teszt profilon próbálja ki. Ehhez kell a `BILLINGO_TEST_API_KEY` és a `BILLINGO_E2E_TAX_CODE` (lásd `.env.example`), és nem része az `npm run ci`-nek. Kulcs nélkül hibával áll le, így nem lehet véletlenül zöldnek hinni.

Az `npm run ci` lefuttatja a lintet, a típusellenőrzést, a README-szinkront, a lefedettséget (legalább 80%), a buildet, a `publint`-et és az `attw`-t. Pull request csak zöld `npm run ci` mellett kerül be.

## Szabályok

- Kód közé nem kerül komment (se `//`, se JSDoc).
- Az azonosítók angolul, a hibaüzenetek és a tesztnevek magyarul vannak.
- Nulla futásidejű függőség. A `src/` futtatókörnyezet-független marad: nincs `Buffer`, és nincs `node:` import.
- A `src/generated/billingo.ts` generált fájl, kézzel ne szerkeszd (`npm run spec:types`).
- Minden új modulhoz tartozik teszt, minden kéréstörzshöz contract teszt, és minden megvalósított művelethez e2e lépés. A tesztek nem hívják a valódi Billingo API-t. Az egyetlen kivétel a `tests/e2e/live.test.ts`, amit csak az `npm run e2e` futtat egy teszt profil kulcsával.
- Írást (POST, PUT, DELETE) soha nem ismétlünk automatikusan, csak GET-et.
- Nyilvános API-változásnál frissítsd a `readme/template.md`-t (utána `npm run readme`), az `agents/api.md`-t és az `agents/recipes.md`-t. A `README.md` generált fájl, kézzel ne szerkeszd.

A részletes útmutató a [AGENTS.md](AGENTS.md)-ben van.

## Commit üzenetek

[Conventional Commits](https://www.conventionalcommits.org/) formátumot használunk:

| Típus | Hatás |
| --- | --- |
| `feat:` | Új funkció, minor verzió |
| `fix:` | Hibajavítás, patch verzió |
| `perf:` | Gyorsítás, patch verzió |
| `feat!:` vagy `BREAKING CHANGE:` | Törő változás |
| `docs:`, `test:`, `refactor:`, `chore:`, `ci:` | Nem ad ki új verziót |

A `main` ágra érkező `feat`, `fix`, `perf` vagy törő commit automatikusan új verziót ad ki az npm-en. A `web/` mappán kívüli változás nélküli commit nem indít kiadást.

## Biztonsági hiba

Ne nyiss nyilvános issue-t, kövesd a [SECURITY.md](SECURITY.md)-t.
