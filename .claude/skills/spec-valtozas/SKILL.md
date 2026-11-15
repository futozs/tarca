---
name: spec-valtozas
description: Handle a change in Billingo's API or docs in tarca: a failing type sync check in CI, a drift watcher issue ("Változásfigyelő: eltérés a Billingo forrásaiban"), a new SwaggerHub version, a changed changelog, a new official MCP version or a route that started answering 404. Use when CI fails on generate-types --check, when npm run drift reports changes, or when the user mentions a Billingo API change.
---

# Billingo spec- vagy API-változás kezelése

1. **Mi változott?** `npm run spec:fetch`, aztán `npm run drift -- --skip-routes` (gyors), vagy teljes `npm run drift` (élő útvonal-próbával, kb. 80 mp). Olvasd el a jelentést és a fejlesztői changelogot (https://developers.billingo.hu/changelogs).
2. **Típusok.** `npm run spec:types`, majd `git diff src/generated/billingo.ts`. Minden eltérést értelmezz: új mező, új enum érték, eltűnt vagy átnevezett mező, kötelezővé vált mező.
2b. **Felülírások.** Ha az `npm run spec:types` (vagy a drift) azt írja, hogy egy `scripts/spec-overrides.mjs` bejegyzés felesleges, a Billingo kijavította a spec-et: töröld a bejegyzést (nem dokumentált műveletnél a `src/core/operations.ts` `spec` jelölését is igazítsd). Ha nem alkalmazható, a cél (séma, mező, művelet) megváltozott: nézd meg élőben vagy a hivatalos MCP-ben, mi a valóság, és ennek megfelelően javítsd, bizonyítékkal.
3. **Művelettábla.** Új vagy eltűnt végpontnál igazítsd a `src/core/operations.ts`-t (a `spec` jelöléssel együtt). A `tests/spec-contract.test.ts` megmondja, mi hiányzik. Ha egy végpont eltűnik a spec-ből, de élőben még 401-et ad (nem 404-et), maradjon a táblában a megfelelő jelöléssel (lásd a `partners/{id}` esetét).
4. **Kliens.** Igazítsd a kézzel írt réteget (ergonomikus bemenetek, leképezések), a teszteket és a fake Billingót. Törő változásnál `feat!:` vagy `fix!:` commit kell.
5. **Bizonyítás.** `npm run ci` (`TARCA_REQUIRE_SPEC=1`-gyel is), és ha van kulcs, `npm run e2e`.
6. **Zár.** `npm run drift -- --update`, és a változás rövid leírása a commit üzenetben. A drift issue-t a commit linkjével lehet lezárni.
