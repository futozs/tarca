import { createMockTarca } from 'tarcajs/testing'

const tarca = createMockTarca({ defaults: { dueInDays: 8 } })

async function fizetesKezelo(rendelesId: number): Promise<void> {
  await tarca.documents.createOnce({
    vendorId: `RENDELES-${rendelesId}`,
    partner: {
      name: 'Vevő Kft.',
      address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    },
    items: [{ name: 'Póló', quantity: 2, grossUnitPrice: 6_350, vat: 27 }],
  })
}

await fizetesKezelo(1001)
await fizetesKezelo(1001)

console.log('kiállítás:', tarca.billingo.count('CreateDocument'))
console.log(
  'hívások:',
  tarca.calls.map((call) => call.method),
)

tarca.failNext('documents.createOnce', undefined, { afterSuccess: true })

try {
  await fizetesKezelo(1002)
} catch (error) {
  console.log('elveszett válasz:', error instanceof Error ? error.message : error)
}
await fizetesKezelo(1002)

console.log('bizonylatok a hamis Billingóban:', tarca.billingo.data.documents.size)
