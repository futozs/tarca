import { describe, expect, vi } from 'vitest'
import { isBillingoError, type KeyValueStore } from '../../src/index'
import { barionWebhook } from '../../src/payments/barion'
import {
  allocateRefund,
  chooseDocument,
  createModificationOnce,
  currencyExponent,
  fromMinorUnits,
  isBillingoCurrency,
  issueForPayment,
  type PaymentEvent,
  parseDecimalAmount,
  partnerFromCustomer,
  paymentVendorId,
  RECEIPT_MAX_GROSS_HUF,
} from '../../src/payments/index'
import { payPalWebhook } from '../../src/payments/paypal'
import { revolutWebhook } from '../../src/payments/revolut'
import {
  simplePaySignature,
  simplePayWebhook,
  verifySimplePayRedirect,
} from '../../src/payments/simplepay'
import { stripeWebhook } from '../../src/payments/stripe'
import { memoryStore } from '../../src/stores/index'
import { docsClient, docsExample, pinDocsClock, sentBodies } from './helpers'

pinDocsClock()

type Route = readonly [RegExp, (request: Request) => Response | Promise<Response>]

function providerFetch(routes: readonly Route[]) {
  const urls: string[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    urls.push(`${request.method} ${new URL(request.url).pathname}`)
    const route = routes.find(([pattern]) => pattern.test(request.url))
    return route ? route[1](request) : new Response('ismeretlen útvonal', { status: 404 })
  }
  return { fetch: fetch as typeof globalThis.fetch, urls }
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

async function hmac(hash: 'SHA-256' | 'SHA-384', key: string, message: string) {
  const imported = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash },
    false,
    ['sign'],
  )
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(message)),
  )
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const huf = (value: number) => ({ value, minor: value * 100, currency: 'HUF' })

const STRIPE_SECRET = 'whsec_sandbox'

async function stripeSignature(body: string, secret = STRIPE_SECRET): Promise<string> {
  const time = Math.floor(Date.now() / 1000)
  return `t=${time},v1=${hex(await hmac('SHA-256', secret, `${time}.${body}`))}`
}

const BUSINESS_PAYMENT: PaymentEvent = {
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
    { name: 'Póló', quantity: 2, totalGross: huf(12_700) },
    { name: 'Bögre', quantity: 1, totalGross: huf(12_700) },
  ],
  raw: {},
}

describe('fizetesek', () => {
  docsExample(
    'fizetesek',
    'a fizetésből nyugta lesz, az újraküldött esemény a meglévőt adja',
    async () => {
      const { tarca, billingo } = docsClient()
      const fizetes: PaymentEvent = {
        provider: 'stripe',
        kind: 'paid',
        id: 'pi_3QhB7c',
        method: 'stripe',
        amount: { value: 12_700, minor: 1_270_000, currency: 'HUF' },
        customer: { name: 'Kiss Anna', email: 'anna@example.hu' },
        items: [
          {
            name: 'Póló',
            quantity: 1,
            totalGross: { value: 12_700, minor: 1_270_000, currency: 'HUF' },
          },
        ],
        raw: {},
      }

      const elso = await issueForPayment(tarca, fizetes, { vat: 27 })
      const ujra = await issueForPayment(tarca, fizetes, { vat: 27 })

      expect(elso).toMatchObject({
        kind: 'receipt',
        vendorId: 'STRIPE-pi_3QhB7c',
        created: true,
        document: { invoiceNumber: 'NYT-2026-1' },
      })
      expect(ujra).toMatchObject({ kind: 'receipt', created: false })
      expect(billingo.count('CreateReceipt')).toBe(1)
    },
  )

  docsExample(
    'fizetesek',
    'a Stripe útvonal üres titokkal már létrehozáskor hibát dob',
    async () => {
      const { tarca } = docsClient()

      expect(() =>
        stripeWebhook({
          secret: '',
          onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
        }),
      ).toThrow(TypeError)
    },
  )
})

