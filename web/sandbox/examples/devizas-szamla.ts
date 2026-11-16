import { createTarca } from 'tarcajs'

const tarca = createTarca()

const { rate } = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' })

const szamla = await tarca.documents.create({
  partner: {
    name: 'Kunde GmbH',
    address: { countryCode: 'AT', postCode: '1010', city: 'Wien', address: 'Graben 1.' },
  },
  currency: 'EUR',
  conversionRate: rate,
  language: 'en',
  items: [{ name: 'Consulting', quantity: 3, unit: 'hour', netUnitPrice: 120, vat: 27 }],
})

console.log(szamla.invoiceNumber, szamla.grossTotal, szamla.currency, `árfolyam: ${rate}`)
