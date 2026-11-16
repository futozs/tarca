import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  vendorId: 'ORDER-1001',
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

const azonositoval = await tarca.documents.get(szamla.id ?? 0)
const vendorIdval = await tarca.documents.getByVendorId('ORDER-1001')
const nincsIlyen = await tarca.documents.findByVendorId('ORDER-9999')

console.log(azonositoval.invoiceNumber, vendorIdval.invoiceNumber, nincsIlyen)
