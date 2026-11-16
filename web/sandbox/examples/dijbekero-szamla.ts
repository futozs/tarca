import { createTarca } from 'tarcajs'

const tarca = createTarca()

const partner = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
}
const items = [{ name: 'Éves tárhely', quantity: 1, netUnitPrice: 48_000, vat: 27 }]

const dijbekero = await tarca.documents.create({ type: 'proforma', partner, items })

const szamla = await tarca.documents.createFromProforma(dijbekero.id ?? 0, { dueInDays: 0 })

await tarca.documents.archive(dijbekero.id ?? 0)

console.log('díjbekérő:', dijbekero.invoiceNumber, dijbekero.grossTotal)
console.log('számla:', szamla.invoiceNumber, szamla.paymentStatus)
