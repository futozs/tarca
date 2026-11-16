import { createTarca } from 'tarcajs'

const tarca = createTarca()

const koltseg = await tarca.spendings.create({
  category: 'software',
  currency: 'HUF',
  conversionRate: 1,
  totalGross: 12_700,
  totalGrossHuf: 12_700,
  totalVatAmount: 2_700,
  totalVatAmountHuf: 2_700,
  invoiceNumber: 'SZLA-2026-42',
  invoiceDate: '2026-11-10',
  fulfillmentDate: '2026-11-10',
  dueDate: '2026-11-18',
  paymentMethod: 'wire_transfer',
  comment: 'Tárhely, november',
})

const lekert = await tarca.spendings.get(koltseg.id ?? 0)

console.log(koltseg.id, koltseg.totalGrossLocal, koltseg.partner)
console.log('createdByNav' in koltseg, lekert.createdByNav)
