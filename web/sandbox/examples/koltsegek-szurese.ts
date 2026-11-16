import { createTarca } from 'tarcajs'

const tarca = createTarca()

const berlet = {
  category: 'office_rent',
  currency: 'HUF',
  conversionRate: 1,
  totalGross: 254_000,
  totalGrossHuf: 254_000,
  totalVatAmount: 54_000,
  totalVatAmountHuf: 54_000,
  paymentMethod: 'wire_transfer',
} as const

await tarca.spendings.create({
  ...berlet,
  invoiceNumber: 'BERLET-2026-10',
  invoiceDate: '2026-10-01',
  fulfillmentDate: '2026-10-01',
  dueDate: '2026-10-08',
  paidAt: '2026-10-06',
})
await tarca.spendings.create({
  ...berlet,
  invoiceNumber: 'BERLET-2026-11',
  invoiceDate: '2026-11-02',
  fulfillmentDate: '2026-11-02',
  dueDate: '2026-11-09',
})

const fizetetlen = await tarca.spendings.list({
  spendingDate: 'invoice_date',
  startDate: '2026-10-01',
  endDate: '2026-11-30',
  paymentStatus: 'unpaid',
  categories: 'office_rent',
})

console.log(
  fizetetlen.total,
  fizetetlen.data.map((koltseg) => koltseg.invoiceNumber),
)