describe('fizetesek/bizonylat-fizetesbol', () => {
  docsExample(
    'fizetesek/bizonylat-fizetesbol',
    'adószámos vevőnek számla és rögzített befizetés',
    async () => {
      const { tarca, billingo } = docsClient()

      const eredmeny = await issueForPayment(tarca, BUSINESS_PAYMENT, { vat: 27 })

      expect(eredmeny).toMatchObject({
        kind: 'invoice',
        vendorId: 'STRIPE-pi_3QhB7c',
        created: true,
        paymentRecorded: true,
        document: { invoiceNumber: '2026-1', grossTotal: 25_400, paymentStatus: 'outstanding' },
        decision: {
          type: 'invoice',
          reasons: [
            'A vevő adóalany vagy jogi személy (adószámot adott meg), ezért számlát kell kiállítani.',
          ],
        },
      })
      expect(billingo.requests.map((request) => request.operation)).toEqual([
        'GetDocumentByVendorId',
        'GetDocumentByVendorId',
        'ListDocumentBlock',
        'ListPartner',
        'CreatePartner',
        'CreateDocument',
        'UpdatePayment',
      ])
      expect(sentBodies(billingo, 'UpdatePayment')).toEqual([
        [{ date: '2026-11-16', price: 25_400, payment_method: 'stripe' }],
      ])
      expect(billingo.data.documents.get(1)?.document.paymentStatus).toBe('paid')
    },
  )

  docsExample('fizetesek/bizonylat-fizetesbol', 'a vendorId a fizetés azonosítójából', async () => {
    expect(await paymentVendorId({ provider: 'paypal', id: '8MC585209K746392H' })).toBe(
      'PAYPAL-8MC585209K746392H',
    )
    expect(await paymentVendorId({ provider: 'simplepay', id: 'rendelés/1' })).toBe(
      'SIMPLEPAY-hf0c34cbeb9b0bc39',
    )
  })

  docsExample(
    'fizetesek/bizonylat-fizetesbol',
    'áfakulcs nélkül validation hiba, kérés nélkül',
    async () => {
      const { tarca, billingo } = docsClient()

      const hiba = await issueForPayment(tarca, BUSINESS_PAYMENT).catch((error: unknown) => error)

      expect(isBillingoError(hiba) && hiba.category).toBe('validation')
      expect(billingo.requests).toEqual([])
    },
  )
})

describe('fizetesek/stripe', () => {
  docsExample('fizetesek/stripe', 'két kézbesítés egy nyugta, hamis aláírásra 400', async () => {
    const { tarca, billingo } = docsClient()
    const POST = stripeWebhook({
      secret: STRIPE_SECRET,
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
    const kezbesit = (fejlec: string) =>
      POST(
        new Request('https://bolt.example/api/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': fejlec },
          body: esemeny,
        }),
      )

    const elso = await kezbesit(await stripeSignature(esemeny))
    const ujrakuldott = await kezbesit(await stripeSignature(esemeny))
    const hamis = await kezbesit(await stripeSignature('{"id":"evt_hamis"}'))

    expect([elso.status, ujrakuldott.status, hamis.status]).toEqual([200, 200, 400])
    expect(await hamis.text()).toBe('A Stripe aláírás nem egyezik.')
    expect(billingo.count('CreateReceipt')).toBe(1)
    expect(billingo.data.documents.get(1)?.vendorId).toBe('STRIPE-pi_3QhB7c')
  })

  docsExample(
    'fizetesek/stripe',
    'payment_intent.succeeded API-kulcs nélkül nem állít ki',
    async () => {
      const { tarca, billingo } = docsClient()
      const onPayment = vi.fn((payment: PaymentEvent) =>
        issueForPayment(tarca, payment, { vat: 27 }),
      )
      const POST = stripeWebhook({ secret: STRIPE_SECRET, onPayment })
      const esemeny = JSON.stringify({
        id: 'evt_2',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_3QhB7f',
            object: 'payment_intent',
            amount_received: 1_270_000,
            currency: 'huf',
          },
        },
      })

      const valasz = await POST(
        new Request('https://bolt.example/api/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': await stripeSignature(esemeny) },
          body: esemeny,
        }),
      )

      expect(valasz.status).toBe(200)
      expect(onPayment.mock.calls[0]?.[0].kind).toBe('other')
      expect(billingo.count('CreateReceipt') + billingo.count('CreateDocument')).toBe(0)
    },
  )
})

const SIMPLEPAY_KEY = 'simplepay-teszt-kulcs'

