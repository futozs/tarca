import { createTarca } from 'tarcajs'

const tarca = createTarca()

const partner = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
}

const eloleg = await tarca.documents.create({
  type: 'advance',
  partner,
  items: [{ name: 'Előleg', quantity: 1, netUnitPrice: 50_000, vat: 27 }],
})

const vegszamla = await tarca.documents.create({
  partner,
  items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 200_000, vat: 27 }],
  advanceInvoiceIds: [eloleg.id ?? 0],
})

console.log('előlegszámla:', eloleg.invoiceNumber, eloleg.grossTotal)
console.log('végszámla:', vegszamla.invoiceNumber, vegszamla.grossTotal)
