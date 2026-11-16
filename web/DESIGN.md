# tárca weboldal: dizájn

A `tarcajs.hu` vizuális iránya. A tulajdonos jóváhagyta az irányt (a kék drótábrás stílust), és 2026. november 16-án öt pontban kérte az átdolgozását; ez a változat már azokat követi (1a. pont). A statikus minta (`web/design-mock/`) az építéskor a valódi főoldallá vált (`app/(site)/page.tsx`, `components/landing/`, `styles/landing.css`), ezért törölve. Ez a fájl a döntéseket rögzíti; az építés (`stage: "epites"`) ebből dolgozik, és ha valamit másképp kell csinálni, előbb ezt kell átírni.

## 1. Az irány

**Egy hívás, négy kérés, egy számla.** A kassza egyetlen XML-t küld, a tárca egy REST API-val beszél: egy `documents.create()` mögött számlatömböt keres, partnert keres vagy hoz létre, és csak a végén küldi el a `POST /documents` kérést. Az oldal ezt az útvonalat mutatja meg, szó szerint: fehér dobozok, köztük pontozott kék drót, a dobozokban a valódi kérések, a végén a számla. A számla formája a logóból jön: a kék sáv a T vízszintese, a róla lelógó, cikkcakkosan letépett papírcsík a T szára.

A világ egyetlen tinta: fehér papír, mélykék szöveg, a `#314EFF` kék pedig nem díszítés, hanem a drót, a kiemelés és két teljes mező (összevetés, zárás). Az egyetlen kódpanel sötét, ugyanazzal a palettával, mint a README hero szerkesztője. Az oldal mindig világos.

Fizikai jelenet, ami a világos módot is indokolja: egy fejlesztő nappali fényben, egyik ablakban a szerkesztő, a másikban a Billingo felülete; két feladat között olvas, másol, kipróbál.

### 1a. A tulajdonos megjegyzései (2026. 11. 16.) és amit változtattak

1. **Olyan letisztult, mint a kassza.** Kevesebb szekció (öt a láblécig), szekciónként egy cím, egy mondat és egy ábra; 160 px a szekciók között desktopon. Kikerült a „Kód és drót” JSON-panel, a külön „Pontosan egyszer” szekció, az 57 metódusnevet felsoroló kék tárgymutató, a futtatókörnyezet- és a tesztelés-szekció: ezek csempék lettek.
2. **Sokkal kevesebb kód.** A főoldalon egyetlen 9 soros, legfeljebb 45 karakter széles kiállító részlet van (a hero, `components/landing/hero-snippet.ts`, típusellenőrzött), minden más ábra és rövid szöveg, legfeljebb apró inline kódcímkével (`createOnce()`, `npx tarcajs doctor`). A kód a docsban és a sandboxban él.
3. **Jobb animációk.** Minden drótábra ugyanúgy mozog: a drót kirajzolódik, rajta egy pötty végigfut, és a doboz akkor gyullad ki, amikor a pötty odaér (7. pont). Egyszer fut, `prefers-reduced-motion` alatt a végállapot látszik.
4. **A drótok tényleg összeérnek a dobozokkal.** A végpontokat nem kézzel számoljuk és nem CSS-sel toldjuk: egy SVG-réteg ül az ábra fölött, a végpontok a dobozok valódi `getBoundingClientRect()` értékéből jönnek, `ResizeObserver` és betűtöltés után újraszámolva. Minden drót két végén egy kis kék port ül a doboz élén. A mintában ellenőrizve 320, 375, 768, 1024 és 1440 px-en: mind a 27 drót mindkét vége 0 px-re van a doboz élétől, vízszintes görgetés sehol.
5. **„Miért tárca?” csempékben**, ahogy a kasszánál: kilenc csempe eltérő méretben (12 oszlopos bento), mindegyikben egy kis ábra, kódblokk egyikben sincs (8. pont, 2. szekció).

## 2. Miben más, mint a kassza, és miért

