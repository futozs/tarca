import { describe, expect, test, vi } from 'vitest'
import { createTarca } from '../client'
import { hmacHex } from '../core/crypto'
import { createFakeBillingoFetch } from '../testing'
import { PaymentProviderError, WebhookVerificationError } from './errors'
import { issueForPayment, paymentVendorId } from './issue'
import {
  countStripeRefunds,
  fetchStripeLineItems,
  findStripeCheckoutSession,
  parseStripeEvent,
  parseStripeSignatureHeader,
  type StripeEvent,
  stripePaymentEvent,
  stripeWebhook,
  verifyStripeSignature,
} from './stripe'
import type { PaymentEvent } from './types'

interface RecordedRequest {
  readonly url: string
  readonly method: string
  readonly headers: Headers
}

function routedFetch(routes: ReadonlyArray<readonly [RegExp, () => Response]>) {
  const requests: RecordedRequest[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    requests.push({ url: request.url, method: request.method, headers: request.headers })
    const route = routes.find(([pattern]) => pattern.test(request.url))
    return route ? route[1]() : new Response('ismeretlen útvonal', { status: 404 })
  }
  return { fetch: fetch as typeof globalThis.fetch, requests }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const SECRET = 'whsec_teszt_titok'
const API_KEY = 'sk_test_tarca'
const NOW_SECONDS = 1_790_000_000
const now = (): number => NOW_SECONDS * 1000

async function signature(
  payload: string,
  secret = SECRET,
  timestamp = NOW_SECONDS,
): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex('SHA-256', secret, `${timestamp}.${payload}`)}`
}

function event(
  type: string,
  object: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  id = 'evt_1',
): string {
  return JSON.stringify({
    id,
    object: 'event',
    type,
    created: NOW_SECONDS,
    livemode: false,
    data: { object, ...extra },
  })
}

const SESSION = {
  id: 'cs_test_1',
  object: 'checkout.session',
  payment_intent: 'pi_1',
  payment_status: 'paid',
  amount_total: 302_300,
  currency: 'huf',
  client_reference_id: 'WEB-1001',
  customer_details: {
    name: 'Kovács Éva',
    email: 'eva@pelda.hu',
    phone: '+36301234567',
    address: {
      country: 'HU',
      postal_code: '1111',
      city: 'Budapest',
      line1: 'Fő utca 1.',
      line2: null,
    },
    tax_ids: [],
  },
  shipping_cost: { amount_total: 99_000 },
  metadata: { orderId: '1001' },
}

const CHARGE = {
  id: 'ch_1',
  object: 'charge',
  payment_intent: 'pi_1',
  amount: 302_300,
  currency: 'huf',
}

function huf(value: number) {
  return { value, minor: value * 100, currency: 'HUF' }
}

function parsed(
  type: string,
  object: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): StripeEvent {
  return parseStripeEvent(event(type, object, extra))
}

function webhookRequest(body: string, headers: Record<string, string>): Request {
  return new Request('https://bolt.example.hu/api/stripe', { method: 'POST', body, headers })
}

describe('parseStripeSignatureHeader', () => {
  test('kiolvassa az időbélyeget és az összes v1 aláírást, a v0-t kihagyja', () => {
    expect(parseStripeSignatureHeader('t=123,v1=aa,v0=bb, v1=cc')).toEqual({
      timestamp: 123,
      signatures: ['aa', 'cc'],
    })
  })

  test('a nem aláírt hibakereső és ismeretlen bejegyzéseket bármilyen sorrendben figyelmen kívül hagyja', () => {
    expect(
      parseStripeSignatureHeader(
        'secret=whsec_x,v1=aa,destination=we_1,payload={"id":"x"},t=123,ismeretlen=1,v1=bb',
      ),
    ).toEqual({ timestamp: 123, signatures: ['aa', 'bb'] })
  })

  test('hiányzó időbélyegnél vagy aláírásnál undefined-ot ad', () => {
    expect(parseStripeSignatureHeader('v1=aa')).toBeUndefined()
    expect(parseStripeSignatureHeader('t=123')).toBeUndefined()
    expect(parseStripeSignatureHeader('t=abc,v1=aa')).toBeUndefined()
    expect(parseStripeSignatureHeader('szemét')).toBeUndefined()
    expect(parseStripeSignatureHeader('t=123,secret=whsec_x,payload=x')).toBeUndefined()
  })
})

describe('verifyStripeSignature', () => {
  const payload = '{"id":"evt_1"}'

  test('a helyes aláírást elfogadja', async () => {
    await expect(
      verifyStripeSignature(payload, await signature(payload), SECRET, { now }),
    ).resolves.toBeUndefined()
  })

  test('a nem aláírt secret, destination és payload bejegyzések mellett is a nyers törzset ellenőrzi', async () => {
    const valid = await signature(payload)
    const debug = `secret=${SECRET},destination=we_123,payload=${payload},extra=1,${valid}`
    await expect(verifyStripeSignature(payload, debug, SECRET, { now })).resolves.toBeUndefined()
    const forgedBody = '{"id":"evt_hamis"}'
    const forged = `payload=${forgedBody},secret=${SECRET},${await signature(forgedBody)}`
    await expect(verifyStripeSignature(payload, forged, SECRET, { now })).rejects.toMatchObject({
      reason: 'invalid_signature',
    })
    await expect(
      verifyStripeSignature(payload, `t=${NOW_SECONDS},secret=${SECRET}`, SECRET, { now }),
    ).rejects.toMatchObject({ reason: 'invalid_signature' })
  })

  test('kulcsváltáskor bármelyik titokkal és bármelyik v1 aláírással elfogad', async () => {
    const header = `${await signature(payload, 'whsec_regi')},v1=${'0'.repeat(64)}`
    await expect(
      verifyStripeSignature(payload, header, ['whsec_uj', 'whsec_regi'], { now }),
    ).resolves.toBeUndefined()
  })

  test('módosított törzsnél invalid_signature hibát dob', async () => {
    await expect(
      verifyStripeSignature('{"id":"evt_2"}', await signature(payload), SECRET, { now }),
    ).rejects.toMatchObject({ reason: 'invalid_signature', provider: 'stripe' })
  })

  test('hiányzó és hibás fejlécre hibát dob, a hibaüzenet nem tartalmazza a fejlécet', async () => {
    await expect(verifyStripeSignature(payload, null, SECRET, { now })).rejects.toMatchObject({
      reason: 'missing_signature',
    })
    const failure = await verifyStripeSignature(payload, 'v1=titkosaláírás', SECRET, { now }).catch(
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({ reason: 'invalid_signature' })
    expect(String((failure as Error).message)).not.toContain('titkosaláírás')
  })

  test('a 300 másodpercnél régebbi időbélyeget elutasítja, a 0 tolerancia kikapcsolja', async () => {
    const old = await signature(payload, SECRET, NOW_SECONDS - 301)
    await expect(verifyStripeSignature(payload, old, SECRET, { now })).rejects.toMatchObject({
      reason: 'timestamp_out_of_range',
    })
    await expect(
      verifyStripeSignature(payload, await signature(payload, SECRET, NOW_SECONDS - 300), SECRET, {
        now,
      }),
    ).resolves.toBeUndefined()
    await expect(
      verifyStripeSignature(payload, old, SECRET, { now, toleranceSeconds: 0 }),
    ).resolves.toBeUndefined()
  })

  test('a NaN, negatív vagy végtelen tolerancia nem kapcsolja ki csendben az ellenőrzést, hanem TypeError', async () => {
    const old = await signature(payload, SECRET, NOW_SECONDS - 301)
    for (const toleranceSeconds of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      await expect(
        verifyStripeSignature(payload, old, SECRET, { now, toleranceSeconds }),
      ).rejects.toBeInstanceOf(TypeError)
    }
  })

  test('üres titokra TypeError-t dob', async () => {
    await expect(verifyStripeSignature(payload, 't=1,v1=a', ' ')).rejects.toBeInstanceOf(TypeError)
    await expect(verifyStripeSignature(payload, 't=1,v1=a', [])).rejects.toBeInstanceOf(TypeError)
  })

  test('alapértelmezésben a valós órát használja', async () => {
    const fresh = await signature(payload, SECRET, Math.floor(Date.now() / 1000))
    await expect(verifyStripeSignature(payload, fresh, SECRET)).resolves.toBeUndefined()
  })
})

describe('parseStripeEvent', () => {
  test('hiányzó data.object esetén invalid_payload hibát dob', () => {
    expect(() => parseStripeEvent('{"id":"evt_1","type":"x"}')).toThrow(WebhookVerificationError)
  })

  test('megőrzi a previous_attributes mezőt', () => {
    expect(
      parsed('charge.refunded', { id: 'ch_1' }, { previous_attributes: { amount_refunded: 0 } })
        .previousAttributes,
    ).toEqual({ amount_refunded: 0 })
  })

  test('a thin (v2) eseményt data nélkül is beolvassa', () => {
    const thin = parseStripeEvent(
      JSON.stringify({
        id: 'evt_test_65R',
        object: 'v2.core.event',
        type: 'v1.billing.meter.error_report_triggered',
        created: '2026-10-02T10:00:00.000Z',
        related_object: { id: 'mtr_1', type: 'billing.meter', url: '/v1/billing/meters/mtr_1' },
      }),
    )
    expect(thin).toMatchObject({ thin: true, object: { id: 'mtr_1' } })
    expect(thin.created).toBe(Math.floor(Date.parse('2026-10-02T10:00:00.000Z') / 1000))
  })
})

describe('stripePaymentEvent', () => {
  test('a fizetett Checkout munkamenetből fizetést készít, a HUF-ot kétdecimálisként kezeli', () => {
    const payment = stripePaymentEvent(parsed('checkout.session.completed', SESSION))
    expect(payment).toMatchObject({
      provider: 'stripe',
      kind: 'paid',
      id: 'pi_1',
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      orderRef: 'WEB-1001',
      amount: { value: 3023, minor: 302_300, currency: 'HUF' },
      method: 'stripe',
      paidAt: new Date(NOW_SECONDS * 1000).toISOString(),
      customer: {
        name: 'Kovács Éva',
        email: 'eva@pelda.hu',
        address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
      },
    })
    expect(payment?.customer?.isBusiness).toBeUndefined()
  })

  test('a metadata rendelésszámát használja, ha nincs client_reference_id', () => {
    const payment = stripePaymentEvent(
      parsed('checkout.session.completed', { ...SESSION, client_reference_id: null }),
    )
    expect(payment?.orderRef).toBe('1001')
  })

  test('a céges vevő adószámait és cégnevét felismeri', () => {
    const payment = stripePaymentEvent(
      parsed('checkout.session.completed', {
        ...SESSION,
        customer_details: {
          ...SESSION.customer_details,
          business_name: 'Példa Kft.',
          tax_ids: [
            { type: 'hu_tin', value: '12345678-2-42' },
            { type: 'eu_vat', value: 'HU12345678' },
          ],
        },
      }),
    )
    expect(payment?.customer).toMatchObject({
      name: 'Példa Kft.',
      taxNumber: '12345678-2-42',
      euTaxNumber: 'HU12345678',
      isBusiness: true,
    })
  })

  test('a még nem fizetett munkamenetet figyelmen kívül hagyja, a fizetés nélkülit other-ként adja', () => {
    expect(
      stripePaymentEvent(
        parsed('checkout.session.completed', { ...SESSION, payment_status: 'unpaid' }),
      ),
    ).toBeUndefined()
    expect(
      stripePaymentEvent(
        parsed('checkout.session.completed', {
          ...SESSION,
          payment_status: 'no_payment_required',
          payment_intent: null,
        }),
      ),
    ).toMatchObject({ kind: 'other', id: 'cs_test_1' })
  })

  test('az aszinkron fizetés sikerét és kudarcát is kezeli', () => {
    expect(
      stripePaymentEvent(parsed('checkout.session.async_payment_succeeded', SESSION))?.kind,
    ).toBe('paid')
    expect(stripePaymentEvent(parsed('checkout.session.async_payment_failed', SESSION))?.kind).toBe(
      'failed',
    )
  })

  test('a PaymentIntent eseményekből fizetést és hibát készít, a method felülírható', () => {
    const intent = {
      id: 'pi_2',
      object: 'payment_intent',
      amount: 500_000,
      amount_received: 500_000,
      currency: 'huf',
      receipt_email: 'vevo@pelda.hu',
      metadata: { order_id: 'R-77' },
    }
    expect(
      stripePaymentEvent(parsed('payment_intent.succeeded', intent), { method: 'bankcard' }),
    ).toMatchObject({
      kind: 'paid',
      id: 'pi_2',
      orderRef: 'R-77',
      amount: huf(5000),
      method: 'bankcard',
      customer: { email: 'vevo@pelda.hu' },
    })
    expect(
      stripePaymentEvent(
        parsed('payment_intent.payment_failed', { ...intent, receipt_email: null }),
      ),
    ).toMatchObject({ kind: 'failed', amount: { value: 5000 }, customer: undefined })
  })

  test('a JPY összeget nem osztja százzal', () => {
    const payment = stripePaymentEvent(
      parsed('payment_intent.succeeded', {
        id: 'pi_3',
        object: 'payment_intent',
        amount_received: 1500,
        currency: 'jpy',
      }),
    )
    expect(payment?.amount).toEqual({ value: 1500, minor: 1500, currency: 'JPY' })
  })

  test('egyszeri teljes visszatérítésből refunded eseményt ad a payment_intent azonosítójával', () => {
    const payment = stripePaymentEvent(
      parsed(
        'charge.refunded',
        {
          ...CHARGE,
          amount_refunded: 302_300,
          refunded: true,
          billing_details: { name: 'Kovács Éva', email: 'eva@pelda.hu', address: null },
        },
        { previous_attributes: { amount_refunded: 0, refunded: false } },
      ),
    )
    expect(payment).toMatchObject({
      kind: 'refunded',
      id: 'pi_1',
      amount: huf(3023),
      refundedAmount: huf(3023),
    })
  })

  test('részleges, illetve részletekben teljessé váló visszatérítést részlegesnek jelöl', () => {
    expect(
      stripePaymentEvent(
        parsed('charge.refunded', { ...CHARGE, amount_refunded: 100_000, refunded: false }),
      )?.kind,
    ).toBe('partially-refunded')
    expect(
      stripePaymentEvent(
        parsed(
          'charge.refunded',
          { ...CHARGE, amount_refunded: 302_300, refunded: true },
          { previous_attributes: { amount_refunded: 100_000 } },
        ),
      )?.kind,
    ).toBe('partially-refunded')
  })

  test('a visszatérítés deltáját a terhelés és a halmozott összeg szerinti azonosítóval adja', () => {
    const charge = { ...CHARGE, amount_refunded: 202_300 }
    const delta = stripePaymentEvent(
      parsed('charge.refunded', charge, { previous_attributes: { amount_refunded: 100_000 } }),
    )
    expect(delta?.refunds).toEqual([
      {
        id: 'ch_1:202300',
        amount: huf(1023),
        refundedBefore: huf(1000),
        createdAt: new Date(NOW_SECONDS * 1000).toISOString(),
      },
    ])
    expect(stripePaymentEvent(parsed('charge.refunded', charge))?.refunds).toBeUndefined()
    expect(
      stripePaymentEvent(
        parsed('charge.refunded', charge, { previous_attributes: { amount_refunded: 202_300 } }),
      )?.refunds,
    ).toBeUndefined()
  })

  test('ugyanarról a visszatérítésről érkező két külön Stripe esemény ugyanazt a visszatérítés-azonosítót adja', () => {
    const extra = { previous_attributes: { amount_refunded: 100_000 } }
    const object = { ...CHARGE, amount_refunded: 202_300 }
    const first = stripePaymentEvent(parseStripeEvent(event('charge.refunded', object, extra)))
    const second = stripePaymentEvent(
      parseStripeEvent(event('charge.refunded', object, extra, 'evt_masodik')),
    )
    expect(first?.eventId).not.toBe(second?.eventId)
    expect(first?.refunds?.[0]?.id).toBe(second?.refunds?.[0]?.id)
  })

  test('payment_intent nélküli terhelésnél a terhelés azonosítóját használja', () => {
    expect(
      stripePaymentEvent(
        parsed('charge.refunded', {
          id: 'ch_9',
          amount: 1000,
          amount_refunded: 1000,
          currency: 'eur',
        }),
      ),
    ).toMatchObject({ id: 'ch_9', kind: 'refunded' })
  })

  test('a thin (v2) eseményből other lesz, bizonylat nem készül belőle', () => {
    const thin = parseStripeEvent(
      JSON.stringify({
        id: 'evt_thin',
        object: 'v2.core.event',
        type: 'v2.core.account.updated',
        related_object: { id: 'acct_1' },
      }),
    )
    expect(stripePaymentEvent(thin)).toMatchObject({
      kind: 'other',
      id: 'acct_1',
      eventId: 'evt_thin',
    })
  })

  test('a meghiúsult vagy visszavont visszatérítésből refund-failed eseményt ad, a sikereset kihagyja', () => {
    const failed = {
      id: 're_1',
      object: 'refund',
      status: 'failed',
      failure_reason: 'lost_or_stolen_card',
      charge: 'ch_1',
      payment_intent: 'pi_1',
      amount: 302_300,
      currency: 'huf',
    }
    for (const type of ['charge.refund.updated', 'refund.updated', 'refund.failed']) {
      expect(stripePaymentEvent(parsed(type, failed))).toMatchObject({
        provider: 'stripe',
        kind: 'refund-failed',
        id: 'pi_1',
        eventType: type,
        refundedAmount: huf(3023),
        refunds: [{ id: 're_1', amount: huf(3023) }],
      })
    }
    expect(
      stripePaymentEvent(
        parsed('charge.refund.updated', { ...failed, status: 'canceled', payment_intent: null }),
      ),
    ).toMatchObject({ kind: 'refund-failed', id: 'ch_1' })
    expect(
      stripePaymentEvent(parsed('charge.refund.updated', { ...failed, status: 'succeeded' })),
    ).toBeUndefined()
    expect(
      stripePaymentEvent(parsed('refund.updated', { ...CHARGE, status: 'failed' })),
    ).toBeUndefined()
  })

  test('az ismeretlen eseménytípust figyelmen kívül hagyja', () => {
    expect(stripePaymentEvent(parsed('customer.created', { id: 'cus_1' }))).toBeUndefined()
  })

  test('a fizetés és a visszatérítése ugyanarra a vendorId-ra képződik (payment_intent)', async () => {
    const payment = stripePaymentEvent(parsed('checkout.session.completed', SESSION))
    const refund = stripePaymentEvent(
      parsed('charge.refunded', { ...CHARGE, amount_refunded: 302_300, refunded: true }),
    )
    const intent = stripePaymentEvent(
      parsed('payment_intent.succeeded', {
        id: 'pi_1',
        object: 'payment_intent',
        amount_received: 302_300,
        currency: 'huf',
      }),
    )
    if (!payment || !refund || !intent) throw new Error('esemény várt')
    expect(await paymentVendorId(payment)).toBe('STRIPE-pi_1')
    expect(await paymentVendorId(refund)).toBe('STRIPE-pi_1')
    expect(await paymentVendorId(intent)).toBe('STRIPE-pi_1')
  })
})

describe('Stripe API segédek', () => {
  test('a Checkout tételeket lapozva kéri le, ISO minor unitban', async () => {
    const stripe = routedFetch([
      [
        /line_items\?limit=100&starting_after=li_1$/,
        () =>
          jsonResponse({
            data: [
              {
                id: 'li_2',
                description: 'Kifli',
                quantity: 1,
                amount_total: 25_000,
                currency: 'huf',
              },
            ],
            has_more: false,
          }),
      ],
      [
        /line_items\?limit=100$/,
        () =>
          jsonResponse({
            data: [
              {
                id: 'li_1',
                description: 'Kávé',
                quantity: 2,
                amount_total: 178_000,
                currency: 'huf',
                price: { product: 'prod_1' },
              },
            ],
            has_more: true,
          }),
      ],
    ])
    const items = await fetchStripeLineItems('cs_test_1', { apiKey: API_KEY, fetch: stripe.fetch })
    expect(items).toEqual([
      { name: 'Kávé', quantity: 2, totalGross: huf(1780), sku: 'prod_1' },
      { name: 'Kifli', quantity: 1, totalGross: huf(250), sku: undefined },
    ])
    expect(stripe.requests[0]?.url).toBe(
      'https://api.stripe.com/v1/checkout/sessions/cs_test_1/line_items?limit=100',
    )
    expect(stripe.requests[0]?.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
  })

  test('hibás válaszra és hiányos tételre PaymentProviderError-t dob, a kulcs nélkül', async () => {
    const failing = routedFetch([[/./, () => jsonResponse({ error: {} }, 401)]])
    const failure = await fetchStripeLineItems('cs_1', {
      apiKey: API_KEY,
      fetch: failing.fetch,
    }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ name: 'PaymentProviderError', status: 401 })
    expect(String((failure as Error).message)).not.toContain(API_KEY)
    const incomplete = routedFetch([
      [/./, () => jsonResponse({ data: [{ id: 'li_1', description: 'X' }], has_more: false })],
    ])
    await expect(
      fetchStripeLineItems('cs_1', { apiKey: API_KEY, fetch: incomplete.fetch }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
    const notJson = routedFetch([[/./, () => new Response('nem json')]])
    await expect(
      fetchStripeLineItems('cs_1', { apiKey: API_KEY, fetch: notJson.fetch }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
    const offline = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(
      fetchStripeLineItems('cs_1', { apiKey: API_KEY, fetch: offline }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
  })

  test('egyedi API URL-t is elfogad, a záró perjelet levágja', async () => {
    const stripe = routedFetch([[/./, () => jsonResponse({ data: [], has_more: false })]])
    await fetchStripeLineItems('cs 1', {
      apiKey: API_KEY,
      apiUrl: 'http://localhost:12111/',
      fetch: stripe.fetch,
    })
    expect(stripe.requests[0]?.url).toBe(
      'http://localhost:12111/v1/checkout/sessions/cs%201/line_items?limit=100',
    )
  })

  test('a PaymentIntent Checkout munkamenetét visszakeresi', async () => {
    const stripe = routedFetch([[/checkout\/sessions\?/, () => jsonResponse({ data: [SESSION] })]])
    expect(
      await findStripeCheckoutSession('pi_1', { apiKey: API_KEY, fetch: stripe.fetch }),
    ).toEqual(SESSION)
    expect(stripe.requests[0]?.url).toBe(
      'https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_1&limit=1',
    )
  })

  test('csak az aktív visszatérítéseket számolja', async () => {
    const stripe = routedFetch([
      [
        /refunds\?charge=ch_1/,
        () =>
          jsonResponse({
            data: [
              { status: 'succeeded' },
              { status: 'failed' },
              { status: 'pending' },
              { status: 'canceled' },
            ],
          }),
      ],
    ])
    expect(await countStripeRefunds('ch_1', { apiKey: API_KEY, fetch: stripe.fetch })).toBe(2)
  })
})

describe('stripeWebhook', () => {
  function stripeApi(
    sessionLookup: unknown[] = [],
    refunds: unknown[] = [{ status: 'succeeded' }],
  ) {
    return routedFetch([
      [
        /line_items/,
        () =>
          jsonResponse({
            data: [
              {
                id: 'li_1',
                description: 'Kávé',
                quantity: 2,
                amount_total: 178_000,
                currency: 'huf',
              },
              {
                id: 'li_2',
                description: 'Kifli',
                quantity: 1,
                amount_total: 25_300,
                currency: 'huf',
              },
            ],
            has_more: false,
          }),
      ],
      [/checkout\/sessions\?payment_intent=/, () => jsonResponse({ data: sessionLookup })],
      [/refunds\?charge=/, () => jsonResponse({ data: refunds })],
    ])
  }

  async function deliver(
    handler: (request: Request) => Promise<Response>,
    payload: string,
    header?: string,
  ): Promise<Response> {
    return handler(
      webhookRequest(payload, { 'stripe-signature': header ?? (await signature(payload)) }),
    )
  }

  test('ellenőrzött Checkout eseménynél tételekkel és szállítással hívja az onPayment-et', async () => {
    const api = stripeApi()
    const payments: PaymentEvent[] = []
    const handler = stripeWebhook({
      secret: SECRET,
      apiKey: API_KEY,
      fetch: api.fetch,
      now,
      onPayment: (payment) => {
        payments.push(payment)
      },
    })

    const response = await deliver(handler, event('checkout.session.completed', SESSION))

    expect(response.status).toBe(200)
    expect(payments).toHaveLength(1)
    expect(payments[0]?.items).toEqual([
      { name: 'Kávé', quantity: 2, totalGross: huf(1780), sku: undefined },
      { name: 'Kifli', quantity: 1, totalGross: huf(253), sku: undefined },
      { name: 'Szállítási díj', quantity: 1, totalGross: huf(990) },
    ])
  })

  test('API-kulcs nélkül tételek nélkül adja tovább az eseményt', async () => {
    const onPayment = vi.fn()
    const handler = stripeWebhook({ secret: SECRET, now, onPayment })
    await deliver(handler, event('checkout.session.completed', SESSION))
    expect(onPayment).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paid' }))
    expect(onPayment.mock.calls[0]?.[0]?.items).toBeUndefined()
  })

  test('API-kulcs nélkül a PaymentIntent fizetést other-ként adja tovább, mert a vevő adatai a Checkoutban vannak', async () => {
    const onPayment = vi.fn()
    const handler = stripeWebhook({ secret: SECRET, now, onPayment })
    const response = await deliver(
      handler,
      event('payment_intent.succeeded', {
        id: 'pi_1',
        object: 'payment_intent',
        amount_received: 302_300,
        currency: 'huf',
      }),
    )
    expect(response.status).toBe(200)
    expect(onPayment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'other', id: 'pi_1', eventType: 'payment_intent.succeeded' }),
    )
  })

  test('a meghiúsult visszatérítést refund-failed eseményként adja az onPayment-nek', async () => {
    const onPayment = vi.fn()
    const handler = stripeWebhook({ secret: SECRET, now, onPayment })
    const response = await deliver(
      handler,
      event('charge.refund.updated', {
        id: 're_1',
        object: 'refund',
        status: 'failed',
        charge: 'ch_1',
        payment_intent: 'pi_1',
        amount: 302_300,
        currency: 'huf',
      }),
    )
    expect(response.status).toBe(200)
    expect(onPayment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'refund-failed', id: 'pi_1' }),
    )
  })

  test('PaymentIntent eseménynél a Checkout munkamenetből tölti be a tételeket és a vevőt', async () => {
    const api = stripeApi([SESSION])
    const onPayment = vi.fn()
    const handler = stripeWebhook({
      secret: SECRET,
      apiKey: API_KEY,
      fetch: api.fetch,
      now,
      onPayment,
    })
    await deliver(
      handler,
      event('payment_intent.succeeded', {
        id: 'pi_1',
        object: 'payment_intent',
        amount_received: 302_300,
        currency: 'huf',
      }),
    )
    expect(onPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'paid',
        id: 'pi_1',
        eventType: 'payment_intent.succeeded',
        orderRef: 'WEB-1001',
        customer: expect.objectContaining({ name: 'Kovács Éva' }),
        items: expect.arrayContaining([expect.objectContaining({ name: 'Szállítási díj' })]),
      }),
    )
    const captured = vi.fn()
    await deliver(
      stripeWebhook({
        secret: SECRET,
        apiKey: API_KEY,
        fetch: api.fetch,
        now,
        onPayment: captured,
      }),
      event('payment_intent.succeeded', {
        id: 'pi_1',
        object: 'payment_intent',
        amount_received: 150_000,
        currency: 'huf',
      }),
    )
    expect(captured).toHaveBeenCalledWith(
      expect.objectContaining({ amount: { value: 1500, minor: 150_000, currency: 'HUF' } }),
    )
  })

  test('Checkout nélküli PaymentIntent eseményt változatlanul ad tovább', async () => {
    const api = stripeApi([])
    const onPayment = vi.fn()
    const handler = stripeWebhook({
      secret: SECRET,
      apiKey: API_KEY,
      fetch: api.fetch,
      now,
      onPayment,
    })
    await deliver(
      handler,
      event('payment_intent.succeeded', {
        id: 'pi_7',
        object: 'payment_intent',
        amount_received: 100_000,
        currency: 'huf',
      }),
    )
    expect(onPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'pi_7' }))
    expect(onPayment.mock.calls[0]?.[0]?.items).toBeUndefined()
  })

  test('több visszatérítés után a teljes visszatérítést is részlegesnek jelöli, egynél refunded marad', async () => {
    const refunded = event('charge.refunded', {
      ...CHARGE,
      amount_refunded: 302_300,
      refunded: true,
    })
    const many = vi.fn()
    await deliver(
      stripeWebhook({
        secret: SECRET,
        apiKey: API_KEY,
        fetch: stripeApi([], [{ status: 'succeeded' }, { status: 'succeeded' }]).fetch,
        now,
        onPayment: many,
      }),
      refunded,
    )
    const single = vi.fn()
    await deliver(
      stripeWebhook({
        secret: SECRET,
        apiKey: API_KEY,
        fetch: stripeApi([], [{ status: 'succeeded' }]).fetch,
        now,
        onPayment: single,
      }),
      refunded,
    )
    expect(many).toHaveBeenCalledWith(expect.objectContaining({ kind: 'partially-refunded' }))
    expect(single).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refunded' }))
  })

  test('nem releváns eseményre 200-at ad, onPayment nélkül; thin eseményre other-rel', async () => {
    const onPayment = vi.fn()
    const handler = stripeWebhook({ secret: SECRET, now, onPayment })
    expect((await deliver(handler, event('customer.created', { id: 'cus_1' }))).status).toBe(200)
    expect(onPayment).not.toHaveBeenCalled()
    const thin = JSON.stringify({
      id: 'evt_thin',
      object: 'v2.core.event',
      type: 'v2.core.account.updated',
      related_object: { id: 'acct_1' },
    })
    expect((await deliver(handler, thin)).status).toBe(200)
    expect(onPayment).toHaveBeenCalledWith(expect.objectContaining({ kind: 'other' }))
  })

  test('hibás aláírásra 400-at ad, és nem hívja az onPayment-et', async () => {
    const onPayment = vi.fn()
    const handler = stripeWebhook({ secret: SECRET, now, onPayment })
    const response = await deliver(
      handler,
      event('checkout.session.completed', SESSION),
      't=1,v1=00',
    )
    expect(response.status).toBe(400)
    expect(onPayment).not.toHaveBeenCalled()
  })

  test('érvénytelen JSON-ra 400-at ad, a válasz nem idéz a törzsből', async () => {
    const onPayment = vi.fn()
    const handler = stripeWebhook({ secret: SECRET, now, onPayment })
    const body = '{"email":"titkos@pelda.hu",'
    const response = await deliver(handler, body)
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('titkos')
    expect(onPayment).not.toHaveBeenCalled()
  })

  test('ha az onPayment dob, 500-at ad, hogy a Stripe újraküldje', async () => {
    const onError = vi.fn()
    const handler = stripeWebhook({
      secret: SECRET,
      now,
      onError,
      onPayment: () => {
        throw new Error('a számlázás nem sikerült')
      },
    })
    const response = await deliver(handler, event('checkout.session.completed', SESSION))
    expect(response.status).toBe(500)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('üres titokkal vagy rossz beállítással már létrehozáskor TypeError-t dob', () => {
    expect(() => stripeWebhook({ secret: '', onPayment: vi.fn() })).toThrow(TypeError)
    expect(() => stripeWebhook({ secret: SECRET, onPayment: vi.fn(), maxBodyBytes: -1 })).toThrow(
      TypeError,
    )
    expect(() =>
      stripeWebhook({ secret: SECRET, onPayment: vi.fn(), toleranceSeconds: Number.NaN }),
    ).toThrow(TypeError)
  })
})

describe('stripeWebhook a hamis Billingo fölött', () => {
  function setup() {
    const billingo = createFakeBillingoFetch({ now: () => new Date(now()) })
    const tarca = createTarca({
      apiKey: 'tarca-teszt-kulcs',
      fetch: billingo.fetch,
      retryDelayMs: 0,
    })
    const handler = stripeWebhook({
      secret: SECRET,
      now,
      onError: () => undefined,
      onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27, recoveryDelayMs: 0 }),
    })
    return { billingo, handler }
  }

  async function deliver(handler: (request: Request) => Promise<Response>, payload: string) {
    return handler(webhookRequest(payload, { 'stripe-signature': await signature(payload) }))
  }

  test('az újraküldött és a kettőzött (más eseményazonosítójú) esemény is egyetlen nyugtát ad', async () => {
    const { billingo, handler } = setup()
    const session = event('checkout.session.completed', SESSION)
    const intent = event(
      'payment_intent.succeeded',
      { id: 'pi_1', object: 'payment_intent', amount_received: 302_300, currency: 'huf' },
      {},
      'evt_2',
    )

    expect((await deliver(handler, session)).status).toBe(200)
    expect((await deliver(handler, session)).status).toBe(200)
    expect((await deliver(handler, intent)).status).toBe(200)

    expect(billingo.count('CreateReceipt')).toBe(1)
    const receipts = [...billingo.data.documents.values()].filter(
      (record) => record.document.type === 'receipt',
    )
    expect(receipts.map((record) => record.vendorId)).toEqual(['STRIPE-pi_1'])
  })

  test('API-kulcs nélkül a Checkout előtt érkező PaymentIntent nem dönt: a céges munkamenet számlát ad, nyugta nélkül', async () => {
    const { billingo, handler } = setup()
    const intent = event(
      'payment_intent.succeeded',
      { id: 'pi_1', object: 'payment_intent', amount_received: 302_300, currency: 'huf' },
      {},
      'evt_2',
    )
    const session = event('checkout.session.completed', {
      ...SESSION,
      customer_details: {
        ...SESSION.customer_details,
        business_name: 'Példa Kft.',
        tax_ids: [{ type: 'hu_tin', value: '12345678-2-41' }],
      },
    })

    expect((await deliver(handler, intent)).status).toBe(200)
    expect((await deliver(handler, session)).status).toBe(200)

    expect(billingo.count('CreateReceipt')).toBe(0)
    expect(billingo.count('CreateDocument')).toBe(1)
    const [issued] = [...billingo.data.documents.values()].filter(
      (record) => record.vendorId === 'STRIPE-pi_1',
    )
    expect(issued?.document.type).toBe('invoice')
  })

  test('a fizetés előtt érkező visszatérítésre 500-at ad, az újraküldés a fizetés után sztornóz', async () => {
    const { billingo, handler } = setup()
    const session = event('checkout.session.completed', SESSION)
    const refund = event(
      'charge.refunded',
      { ...CHARGE, amount_refunded: 302_300, refunded: true },
      { previous_attributes: { amount_refunded: 0 } },
      'evt_refund',
    )
    billingo.fail({ status: 503 }, { operation: 'CreateReceipt', times: 1 })

    expect((await deliver(handler, session)).status).toBe(500)
    expect((await deliver(handler, refund)).status).toBe(500)
    expect((await deliver(handler, session)).status).toBe(200)
    expect((await deliver(handler, refund)).status).toBe(200)

    expect(billingo.count('CancelDocument')).toBe(1)
    const [receipt] = [...billingo.data.documents.values()].filter(
      (record) => record.vendorId === 'STRIPE-pi_1',
    )
    expect(receipt?.document.cancelled).toBe(true)
  })

  test('ha a Billingo bizonytalanul hibázik, 500 után az újraküldés pontosan egy nyugtát ad', async () => {
    const { billingo, handler } = setup()
    const session = event('checkout.session.completed', SESSION)
    billingo.fail({ status: 503 }, { operation: 'CreateReceipt' })

    expect((await deliver(handler, session)).status).toBe(500)
    expect((await deliver(handler, session)).status).toBe(200)

    expect(billingo.count('CreateReceipt')).toBe(2)
    expect(
      [...billingo.data.documents.values()].filter((record) => record.vendorId === 'STRIPE-pi_1'),
    ).toHaveLength(1)
  })

  test('elveszett válasznál is egy nyugta lesz, a visszatérítés pedig egyszer sztornózza', async () => {
    const { billingo, handler } = setup()
    billingo.fail('network', { operation: 'CreateReceipt', afterSuccess: true })
    const refund = event(
      'charge.refunded',
      { ...CHARGE, amount_refunded: 302_300, refunded: true },
      { previous_attributes: { amount_refunded: 0 } },
      'evt_refund',
    )

    expect((await deliver(handler, event('checkout.session.completed', SESSION))).status).toBe(200)
    expect((await deliver(handler, refund)).status).toBe(200)
    expect((await deliver(handler, refund)).status).toBe(200)

    expect(billingo.count('CreateReceipt')).toBe(1)
    expect(billingo.count('CancelDocument')).toBe(1)
  })
})
