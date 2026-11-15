---
name: uj-vegpont
description: Implement a Billingo API operation in tarca end to end (resource method, types, unit test, contract test, e2e step, fake, docs). Use when adding or finishing any Billingo endpoint, resource or method in this repository, or when the user says "új végpont", "valósítsd meg", "fedd le" about a Billingo operation.
---

# Új Billingo művelet a tárcában

Egy művelet csak akkor kész, ha az alábbiak mind teljesülnek. Olvasd el előbb az `AGENTS.md`-t és, ha létezik, a `kezdo-docs/05-architektura-es-api-terv.md` táblázatát (a metódus neve ott van).

1. **Forrás.** Keresd meg a műveletet a `src/core/operations.ts`-ben (operationId, metódus, útvonal), a sémát a `src/generated/billingo.ts`-ben, a leírást a friss spec-ben (`.spec-cache/`, `npm run spec:fetch`). Ha élő viselkedés kell (például mit ad egy végpont a teszt profilon), nézd meg a hivatalos MCP élő tesztjeit (github.com/octonull/billingo-mcp), és jelöld, mi ellenőrizetlen.
2. **Metódus.** A `src/<erőforrás>/<erőforrás>.ts` `create<X>Api(context)` gyárában, a `src/bank-accounts/bank-accounts.ts` mintájára. Paraméterek camelCase-ben, a típusok a generált sémákból, utolsó paraméter `options?: RequestOptions`. Lista esetén `list` + `all`. Írás soha nem kap retryt.
3. **Bekötés.** `src/client.ts` (a `Tarca` interfész és `createTarcaFromContext`), `src/index.ts` (típus-exportok). Ha új futásidejű export kerül a gyökérbe, bővítsd a `tests/public-api.test.ts` listáját.
4. **Egységteszt** `mockBillingo`-val: pontos metódus, útvonal, query, snake_case törzs, camelCase válasz, hibák. Magyar tesztnevek.
5. **Contract teszt:** minden kéréstörzsre `expect(contractErrors('<Séma>', request.body)).toEqual([])`.
6. **E2E:** új lépés a `tests/e2e/suite.ts`-ben a megfelelő csoportban (takarítással), a művelet az `E2E_OPERATIONS`-be, vagy indoklással az `E2E_EXCLUDED`-be. Bővítsd a `tests/fake-billingo.ts`-t, hogy a fake futás is zöld legyen. A `tests/coverage.test.ts` ratchet számát csökkentsd.
7. **Dokumentáció:** `agents/api.md`, `agents/recipes.md` (ha van értelme), `readme/template.md` (utána `npm run readme`), és a `kezdo-docs/05` táblázatában ✅.
8. **Ellenőrzés:** `npm run ci`, `node scripts/smoke.mjs` a build után, és ha van teszt profil kulcs, `npm run e2e`. Utána commit: `feat(<erőforrás>): …`.
