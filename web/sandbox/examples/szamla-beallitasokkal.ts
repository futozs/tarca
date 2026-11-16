import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    emails: ['vevo@example.hu'],
    taxcode: '12345678-2-42',
    taxType: 'HAS_TAX_NUMBER',
  },
  items: [
    { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
    { name: 'Tankönyv', quantity: 2, grossUnitPrice: 4_200, vat: 5 },
  ],
  fulfillmentDate: '2026-11-16',
  dueInDays: 15,
  comment: 'Köszönjük a megrendelést.',
  orderNumber: 'ORDER-1001',
})

console.log(szamla.invoiceNumber, szamla.grossTotal, szamla.paymentStatus)
console.log(szamla.summary?.vatRateSummary)