describe('fizetesek/simplepay', () => {
  docsExample('fizetesek/simplepay', 'aláírt IPN: nyugta és aláírt visszaigazolás', async () => {
    const { tarca, billingo } = docsClient()
    const api = providerFetch([
      [
        /\/query$/,
        async () => {
          const body = JSON.stringify({
            merchant: 'HUFKERESKEDO',
            transactions: [
              {
                transactionId: 99_310_118,
                orderRef: 'ORDER-1001',
                status: 'FINISHED',
                currency: 'HUF',
                total: 2540,
                remainingTotal: 0,
                method: 'CARD',
                customerEmail: 'vevo@example.hu',
                invoice: { name: 'Vevő', country: 'hu', city: 'Budapest', zip: '1111' },
              },
            ],
          })
          return new Response(body, {
            headers: { signature: await simplePaySignature(body, SIMPLEPAY_KEY) },
          })
        },
      ],
    ])
    const POST = simplePayWebhook({
      merchants: { HUFKERESKEDO: SIMPLEPAY_KEY },
      fetch: api.fetch,
      now: () => new Date('2026-11-16T09:00:00Z'),
      onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
    })
    const ipn = JSON.stringify({
      salt: 'teszt',
      orderRef: 'ORDER-1001',
      method: 'CARD',
      merchant: 'HUFKERESKEDO',
      finishDate: '2026-11-16T10:00:00+01:00',
      transactionId: 99_310_118,
      status: 'FINISHED',
    })

    const valasz = await POST(
      new Request('https://bolt.example.hu/api/simplepay/ipn', {
        method: 'POST',
        headers: { signature: await simplePaySignature(ipn, SIMPLEPAY_KEY) },
        body: ipn,
      }),
    )
    const hamis = await POST(
      new Request('https://bolt.example.hu/api/simplepay/ipn', {
        method: 'POST',
        headers: { signature: 'hamis' },
        body: ipn,
      }),
    )

    expect(valasz.status).toBe(200)
    expect(valasz.headers.get('signature')).toBe(
      await simplePaySignature(await valasz.clone().text(), SIMPLEPAY_KEY),
    )
    expect(JSON.parse(await valasz.text())).toMatchObject({
      transactionId: 99_310_118,
      receiveDate: expect.any(String),
    })
    expect(hamis.status).toBe(400)
    expect(api.urls).toEqual(['POST /payment/v2/query'])
    expect(billingo.data.documents.get(1)).toMatchObject({
      vendorId: 'SIMPLEPAY-99310118',
      document: { grossTotal: 2540, paymentMethod: 'simple_pay' },
    })
  })

  docsExample('fizetesek/simplepay', 'a visszairányítás aláírását ellenőrzi', async () => {
    const adat = JSON.stringify({
      r: 0,
      t: 99_310_118,
      e: 'SUCCESS',
      m: 'HUFKERESKEDO',
      o: 'ORDER-1001',
    })
    const s = await simplePaySignature(adat, SIMPLEPAY_KEY)
    const url = new URL('https://bolt.example.hu/simplepay/vissza')
    url.searchParams.set('r', btoa(adat))
    url.searchParams.set('s', s)

    async function GET(request: Request): Promise<Response> {
      const vissza = await verifySimplePayRedirect(new URL(request.url), {
        HUFKERESKEDO: SIMPLEPAY_KEY,
      })
      const oldal = vissza.event === 'SUCCESS' ? '/koszonjuk' : '/sikertelen-fizetes'
      const cel = new URL(`${oldal}?rendeles=${encodeURIComponent(vissza.orderRef)}`, request.url)
      return Response.redirect(cel, 303)
    }

    const valasz = await GET(new Request(url))

    expect(valasz.status).toBe(303)
    expect(valasz.headers.get('location')).toBe(
      'https://bolt.example.hu/koszonjuk?rendeles=ORDER-1001',
    )
    url.searchParams.set('s', 'hamis')
    await expect(GET(new Request(url))).rejects.toThrow('A SimplePay aláírás')
  })

  docsExample('fizetesek/simplepay', 'kulcs nélkül TypeError létrehozáskor', async () => {
    expect(() =>
      simplePayWebhook({ merchants: { HUFKERESKEDO: '' }, onPayment: () => {} }),
    ).toThrow(TypeError)
  })
})

const BARION_ID = 'b6e8c5a0c8a5ed11bc2b001dd8b71cc5'

function barionState(extra: readonly Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    PaymentId: BARION_ID,
    OrderNumber: 'ORDER-1001',
    Status: 'Succeeded',
    FundingSource: 'Bankcard',
    CompletedAt: '2026-11-16T10:00:07',
    Total: 3023,
    Currency: 'HUF',
    Transactions: [
      {
        TransactionId: 'tr-shop-1',
        POSTransactionId: 'ORDER-1001-1',
        Total: 3023,
        Currency: 'HUF',
        Status: 'Succeeded',
        TransactionType: 'CardPayment',
        Payer: { Name: { LastName: 'Vevő', FirstName: 'Teszt' }, Email: 'vevo@example.hu' },
        Items: [
          { Name: 'Kávé', Quantity: 2, Unit: 'db', ItemTotal: 1780 },
          { Name: 'Kifli', Quantity: 1, Unit: 'db', ItemTotal: 1243 },
        ],
      },
      ...extra,
    ],
  }
}