| | kassza | tárca | Miért |
|---|---|---|---|
| Kompozíció | Középre zárt hero, középre zárt szekciócímek | Balra zárt, aszimmetrikus: a cím balra, a mondat és a gombok jobbra a cím alapvonalán; a szekciók fele balra zárt | Testvér, nem ikertestvér. A tárca egy REST útvonalat mutat, az balról jobbra olvasható |
| Hero jelenet | Nyomtató, kinyomtatott blokk, pecsét | Drótábra: a kód sorából pontozott drót négy valódi kérés dobozán át a logóból lelógó számláig | A Billingo-ban a tárca több kérést küld; ez a mechanizmus, ezt kell látni |
| Szekcióhatár | Sötét sávok hullámos széllel | Kék mezők cikkcakkos, letépett felső éllel (a logó szárának alja) | A hullám a kassza ritmusa; a tárcáé a tépés |
| Szín | Narancs `#ff6630` kiemelés, sötét palaszürke sávok | Egy kék tinta: kék szöveg-ink, kék mezők, kék útvonal | A márka kék; a kassza narancsával nem keveredhet |
| Betű | Bricolage Grotesque + Geist + Geist Mono | Archivo (kiterjesztett szélesség a címekhez) + Public Sans + JetBrains Mono | Lásd 4. pont |
| Gombok | Kerek pirulák | Szögletes, 8 px sarok, a logó csempéjének aránya kicsiben | A pirula a kassza gombja |
| Kódablak | Ablak három pöttyel | Fájlnév-fül, pöttyök nélkül | Ne rajzoljunk OS-ablakot |
| Statisztika-sáv | Öt számláló szám | Nincs külön sáv: az 57 a hero címkéjében, a „Mind az 57 művelet” csempe megosztott sávjában (50 + 4 + 3) és az összevetésben | Egy szám ott hihető, ahol mellette a bizonyíték |
| „Miért” | Öt csempe bento-rácsban | Kilenc csempe négy méretben; a vizuálisok többsége ugyanaz a drótábra-nyelv, mint a hero (dobozok, pontozott drót, portok) | A testvér-szerkezet megmarad, a nyelv a tárcáé |
| Kód a főoldalon | Hero kód és két nagy panel (TypeScript és XML) | Egyetlen 8 soros részlet a heróban | A tulajdonos kérése; a kód a docsba és a sandboxba való |
| Futtatókörnyezetek | Forgó orbit külön szekcióban | Csempe: a logó csempéjéből négy drót a négy környezetbe | Nyugodtabb, és ugyanaz a nyelv |
| Hivatalos jelvény | Hivatalos Számlázz.hu plugin | Nincs. A láblécben: független projekt, nem a Billingo fejleszti | A tárca nem hivatalos Billingo termék |
| Sötét mód | Kódban megvan, kikapcsolva | Nincs: se token, se kapcsoló, se `next-themes` | A tulajdonos döntése |

Ami ugyanaz (az információs architektúra): navigáció (Dokumentáció, Sandbox, Receptek, verzió, GitHub, npm, keresés), a főoldal története és sorrendje (kiállítás néhány sorban, miért: pontosan egyszer, műveletek, függőség, futtatókörnyezetek, hibák, típusok, tesztelés, fizetés, MCP; összevetés; fizetések; zárás), fumadocs docs oldalsávval és tartalomjegyzékkel, háromoszlopos sandbox, llms.txt, Markdown változatok, OG képek, kereső, sitemap.

## 3. Színek (csak világos)

Minden szín token a `styles/tokens.css` `:root` blokkjában. Nincs `.dark` blokk, nincs `prefers-color-scheme: dark`, a `color-scheme` értéke `light`. A márka kék OKLCH-ban: `#314EFF` = `oklch(53.2% 0.26 268)`.

| Token | Érték | Mire |
|---|---|---|
| `--paper` | `#ffffff` | Az oldal alapja |
| `--leaf` | `oklch(97.6% 0.012 268)` | Halvány kék levél: a bento csempék háttere, a táblák fejléce, a docs oldalsáv aktív eleme |
| `--leaf-2` | `oklch(95% 0.022 268)` | Hover a levélen, a kód kiemelt sora világos környezetben |
| `--rule` | `oklch(91% 0.018 268)` | Hajszálvonalak |
| `--rule-strong` | `oklch(82% 0.04 268)` | Mezőhatár, gombkeret |
| `--ink` | `oklch(22% 0.05 268)` | Szöveg, címek (mélykék, nem fekete) |
| `--ink-2` | `oklch(37% 0.045 268)` | Bekezdés |
| `--muted` | `oklch(50% 0.04 268)` | Másodlagos szöveg (fehéren 6:1 fölött) |
| `--blue` | `#314EFF` | Márka: elsődleges gomb, kék mezők, útvonal, aktív állapot |
| `--blue-hover` | `oklch(47% 0.25 268)` | Elsődleges gomb hover |
| `--blue-press` | `oklch(42% 0.23 268)` | Elsődleges gomb lenyomva |
| `--blue-ink` | `oklch(46% 0.24 268)` | Kék szöveg fehéren (linkek, kis méretben is 7:1) |
| `--blue-soft` | `oklch(94% 0.035 268)` | Címkék háttere, kijelölés |
| `--blue-mid` | `oklch(72% 0.14 268)` | A 3.0.15 újdonságainak szelete a műveletsávban |
| `--on-blue-track`, `--on-blue-deep` | `oklch(62% 0.2 268)`, `oklch(45% 0.24 268)` | Sorvonal és üres sáv a kék mezőn |
| `--danger-ink`, `--danger-bg` | `oklch(47% 0.17 27)`, `oklch(96.5% 0.025 27)` | A hibacsempe kategóriacímkéje |
| `--on-blue` | `#ffffff` | Szöveg kék mezőn (5,7:1) |
| `--on-blue-2` | `oklch(92% 0.04 268)` | Másodlagos szöveg kék mezőn |
| `--on-blue-rule` | `oklch(70% 0.16 268)` | Vonalak kék mezőn |
| `--editor` | `oklch(21% 0.022 258)` | Kódpanel (a README hero szerkesztője) |
| `--editor-chrome` | `oklch(25% 0.022 258)` | Kódpanel fejléc |
| `--editor-rule` | `oklch(32% 0.022 258)` | Kódpanel vonalai |
| `--code-*` | a `readme/art/theme.mjs` `darkCode` értékei | Kódszínezés (keyword 305, string 80, constant 45, function 240) |
| `--danger`, `--warning`, `--success`, `--info` (+ `-bg`, `-border`) | szemantikus, 27 / 75 / 155 / 268 árnyalat | Csak a docs Callout és a sandbox hibapanelje |
| `--focus` | `--blue` | Fókuszgyűrű: 2 px, 2 px eltolással, kék mezőn fehér |

