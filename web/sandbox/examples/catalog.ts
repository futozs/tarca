export type ExampleGroup =
  | 'Számlák'
  | 'Nyugták'
  | 'Fizetésből bizonylat'
  | 'Partnerek és export'
  | 'Hibakezelés'
  | 'Tesztelés és tárhely'

export interface ExampleMeta {
  readonly slug: string
  readonly title: string
  readonly group: ExampleGroup
  readonly description: string
  readonly docs?: string
}

export const EXAMPLE_GROUPS: readonly ExampleGroup[] = [
  'Számlák',
  'Nyugták',
  'Fizetésből bizonylat',
  'Partnerek és export',
  'Hibakezelés',
  'Tesztelés és tárhely',
]

export const EXAMPLES: readonly ExampleMeta[] = [
  {
    slug: 'szamla',
    title: 'Számla kiállítása',
    group: 'Számlák',
    description:
      'Egy hívás, négy kérés: számlatömb, partnerkeresés, új partner, majd a számla. A sorszámot a Billingo adja.',
    docs: '/docs/bizonylatok/kiallitas',
  },
  {
    slug: 'pontosan-egyszer',
    title: 'Pontosan egyszer',
    group: 'Számlák',
    description:
      'createOnce kétszer ugyanarra a rendelésre: a második hívás a meglévő számlát adja vissza.',
    docs: '/docs/alapok/pontosan-egyszer',
  },
  {
    slug: 'dijbekero-szamla',
    title: 'Díjbekérő, majd számla',
    group: 'Számlák',
    description: 'Díjbekérő, belőle fizetett számla, végül a díjbekérő archiválása.',
    docs: '/docs/bizonylatok/dijbekero/minta',
  },
  {
    slug: 'eloleg-vegszamla',
    title: 'Előleg- és végszámla',
    group: 'Számlák',
    description: 'Előlegszámla, majd végszámla, amelyről a Billingo levonja az előleget.',
    docs: '/docs/bizonylatok/elolegszamla/minta',
  },
  {
    slug: 'devizas-szamla',
    title: 'Devizás számla angolul',
    group: 'Számlák',
    description: 'Euróban kiállított angol nyelvű számla a Billingo árfolyamával.',
    docs: '/docs/bizonylatok/kiallitas/szabalyok/deviza',
  },
  {
    slug: 'sztorno',
    title: 'Számla sztornózása',
    group: 'Számlák',
    description: 'Számla, sztornó, és az eredeti számla sztornózott állapota.',
    docs: '/docs/bizonylatok/sztorno/minta',
  },
  {
    slug: 'befizetes',
    title: 'Befizetés rögzítése',
    group: 'Számlák',
    description: 'Két részlet egy számlára: a fizetési állapot előbb részleges, aztán fizetett.',
    docs: '/docs/bizonylatok/befizetes/minta',
  },
  {
    slug: 'pdf',
    title: 'PDF és blokknyomtatás',
    group: 'Számlák',
    description: 'A számla A4-es PDF-je és a 80 mm-es blokknyomtatós változata.',
    docs: '/docs/bizonylatok/pdf/minta',
  },
  {
    slug: 'szamla-beallitasokkal',
    title: 'Számla minden fontos mezővel',
    group: 'Számlák',
    description:
      'Nettó és bruttó árú tétel két áfakulccsal, teljesítési nap, határidő, megjegyzés és rendelésszám.',
    docs: '/docs/bizonylatok/kiallitas/minta',
  },
  {
    slug: 'bizonylat-lekerese',
    title: 'Bizonylat lekérése',
    group: 'Számlák',
    description:
      'Lekérés azonosítóval és vendorId-val; az ismeretlen vendorId-ra a findByVendorId null értéket ad.',
    docs: '/docs/bizonylatok/lekeres',
  },
  {
    slug: 'bizonylat-lista',
    title: 'Lista és lapozás',
    group: 'Számlák',
    description:
      'Kifizetetlen számlák két elemes oldalanként, majd az összes számla bejárása az all() iterátorral.',
    docs: '/docs/bizonylatok/lista/minta',
  },
  {
    slug: 'piszkozat',
    title: 'Piszkozatból számla',
    group: 'Számlák',
    description:
      'Piszkozat véglegesítése számlává ugyanazzal az azonosítóval, majd egy másik piszkozat törlése.',
    docs: '/docs/bizonylatok/piszkozat/minta',
  },
  {
    slug: 'bizonylat-masolasa',
    title: 'Számla másolása',
    group: 'Számlák',
    description: 'Egy kiállított számla másolata új piszkozatként, sorszám nélkül.',
    docs: '/docs/bizonylatok/masolas',
  },
  {
    slug: 'modosito-szamla',
    title: 'Módosító számla',
    group: 'Számlák',
    description:
      'Két óra jóváírása módosító számlával; utána a Billingo az eredeti sztornóját 400-zal elutasítja.',
    docs: '/docs/bizonylatok/modosito/minta',
  },
  {
    slug: 'nyilvanos-link',
    title: 'Nyilvános link',
    group: 'Számlák',
    description:
      'A számla nyilvános hivatkozása, amelyet a vevőnek bejelentkezés nélkül elküldhetsz.',
    docs: '/docs/bizonylatok/pdf/minta',
  },
  {
    slug: 'kikuldes',
    title: 'Kiküldés e-mailben',
    group: 'Számlák',
    description: 'A számla kiküldése két címre, majd az emlékeztetők lekérése.',
    docs: '/docs/bizonylatok/kuldes/minta',
  },
  {
    slug: 'nav-statusz',
    title: 'NAV-állapot',
    group: 'Számlák',
    description:
      'Közvetlenül a kiállítás után a Billingónak még nincs NAV rekordja: a navStatus() null értéket ad.',
    docs: '/docs/bizonylatok/nav-statusz',
  },
  {
    slug: 'webshop-rendeles',
    title: 'Webshop rendelésből számla',
    group: 'Számlák',
    description:
      'Egy webshop rendelés számlája kétszer futtatva: a második futás egyetlen kereséssel a meglévő számlát adja.',
    docs: '/docs/receptek/webshop-rendeles',
  },
  {
    slug: 'havi-elofizetes',
    title: 'Havi előfizetés',
    group: 'Számlák',
    description:
      'runBatch két előfizetésre, majd ugyanarra a hónapra még egyszer: másodszorra minden tétel existing.',
    docs: '/docs/receptek/havi-elofizetes',
  },
  {
    slug: 'tomeges-szamlazas',
    title: 'Tömeges számlázás',
    group: 'Számlák',
    description:
      'runBatch két előfizetésre: próbafutás becsült összeggel, kiállítás, majd újrafuttatás dupla számla nélkül.',
    docs: '/docs/kiegeszitok/tomeges-szamlazas',
  },
  {
    slug: 'nyugta',
    title: 'Nyugta kiállítása',
    group: 'Nyugták',
    description: 'Kártyás nyugta bruttó árakkal, két áfakulccsal, partner nélkül.',
    docs: '/docs/nyugtak/kiallitas/minta',
  },
  {
    slug: 'nyugta-pontosan-egyszer',
    title: 'Nyugta pontosan egyszer',
    group: 'Nyugták',
    description:
      'receipts.createOnce kétszer ugyanarra a vendorId-ra: a második hívás a meglévő nyugtát adja.',
    docs: '/docs/nyugtak/kiallitas/minta',
  },
  {
    slug: 'nyugta-piszkozat',
    title: 'Nyugta piszkozatból',
    group: 'Nyugták',
    description:
      'Nyugta piszkozat, majd véglegesítés kártyás fizetéssel ugyanazzal az azonosítóval.',
    docs: '/docs/nyugtak/piszkozat/minta',
  },
  {
    slug: 'nyugta-sztorno',
    title: 'Nyugta sztornózása',
    group: 'Nyugták',
    description:
      'Nyugta és a sztornója: receipt_cancellation típus, negatív végösszeg a nyugtatömbben.',
    docs: '/docs/nyugtak/sztorno',
  },
  {
    slug: 'nyugta-blokk',
    title: 'Nyugta blokknyomtatóra',
    group: 'Nyugták',
    description:
      'Nyugta 58 mm-es blokknyomtatós PDF-je, application/octet-stream tartalomtípussal.',
    docs: '/docs/nyugtak/blokknyomtatas',
  },
  {
    slug: 'penztari-nyugta',
    title: 'Pénztári nyugta',
    group: 'Nyugták',
    description: 'Nyugta a pultnál createOnce-szal és a 80 mm-es blokknyomtatós PDF.',
    docs: '/docs/receptek/penztari-nyugta',
  },
  {
    slug: 'fizetesbol-bizonylat',
    title: 'Fizetésből nyugta',
    group: 'Fizetésből bizonylat',
    description:
      'issueForPayment egy fizetésre: a tárca dönt a nyugta és a számla között, és egyszer állítja ki.',
    docs: '/docs/fizetesek',
  },
  {
    slug: 'stripe-webhook',
    title: 'Stripe webhook',
    group: 'Fizetésből bizonylat',
    description:
      'Aláírt Stripe esemény kétszer és hamis aláírással: egy nyugta készül, a hamis kérés 400-at kap.',
    docs: '/docs/fizetesek',
  },
  {
    slug: 'visszaterites',
    title: 'Visszatérítés, sztornó',
    group: 'Fizetésből bizonylat',
    description: 'Barion fizetés nyugtája, majd a teljes visszatérítésre a sztornó.',
    docs: '/docs/fizetesek',
  },
  {
    slug: 'szamla-fizetesbol',
    title: 'Fizetésből számla cégnek',
    group: 'Fizetésből bizonylat',
    description:
      'Adószámos vevő fizetése: a tárca számlát állít ki partnerrel, és fizetettnek jelöli.',
    docs: '/docs/fizetesek/bizonylat-fizetesbol',
  },
  {
    slug: 'reszleges-visszaterites',
    title: 'Részleges visszatérítés',
    group: 'Fizetésből bizonylat',
    description:
      'Részleges visszatérítésre módosító számla ledgerrel; az újraküldött esemény nem állít ki másodikat.',
    docs: '/docs/fizetesek/reszleges-visszaterites',
  },
  {
    slug: 'partner',
    title: 'Partner keresése vagy létrehozása',
    group: 'Partnerek és export',
    description:
      'findOrCreate: azonos adatokra a meglévő partnert adja, megváltozott címre újat hoz létre.',
    docs: '/docs/partnerek/kereses-vagy-letrehozas/minta',
  },
  {
    slug: 'partner-lista',
    title: 'Partnerek listája',
    group: 'Partnerek és export',
    description: 'Névkeresés a szavak elejére: a „vev” talál, a szó közepe és az adószám nem.',
    docs: '/docs/partnerek/lista/minta',
  },
  {
    slug: 'partner-letrehozas',
    title: 'Partner létrehozása',
    group: 'Partnerek és export',
    description: 'Adószámos belföldi partner, a tárca kiegészíti a HU országkóddal.',
    docs: '/docs/partnerek/letrehozas/minta',
  },
  {
    slug: 'partner-modositas',
    title: 'Partner módosítása',
    group: 'Partnerek és export',
    description:
      'Teljes csere: a lekért partnerrel minden megmarad, a csonka PUT kiüríti a telefont és az e-mailt.',
    docs: '/docs/partnerek/modositas/minta',
  },
  {
    slug: 'partner-guess',
    title: 'Partner guess',
    group: 'Partnerek és export',
    description:
      'Pontos névre a meglévő partner üres taxType-pal, a név elejére új partner, mindkettő 201.',
    docs: '/docs/partnerek/guess/minta',
  },
  {
    slug: 'termek-lista',
    title: 'Termékek listája',
    group: 'Partnerek és export',
    description: 'Nettó és bruttó árú termék, keresés a névben, a lista mindkét árral.',
    docs: '/docs/termekek/lista/minta',
  },
  {
    slug: 'termek-letrehozas',
    title: 'Termék létrehozása',
    group: 'Partnerek és export',
    description: 'Egy ár: a másikat a Billingo számolja, a NaN árat a tárca el sem küldi.',
    docs: '/docs/termekek/letrehozas/minta',
  },
  {
    slug: 'termek-modositas',
    title: 'Termék módosítása',
    group: 'Partnerek és export',
    description:
      'Új bruttó ár a lekért termékből, majd egy csonka PUT, amely kiüríti a megjegyzést.',
    docs: '/docs/termekek/modositas/minta',
  },
  {
    slug: 'szamlatomb-lista',
    title: 'Számlatömbök listája',
    group: 'Partnerek és export',
    description:
      'A friss profil két tömbje és egy új, növekvő sorrendben, típus szerinti szűréssel.',
    docs: '/docs/szamlatombok/lista/minta',
  },
  {
    slug: 'szamlatomb-letrehozas',
    title: 'Számlatömb létrehozása',
    group: 'Partnerek és export',
    description:
      'WEB előtagú tömb, benne a WEB / 2026-000001 számla, és egy kötőjeles név, ami el sem megy.',
    docs: '/docs/szamlatombok/letrehozas/minta',
  },
  {
    slug: 'szamlatomb-modositas',
    title: 'Számlatömb módosítása',
    group: 'Partnerek és export',
    description: 'A lekért tömb visszaküldve a null mezők nélkül, majd egy csonka PUT.',
    docs: '/docs/szamlatombok/modositas/minta',
  },
  {
    slug: 'bankszamla-letrehozas',
    title: 'Bankszámla létrehozása',
    group: 'Partnerek és export',
    description: 'Forint és euró bankszámla, és egy euró számla az euró bankszámlával.',
    docs: '/docs/bankszamlak/letrehozas/minta',
  },
  {
    slug: 'bankszamla-modositas',
    title: 'Bankszámla módosítása',
    group: 'Partnerek és export',
    description: 'SWIFT kód a lekért bankszámlához, majd egy csonka PUT, amely kiüríti az IBAN-t.',
    docs: '/docs/bankszamlak/modositas/minta',
  },
  {
    slug: 'export',
    title: 'Export CSV-be',
    group: 'Partnerek és export',
    description:
      'Exportfeladat indítása, várakozás az elkészültére, majd a CSV letöltése. A hamis Billingo csak a fejlécsort adja.',
    docs: '/docs/export',
  },
  {
    slug: 'koltseg-rogzitese',
    title: 'Költség rögzítése',
    group: 'Partnerek és export',
    description:
      'Bejövő számla forintban, partner nélkül, majd ugyanaz lekérve: a createdByNav csak a lekérésben van.',
    docs: '/docs/koltsegek/letrehozas/minta',
  },
  {
    slug: 'koltsegek-szurese',
    title: 'Költségek szűrése',
    group: 'Partnerek és export',
    description:
      'Két havi bérleti díj, az egyik kifizetve. A lista a dátum, a kategória és a fizetési állapot szerint szűr.',
    docs: '/docs/koltsegek/lista/minta',
  },
  {
    slug: 'koltseg-modositasa',
    title: 'Költség módosítása és törlése',
    group: 'Partnerek és export',
    description:
      'A teljes költség újraküldve a fizetés dátumával, majd törlés. Utána a lekérés 404-et kap.',
    docs: '/docs/koltsegek/modositas/minta',
  },
  {
    slug: 'arfolyam',
    title: 'Árfolyam lekérése',
    group: 'Partnerek és export',
    description: 'Euró–forint árfolyam egy adott napra, és a forint–euró árfolyam mára.',
    docs: '/docs/arfolyam/minta',
  },
  {
    slug: 'adoszam-ellenorzes',
    title: 'Adószám ellenőrzése',
    group: 'Partnerek és export',
    description:
      'A törzsszámot a tárca kérés nélkül elutasítja, a teljes adószámra a teszt profil nav_unavailable hibát ad.',
    docs: '/docs/segedvegpontok/adoszam-ellenorzes/minta',
  },
  {
    slug: 'szervezet-adatai',
    title: 'Kulcs és szervezet',
    group: 'Partnerek és export',
    description:
      'verifyCredentials, majd a profil adatai: adószám, NAV-kapcsolat és az előfizetett funkciók.',
    docs: '/docs/segedvegpontok/szervezet',
  },
  {
    slug: 'szerverido-es-azonosito',
    title: 'Szerveridő és régi azonosító',
    group: 'Partnerek és export',
    description:
      'A Billingo órája budapesti időben, és egy v2-es azonosító v3-as párja kétszer lekérve.',
    docs: '/docs/segedvegpontok/szerverido',
  },
  {
    slug: 'hibakezeles',
    title: 'Hibák magyarul',
    group: 'Hibakezelés',
    description:
      'BillingoError kategóriával, mezőhibákkal és tippel: kérés előtti ellenőrzés és Billingo hiba.',
    docs: '/docs/alapok/hibakezeles',
  },
  {
    slug: 'elveszett-valasz',
    title: 'Elveszett válasz után',
    group: 'Hibakezelés',
    description:
      'A számla elkészül, de a válasz elveszik: a createOnce visszakeresi, újra nem állítja ki.',
    docs: '/docs/alapok/pontosan-egyszer',
  },
  {
    slug: 'kulcs-ellenorzes',
    title: 'Kulcs ellenőrzése',
    group: 'Hibakezelés',
    description: 'verifyCredentials és a profil adatai: NAV kapcsolat és az előfizetés lejárata.',
    docs: '/docs/receptek/kulcs-ellenorzes-indulaskor',
  },
  {
    slug: 'naplozas-es-metrikak',
    title: 'Naplózás és metrikák',
    group: 'Hibakezelés',
    description: 'observe() naplóval és Prometheus metrikával egy számla kiállítása közben.',
    docs: '/docs/receptek/naplozas-es-metrikak',
  },
  {
    slug: 'mock-kliens',
    title: 'Mock kliens tesztekhez',
    group: 'Tesztelés és tárhely',
    description: 'createMockTarca: hívásnapló, kérésszámláló és egyszeri hiba a saját tesztedhez.',
    docs: '/docs/tesztek',
  },
  {
    slug: 'hiba-szimulalas',
    title: 'Hibák szimulálása',
    group: 'Tesztelés és tárhely',
    description:
      'Hálózati hiba lekérdezésnél, 500 írásnál és elveszett válasz: mit ismétel a tárca, és mit nem.',
    docs: '/docs/tesztek/hibak-szimulalasa',
  },
  {
    slug: 'pdf-tarhely',
    title: 'PDF mentése tárhelyre',
    group: 'Tesztelés és tárhely',
    description: 'A kiállított számla PDF-je dátum szerinti kulccsal egy memóriás tárhelyre.',
  },
  {
    slug: 'bizonylatnaplo',
    title: 'Bizonylatnapló',
    group: 'Tesztelés és tárhely',
    description:
      'A kiállított számla a naplóba kerül, majd az egyeztetés a Billingo listájával összeveti.',
    docs: '/docs/kiegeszitok/bizonylatnaplo',
  },
]

export function findExample(slug: string): ExampleMeta | undefined {
  return EXAMPLES.find((example) => example.slug === slug)
}
