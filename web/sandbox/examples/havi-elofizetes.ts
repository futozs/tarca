import { createTarca } from 'tarcajs'
import { runBatch, todayPeriod } from 'tarcajs/batch'

const tarca = createTarca()

const HONAPOK = { interval: 'month', anchor: '2026-01-01' } as const
const honap = todayPeriod(HONAPOK)

const elofizetesek = [
  {
    id: 41,
    csomag: 'Alap',
    havidij: 9_900,
    vevo: {
      name: 'Vevő Kft.',
      address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    },
  },
  {
    id: 42,
    csomag: 'Profi',
    havidij: 24_900,
    vevo: {
      name: 'Másik Vevő Bt.',
      address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 2.' },
    },
  },
]

async function szamlazdAHonapot() {
  return runBatch(tarca, {
    items: elofizetesek.map((elofizetes) => ({
      key: `ELOFIZETES-${elofizetes.id}-${honap.start}`,
      document: () => ({
        kind: 'invoice' as const,
        input: {
          partner: elofizetes.vevo,
          items: [
            {
              name: `${elofizetes.csomag} csomag havidíja (${honap.start}–${honap.end})`,
              quantity: 1,
              netUnitPrice: elofizetes.havidij,
              vat: 27,
            },
          ],
        },
      }),
    })),
  })
}

const elso = await szamlazdAHonapot()
console.log(
  'első futás:',
  elso.created.map((tetel) => tetel.number),
  elso.grossTotals,
)

const ujra = await szamlazdAHonapot()
console.log('újrafuttatás:', ujra.created.length, 'új,', ujra.existing.length, 'meglévő')