Színstratégia: elkötelezett. A kék a drótokat, a kigyulladt dobozokat és két teljes mezőt visz (összevetés, zárás), a docsban visszafogott: csak link, aktív elem, elsődleges gomb.

Böngészőfelületek: `::selection` kék-lágy háttér, `caret-color: var(--blue)`, görgetősáv `--rule-strong` a `--paper`-en, `text-underline-offset: 0.18em`, táblákban `tabular-nums`.

## 4. Betűk

| Szerep | Betű | Beállítás |
|---|---|---|
| Display (h1, h2, logó szó) | **Archivo**, változó, `wdth` 100–125 | h1: `wdth` 125, 800, `-0.035em`; h2: `wdth` 118, 750, `-0.025em`; h3: `wdth` 108, 700 |
| Szöveg és UI | **Public Sans**, 400–700 | 17 px alap, 1,6 sormagasság, 65–72 karakteres sorhossz |
| Kód | **JetBrains Mono**, 400–600 | 13,5–14,5 px, 1,7 sormagasság, ligatúrák nélkül |

Miért ez a pár: a magyar nyomtatványok és bizonylatok fejléce széles, nehéz groteszk, a mezőik semleges, olvasható betűvel kitöltve. Az Archivo szélességtengelye ezt a „fejléc” hangot adja (125-ös szélességen a „Billingo, TypeScriptben.” egy bizonylat címsorára hasonlít), a Public Sans pedig közszolgálati űrlapokra készült semleges szöveges betű. A JetBrains Mono csak kódhoz, adathoz és mért értékhez kerül (HTTP sor, összeg a számlán), címkéhez soha. Mindhárom ingyenes, latin-ext (ő, ű) karakterkészlettel, `next/font/google`-lel tölthető, és egyik sem a kassza betűje.

Skála (rem, 16 px bázis): 0,8125 · 0,875 · 1 · 1,0625 (szöveg) · 1,25 · 1,5 · 2 · `clamp(2rem, 2.4vw + 1.25rem, 3.4rem)` (h2) · `clamp(2.6rem, 6.2vw + 0.6rem, 6rem)` (h1). Címkék, táblafejek, navigáció: szöveges betű, egy fokkal kisebb, mondatkezdő kisbetűvel, ritkítás nélkül. Csupa nagybetű és kiskapitális sehol.

A README grafikák (`readme/art/fonts.mjs`) most Bricolage + Geist betűvel készülnek. Ha az oldal betűi maradnak, érdemes a README art `FONT_SPECS`-ét is átállítani, hogy a README hero és a weboldal ugyanazt a betűt mutassa. Ez a tulajdonos döntése (8. pont).

## 5. Térköz, rács, sarkok

- Térközskála (px): 4, 8, 12, 16, 24, 32, 48, 64, 96, 160. Szekciók között 160 (desktop), 120 (tablet), 88 (mobil), a kassza levegőjével. A cím fölött több hely, mint alatta.
- Tartalom: legfeljebb 80 rem (1280 px), középre zárva, 1920 px-en a margó nő, a rács nem. Oldalmargó: 64 / 32 / 16 px.
- Rács: 12 oszlop, 24 px köz desktopon, 16 px mobilon (a bento is ezt használja). A drótábrák belső oszlopközét a drót hossza adja, ábránként. Képtartó sávok `minmax(0, 1fr)`.
- Sarkok: 4 px (címke, kód a szövegben), 8 px (gomb, mező, drótábra doboza), 14 px (kódpanel, hibalap, a fizetési ábra középső doboza), 20 px (bento csempe). A logó csempéje 22%-os sugarú, ezt csak a logó viseli.
- Árnyék: csak a kódpanel és a számla levél kap, eltolással és lágy elmosással (`0 18px 40px -18px` mélykékből 22%), színes fényudvar nincs.

## 6. Motívumok

