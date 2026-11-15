# Biztonsági szabályzat

A tárca számlázási hozzáférést (Billingo API kulcsot) és vevői adatokat kezel, ezért a biztonsági hibákat komolyan vesszük.

## Támogatott verziók

Biztonsági javítást csak a legutóbbi kiadott verzió kap. Érdemes mindig a legfrissebb verzióra frissíteni.

## Sebezhetőség bejelentése

**Ne nyiss nyilvános issue-t** biztonsági hibához. Használd a GitHub privát bejelentését:

[Sebezhetőség bejelentése](https://github.com/futozs/tarca/security/advisories/new)

A bejelentésben add meg:

- az érintett verziót és a futtatási környezetet (Node, Workers, Bun, Deno),
- a hiba leírását és a reprodukálás lépéseit,
- ha tudod, a lehetséges hatást.

Ne küldj valódi API kulcsot vagy vevői adatot. Ha egy kulcs kiszivároghatott, előbb töröld és hozz létre újat a Billingo felületén (Beállítások → API kulcsok).

## Mire számíthatsz

- A bejelentést néhány munkanapon belül visszaigazoljuk.
- A megerősített hibához javítást készítünk, és a javított verzió kiadása után nyilvános tájékoztatást (GitHub Security Advisory) teszünk közzé.
- Kérjük, a javítás megjelenéséig ne hozd nyilvánosságra a részleteket.

## Hatókör

A Billingo rendszerét érintő hibát a [Billingo](https://www.billingo.hu/kapcsolat) felé kell jelezni. A tárca csomagjában lévő hibák (kérésépítés, válaszfeldolgozás, hibakezelés) ide tartoznak.

## English summary

To report a security vulnerability, do not open a public issue. Use [GitHub private vulnerability reporting](https://github.com/futozs/tarca/security/advisories/new). We acknowledge reports within a few business days, prepare a fix for confirmed issues, and publish a GitHub Security Advisory after the fixed version is released. Please keep the details private until then (coordinated disclosure). Only the latest released version receives security fixes.
