import { describe, expect, test, vi } from 'vitest'
import { PaymentProviderError, WebhookVerificationError } from './errors'
import { paymentVendorId } from './issue'
import {
  parseSimplePayIpn,
  querySimplePayTransaction,
  SIMPLEPAY_SANDBOX_API_URL,
  type SimplePayTransaction,
  simplePayIpnResponse,
  simplePayPaymentEvent,
  simplePayRequest,
  simplePaySignature,
  simplePayWebhook,
  verifySimplePayRedirect,
  verifySimplePaySignature,
} from './simplepay'
import type { PaymentEvent } from './types'

interface RecordedRequest {
  readonly url: string
  readonly headers: Headers
  readonly body: string
}

function routedFetch(routes: ReadonlyArray<readonly [RegExp, () => Response | Promise<Response>]>) {
  const requests: RecordedRequest[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    requests.push({ url: request.url, headers: request.headers, body: await request.text() })
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

function webhookRequest(body: string, headers: Record<string, string>): Request {
  return new Request('https://bolt.example.hu/api/simplepay', { method: 'POST', body, headers })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const KEY = 'FxDa5w314kLlNseq2sKuVwaqZshZT5d6'
const SZEP_KEY = 'szep-titkos-kulcs'
const RECEIVED_AT = new Date('2026-10-02T08:30:00Z')

const IPN = JSON.stringify({
  salt: '223G0O18VAqdLhQYbJz73adT36YzLtak',
  orderRef: '101010515363456734591',
  method: 'CARD',
  merchant: 'PUBLICTESTHUF',
  finishDate: '2026-10-02T10:29:58+02:00',
  paymentDate: '2026-10-02T10:29:40+02:00',
  transactionId: 99310118,
  status: 'FINISHED',
})

function huf(value: number) {
  return { value, minor: value * 100, currency: 'HUF' }
}

function detailedTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    salt: 'FNoR545Lw2kUQdQOXXy7sJWPBGu4h5T9',
    merchant: 'PUBLICTESTHUF',
    orderRef: '101010515363456734591',
    currency: 'HUF',
    customer: 'v2 START Tester',
    customerEmail: 'sdk_test@otpmobil.com',
    language: 'HU',
    twoStep: false,
    total: 2540.0,
    shippingCost: 0.0,
    discount: 0.0,
    invoice: {
      company: '',
      country: 'hu',
      state: 'Budapest',
      city: 'Budapest',
      zip: '1111',
      address: 'Address 1',
      address2: '',
      phone: '06203164978',
      lname: 'SimplePay V2 Tester',
    },
    transactionId: 99310118,
    status: 'FINISHED',
    resultCode: 'OK',
    remainingTotal: 0.0,
    paymentDate: '2026-10-02T10:29:40+02:00',
    finishDate: '2026-10-02T10:29:58+02:00',
    method: 'CARD',
    ...overrides,
  }
}

async function signedJson(body: unknown, key = KEY): Promise<Response> {
  const text = JSON.stringify(body)
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json', signature: await simplePaySignature(text, key) },
  })
}

function simplePayApi(transactions: unknown[], key = KEY) {
  return routedFetch([
    [
      /\/query$/,
      () =>
        signedJson(
          {
            salt: 'sNWsKj5sDsQUSlc4LqjliAH3unCG4Mt3',
            merchant: 'PUBLICTESTHUF',
            transactions,
            totalCount: transactions.length,
          },
          key,
        ),
    ],
  ])
}

describe('simplePaySignature', () => {
  test('a SimplePay dokumentáció hivatalos tesztvektorát adja (HMAC-SHA384, base64)', async () => {
    const message =
      '{"merchant":"P000001","orderRef":"1234567890A","sdkVersion":"1.1","salt":"árvíztűrőtükörfúrógép__ÁÉÍÓÖŐÚÜŰ"}'
    expect(await simplePaySignature(message, 'ABC1234444')).toBe(
      'pIytnScMV+18KYrUJSYC4lWdv/Tu6lCxEqWxfZZL20v0XxPajA1vv0ELSzLV+Btp',
    )
  })

  test('a kulcs körüli szóközöket levágja', async () => {
    expect(await simplePaySignature('{}', ` ${KEY}\n`)).toBe(await simplePaySignature('{}', KEY))
  })
})