1. **Drótábra.** Fehér doboz (1 px `--rule-strong` keret, 8 px sarok), köztük kerek végű, `0 8` szaggatású 2,5 px-es kék pontozott drót, köbös görbével. A drót két végén 3,5 px sugarú kék port ül, pontosan a doboz élén. Az irányt az ábra `--flow` CSS-változója adja (`x`: jobb élből bal élbe, `y`: alsó élből felső élbe, `auto`: a dobozok helyzetéből), így töréspontonként a CSS dönti el, merre fut a drót, a JS csak mér. Halvány (`dim`) drót `--rule-strong` színnel: visszatérítés, üres függőségfa. Kigyulladt doboz: 2 px kék gyűrű egy átlátszóságra animált rétegen. A kódpanelből induló drót a `documents.create(` sorából indul (`data-port-y`).
2. **Tépés.** A logó szárának alja: 24 px széles, 12 px mély cikkcakk, CSS maszkkal (`conic-gradient`). A kék mezők felső élén és a számla levél alján. Hullám nincs.
3. **T-sáv.** Kék, lekerekített sáv, amiről a számla lelóg. A hero utolsó drótja ide fut be.
4. **Kódpanel.** Sötét, fájlnév-füllel; a főoldalon egyetlen egy van. A sandbox Monaco szerkesztője ugyanezt a sötét témát kapja.

Tiltólista: hullám, pecsét, OS-ablak pöttyök, egyforma kártyarács, színátmenet, üvegeffekt, felcímke a címek fölött, csupa nagybetűs ritkított címke, középpontokkal összefűzött meta-sor, emoji ikon, kódblokk a csempékben, drót, ami nem ér a dobozhoz.

## 7. Mozgás

- Csak `transform`, `opacity`, `clip-path` és `filter` animálódik. `transition: all` nincs.
- **A drót kirajzolása:** `clip-path: inset()` a drót útján, a haladás irányából (vízszintes drótnál balról jobbra, függőlegesnél felülről lefelé), 560 ms, `cubic-bezier(0.45, 0, 0.2, 1)`. A kezdő port az elején, a záró port a végén jelenik meg (160 ms áttűnés).
- **A pötty:** 5,5 px sugarú kék kör fehér körvonallal, Web Animations API `transform: translate()` kulcskockákkal. A kulcskockák a drót `getPointAtLength()` mintáiból készülnek, az eltolásuk a vízszintes vagy függőleges haladás (nem az ívhossz), így a pötty a kirajzolódó drót hegyén ül.
- **Kigyulladás:** amikor a pötty a dobozhoz ér, a doboz gyűrűje 260 ms alatt megjelenik, és ami a dobozhoz tartozik (a kérés státusza, a `created: true`), 320 ms alatt beúszik (opacity és 4 px). 90 ms szünet a következő drót előtt.
- **Ábránként egy menet:** a hero betöltés után 350 ms-mal indul (kód, négy kérés, T-sáv, végül a számla 760 ms alatt lecsúszik a sáv alól). A többi ábra akkor indul, amikor 45%-a látszik, és egyszer fut le. Ahol több bemenet van (fizetések), előbb a nem futó drótok rajzolódnak ki 70 ms lépcsővel, utána fut a pötty egyetlen úton (Stripe, `issueForPayment()`, Számla), így a végállapot is elmond egy történetet.
- Görgetésre megjelenő elemek: egyetlen belépés (opacity és 16 px, `cubic-bezier(0.16, 1, 0.3, 1)`, 560 ms, csempéknél 70 ms lépcső). A rejtett kezdőállapot csak a JS által adott `.js-motion` osztály alatt él, script nélkül minden látszik (a drótok nélkül). A kassza `lenis` simított görgetését nem vesszük át.
- A műveletsáv és az összevetés sávjai `scaleX`-szel nőnek ki, egyszer.
- Állapotok: hover 120 ms, nyomás 80 ms (`scale(0.98)` a gombokon), fókusz azonnal.
- `prefers-reduced-motion: reduce`: minden a végállapotában: a drótok kirajzolva, a futások dobozai kigyulladva, a státuszok és a számla látszik.

## 8. A főoldal szekciónként

A számok nem kézzel vannak beírva. A műveletszám és a spec szerinti bontás (a 3.0.14-es specben 50, a 3.0.15 újdonsága 4, nem dokumentált 3) a telepített `tarcajs` `BILLINGO_OPERATIONS` exportjából jön (`spec`: `both` és `only-3.0.14`, `only-3.0.15`, `undocumented`), ugyanúgy, ahogy a `readme/site-data.mjs` a `src/core/operations.ts`-ből számol. A verzió a `web/tarca-version.json`-ból. A hero kimenete (a négy kérés, `2026-1`, 190 500 Ft) és a hibacsempe szövege a build közben, a hamis Billingo ellen futtatott valódi kódból készül (`scripts/examples-runner.ts` mintájára). A mintában szereplő értékeket is így mértük, a `tarcajs` buildjével.

A szövegek tegeződnek, mint a kasszánál. Öt szekció a láblécig; szekciónként egy cím, legfeljebb egy mondat, és egy ábra.

### 1. Hero (kassza: Hero és HeroStage)