describe('fizetesek/barion', () => {
  docsExample(
    'fizetesek/barion',
    'a callback után a PaymentState dönt, a visszatérítés sztornóz',
    async () => {
      const { tarca, billingo } = docsClient()
      let state = barionState()
      const api = providerFetch([[/PaymentState$/, () => json(state)]])
      const POST = barionWebhook({
        posKey: 'barion-pos-kulcs',
        fetch: api.fetch,
        onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
      })
      const callback = () =>
        POST(
          new Request(`https://bolt.example.hu/api/barion/callback?paymentId=${BARION_ID}`, {
            method: 'POST',
          }),
        )

      expect((await callback()).status).toBe(200)
      expect(api.urls).toEqual([`GET /v4/Payment/${BARION_ID}/PaymentState`])
      expect(billingo.data.documents.get(1)?.document).toMatchObject({
        type: 'receipt',
        paymentMethod: 'barion',
        items: [
          { name: 'Kávé', quantity: 2 },
          { name: 'Kifli', quantity: 1 },
        ],
      })

      state = barionState([
        {
          TransactionId: 'tr-refund-1',
          POSTransactionId: 'ORDER-1001-1',
          Total: -3023,
          Currency: 'HUF',
          Status: 'Succeeded',
          TransactionType: 'RefundToBankCard',
        },
      ])
      expect((await callback()).status).toBe(200)
      expect(billingo.count('CancelDocument')).toBe(1)
      expect(billingo.data.documents.get(1)?.document.cancelled).toBe(true)
    },
  )

  docsExample('fizetesek/barion', 'érvénytelen paymentId: 400, Barion hívás nélkül', async () => {
    const api = providerFetch([])
    const POST = barionWebhook({
      posKey: 'barion-pos-kulcs',
      fetch: api.fetch,
      onPayment: () => {},
    })

    const valasz = await POST(
      new Request('https://bolt.example.hu/api/barion/callback?paymentId=x'),
    )

    expect(valasz.status).toBe(400)
    expect(api.urls).toEqual([])
  })
})

const REVOLUT_SECRET = 'wsk_teszt'

describe('fizetesek/revolut', () => {
  docsExample(
    'fizetesek/revolut',
    'ORDER_COMPLETED: a rendelésből nyugta, a válasz 204',
    async () => {
      const { tarca, billingo } = docsClient()
      const api = providerFetch([
        [
          /\/api\/orders\/ord-1$/,
          () =>
            json({
              id: 'ord-1',
              type: 'payment',
              state: 'completed',
              amount: 1_270_000,
              currency: 'HUF',
              customer: { full_name: 'Vevő', email: 'vevo@example.hu' },
              merchant_order_data: { reference: 'ORDER-1001' },
            }),
        ],
      ])
      const POST = revolutWebhook({
        secret: REVOLUT_SECRET,
        apiKey: 'sk_teszt',
        fetch: api.fetch,
        onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
      })
      const body = JSON.stringify({ event: 'ORDER_COMPLETED', order_id: 'ord-1' })
      const timestamp = String(Date.now())
      const signature = `v1=${hex(await hmac('SHA-256', REVOLUT_SECRET, `v1.${timestamp}.${body}`))}`
      const kuld = (aláírás: string) =>
        POST(
          new Request('https://bolt.example.hu/api/revolut/webhook', {
            method: 'POST',
            headers: { 'revolut-signature': aláírás, 'revolut-request-timestamp': timestamp },
            body,
          }),
        )

      const valasz = await kuld(signature)
      const hamis = await kuld('v1=00')

      expect(valasz.status).toBe(204)
      expect(hamis.status).toBe(400)
      expect(billingo.data.documents.get(1)).toMatchObject({
        vendorId: 'REVOLUT-ord-1',
        document: { grossTotal: 12_700, paymentMethod: 'revolut' },
      })
    },
  )

  docsExample('fizetesek/revolut', 'API-kulcs nélkül TypeError létrehozáskor', async () => {
    expect(() =>
      revolutWebhook({ secret: REVOLUT_SECRET, apiKey: '', onPayment: () => {} }),
    ).toThrow(TypeError)
  })
})

