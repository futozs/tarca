import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Tanácsadás', quantity: 5, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
})

await tarca.documents.payments.add(szamla.id ?? 0, {
  date: new Date(),
  price: 63_500,
  paymentMethod: 'wire_transfer',
})

const reszben = await tarca.documents.get(szamla.id ?? 0)

await tarca.documents.payments.add(szamla.id ?? 0, {
  date: new Date(),
  price: 63_500,
  paymentMethod: 'wire_transfer',
})

const kifizetve = await tarca.documents.get(szamla.id ?? 0)
const befizetesek = await tarca.documents.payments.list(szamla.id ?? 0)

console.log(szamla.grossTotal, reszben.paymentStatus, kifizetve.paymentStatus)
console.log(befizetesek)
