import { createTarca } from 'tarcajs'

const tarca = createTarca()

const nyugta = {
  vendorId: 'POS-1001',
  items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }],
  paymentMethod: 'bankcard' as const,
}

const elso = await tarca.receipts.createOnce(nyugta)
const masodik = await tarca.receipts.createOnce(nyugta)

console.log('első:', elso.created, elso.document.invoiceNumber, elso.document.grossTotal)
console.log('második:', masodik.created, masodik.document.invoiceNumber)