describe('fizetesek/paypal', () => {
  docsExample(
    'fizetesek/paypal',
    'a PayPal ellenőrzi az aláírást, a rendelésből nyugta',
    async () => {
      const { tarca, billingo } = docsClient()
      const api = providerFetch([
        [/\/v1\/oauth2\/token$/, () => json({ access_token: 'token', expires_in: 3600 })],
        [/verify-webhook-signature$/, () => json({ verification_status: 'SUCCESS' })],
        [
          /\/v2\/checkout\/orders\/ORD-1$/,
          () =>
            json({
              id: 'ORD-1',
              payer: {
                name: { given_name: 'Vevő', surname: 'Teszt' },
                email_address: 'vevo@example.hu',
              },
              purchase_units: [
                {
                  custom_id: 'ORDER-1001',
                  amount: { currency_code: 'HUF', value: '12700.00' },
                  items: [
                    {
                      name: 'Póló',
                      quantity: '1',
                      unit_amount: { currency_code: 'HUF', value: '12700.00' },
                    },
                  ],
                },
              ],
            }),
        ],
      ])
      const POST = payPalWebhook({
        webhookId: 'WH-1',
        clientId: 'client',
        clientSecret: 'secret',
        fetch: api.fetch,
        onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
      })
      const body = JSON.stringify({
        id: 'WH-EVT-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAP-1',
          status: 'COMPLETED',
          amount: { currency_code: 'HUF', value: '12700.00' },
          supplementary_data: { related_ids: { order_id: 'ORD-1' } },
        },
      })

      const valasz = await POST(
        new Request('https://bolt.example.hu/api/paypal/webhook', {
          method: 'POST',
          headers: {
            'paypal-auth-algo': 'SHA256withRSA',
            'paypal-cert-url': 'https://api-m.paypal.com/cert',
            'paypal-transmission-id': 'tr-1',
            'paypal-transmission-sig': 'sig',
            'paypal-transmission-time': '2026-11-16T09:00:00Z',
          },
          body,
        }),
      )
      const fejlecNelkul = await POST(
        new Request('https://bolt.example.hu/api/paypal/webhook', { method: 'POST', body }),
      )

      expect(valasz.status).toBe(200)
      expect(fejlecNelkul.status).toBe(400)
      expect(api.urls).toEqual([
        'POST /v1/oauth2/token',
        'POST /v1/notifications/verify-webhook-signature',
        'GET /v2/checkout/orders/ORD-1',
      ])
      expect(billingo.data.documents.get(1)).toMatchObject({
        vendorId: 'PAYPAL-CAP-1',
        document: { grossTotal: 12_700, paymentMethod: 'paypal', items: [{ name: 'Póló' }] },
      })
    },
  )
})

describe('fizetesek/webhook-beallitasok', () => {
  function signedRequest(body: string, signature: string, extra: Record<string, string> = {}) {
    return new Request('https://bolt.example/api/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature, ...extra },
      body,
    })
  }

  const esemeny = JSON.stringify({
    id: 'evt_dedupe',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        object: 'checkout.session',
        payment_intent: 'pi_dedupe',
        payment_status: 'paid',
        amount_total: 1_270_000,
        currency: 'huf',
      },
    },
  })

  docsExample(
    'fizetesek/webhook-beallitasok',
    'az ismétlés-szűrő után az onPayment nem fut újra, a validation hiba emberhez megy',
    async () => {
      const { tarca, billingo } = docsClient()
      const store: KeyValueStore = memoryStore()
      const jelezdEmbernek = vi.fn(async () => {})
      const onError = vi.fn()
      const issue = vi.fn((payment: PaymentEvent) =>
        issueForPayment(tarca, payment, { vat: 27, ledger: store }),
      )
      const POST = stripeWebhook({
        secret: STRIPE_SECRET,
        dedupe: store,
        dedupeTtlSeconds: 3 * 86_400,
        maxBodyBytes: 256 * 1024,
        method: 'stripe',
        onError,
        onWarning: (warning) => console.warn(warning.message),
        onPayment: async (payment) => {
          try {
            return await issue(payment)
          } catch (error) {
            if (isBillingoError(error) && error.category === 'validation') {
              return jelezdEmbernek()
            }
            throw error
          }
        },
      })

      const elso = await POST(signedRequest(esemeny, await stripeSignature(esemeny)))
      const masodik = await POST(signedRequest(esemeny, await stripeSignature(esemeny)))

      expect([elso.status, masodik.status]).toEqual([200, 200])
      expect(issue).toHaveBeenCalledTimes(1)
      expect(await store.get('tarca:evt:stripe:evt_dedupe')).toBe('1')
      expect(billingo.count('CreateReceipt')).toBe(1)

      const deviza = esemeny
        .replace('evt_dedupe', 'evt_deviza')
        .replace("'huf'", "'xof'")
        .replace('"huf"', '"xof"')
      const hibas = await POST(signedRequest(deviza, await stripeSignature(deviza)))
      expect(hibas.status).toBe(200)
      expect(jelezdEmbernek).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    },
  )

  docsExample(
    'fizetesek/webhook-beallitasok',
    'túl nagy törzs 400, dobó onPayment 500',
    async () => {
      const onError = vi.fn()
      const POST = stripeWebhook({
        secret: STRIPE_SECRET,
        maxBodyBytes: 100,
        onError,
        onPayment: () => {
          throw new Error('adatbázis hiba')
        },
      })

      const nagy = await POST(signedRequest(esemeny, await stripeSignature(esemeny)))
      expect(nagy.status).toBe(400)

      const kicsi = JSON.stringify({
        id: 'e',
        type: 'checkout.session.completed',
        data: { object: { payment_status: 'paid' } },
      })
      const dobo = await POST(signedRequest(kicsi, await stripeSignature(kicsi)))
      expect(dobo.status).toBe(500)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(() =>
        stripeWebhook({ secret: STRIPE_SECRET, method: 'kartya' as never, onPayment: () => {} }),
      ).toThrow(TypeError)
    },
  )
})

