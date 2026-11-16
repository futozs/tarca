import { createTarca } from 'tarcajs'
import { issueForPayment, type PaymentEvent } from 'tarcajs/payments'

const tarca = createTarca()

const fizetes: PaymentEvent = {
  provider: 'stripe',
  kind: 'paid',
  id: 'pi_3QhB7c',
  method: 'stripe',
  amount: { value: 12_700, minor: 1_270_000, currency: 'HUF' },
  customer: { name: 'Kiss Anna', email: 'anna@example.hu' },
  items: [
    { name: 'Póló', quantity: 1, totalGross: { value: 12_700, minor: 1_270_000, currency: 'HUF' } },
  ],
  raw: {},
}

const elso = await issueForPayment(tarca, fizetes, { vat: 27 })
const ujra = await issueForPayment(tarca, fizetes, { vat: 27 })

if (elso.kind === 'receipt' && ujra.kind === 'receipt') {
  console.log(elso.vendorId, elso.decision?.reasons)
  console.log('első kézbesítés:', elso.created, elso.document.invoiceNumber)
  console.log('újraküldött esemény:', ujra.created, ujra.document.invoiceNumber)
}
