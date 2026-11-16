# tárca weboldal

A [tarcajs](https://www.npmjs.com/package/tarcajs) npm csomag weboldala ([tarcajs.hu](https://tarcajs.hu)): főoldal, magyar nyelvű dokumentáció és egy böngészőben futó sandbox, ahol a példák API kulcs nélkül, a csomag saját hamis Billingója ellen futnak.

Next.js 16 (App Router), React 19, Tailwind CSS 4 és fumadocs (MDX) alapokon készül. Az oldal csak világos módban létezik. A dizájn döntései a [`DESIGN.md`](DESIGN.md)-ben vannak.

## Követelmények

- Node.js 22 vagy újabb
- npm (a `package-lock.json` a mérvadó)

```bash
cd web
npm install
npm run dev
```

## A csomag forrása

A weboldal a `tarcajs` csomagot nem a `package.json`-ból, hanem a `tarca-version.json` alapján telepíti (`npm run tarca:install`, ezt a `dev`, a `build`, a `typecheck` és a `test` előtt magától lefut):

- Verziószámnál (például `{ "version": "0.1.2" }`) az npm-ről tölti le pontosan azt a verziót. Ha egy friss kiadás még nem érhető el, 15 másodpercenként újrapróbálja, legfeljebb 20 percig.
- `{ "version": "local" }` esetén a repó gyökerét buildeli és csomagolja (`npm run build`, `npm pack`), így kiadás nélkül is a helyi forrás fut.

A kiadáskor a `scripts/release.mjs` a gyökérben átírja a `tarca-version.json`-t az új verzióra, így a weboldal mindig a kiadott csomagot mutatja.

## Parancsok

| Parancs | Mit csinál |
| --- | --- |
| `npm run dev` | Legenerálja a sandbox fájljait, majd elindítja a fejlesztői szervert (`http://localhost:3000`) |
| `npm run dev:next` | Csak a Next.js fejlesztői szerver, sandbox build nélkül (ha a `generated/` és a `public/sandbox-runtime/` már megvan) |
| `npm run build` | Sandbox build, majd éles Next.js build |
| `npm run start` | Az éles build kiszolgálása |
| `npm run sandbox:build` | A sandbox worker, a típusfájlok, a Monaco szerkesztő és a példák kimenetének generálása |
| `npm run typecheck` | Sandbox build, `next typegen`, majd `tsc --noEmit` |
| `npm run lint` | Biome ellenőrzés (`npm run lint:fix` javít is) |
| `npm test` | Vitest egységtesztek |
| `npm run ci` | Lint, típusellenőrzés, tesztek és build egymás után |

## Felépítés

```text
web/
├── app/                      útvonalak (App Router)
│   ├── (site)/               főoldal
│   ├── docs/[[...slug]]/     dokumentációs oldalak
│   ├── sandbox/              a sandbox oldal
│   ├── api/search/           statikus keresőindex
│   ├── docs-md/[[...slug]]/  az oldalak Markdown változata (a /docs/*.md ide van átírva)
│   ├── og/docs/[...slug]/    az oldalak Open Graph képe
│   ├── llms.txt/             oldallista AI eszközöknek
│   ├── llms-full.txt/        a teljes dokumentáció egy fájlban
│   ├── sitemap.ts, robots.ts
│   ├── not-found.tsx, icon.svg
│   └── layout.tsx
├── content/docs/             a dokumentáció MDX fájljai és a meta.json navigáció
├── components/
│   ├── landing/              a főoldal szekciói és a drótábrák (wire-diagram, wire-geometry)
│   ├── docs/                 oldalsáv, tartalomjegyzék, morzsamenü, lapozó, oldalműveletek
│   ├── mdx/                  MDX komponensek (Callout, Cards, Tabs, Example, Operation, FlowDiagram, táblák)
│   ├── sandbox/              a sandbox felülete (szerkesztő, kimeneti panelek)
│   └── site/                 navigáció, lábléc, kereső, logó
├── sandbox/
│   ├── runtime/              a felhasználói kód fordítása és futtatása, a hamis Billingo felvevője, szerializálás
│   ├── examples/             a futtatható példák és a katalógusuk (catalog.ts)
│   └── worker.ts             a böngészőben futó Web Worker belépési pontja
├── scripts/                  a csomag telepítése, a sandbox build és a példák előfuttatása
├── lib/                      közös segédek (site adatok, fumadocs source, linkek, llms, OG kép, műveletszámok)
├── styles/                   design tokenek (tokens.css), főoldal, próza és kód stílusok
├── generated/                a sandbox build kimenete (gitignored)
├── public/                   statikus fájlok; a monaco/ és a sandbox-runtime/ generált
├── proxy.ts                  a /docs/*.md kérések átírása
└── source.config.ts          fumadocs-mdx beállítások (Shiki téma, Twoslash, lastModified)
```

A főoldal minden száma generált: a műveletek száma és megoszlása a csomag `BILLINGO_OPERATIONS` listájából jön (`lib/operations.ts`), a verzió a `tarca-version.json`-ból, a kérések, a számla és a `createOnce` eredményei pedig a build közben a hamis Billingo ellen lefuttatott valódi hívásokból (`components/landing/sample.ts`).

### A sandbox működése

A `/sandbox` oldalon a felhasználó kódja egy Web Workerben fut (`sandbox/worker.ts`), a valódi `tarcajs` csomaggal. A `runtime` lefordítja a TypeScriptet, a `tarcajs` importokat a csomagra köti, a `fetch` pedig a `tarcajs/testing` `createFakeBillingoFetch()` hamis Billingóját kapja, egy felvevőn át, amely minden kérést és választ megjegyez. Minden futás friss hamis Billingót kap. A futtatókörnyezet fájljait a `/sandbox-runtime/` útvonal szolgálja ki, szigorú CSP-vel (nincs hálózati hozzáférés).

A `npm run sandbox:build` minden példát lefuttat a hamis Billingo ellen, és a kimenetet (konzol, elküldött kérések, Billingo válaszok) a `generated/examples.json`-ba írja. Ha egy példa hibát dob vagy hibát naplóz, a build megáll.

## Új dokumentációs oldal

1. Hozd létre az MDX fájlt a megfelelő mappában, például `content/docs/alapok/uj-oldal.mdx`:

   ```mdx
   ---
   title: Új oldal
   description: Egy-két mondat arról, mit tud meg az olvasó. Ez kerül a keresőbe, az OG képre és az llms.txt-be is.
   official: https://app.swaggerhub.com/apis/Billingo/Billingo/3.0.14#/Document/CreateDocument
   ---

   A tartalom Markdownban, a `components/mdx` komponenseivel.
   ```

   Az `official` opcionális: a művelet hivatalos Billingo leírására mutat.
2. Vedd fel a fájl nevét (kiterjesztés nélkül) a mappa `meta.json` fájljának `pages` listájába, a kívánt helyre. Új mappánál a mappába is kell egy `meta.json` (`title`, `pages`), és a mappa nevét a szülő `meta.json`-jába is fel kell venni. Ha egy mappában csak `index.mdx` van, a `meta.json`-ból elhagyható a `pages`.
3. Minden más automatikus: a navigáció, a keresőindex, a sitemap, az llms.txt, a Markdown változat (`/docs/alapok/uj-oldal.md`) és az OG kép (`/og/docs/alapok/uj-oldal/image.png`) a build során elkészül.

Egy sandbox példa a `<Example slug="szamla" />` komponenssel ágyazható be; ez a kódot, a ténylegesen elküldött kéréseket, a Billingo válaszait és a konzolkimenetet mutatja. A `ts twoslash` jelölésű kódblokkokat a build típusellenőrzi. Egy művelet fejléce az `<Operation id="CreateDocument" methods={['documents.create']} />` komponenssel készül: a HTTP metódust, az útvonalat és a spec jelölését a csomag `BILLINGO_OPERATIONS` listájából veszi, a `methods` a hozzá tartozó tárca metódusokat sorolja fel.

A README receptgombjai a `content/docs/receptek/meta.json` `pages` listájából készülnek (a gyökérben `npm run readme`).

## Új sandbox példa

1. Írd meg a példát a `sandbox/examples/<slug>.ts` fájlba. A kód a `tarcajs` csomagot importálja; a `createTarca()` argumentum nélkül is működik, mert a sandbox adja a kulcsot és a hamis Billingót. A `tarca-sandbox` modul `billingo` objektumával hibát lehet szimulálni és a hamis Billingo állapotát lekérdezni.
2. Vedd fel az `EXAMPLES` listába a `sandbox/examples/catalog.ts`-ben: `slug` (egyezzen a fájlnévvel), `title`, `group`, `description` és opcionálisan `docs` (a kapcsolódó dokumentációs oldal útvonala; a teszt ellenőrzi, hogy létezik).
3. Futtasd a `npm run sandbox:build` parancsot. Ha a példa hibát dob, a build megmondja, melyik példa és miért.

## SEO és AI végpontok

| Útvonal | Tartalom |
| --- | --- |
| `/sitemap.xml` | A főoldal, a sandbox és minden dokumentációs oldal, utolsó módosítási dátummal |
| `/robots.txt` | Minden engedélyezett, kivéve az `/api/` és a belső `/docs-md/` útvonalat |
| `/llms.txt` | A dokumentáció oldallistája leírásokkal, a Markdown változatokra mutató linkekkel ([llmstxt.org](https://llmstxt.org)) |
| `/llms-full.txt` | Az összes oldal feldolgozott Markdownja, a navigáció sorrendjében |
| `/docs/<oldal>.md` | Egy oldal Markdownja (`text/markdown`), a kezdőlapé `/docs/index.md` |
| `/og/docs/<oldal>/image.png` | Az oldal Open Graph képe (1200 × 630) |

Mindegyik statikusan, a build során készül. Az abszolút URL-ek alapja a `lib/site.ts`-ben dől el: `NEXT_PUBLIC_SITE_URL`, ennek hiányában Vercelen a `VERCEL_PROJECT_PRODUCTION_URL`, helyben `http://localhost:3000`. Az OG képek betűtípusait (Archivo, Public Sans, JetBrains Mono) a build a Google Fontsból tölti le.

## Deploy (Vercel)

A Vercel projekt neve `tarca`, a domain `tarcajs.hu` (a `www.tarcajs.hu` átirányít rá).

1. A **Root Directory** `web`, a keretrendszer Next.js, a Node.js verzió 24. A Root Directoryn kívüli fájlok engedélyezettek, hogy `{ "version": "local" }` esetén a telepítő a repó gyökerét is buildelhesse.
2. A `vercel.json` szerint csak a `main` ág deployol, és az `ignoreCommand` kihagyja a buildet, ha a `web/` nem változott az előző deploy óta.
3. Környezeti változó: `NEXT_PUBLIC_SITE_URL=https://tarcajs.hu` (production). Ha nincs megadva, a projekt Vercel production domainje lesz az alap.
4. Az „Utoljára frissítve” dátumokat és a sitemap `lastModified` értékeit a build a git előzményből olvassa. Sekély klónnál egyes dátumok pontatlanok lehetnek, ezért a CI teljes előzménnyel (`fetch-depth: 0`) klónoz.

A `.github/workflows/web.yml` minden `web/**` változásnál lefuttatja a lintet, a típusellenőrzést, a teszteket és a buildet. A csomag saját CI-ja (`ci.yml`) és kiadási folyamata (`release.yml`) a `web/` változásait figyelmen kívül hagyja.
