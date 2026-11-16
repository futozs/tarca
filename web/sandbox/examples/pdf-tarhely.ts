import { createTarca } from 'tarcajs'
import { memoryStorage, storeDocumentPdf } from 'tarcajs/storage'

const tarca = createTarca()
const tarhely = memoryStorage()

const { document } = await tarca.documents.createOnce({
  vendorId: 'RENDELES-1003',
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

const fajl = await storeDocumentPdf(tarca, tarhely, document)

console.log(fajl.key, fajl.size, fajl.contentType)