describe('fizetesek/osszegek', () => {
  docsExample('fizetesek/osszegek', 'átváltás váltóegységek között', async () => {
    expect(fromMinorUnits(127_000, 'HUF', 'stripe')).toEqual({
      value: 1270,
      minor: 127_000,
      currency: 'HUF',
    })
    expect(fromMinorUnits(1_270, 'HUF')).toEqual({ value: 12.7, minor: 1270, currency: 'HUF' })
    expect(parseDecimalAmount('12.70', 'EUR')).toEqual({
      value: 12.7,
      minor: 1270,
      currency: 'EUR',
    })
    expect(fromMinorUnits(500, 'JPY', 'stripe')).toEqual({
      value: 500,
      minor: 500,
      currency: 'JPY',
    })
    expect([currencyExponent('HUF'), currencyExponent('JPY'), isBillingoCurrency('EUR')]).toEqual([
      2,
      0,
      true,
    ])
    expect(currencyExponent('BHD')).toBe(3)
    expect(() => parseDecimalAmount('12.705', 'EUR')).toThrow(RangeError)
  })

  docsExample('fizetesek/osszegek', 'eltérő value és minor: validation, kérés nélkül', async () => {
    const { tarca, billingo } = docsClient()
    const hiba = await issueForPayment(
      tarca,
      {
        provider: 'stripe',
        kind: 'paid',
        id: 'pi_rossz',
        method: 'stripe',
        amount: { value: 12_700, minor: 12_700, currency: 'HUF' },
        raw: {},
      },
      { vat: 27 },
    ).catch((error: unknown) => error)

    expect(isBillingoError(hiba) && hiba.category).toBe('validation')
    expect(billingo.requests).toEqual([])
  })
})