- Verziócímke (link a `#miert`-re): `v0.1.2` és „Mind az 57 Billingo művelet”.
- Cím: **Billingo, TypeScriptben.** (két sor), balra zárva; jobbra, a cím alapvonalán: „Egy függvényhívás, és a számla kész a Billingóban.”, alatta „Kezdd el” (elsődleges) és „Kipróbálom” (keretes).
- Jelenet (drótábra): a 9 soros `szamla.ts` panel (mobilon is vízszintes görgetés nélkül, 375 px-től); a `documents.create(` sorából drót fut a négy kérésdobozba (`GET /document-blocks` számlatömböt választ, `GET /partners?query=Vevő Kft.` partnert keres, `POST /partners` nincs ilyen, létrehozza, `POST /documents` kiállítja), dobozról dobozra függőleges drót, az utolsóból a T-sávba. A pötty sorban kigyújtja a dobozokat, megjelenik a státusz (200, 200, 201, 201), végül a számla lecsúszik: `2026-1`, Vevő Kft., Webfejlesztés 10 óra, nettó 150 000 Ft, ÁFA 27% 40 500 Ft, bruttó **190 500 Ft**.
- Elrendezés: 1152 px fölött három oszlop (kód, kérések, számla); 641 és 1152 px között a kód felül teljes szélességben, alatta a kérések és a számla; mobilon egy oszlop, minden drót függőleges.
- A részletben a `partner: { name: 'Vevő Kft.', address }` rövidítés szerepel; az építésnél a részletet a valódi típusokkal ellenőrizzük (`declare const address: Address`).

### 2. Miért tárca? (kassza: FeaturesSection)

- Cím: **Miért tárca?**
- Szöveg: „A Billingo API-ban a számlához számlatömb, partner és pontos áfakód kell, egy ismételt kérésből pedig két számla lesz. Ezt a tárca intézi helyetted.”
- Bento, 12 oszlop (tableten 2, mobilon 1). Csempe: `--leaf` háttér, 20 px sarok, keret nélkül; felül az ábra, alul cím és egy mondat, néha egy szöveges link. Kódblokk egyikben sincs.

| Csempe | Méret (desktop) | Ábra | Szöveg |
|---|---|---|---|
| Nincs dupla számla | 7 oszlop, 2 sor | Drótábra: „Webhook” és „Ugyanaz újra” (mindkettő `rendeles-1001`), mindkettőből drót a `createOnce()` dobozba, onnan a „Számla 2026-1” dobozba. Két futás: az elsőnél `created: true`, a másodiknál `created: false`, végül „1 számla. Nem kettő.” | „A `createOnce()` a rendelés azonosítója alapján megkeresi a bizonylatot, mielőtt kiállítja. Az újraküldött webhook a meglévő számlát kapja vissza.” Link: Pontosan egyszer |
| Mind az 57 művelet | 5 oszlop | Megosztott sáv (50, 4, 3) jelmagyarázattal: a 3.0.14-es specben, újdonság a 3.0.15-ösben, nem dokumentált, élőben mérve | „Számla, díjbekérő, nyugta, sztornó, partner, termék, készlet és export. Mindegyiket élő e2e teszt futtatja.” |
| 0 futásidejű függőség | 5 oszlop | Függőségfa drótként: `tarcajs@0.1.2`, alatta szaggatott `(empty)` doboz, alatta `npm ls --omit=dev` | „Natív `fetch`. Se axios, se node-fetch.” |
| Bárhol fut | 5 oszlop | A logó csempéjéből négy drót: Node 22+, Bun, Deno, Cloudflare Workers | „A CI a lefordított csomagot mind a négy környezetben lefuttatja, ESM és CommonJS buildként.” |
| Egy hibatípus, magyarul | 7 oszlop | Hibalap: `BillingoError`, `validation` címke, „Hibás bizonylatadatok: items.0.name: Nem lehet üres.”, mezőhiba, és a tipp: „A tárca a kérést el sem küldte a Billingónak, így semmi nem jött létre.” | „Minden hiba `BillingoError`, kategóriával, mezőhibákkal és javítási tippel.” |
| Típusok a hivatalos specből | 4 oszlop | Három sor: a spec szerint `is_created_by_nav` (áthúzva), a Billingo valójában `created_by_nav`-ot küld, a tárca típusa `createdByNav: boolean` | „Ahol a Billingo mást küld, mint amit a spec ír, a típus az élő mérést követi.” |
| Hamis Billingo a tesztekhez | 4 oszlop | Tesztfuttatás-lap (minta): `fizetes.test.ts`, két pipa a README tesztneveivel, „Tests 2 passed” | „A `tarcajs/testing` memóriában fut, sorszámoz és kerekít, mint az igazi.” |
| Fizetésből bizonylat | 4 oszlop | Két drót: Fizetés, Számla vagy nyugta; Visszatérítés, Sztornó (szaggatott); alatta `vendorId: STRIPE-<fizetés azonosító>` | „Webhookból pontosan egyszer, a fizetés azonosítójával.” Link: „Az öt szolgáltató” (`#fizetesek`) |
| Parancssor és MCP szerver | 12 oszlop, a szöveg balra | Drótlánc: „Az asszisztens kéri”, `preview_document`, „Te jóváhagyod” (megerősítő kód), `create_document`; egy futás | „Az `npx tarcajs doctor` 3 olvasó kéréssel ellenőrzi a beállításod. Az MCP szerver csak előnézet és megerősítő kód után enged számlát kiállítani.” Link: MCP szerver |

