import { createTarca, nullIfNotFound } from 'tarcajs'

const tarca = createTarca()

const adatok = {
  category: 'advertisement',
  currency: 'HUF',
  conversionRate: 1,
  totalGross: 63_500,
  totalGrossHuf: 63_500,
  totalVatAmount: 13_500,
  totalVatAmountHuf: 13_500,
  invoiceNumber: 'HIRDETES-2026-7',
  invoiceDate: '2026-11-03',
  fulfillmentDate: '2026-11-03',
  dueDate: '2026-11-11',
  paymentMethod: 'wire_transfer',
  comment: 'Novemberi kampány',
} as const

const koltseg = await tarca.spendings.create(adatok)
const fizetett = await tarca.spendings.update(koltseg.id ?? 0, { ...adatok, paidAt: '2026-11-10' })

console.log(fizetett.paidAt, fizetett.comment)

await tarca.spendings.delete(koltseg.id ?? 0)

console.log(await nullIfNotFound(tarca.spendings.get(koltseg.id ?? 0)))
