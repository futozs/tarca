import { createTarca } from 'tarcajs'
import { issueForPayment, type PaymentEvent } from 'tarcajs/payments'

const tarca = createTarca()

const osszeg = { value: 25_400, minor: 2_540_000, currency: 'HUF' }

const fizetes: PaymentEvent = {
  provider: 'barion',
  kind: 'paid',
  id: 'b7c1e2f0',
  method: 'barion',
  amount: osszeg,
  customer: { name: 'Nagy Péter', email: 'peter@example.hu' },
  raw: {},
}

const nyugta = await issueForPayment(tarca, fizetes, { vat: 27 })

const visszaterites = await issueForPayment(
  tarca,
  { ...fizetes, kind: 'refunded', refundedAmount: osszeg },
  { vat: 27 },
)

if (nyugta.kind === 'receipt') console.log('nyugta:', nyugta.document.invoiceNumber)
if (visszaterites.kind === 'cancellation') {
  console.log('sztornó:', visszaterites.cancellation?.invoiceNumber, visszaterites.created)
}
