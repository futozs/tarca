import { billingo } from 'tarca-sandbox'
import { createTarca } from 'tarcajs'

const tarca = createTarca()

billingo.fail('network', { operation: 'CreateDocument', afterSuccess: true })

const { document, created } = await tarca.documents.createOnce({
  vendorId: 'RENDELES-1002',
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
})

console.log(created, document.invoiceNumber)
console.log('kiállítási kérés:', billingo.count('CreateDocument'))
console.log('bizonylat a Billingóban:', billingo.data.documents.size)
