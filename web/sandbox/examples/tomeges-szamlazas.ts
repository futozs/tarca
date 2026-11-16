import { createTarca } from 'tarcajs'
import { billingPeriodAt, runBatch } from 'tarcajs/batch'

const tarca = createTarca()

const elofizetesek = [
  { id: 1, ar: 15_000 },
  { id: 2, ar: 25_000 },
]
const idoszak = billingPeriodAt({ interval: 'month', anchor: '2026-01-01' }, '2026-11-16')

const tetelek = elofizetesek.map((elofizetes) => ({
  key: `SUB-${elofizetes.id}-${idoszak.start}`,
  document: () => ({
    kind: 'invoice' as const,
    input: {
      partner: {
        name: 'Vevő Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
      items: [{ name: 'Havi előfizetés', quantity: 1, netUnitPrice: elofizetes.ar, vat: 27 }],
      fulfillmentDate: idoszak.end,
    },
  }),
}))

const proba = await runBatch(tarca, { items: tetelek, dryRun: true, ratePerMinute: 60 })
console.log('próba:', proba.validated.length, proba.grossTotals)

const eles = await runBatch(tarca, { items: tetelek, ratePerMinute: 60 })
console.log(
  'kiállítva:',
  eles.created.map((tetel) => tetel.number),
)

const ujra = await runBatch(tarca, { items: tetelek, ratePerMinute: 60 })
console.log(
  'újrafuttatás:',
  ujra.items.map((tetel) => tetel.status),
)