### 3. Összevetés (kassza: CompareSection; itt kék mező, tépett felső éllel)

- Cím: **A többiek legfeljebb 50-ig jutnak. A tárca mind az 57-et tudja.**
- Szöveg: „A Billingo API v3 kliensei az npm-en, a publikált kódjuk alapján.”
- Sávdiagram fehérrel a kéken: csomagnév (mono), alatta a függőségek száma és az utolsó kiadás külön elemként, mellette a sáv és a műveletszám. Sorok a README táblájából: tarcajs 57, 0 függőség, 2026. november; @codingsans/billingo-client 50, 2 nem deklarált, 2022. július; @clientapi/billingo 50, 1, 2023. október; billingo_api_v3 50, 2, 2024. január; billingo-v3 18, 1, 2024. február; node-billingo „A régi, v2-es API-hoz”, 9, 2017. július.
- Lábjegyzet: „2026. november 15-i állapot. A 3.0.14-es spec 50 műveletet ír le; a tárca ezen felül a 3.0.15-ös spec új műveleteit és 3 nem dokumentált, élőben működő műveletet is ismer.” Link: Részletes összehasonlítás.

### 4. Fizetésből bizonylat (kassza: PaymentsSection)

- Cím: **Fizetés után a bizonylat magától elkészül.**
- Szöveg: „Stripe, SimplePay, Barion, Revolut és PayPal webhookból pontosan egyszer nyugta vagy számla. Visszatérítéskor sztornó vagy módosító számla.”
- A jóváhagyott drótábra: bal oldalt az öt szolgáltató doboza, középen a logó csempéje `issueForPayment()` felirattal, jobb oldalt Számla, Nyugta, és szaggatottan Sztornó, Módosító számla („Szaggatott: visszatérítéskor.”). Minden drót a doboz élén kezdődik és végződik. A pötty egy utat jár be: Stripe, `issueForPayment()`, Számla.
- Mobilon is vízszintes marad (öt doboz balra, a logó középen, a négy kimenet jobbra, ikon nélkül); az `issueForPayment()` felirat ott az ábra alá kerül egy mondatba („Középen a tárca issueForPayment() függvénye.”), hogy ne keresztezze a drótokat.
- Gomb: „Fizetési integrációk” (`/docs/fizetesek`).

### 5. Zárás (kassza: ClosingSection) és lábléc

- Kék mező, tépett felső éllel. Logó csempe, cím: **Kezdd el most.** Telepítő parancs (`npm i tarcajs`, fehér mező, másolás gombbal), „Dokumentáció” (fehér gomb), „GitHub” (fehér keretes).
- Lábléc fehéren: logó és egy mondat („Nulla függőségű TypeScript kliens a Billingo API v3-hoz. MIT licenc.”), három oszlop linkkel (Dokumentáció, Eszközök, Projekt), alul: „A tárca független, nyílt forráskódú projekt: nem a Billingo fejleszti, és nem áll kapcsolatban vele.” és „A testvére: kassza, Számlázz.hu-hoz.”

Terjedelem: a főoldal nagyjából 590 látható szó, a hallmark 450-es határa fölött, mert a tulajdonos a kassza tartalmát kérte; a szöveg csempénként egy mondat, a többi ábra.

## 9. Dokumentáció

Fumadocs, ugyanúgy, mint a kasszánál (`fumadocs-core`, `fumadocs-mdx`, `fumadocs-ui`, `fumadocs-twoslash`, ugyanazok a verziók), saját oldalsávval, tartalomjegyzékkel, morzsamenüvel és lapozóval (`components/docs`). Olvasási felület: a márka a részletekben él, nem kiállítás.

- Fejléc: 64 px, fehér, alsó hajszálvonal. Logó, Dokumentáció, Sandbox, Receptek; jobbra verzió, GitHub, npm, kereső (`⌘K`). Témaváltó nincs.
- Oldalsáv: 288 px, csoportcímek a szöveges betűvel, félkövér, mondatkezdő kisbetűvel (nem csupa nagybetű). Aktív elem: `--leaf` háttér és `--blue-ink` szöveg, bal oldali színes keret nélkül.
- Tartalom: legfeljebb 46 rem; a cím Archivo `wdth` 112, 700, 2,5 rem; alatta a leírás (lead) és egy meta sor: az `official` link a SwaggerHub művelethez, a HTTP sor mono címkében, „Utoljára frissítve” a gitből.
- Új MDX komponens: `<Operation id="CreateDocument" />`. Egy sávban mutatja a HTTP módszert és útvonalat, a tárca metódusait és hogy melyik spec dokumentálja (3.0.14, 3.0.15 vagy „nem dokumentált”). Az adat a `BILLINGO_OPERATIONS`-ből jön.
- Kódblokkok: sötét panelek (`--editor`), a fájlnév-füllel; a Twoslash felugrók világosak, hajszálkerettel.
- Callout: halvány háttér, 1 px keret a szemantikus színből, ikon; nincs vastag bal keret.
- Táblák: `--leaf` fejléc, hajszálvonalak, `tabular-nums`.
- Oldalműveletek (`page-actions`): Markdown másolása, megnyitás `.md`-ként, szerkesztés GitHubon.
- Mobilon: az oldalsáv a fejléc menüjéből nyílik, a tartalomjegyzék a cím alatt összecsukva.