describe('verifySimplePaySignature', () => {
  test('a helyes aláírást elfogadja, a szóközzé torzult pluszjelet is', async () => {
    const valid = await simplePaySignature(IPN, KEY)
    await expect(verifySimplePaySignature(IPN, valid, KEY)).resolves.toBeUndefined()
    await expect(
      verifySimplePaySignature(IPN, valid.replace(/\+/g, ' '), KEY),
    ).resolves.toBeUndefined()
  })

  test('hiányzó és hibás aláírásra hibát dob', async () => {
    await expect(verifySimplePaySignature(IPN, null, KEY)).rejects.toMatchObject({
      reason: 'missing_signature',
    })
    await expect(verifySimplePaySignature(IPN, 'rossz', KEY)).rejects.toMatchObject({
      reason: 'invalid_signature',
      provider: 'simplepay',
    })
  })
})

describe('parseSimplePayIpn', () => {
  test('kiolvassa a SimplePay IPN mezőit, a számot stringként adja', () => {
    expect(parseSimplePayIpn(IPN)).toMatchObject({
      merchant: 'PUBLICTESTHUF',
      orderRef: '101010515363456734591',
      transactionId: '99310118',
      status: 'FINISHED',
      method: 'CARD',
      finishDate: '2026-10-02T10:29:58+02:00',
    })
  })

  test('hiányzó kötelező mezőre invalid_payload hibát dob', () => {
    expect(() => parseSimplePayIpn('{"merchant":"X","orderRef":"1"}')).toThrow(
      WebhookVerificationError,
    )
  })
})

describe('simplePayIpnResponse', () => {
  test('a receiveDate mezőt az utolsó záró kapcsos zárójel elé szúrja, budapesti idővel, és aláírja', async () => {
    const response = await simplePayIpnResponse(IPN, KEY, RECEIVED_AT)
    expect(response.body).toBe(`${IPN.slice(0, -1)},"receiveDate":"2026-10-02T10:30:00+02:00"}`)
    expect(JSON.parse(response.body)).toMatchObject({ status: 'FINISHED' })
    expect(response.signature).toBe(await simplePaySignature(response.body, KEY))
  })

  test('beágyazott objektumnál is érvényes JSON-t ad', async () => {
    const nested = '{"a":{"b":1},"c":[{"d":2}]}\n'
    const response = await simplePayIpnResponse(nested, KEY, RECEIVED_AT)
    expect(JSON.parse(response.body)).toEqual({
      a: { b: 1 },
      c: [{ d: 2 }],
      receiveDate: '2026-10-02T10:30:00+02:00',
    })
  })

  test('üres objektumhoz vessző nélkül fűz', async () => {
    const response = await simplePayIpnResponse('{ }', KEY, RECEIVED_AT)
    expect(response.body).toBe('{"receiveDate":"2026-10-02T10:30:00+02:00"}')
  })

  test('alapértelmezésben az aktuális időt használja', async () => {
    const response = await simplePayIpnResponse(IPN, KEY)
    expect(JSON.parse(response.body).receiveDate).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    )
  })
})

