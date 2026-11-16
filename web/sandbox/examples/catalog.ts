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
    docs: '/docs/bizonylatok',
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
    docs: '/docs/bizonylatok',
  },
  {
    slug: 'eloleg-vegszamla',
    title: 'Előleg- és végszámla',
    group: 'Számlák',
    description: 'Előlegszámla, majd végszámla, amelyről a Billingo levonja az előleget.',
    docs: '/docs/bizonylatok',
  },
  {
    slug: 'devizas-szamla',
    title: 'Devizás számla angolul',
    group: 'Számlák',
    description: 'Euróban kiállított angol nyelvű számla a Billingo árfolyamával.',
    docs: '/docs/bizonylatok',
  },
  {
    slug: 'sztorno',
    title: 'Számla sztornózása',
    group: 'Számlák',
    description: 'Számla, sztornó, és az eredeti számla sztornózott állapota.',
    docs: '/docs/bizonylatok',
  },
  {
    slug: 'befizetes',
    title: 'Befizetés rögzítése',
    group: 'Számlák',
    description: 'Két részlet egy számlára: a fizetési állapot előbb részleges, aztán fizetett.',
    docs: '/docs/bizonylatok',
  },
  {
    slug: 'pdf',
    title: 'PDF és blokknyomtatás',
    group: 'Számlák',
    description: 'A számla A4-es PDF-je és a 80 mm-es blokknyomtatós változata.',
    docs: '/docs/bizonylatok',
  },
  {
    slug: 'nyugta',
    title: 'Nyugta kiállítása',
    group: 'Nyugták',
    description: 'Kártyás nyugta bruttó árakkal, két áfakulccsal, partner nélkül.',
    docs: '/docs/nyugtak',
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
    slug: 'partner',
    title: 'Partner keresése vagy létrehozása',
    group: 'Partnerek és export',
    description:
      'findOrCreate: azonos adatokra a meglévő partnert adja, megváltozott címre újat hoz létre.',
    docs: '/docs/partnerek',
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
    slug: 'mock-kliens',
    title: 'Mock kliens tesztekhez',
    group: 'Tesztelés és tárhely',
    description: 'createMockTarca: hívásnapló, kérésszámláló és egyszeri hiba a saját tesztedhez.',
    docs: '/docs/tesztek',
  },
  {
    slug: 'pdf-tarhely',
    title: 'PDF mentése tárhelyre',
    group: 'Tesztelés és tárhely',
    description: 'A kiállított számla PDF-je dátum szerinti kulccsal egy memóriás tárhelyre.',
  },
]

export function findExample(slug: string): ExampleMeta | undefined {
  return EXAMPLES.find((example) => example.slug === slug)
}