## 10. Sandbox

Ugyanaz a háromoszlopos elrendezés, mint a kasszánál: példalista, szerkesztő, kimenet. A kód Web Workerben fut a valódi `tarcajs` csomag ellen, a `fetch` a `tarcajs/testing` `createFakeBillingoFetch()`-ére kötve; szimulátort nem írunk.

- Fejsáv: példa címe és leírása; jobbra „Dokumentáció”, „Visszaállítás”, „Megosztás” (lz-string), és a kék „Futtatás” gomb (`⌘↵`).
- Példalista: csoportok (Számlák, Nyugták, Befizetések, Partnerek és termékek, Hibakezelés, Tesztelés, Eszközök), csoportcím a szöveges betűvel, nem csupa nagybetű.
- Szerkesztő: Monaco, a sötét kódtéma (`--editor`, `--code-*`), JetBrains Mono.
- Kimenet, három fül:
  - **Kérések**: a futás pontozott útvonala, minden megálló egy kérés (módszer, útvonal, státusz, idő), kattintásra kinyílik a JSON törzs és a válasz. Ez váltja ki a kassza „Elküldött XML” paneljét.
  - **Eredmény**: a visszatérési érték (`PreviewValue`), hibánál a `BillingoError` mezői.
  - **Konzol**.
- Állapotsor alul: „A hamis Billingo a böngésződben fut, kérés nem megy ki.” és a csomag verziója.
- Mobilon: fülek (Kód, Kimenet), a Futtatás gomb a fejsávban marad.

## 11. Egyéb oldalak

- **404**: balra zárt, „Ez az oldal nincs meg.” cím, a cikkcakkos tépés egy kis levélen, linkek a docsra és a sandboxra.
- **OG kép** (1200 × 630): fehér alap, balra a cím Archivo `wdth` 125-tel, alatta a leírás Public Sansszal, jobb alsó sarokban a kék T-sáv lelógó levéllel, a levélen az oldal útvonala mono betűvel. Betűk a buildben a Google Fontsból (`lib/og-fonts.ts`).
- **Ikon**: `app/icon.svg` = `assets/logo.svg`.

## 12. Fájlterv a `../kassza/web` alapján

A csomag forrása: a `tarcajs` fent van az npm-en (`npm view tarcajs version` 2026. 11. 16-án: `0.1.2`), ezért a `web/tarca-version.json` az aktuális kiadott verziót tartalmazza, és a `scripts/install-tarca.mjs` a kassza `install-kassza.mjs`-ét követi (`npm pack tarcajs@<verzió>`, kicsomagolás a `web/node_modules/tarcajs`-ba, várakozás, ha a friss kiadás még nincs kint). A `{ "version": "local" }` ág (`npm run build && npm pack` a repó gyökerén) megmarad helyi fejlesztéshez. A `scripts/release.mjs` már frissíti a fájlt.

