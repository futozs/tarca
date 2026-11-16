import { createTarca } from 'tarcajs'

const tarca = createTarca()

const nyugta = await tarca.receipts.create({
  items: [
    { name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 },
    { name: 'Croissant', grossUnitPrice: 750, vat: 5 },
  ],
  paymentMethod: 'bankcard',
})

console.log(nyugta.invoiceNumber, nyugta.grossTotal, nyugta.paymentStatus)
