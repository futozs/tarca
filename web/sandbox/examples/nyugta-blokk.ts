import { createTarca } from 'tarcajs'

const tarca = createTarca()

const nyugta = await tarca.receipts.create({
  items: [
    { name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 },
    { name: 'Croissant', grossUnitPrice: 750, vat: 5 },
  ],
  paymentMethod: 'bankcard',
})

const blokk = await tarca.documents.posPdf(nyugta.id ?? 0, { size: 58 })

console.log(nyugta.invoiceNumber, blokk.filename, blokk.contentType, blokk.bytes.length)
