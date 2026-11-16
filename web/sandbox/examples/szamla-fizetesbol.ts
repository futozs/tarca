import { createTarca } from 'tarcajs'
import { issueForPayment, type PaymentEvent } from 'tarcajs/payments'

const tarca = createTarca()

const tetel = { value: 12_700, minor: 1_270_000, currency: 'HUF' }

const fizetes: PaymentEvent = {
  provider: 'stripe',
  kind: 'paid',
  id: 'pi_3QhB7c',
  method: 'stripe',
  paidAt: '2026-11-16T09:00:00Z',
  amount: { value: 25_400, minor: 2_540_000, currency: 'HUF' },
  customer: {
    name: 'Vevő Kft.',
    email: 'vevo@example.hu',
    taxNumber: '12345678-2-42',
    address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
  },
  items: [
    { name: 'Póló', quantity: 2, totalGross: tetel },
    { name: 'Bögre', quantity: 1, totalGross: tetel },
  ],
  raw: {},
}

const eredmeny = await issueForPayment(tarca, fizetes, { vat: 27 })

if (eredmeny.kind === 'invoice') {
  console.log(eredmeny.vendorId, eredmeny.document.invoiceNumber, eredmeny.document.grossTotal)
  console.log('befizetés rögzítve:', eredmeny.paymentRecorded)
  console.log(eredmeny.decision?.reasons)
}
