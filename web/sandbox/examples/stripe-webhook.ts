import { createTarca } from 'tarcajs'
import { issueForPayment } from 'tarcajs/payments'
import { stripeWebhook } from 'tarcajs/payments/stripe'

const tarca = createTarca()
const titok = 'whsec_sandbox'

const POST = stripeWebhook({
  secret: titok,
  onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
})

const esemeny = JSON.stringify({
  id: 'evt_1QhB7c',
  type: 'checkout.session.completed',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: 'cs_test_a1',
      object: 'checkout.session',
      payment_intent: 'pi_3QhB7c',
      payment_status: 'paid',
      amount_total: 1_270_000,
      currency: 'huf',
      customer_details: { name: 'Kiss Anna', email: 'anna@example.hu' },
    },
  },
})

async function alairas(torzs: string): Promise<string> {
  const ido = Math.floor(Date.now() / 1000)
  const kulcs = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(titok),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const jel = await crypto.subtle.sign('HMAC', kulcs, new TextEncoder().encode(`${ido}.${torzs}`))
  const hex = [...new Uint8Array(jel)].map((bajt) => bajt.toString(16).padStart(2, '0')).join('')
  return `t=${ido},v1=${hex}`
}

const kezbesit = (fejlec: string) =>
  POST(
    new Request('https://bolt.example/api/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': fejlec },
      body: esemeny,
    }),
  )

const elso = await kezbesit(await alairas(esemeny))
const ujrakuldott = await kezbesit(await alairas(esemeny))
const hamis = await kezbesit(await alairas('{"id":"evt_hamis"}'))

console.log('első kézbesítés:', elso.status)
console.log('újraküldött esemény:', ujrakuldott.status)
console.log('hamis aláírás:', hamis.status, await hamis.text())
