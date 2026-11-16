import { isBillingoError } from 'tarcajs'
import { createMockTarca } from 'tarcajs/testing'

const tarca = createMockTarca()

const szamla = {
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
}

tarca.billingo.fail('network', { operation: 'GetOrganizationData', times: 2 })
const szervezet = await tarca.organization.get()
console.log('lekérdezés két hálózati hiba után:', szervezet.taxCode)
console.log('kérések:', tarca.billingo.count('GetOrganizationData'))

tarca.billingo.fail({ status: 500 }, { operation: 'CreateDocument' })
try {
  await tarca.documents.create(szamla)
} catch (error) {
  if (isBillingoError(error)) console.log('írás:', error.category, error.status, error.retryable)
}
console.log('kiállító kérés:', tarca.billingo.count('CreateDocument'))

tarca.billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })
const { created, document } = await tarca.documents.createOnce({
  ...szamla,
  vendorId: 'ORDER-1001',
})
console.log('elveszett válasz után:', created, document.invoiceNumber)
