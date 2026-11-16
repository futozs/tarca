import { createTarca } from 'tarcajs'
import { createJournal, memoryJournal } from 'tarcajs/journal'

const journal = createJournal(memoryJournal())
const tarca = createTarca({
  hooks: { onDocument: (event) => journal.record(event), onDocumentError: 'throw' },
})

const vendorId = 'ORDER-1001'
await journal.track(vendorId, () =>
  tarca.documents.createOnce({
    vendorId,
    partner: {
      name: 'Vevő Kft.',
      address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    },
    items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
  }),
)

const bejegyzesek = await journal.entries({ from: '2026-11-01', to: '2026-11-30' })
console.log(
  bejegyzesek.map((bejegyzes) => [bejegyzes.number, bejegyzes.grossTotal, bejegyzes.source]),
)

const egyeztetes = await journal.reconcile(tarca, { from: '2026-11-01', to: '2026-11-30' })
console.log('egyezik:', egyeztetes.matched, 'hiányzik:', egyeztetes.missing.length)
