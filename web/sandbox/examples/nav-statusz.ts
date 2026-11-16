import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

const nav = await tarca.documents.navStatus(szamla.id ?? 0)

console.log(szamla.invoiceNumber, szamla.onlineSzamlaStatus)
console.log(nav ?? 'A Billingónak még nincs NAV rekordja erről a számláról.')