describe('simplePayRequest és querySimplePayTransaction', () => {
  test('aláírt, perjelet escapelő kérést küld, és ellenőrzi a válasz aláírását', async () => {
    const api = simplePayApi([detailedTransaction()])
    const transaction = await querySimplePayTransaction('99310118', {
      merchant: 'PUBLICTESTHUF',
      secretKey: KEY,
      fetch: api.fetch,
    })
    const request = api.requests[0]
    expect(request?.url).toBe('https://secure.simplepay.hu/payment/v2/query')
    expect(request?.headers.get('signature')).toBe(
      await simplePaySignature(request?.body ?? '', KEY),
    )
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({
      transactionIds: ['99310118'],
      detailed: true,
      refunds: true,
      merchant: 'PUBLICTESTHUF',
      sdkVersion: 'tarca',
      salt: expect.stringMatching(/^[0-9a-f]{32}$/),
    })
    expect(transaction).toMatchObject({
      transactionId: '99310118',
      status: 'FINISHED',
      total: huf(2540),
      remainingTotal: huf(0),
      refunds: [],
      customer: {
        name: 'SimplePay V2 Tester',
        email: 'sdk_test@otpmobil.com',
        phone: '06203164978',
        address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Address 1' },
      },
    })
  })

  test('a kérés törzsében a perjeleket escapeli, a sandbox URL-t használja', async () => {
    const api = routedFetch([[/./, () => signedJson({ ok: true })]])
    await simplePayRequest(
      'query',
      { orderRefs: ['A/1'] },
      { merchant: 'M', secretKey: KEY, sandbox: true, fetch: api.fetch },
    )
    expect(api.requests[0]?.url).toBe(`${SIMPLEPAY_SANDBOX_API_URL}/query`)
    expect(api.requests[0]?.body).toContain('"A\\/1"')
  })

  test('céges számlázási adatnál a cégnevet és az isBusiness jelzést adja', async () => {
    const api = simplePayApi([
      detailedTransaction({ invoice: { company: 'Példa Kft.', city: 'Budapest', zip: '1111' } }),
    ])
    const transaction = await querySimplePayTransaction('99310118', {
      merchant: 'PUBLICTESTHUF',
      secretKey: KEY,
      fetch: api.fetch,
    })
    expect(transaction?.customer).toMatchObject({ name: 'Példa Kft.', isBusiness: true })
  })

  test('a nem egyező tranzakcióazonosítót nem adja vissza', async () => {
    const api = simplePayApi([detailedTransaction({ transactionId: 1 })])
    await expect(
      querySimplePayTransaction('99310118', { merchant: 'M', secretKey: KEY, fetch: api.fetch }),
    ).resolves.toBeUndefined()
  })

  test('errorCodes, aláírási és HTTP hibára PaymentProviderError-t dob', async () => {
    const errorCodes = routedFetch([[/./, () => jsonResponse({ errorCodes: ['5000', '5110'] })]])
    await expect(
      simplePayRequest('query', {}, { merchant: 'M', secretKey: KEY, fetch: errorCodes.fetch }),
    ).rejects.toMatchObject({ message: expect.stringContaining('5000, 5110') })
    const unsigned = routedFetch([[/./, () => jsonResponse({ transactions: [] })]])
    await expect(
      simplePayRequest('query', {}, { merchant: 'M', secretKey: KEY, fetch: unsigned.fetch }),
    ).rejects.toMatchObject({ message: expect.stringContaining('aláírása') })
    const wrongKey = routedFetch([[/./, () => signedJson({ transactions: [] }, 'masik-kulcs')]])
    await expect(
      simplePayRequest('query', {}, { merchant: 'M', secretKey: KEY, fetch: wrongKey.fetch }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
    const httpError = routedFetch([[/./, () => new Response('hiba', { status: 503 })]])
    await expect(
      simplePayRequest('query', {}, { merchant: 'M', secretKey: KEY, fetch: httpError.fetch }),
    ).rejects.toMatchObject({ status: 503 })
    const notJson = routedFetch([[/./, () => new Response('nem json')]])
    await expect(
      simplePayRequest('query', {}, { merchant: 'M', secretKey: KEY, fetch: notJson.fetch }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
    const offline = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(
      simplePayRequest('query', {}, { merchant: 'M', secretKey: KEY, fetch: offline }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
  })
})

describe('simplePayPaymentEvent', () => {
  const ipn = parseSimplePayIpn(IPN)
  const refundIpn = parseSimplePayIpn(IPN.replace('"FINISHED"', '"REFUND"'))
  const transaction = (overrides: Partial<SimplePayTransaction> = {}): SimplePayTransaction => ({
    transactionId: '99310118',
    status: 'FINISHED',
    total: huf(2540),
    remainingTotal: huf(0),
    refunds: [],
    raw: {},
    ...overrides,
  })

  test('a FINISHED IPN-ből fizetést készít a lekérdezett összeggel, simple_pay móddal', () => {
    expect(simplePayPaymentEvent(ipn, { transaction: transaction() })).toMatchObject({
      provider: 'simplepay',
      kind: 'paid',
      id: '99310118',
      eventId: '99310118:FINISHED',
      orderRef: '101010515363456734591',
      amount: huf(2540),
      paidAt: '2026-10-02T10:29:58+02:00',
      method: 'simple_pay',
    })
  })

  test('lekérdezés nélkül összeg nélkül adja, az átutalást wire_transfer-ként, a SZÉP-kártyát külön jelöli', () => {
    expect(simplePayPaymentEvent(ipn).amount).toBeUndefined()
    const wire = parseSimplePayIpn(IPN.replace('"CARD"', '"WIRE"'))
    expect(simplePayPaymentEvent(wire).method).toBe('wire_transfer')
    expect(simplePayPaymentEvent(ipn, { method: 'szep_card' }).method).toBe('szep_card')
  })

  test('a REFUND státuszt a visszatérítések alapján, egész minor unitban teljesnek vagy részlegesnek jelöli', () => {
    expect(
      simplePayPaymentEvent(refundIpn, {
        transaction: transaction({ refunds: [{ total: huf(2540), status: 'FINISHED' }] }),
      }),
    ).toMatchObject({ kind: 'refunded', refundedAmount: huf(2540) })
    expect(
      simplePayPaymentEvent(refundIpn, {
        transaction: transaction({
          refunds: [
            { total: { value: 2539.99, minor: 253_999, currency: 'HUF' }, status: 'FINISHED' },
          ],
        }),
      }).kind,
    ).toBe('partially-refunded')
    expect(
      simplePayPaymentEvent(refundIpn, {
        transaction: transaction({
          refunds: [
            { total: huf(1000), status: 'FINISHED' },
            { total: huf(1540), status: 'FINISHED' },
          ],
        }),
      }).kind,
    ).toBe('partially-refunded')
    expect(
      simplePayPaymentEvent(refundIpn, {
        transaction: transaction({ remainingTotal: huf(1540), refunds: [{ total: huf(1000) }] }),
      }).kind,
    ).toBe('partially-refunded')
    expect(
      simplePayPaymentEvent(refundIpn, {
        transaction: transaction({ remainingTotal: huf(1), refunds: [{ total: huf(2540) }] }),
      }).kind,
    ).toBe('partially-refunded')
    expect(simplePayPaymentEvent(refundIpn).kind).toBe('partially-refunded')
    expect(
      simplePayPaymentEvent(refundIpn, { transaction: transaction({ total: undefined }) }).kind,
    ).toBe('partially-refunded')
  })

  test('a befejezett visszatérítéseket időrendben, tételesen adja, az eventId visszatérítésenként egyedi', () => {
    const first = transaction({
      refunds: [{ transactionId: '501', total: huf(1000), status: 'FINISHED', date: '2026-10-03' }],
    })
    const second = transaction({
      refunds: [
        { transactionId: '502', total: huf(540), status: 'FINISHED', date: '2026-10-04' },
        { transactionId: '501', total: huf(1000), status: 'FINISHED', date: '2026-10-03' },
        { transactionId: '503', total: huf(100), status: 'PENDING', date: '2026-10-05' },
      ],
    })

    const firstEvent = simplePayPaymentEvent(refundIpn, { transaction: first })
    const secondEvent = simplePayPaymentEvent(refundIpn, { transaction: second })

    expect(secondEvent.refunds).toEqual([
      { id: '501', amount: huf(1000), refundedBefore: huf(0), createdAt: '2026-10-03' },
      { id: '502', amount: huf(540), refundedBefore: huf(1000), createdAt: '2026-10-04' },
    ])
    expect(firstEvent.eventId).not.toBe(secondEvent.eventId)
    expect(simplePayPaymentEvent(refundIpn).eventId).toBeUndefined()
    expect(simplePayPaymentEvent(refundIpn).refunds).toBeUndefined()
    expect(simplePayPaymentEvent(ipn).eventId).toBe(`${ipn.transactionId}:FINISHED`)
    expect(
      simplePayPaymentEvent(refundIpn, {
        transaction: transaction({ refunds: [{ total: huf(1000), status: 'FINISHED' }] }),
      }).refunds,
    ).toBeUndefined()
  })

  test('a sikertelen és a köztes státuszokat felismeri', () => {
    for (const status of ['NOTAUTHORIZED', 'FRAUD', 'TIMEOUT', 'CANCELLED', 'REVERSED']) {
      const failed = parseSimplePayIpn(IPN.replace('"FINISHED"', `"${status}"`))
      expect(simplePayPaymentEvent(failed).kind).toBe('failed')
    }
    const authorized = parseSimplePayIpn(IPN.replace('"FINISHED"', '"AUTHORIZED"'))
    expect(simplePayPaymentEvent(authorized).kind).toBe('other')
  })

  test('a fizetés és a visszatérítése ugyanarra a vendorId-ra képződik', async () => {
    expect(await paymentVendorId(simplePayPaymentEvent(ipn))).toBe('SIMPLEPAY-99310118')
    expect(await paymentVendorId(simplePayPaymentEvent(refundIpn))).toBe('SIMPLEPAY-99310118')
  })
})

describe('simplePayWebhook', () => {
  async function deliver(
    handler: (request: Request) => Promise<Response>,
    body: string,
    key = KEY,
  ): Promise<Response> {
    return handler(webhookRequest(body, { signature: await simplePaySignature(body, key) }))
  }

  test('ellenőrzi az IPN-t, lekérdezi az összeget, és aláírt visszhanggal válaszol', async () => {
    const api = simplePayApi([detailedTransaction()])
    const payments: PaymentEvent[] = []
    const handler = simplePayWebhook({
      secretKey: KEY,
      fetch: api.fetch,
      now: () => RECEIVED_AT,
      onPayment: (payment) => {
        payments.push(payment)
      },
    })

    const response = await deliver(handler, IPN)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('signature')).toBe(await simplePaySignature(body, KEY))
    expect(JSON.parse(body)).toMatchObject({
      transactionId: 99310118,
      receiveDate: '2026-10-02T10:30:00+02:00',
    })
    expect(payments[0]).toMatchObject({ kind: 'paid', amount: huf(2540) })
  })

  test('kereskedőnként más kulcsot és fizetési módot használ (HUF, SZÉP)', async () => {
    const szepIpn = IPN.replace('PUBLICTESTHUF', 'SZEP114606')
    const api = simplePayApi([detailedTransaction({ merchant: 'SZEP114606' })], SZEP_KEY)
    const onPayment = vi.fn()
    const handler = simplePayWebhook({
      merchants: {
        PUBLICTESTHUF: KEY,
        SZEP114606: { secretKey: SZEP_KEY, method: 'szep_card' },
      },
      fetch: api.fetch,
      onPayment,
    })
    const response = await deliver(handler, szepIpn, SZEP_KEY)
    expect(response.status).toBe(200)
    expect(onPayment).toHaveBeenCalledWith(expect.objectContaining({ method: 'szep_card' }))
    expect(JSON.parse(api.requests[0]?.body ?? '{}').merchant).toBe('SZEP114606')
  })

  test('ismeretlen kereskedőre és hibás aláírásra 400-at ad, a kereskedő nevének visszaírása nélkül', async () => {
    const onPayment = vi.fn()
    const handler = simplePayWebhook({ merchants: { MASIK: KEY }, onPayment })
    const unknown = await deliver(handler, IPN)
    expect(unknown.status).toBe(400)
    expect(await unknown.text()).not.toContain('PUBLICTESTHUF')
    const signed = simplePayWebhook({ secretKey: KEY, onPayment })
    const response = await signed(webhookRequest(IPN, { signature: 'rossz' }))
    expect(response.status).toBe(400)
    expect(onPayment).not.toHaveBeenCalled()
  })

  test('az Object.prototype nevű kereskedőt is ismeretlenként kezeli: 400, onError nélkül', async () => {
    const onPayment = vi.fn()
    const onError = vi.fn()
    const handler = simplePayWebhook({ merchants: { MASIK: KEY }, onPayment, onError })
    for (const merchant of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const response = await deliver(handler, IPN.replace('PUBLICTESTHUF', merchant))
      expect(response.status).toBe(400)
    }
    expect(onError).not.toHaveBeenCalled()
    expect(onPayment).not.toHaveBeenCalled()
  })

  test('a visszhangot a kereskedő saját kulcsával írja alá, nem az alapértelmezettel', async () => {
    const szepIpn = IPN.replace('PUBLICTESTHUF', 'SZEP114606')
    const api = simplePayApi([detailedTransaction({ merchant: 'SZEP114606' })], SZEP_KEY)
    const handler = simplePayWebhook({
      secretKey: KEY,
      merchants: { SZEP114606: { secretKey: SZEP_KEY, method: 'szep_card' } },
      fetch: api.fetch,
      onPayment: vi.fn(),
    })

    const response = await deliver(handler, szepIpn, SZEP_KEY)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('signature')).toBe(await simplePaySignature(body, SZEP_KEY))
  })

  test('ha a lekérdezés nem találja a tranzakciót, 500-at ad', async () => {
    const api = simplePayApi([])
    const onError = vi.fn()
    const handler = simplePayWebhook({
      secretKey: KEY,
      fetch: api.fetch,
      onError,
      onPayment: vi.fn(),
    })
    expect((await deliver(handler, IPN)).status).toBe(500)
    expect(onError).toHaveBeenCalledWith(expect.any(PaymentProviderError))
  })

  test('fetchDetails: false mellett és nem fizetési státusznál nem kérdez le', async () => {
    const api = simplePayApi([])
    const onPayment = vi.fn()
    const handler = simplePayWebhook({
      secretKey: KEY,
      fetch: api.fetch,
      fetchDetails: false,
      onPayment,
    })
    expect((await deliver(handler, IPN)).status).toBe(200)
    const authorized = simplePayWebhook({ secretKey: KEY, fetch: api.fetch, onPayment })
    expect((await deliver(authorized, IPN.replace('"FINISHED"', '"AUTHORIZED"'))).status).toBe(200)
    expect(api.requests).toHaveLength(0)
    expect(onPayment).toHaveBeenCalledTimes(2)
  })

  test('kulcs nélkül, üres kulccsal vagy ismeretlen fizetési móddal létrehozáskor TypeError-t dob', () => {
    expect(() => simplePayWebhook({ onPayment: vi.fn() })).toThrow(TypeError)
    expect(() => simplePayWebhook({ secretKey: ' ', onPayment: vi.fn() })).toThrow(TypeError)
    expect(() =>
      simplePayWebhook({ merchants: { M: { secretKey: '' } }, onPayment: vi.fn() }),
    ).toThrow(TypeError)
    expect(() =>
      simplePayWebhook({
        merchants: { M: { secretKey: KEY, method: 'szep' as unknown as 'szep_card' } },
        onPayment: vi.fn(),
      }),
    ).toThrow(TypeError)
  })
})

describe('verifySimplePayRedirect', () => {
  async function redirectUrl(payload: Record<string, unknown>, key = KEY): Promise<string> {
    const json = JSON.stringify(payload)
    const r = encodeURIComponent(bytesToBase64(new TextEncoder().encode(json)))
    const s = encodeURIComponent(await simplePaySignature(json, key))
    return `https://bolt.example.hu/back?r=${r}&s=${s}`
  }

  const BACK = { r: 0, t: 99310118, e: 'SUCCESS', m: 'PUBLICTESTHUF', o: '101010515363456734591' }

  test('ellenőrzi az aláírást, és kiolvassa az eredményt', async () => {
    await expect(verifySimplePayRedirect(await redirectUrl(BACK), KEY)).resolves.toEqual({
      responseCode: 0,
      transactionId: '99310118',
      event: 'SUCCESS',
      merchant: 'PUBLICTESTHUF',
      orderRef: '101010515363456734591',
    })
  })

  test('URL, URLSearchParams és kereskedőnkénti kulcs is működik', async () => {
    const url = new URL(await redirectUrl(BACK))
    await expect(verifySimplePayRedirect(url, { PUBLICTESTHUF: KEY })).resolves.toMatchObject({
      event: 'SUCCESS',
    })
    await expect(verifySimplePayRedirect(url.searchParams, KEY)).resolves.toMatchObject({
      responseCode: 0,
    })
    await expect(verifySimplePayRedirect(url.search.slice(1), KEY)).resolves.toMatchObject({
      transactionId: '99310118',
    })
  })

  test('a szóközzé alakult pluszjeleket visszaállítja, az ékezetet UTF-8-ként olvassa', async () => {
    const json = JSON.stringify({ ...BACK, o: 'ő>?~' })
    const r = bytesToBase64(new TextEncoder().encode(json)).replace(/\+/g, ' ')
    const s = (await simplePaySignature(json, KEY)).replace(/\+/g, ' ')
    const params = new URLSearchParams()
    params.set('r', r)
    params.set('s', s)
    await expect(verifySimplePayRedirect(params, KEY)).resolves.toMatchObject({ orderRef: 'ő>?~' })
  })

  test('hibás, hiányos vagy idegen visszairányításra hibát dob', async () => {
    await expect(
      verifySimplePayRedirect('https://bolt.example.hu/back', KEY),
    ).rejects.toMatchObject({ reason: 'invalid_payload' })
    await expect(verifySimplePayRedirect('r=%25%25%25&s=x', KEY)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    )
    await expect(
      verifySimplePayRedirect(await redirectUrl({ r: 0, t: 1 }), KEY),
    ).rejects.toMatchObject({ reason: 'invalid_payload' })
    await expect(
      verifySimplePayRedirect(await redirectUrl(BACK), { MASIK: KEY }),
    ).rejects.toMatchObject({ reason: 'verification_failed' })
    for (const m of ['constructor', 'toString', '__proto__']) {
      await expect(
        verifySimplePayRedirect(await redirectUrl({ ...BACK, m }), { MASIK: KEY }),
      ).rejects.toMatchObject({ reason: 'verification_failed' })
    }
    await expect(
      verifySimplePayRedirect(await redirectUrl(BACK, 'masik'), KEY),
    ).rejects.toMatchObject({ reason: 'invalid_signature' })
  })
})
