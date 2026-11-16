import { createTarca } from 'tarcajs'
import { issueForPayment, type PaymentEvent } from 'tarcajs/payments'
import { memoryStore } from 'tarcajs/stores'

const tarca = createTarca()
const ledger = memoryStore()

const fizetes: PaymentEvent = {
  provider: 'stripe',
  kind: 'paid',
  id: 'pi_3QhB7d',
  method: 'stripe',
  amount: { value: 25_400, minor: 2_540_000, currency: 'HUF' },
  customer: {
    name: 'Vevő Kft.',
    taxNumber: '12345678-2-42',
    address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
  },
  raw: {},
}

const visszaterites: PaymentEvent = {
  ...fizetes,
  kind: 'partially-refunded',
  refunds: [{ id: 're_1', amount: { value: 5_000, minor: 500_000, currency: 'HUF' } }],
}

const szamla = await issueForPayment(tarca, fizetes, { vat: 27 })
const elso = await issueForPayment(tarca, visszaterites, { vat: 27, ledger })
const ujra = await issueForPayment(tarca, visszaterites, { vat: 27, ledger })

if (szamla.kind === 'invoice') console.log('számla:', szamla.document.invoiceNumber)
if (elso.kind === 'modification' && ujra.kind === 'modification') {
  console.log('módosító számla:', elso.modifications[0]?.modificationId, elso.created)
  console.log('újraküldött esemény:', ujra.modifications[0]?.modificationId, ujra.created)
  console.log('bruttó:', elso.modifications[0]?.grossTotal)
}
