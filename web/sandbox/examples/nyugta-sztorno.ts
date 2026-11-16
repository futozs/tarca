import { createTarca } from 'tarcajs'

const tarca = createTarca()

const nyugta = await tarca.receipts.create({
  items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }],
  paymentMethod: 'bankcard',
})

const sztorno = await tarca.documents.cancel(nyugta.id ?? 0)
const eredeti = await tarca.documents.get(nyugta.id ?? 0)

console.log('sztornó:', sztorno.invoiceNumber, sztorno.type, sztorno.grossTotal)
console.log('az eredeti nyugta:', eredeti.invoiceNumber, eredeti.cancelled, eredeti.paymentStatus)