**Változatlanul átvesszük** (csak a `kassza` → `tarca` nevek cserélődnek): `next.config.mts`, `proxy.ts`, `vercel.json`, `postcss.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `biome.json`, `app/api/search/route.ts`, `app/docs-md/[[...slug]]/route.ts`, `app/robots.ts`, `app/sitemap.ts`, `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`, `components/docs/*` (breadcrumbs, page-actions, pagination, sidebar-tree, toc), `components/mdx/{cards,code-block,copy-button,heading,tabs,tab-group-store}.tsx`, `components/site/{search-context,search-dialog}.tsx`, `components/sandbox/{preview-value,use-sandbox-runner}.ts(x)`, `lib/{cn,source,examples,use-shortcut-label}.ts`, `sandbox/runtime/{protocol,serialize}.ts`.

**Átalakítjuk:**
- `package.json`: név `tarca-web`, `tarca:install` szkript; kikerül a `next-themes` és a `lenis`; a többi függőség és verzió ugyanaz.
- `source.config.ts`: egyetlen Shiki téma (`themes: { light: tarcaCodeTheme }`), Twoslash, `lastModified`, ugyanazok a nyelvek (`xml` helyett a `http` és a `json` a fontos).
- `app/layout.tsx`: Archivo (`wdth` tengellyel), Public Sans, JetBrains Mono; `viewport` csak világos (`themeColor: '#ffffff'`, `colorScheme: 'light'`); metaadatok a tárcára.
- `app/(site)/page.tsx`: az új szekciók; a számok a csomagból és a buildelt példákból.
- `app/docs/*`, `app/sandbox/*`, `app/not-found.tsx`, `app/og/docs/[...slug]/route.tsx`, `app/icon.svg`.
- `components/site/{navbar,mobile-menu,site-footer,root-providers}.tsx`: témaváltó és `ThemeProvider` nélkül.
- `components/docs/sidebar-styles.ts`: az új aktív állapot.
- `components/mdx/{index,callout,example,flow-diagram,try-it}.tsx`: az `Example` a JSON kéréseket mutatja XML helyett; az `index` az új komponenseket exportálja.
- `components/sandbox/{sandbox-app,code-editor,output-panels}.tsx`: Kérések fül, sötét Monaco téma, csak világos oldal.
- `lib/{site,docs-links,llms,highlight,og-fonts,og-image,code-theme}.ts(x)`: tárca adatok, egy téma, új betűk.
- `sandbox/worker.ts`, `sandbox/runtime/{execute,modules,run}.ts`: a `tarcajs` és a `tarcajs/testing` modul, a `fetch` a hamis Billingóra kötve.
- `scripts/build-sandbox.mjs`, `scripts/examples-runner.ts`: a példák a hamis Billingo ellen futnak, és a kéréseket is rögzítik.
- `scripts/install-kassza.mjs` → `scripts/install-tarca.mjs`.
- `styles/prose.css`, `styles/code.css`: új tokenek, sötét kódblokk.
- `.github/workflows/web.yml`: a kassza előzményéből (lint, typecheck, test, build, `fetch-depth: 0`, csak `web/**` változásra). A tárca `ci.yml` és `release.yml` már kihagyja a `web/**` útvonalat.
- `README.md`, `AGENTS.md`, `CLAUDE.md` a `web/`-ben: a kasszáéi a tárcára írva.

**Lecseréljük:**
- `styles/tokens.css` (csak világos tokenek, 3. pont), `styles/{hero,landing,sections}.css` (új főoldal).
- `components/landing/*`: `hero`, `hero-route` (a `hero-stage` helyett, drótábra), `why-bento` és `bento-visuals` (a `features-section` és a `feature-visuals` helyett, kilenc csempe), `compare-section` (kék mezőn), `payments-section` (a jóváhagyott drótábra), `closing-section`, `tear-edge` (a `wave` helyett), `reveal`, `landing-container`, `section-title` (balra zárt). Kimarad: `proof-section`, `proof-snippet`, `operations-statement`, `stats-band`, `runtime-orbit`, `smooth-scroll`.
- `components/landing/wire-diagram.tsx` (új, kliens komponens): a minta `setupDiagram` logikája Reactben. Bemenet: a dobozok (`data-node`), a drótok (`from`, `to`, `dim`) és a futások; a végpontokat `getBoundingClientRect()`-ből számolja `useLayoutEffect`-ben, `ResizeObserver`-rel és `document.fonts.ready` után újra; a mozgás Web Animations API, `useReducedMotion` alatt végállapot. A `--flow` változót a CSS adja töréspontonként. Vitest teszt (kézzel megadott téglalapokkal) ellenőrzi, hogy a drót végpontja a doboz élén van minden `flow` értéknél, és egy Playwright lépés a mintában használt mérést futtatja 375, 768, 1024 és 1440 px-en.
- `components/site/logo.tsx`, `lib/brand.ts`, `lib/logo-art.tsx`: a tárca logó (`assets/logo.svg` útvonalai).
- `components/mdx/reference-tables.tsx`: Billingo táblák (hibakategóriák, áfakódok, fizetési módok, pénznemek, műveletek).
- `components/mdx/rounding-calculator.tsx`, `validator-playground.tsx`: a kasszás kerekítés és validátorok helyett egy `InputPlayground`, ami a tárca helyi ellenőrzését futtatja (mezőhibák magyarul, kérés nélkül). Csak akkor készül el, ha a docs oldalak hivatkoznak rá.
- `components/sandbox/xml-code.tsx` → `request-log.tsx`.
- `sandbox/simulator/*`: kimarad, a `tarcajs/testing` váltja ki.
- `sandbox/examples/*`: új példák a tárcához.

**Elhagyjuk:** `components/site/theme-toggle.tsx`, `components/site/official-badge.tsx`, `lib/theme.ts`, `public/hivatalos-szamlazz-plugin.svg`, `components/landing/smooth-scroll.tsx`, a `.dark` blokk minden CSS-ből. A főoldalnak nem kell a `motion` csomag (a drótábra WAAPI-t használ); ha a docs és a sandbox sem használja, kikerül a függőségek közül.

## 13. Nyitott döntések a tulajdonosnak

1. A betűpár (Archivo, Public Sans, JetBrains Mono) maradt. A README grafikák betűit is erre állítsuk át?
2. A hero számlája a hamis Billingo `2026-1` számát mutatja. Ha valódi teszt profilos számlaformátum kell (például előtaggal), azt egy élő e2e válaszból vesszük, nem kitaláljuk.
3. A „Fizetésből bizonylat” a csempék között és külön szekcióként is szerepel: a csempe a mechanizmust (a fizetés azonosítója a `vendorId`), a szekció a szélességet (öt szolgáltató, négy bizonylat) mutatja. Ha ez soknak hat, a csempe kimaradhat.