describe('fizetesek/vevo-adatai', () => {
  docsExample('fizetesek/vevo-adatai', 'a vevőből partner adószámmal', async () => {
    expect(
      partnerFromCustomer({
        name: 'Vevő Kft.',
        email: 'vevo@example.hu',
        taxNumber: '12345678-2-42',
        address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
      }),
    ).toEqual({
      name: 'Vevő Kft.',
      address: { countryCode: 'HU', postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      emails: ['vevo@example.hu'],
      taxcode: '12345678-2-42',
      taxType: 'HAS_TAX_NUMBER',
    })
    expect(
      partnerFromCustomer({
        name: 'Vevő GmbH',
        euTaxNumber: 'ATU12345678',
        address: { country: 'AT', zip: '1010', city: 'Wien', line1: 'Ring 1' },
      }),
    ).toMatchObject({ taxcode: 'ATU12345678', taxType: 'FOREIGN' })
    expect(
      partnerFromCustomer({
        name: 'Vevő',
        address: { zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
      }),
    ).toMatchObject({ taxType: 'NO_TAX_NUMBER' })
    expect(partnerFromCustomer({ name: 'Vevő Kft.' })).toBeUndefined()
    expect(() =>
      partnerFromCustomer({
        name: 'Vevő Kft.',
        euTaxNumber: 'HU12345678',
        address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
      }),
    ).toThrow(expect.objectContaining({ category: 'validation' }))
  })

  docsExample('fizetesek/vevo-adatai', 'saját partnerrel számla', async () => {
    const { tarca, billingo } = docsClient()
    const payment: PaymentEvent = {
      provider: 'barion',
      kind: 'paid',
      id: 'b7c1e2f1',
      method: 'barion',
      amount: huf(12_700),
      raw: {},
    }

    const eredmeny = await issueForPayment(tarca, payment, {
      vat: 27,
      invoiceRequested: true,
      partner: {
        name: 'Vevő Kft.',
        taxcode: '12345678-2-42',
        taxType: 'HAS_TAX_NUMBER',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
    })

    expect(eredmeny.kind).toBe('invoice')
    expect(sentBodies(billingo, 'CreatePartner')).toEqual([
      expect.objectContaining({ name: 'Vevő Kft.', taxcode: '12345678-2-42' }),
    ])
  })
})

describe('fizetesek/nyugta-vagy-szamla', () => {
  docsExample('fizetesek/nyugta-vagy-szamla', 'a döntés és a 900 000 Ft-os határ', async () => {
    expect(RECEIPT_MAX_GROSS_HUF).toBe(900_000)
    expect(chooseDocument({ grossTotal: 950_000 }).type).toBe('invoice')
    expect(
      chooseDocument({ grossTotal: 2_000, currency: 'EUR', conversionRate: 390 }),
    ).toMatchObject({
      type: 'receipt',
      grossTotalHuf: 780_000,
    })
    expect(chooseDocument({ grossTotal: 12_700, cashRegisterRequired: true }).type).toBe(
      'cash-register',
    )
    expect(() => chooseDocument({ grossTotal: 2_000, currency: 'EUR' })).toThrow(
      expect.objectContaining({ category: 'validation' }),
    )
  })

  docsExample('fizetesek/nyugta-vagy-szamla', 'pénztárgép-kötelesnél validation hiba', async () => {
    const { tarca, billingo } = docsClient()
    const hiba = await issueForPayment(
      tarca,
      {
        provider: 'stripe',
        kind: 'paid',
        id: 'pi_pg',
        method: 'stripe',
        amount: huf(1_270),
        raw: {},
      },
      { vat: 27, cashRegisterRequired: true },
    ).catch((error: unknown) => error)

    expect(isBillingoError(hiba) && hiba.category).toBe('validation')
    expect(billingo.count('CreateReceipt')).toBe(0)
  })
})

describe('fizetesek/visszaterites', () => {
  docsExample(
    'fizetesek/visszaterites',
    'Barion nyugta, majd a teljes visszatérítés sztornója',
    async () => {
      const { tarca } = docsClient()
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
      const ujra = await issueForPayment(
        tarca,
        { ...fizetes, kind: 'refunded', refundedAmount: osszeg },
        { vat: 27 },
      )

      expect(nyugta).toMatchObject({ kind: 'receipt', document: { invoiceNumber: 'NYT-2026-1' } })
      expect(visszaterites).toMatchObject({
        kind: 'cancellation',
        created: true,
        cancellation: { type: 'receipt_cancellation', grossTotal: -25_400 },
      })
      expect(ujra).toMatchObject({ kind: 'cancellation', created: false })
    },
  )

  docsExample(
    'fizetesek/visszaterites',
    'bizonylat nélküli visszatérítés: in_progress',
    async () => {
      const { tarca, billingo } = docsClient()
      const visszaterites: PaymentEvent = {
        provider: 'stripe',
        kind: 'refunded',
        id: 'pi_3QhB7e',
        method: 'stripe',
        amount: { value: 12_700, minor: 1_270_000, currency: 'HUF' },
        refundedAmount: { value: 12_700, minor: 1_270_000, currency: 'HUF' },
        raw: {},
      }

      const hiba = await issueForPayment(tarca, visszaterites, { vat: 27 }).catch(
        (error: unknown) => error,
      )

      expect(isBillingoError(hiba) && hiba.category).toBe('in_progress')
      expect(billingo.count('CancelDocument')).toBe(0)
    },
  )

  docsExample('fizetesek/visszaterites', 'setIfAbsent nélküli ledger: configuration', async () => {
    const { tarca } = docsClient()
    const base = memoryStore()
    const ledger: KeyValueStore = {
      get: (key) => base.get(key),
      set: (key, value, ttl) => base.set(key, value, ttl),
      delete: (key) => base.delete(key),
    }
    const fizetes: PaymentEvent = { ...BUSINESS_PAYMENT, id: 'pi_kv' }
    await issueForPayment(tarca, fizetes, { vat: 27 })

    const hiba = await issueForPayment(
      tarca,
      { ...fizetes, kind: 'refunded', refundedAmount: fizetes.amount },
      { vat: 27, ledger },
    ).catch((error: unknown) => error)

    expect(isBillingoError(hiba) && hiba.category).toBe('configuration')
  })
})

describe('fizetesek/reszleges-visszaterites', () => {
  docsExample(
    'fizetesek/reszleges-visszaterites',
    'módosító számla ledgerrel, az újraküldés nem állít ki másodikat',
    async () => {
      const { tarca, billingo } = docsClient()
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
      const elott = billingo.requests.length
      const elso = await issueForPayment(tarca, visszaterites, { vat: 27, ledger })
      const kozben = billingo.requests.length
      const ujra = await issueForPayment(tarca, visszaterites, { vat: 27, ledger })

      expect(szamla).toMatchObject({ kind: 'invoice', document: { invoiceNumber: '2026-1' } })
      expect(elso).toMatchObject({
        kind: 'modification',
        created: true,
        modifications: [{ refundId: 're_1', modificationId: 2, created: true, grossTotal: -5_000 }],
      })
      expect(ujra).toMatchObject({
        kind: 'modification',
        created: false,
        modifications: [{ modificationId: 2, created: false }],
      })
      expect(billingo.requests.slice(elott, kozben).map((request) => request.operation)).toEqual([
        'GetDocumentByVendorId',
        'GetDocument',
        'ListDocument',
        'CreateModificationDocument',
      ])
      expect(billingo.requests.slice(kozben).map((request) => request.operation)).toEqual([
        'GetDocumentByVendorId',
      ])
      expect(sentBodies(billingo, 'CreateModificationDocument')).toEqual([
        {
          comment: '(Visszatérítés STRIPE-pi_3QhB7d re_1)',
          payment_method: 'stripe',
          items: [
            {
              name: 'Termék vagy szolgáltatás',
              quantity: 1,
              unit: 'db',
              vat: '27%',
              unit_price: -5000,
              unit_price_type: 'gross',
            },
          ],
        },
      ])
    },
  )

  docsExample('fizetesek/reszleges-visszaterites', 'ledger nélkül javaslat jön', async () => {
    const { tarca, billingo } = docsClient()
    await issueForPayment(tarca, BUSINESS_PAYMENT, { vat: 27 })

    const javaslat = await issueForPayment(
      tarca,
      {
        ...BUSINESS_PAYMENT,
        kind: 'partially-refunded',
        refunds: [{ id: 're_1', amount: huf(5_000) }],
      },
      { vat: 27 },
    )

    expect(javaslat).toMatchObject({
      kind: 'refund-proposal',
      refunds: [{ refundId: 're_1', items: [{ grossMinor: 250_000 }, { grossMinor: 250_000 }] }],
    })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  docsExample('fizetesek/reszleges-visszaterites', 'arányos felosztás két áfakulcsra', async () => {
    expect(
      allocateRefund(
        [
          { name: 'Póló', vat: '27%', grossMinor: 1_270_000 },
          { name: 'Könyv', vat: '5%', grossMinor: 630_000 },
        ],
        500_000,
      ),
    ).toEqual([
      { index: 0, name: 'Póló', vat: '27%', grossMinor: 334_211 },
      { index: 1, name: 'Könyv', vat: '5%', grossMinor: 165_789 },
    ])
    expect(() => allocateRefund([{ name: 'Póló', vat: '27%', grossMinor: 100 }], 101)).toThrow(
      expect.objectContaining({ category: 'validation' }),
    )
  })

  docsExample(
    'fizetesek/reszleges-visszaterites',
    'createModificationOnce közvetlenül, egyszer',
    async () => {
      const { tarca, billingo } = docsClient()
      const ledger = memoryStore()
      await tarca.documents.createOnce({
        vendorId: 'ORDER-1001',
        partner: {
          name: 'Vevő Kft.',
          address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
        },
        items: [{ name: 'Póló', quantity: 2, grossUnitPrice: 6_350, vat: 27 }],
      })
      const input = {
        documentId: 1,
        vendorId: 'ORDER-1001',
        refundId: 'visszaru-1',
        ledger,
        items: [{ name: 'Visszáru', quantity: 1, grossUnitPrice: -5_000, vat: 27 }],
      }

      const modosito = await createModificationOnce(tarca, input)
      const ujra = await createModificationOnce(tarca, input)

      expect(modosito).toMatchObject({ created: true, modificationId: 2, grossTotal: -5_000 })
      expect(ujra).toMatchObject({ created: false, modificationId: 2 })
      expect(billingo.count('CreateModificationDocument')).toBe(1)
    },
  )
})
