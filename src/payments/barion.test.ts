import { describe, expect, test, vi } from 'vitest'
import { createTarca } from '../client'
import type { KeyValueStore } from '../core/store'
import { createFakeBillingoFetch } from '../testing'
import {
  BARION_SANDBOX_API_URL,
  barionPaymentEvent,
  barionPaymentId,
  barionWebhook,
  fetchBarionPaymentState,
} from './barion'
import { PaymentProviderError } from './errors'
import { issueForPayment, paymentVendorId } from './issue'

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

function webhookRequest(
  body: string,
  headers: Record<string, string> = {},
  url = 'https://bolt.example.hu/api/barion',
): Request {
  return new Request(url, { method: 'POST', body, headers })
}

const POS_KEY = 'barion-pos-kulcs'
const PAYMENT_ID = 'b6e8c5a0c8a5ed11bc2b001dd8b71cc5'

function huf(value: number) {
  return { value, minor: value * 100, currency: 'HUF' }
}

function shopTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    TransactionId: 'tr-shop-1',
    POSTransactionId: 'WEB-1001-1',
    TransactionTime: '2026-10-02T10:00:05',
    Total: 3023,
    Currency: 'HUF',
    Payer: {
      Name: { LoginName: 'eva@pelda.hu', FirstName: 'Éva', LastName: 'Kovács' },
      Email: 'eva@pelda.hu',
    },
    Payee: { Name: { LoginName: 'bolt@pelda.hu' }, Email: 'bolt@pelda.hu' },
    Status: 'Succeeded',
    TransactionType: 'CardPayment',
    Items: [
      {
        Name: 'Kávé',
        Description: 'Pörkölt kávé',
        Quantity: 2,
        Unit: 'db',
        UnitPrice: 890,
        ItemTotal: 1780,
        SKU: 'KAVE',
      },
      { Name: 'Kifli', Quantity: 1, Unit: 'db', UnitPrice: 1243, ItemTotal: 1243 },
    ],
    ...overrides,
  }
}

function paymentState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PaymentId: PAYMENT_ID,
    PaymentRequestId: 'REQ-1001',
    OrderNumber: 'WEB-1001',
    POSId: 'pos-1',
    Status: 'Succeeded',
    PaymentType: 'Immediate',
    FundingSource: 'Bankcard',
    CompletedAt: '2026-10-02T10:00:07',
    Total: 3023,
    Currency: 'HUF',
    Transactions: [
      shopTransaction(),
      {
        TransactionId: 'tr-fee',
        POSTransactionId: 'WEB-1001-1',
        Total: 45,
        Currency: 'HUF',
        Status: 'Succeeded',
        TransactionType: 'CardProcessingFee',
        Items: [{ Name: 'Díj', Quantity: 1, ItemTotal: 45 }],
      },
    ],
    Errors: [],
    ...overrides,
  }
}

function refund(total: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    TransactionId: `tr-refund-${total}`,
    POSTransactionId: 'WEB-1001-1',
    Total: -total,
    Currency: 'HUF',
    Status: 'Succeeded',
    TransactionType: 'RefundToBankCard',
    RelatedId: 'tr-shop-1',
    Items: [],
    ...overrides,
  }
}

describe('barionPaymentId', () => {
  test('a query stringből, a form és a JSON törzsből is kiolvassa', () => {
    expect(barionPaymentId(`https://bolt.example.hu/barion?paymentId=${PAYMENT_ID}`)).toBe(
      PAYMENT_ID,
    )
    expect(barionPaymentId(`https://bolt.example.hu/barion?PaymentId=${PAYMENT_ID}`)).toBe(
      PAYMENT_ID,
    )
    expect(
      barionPaymentId(
        'https://bolt.example.hu/barion',
        `paymentId=${PAYMENT_ID}`,
        'application/x-www-form-urlencoded',
      ),
    ).toBe(PAYMENT_ID)
    expect(
      barionPaymentId('https://bolt.example.hu/barion', `{"PaymentId":"${PAYMENT_ID}"}`, null),
    ).toBe(PAYMENT_ID)
  })

  test('hiányzó vagy hibás törzsnél undefined-ot ad', () => {
    expect(barionPaymentId('https://bolt.example.hu/barion')).toBeUndefined()
    expect(
      barionPaymentId('https://bolt.example.hu/barion', '{nem json', 'application/json'),
    ).toBeUndefined()
    expect(barionPaymentId('https://bolt.example.hu/barion', 'masik=1')).toBeUndefined()
  })
})

describe('fetchBarionPaymentState', () => {
  test('a v4 PaymentState végpontot hívja GET-tel, x-pos-key fejléccel', async () => {
    const api = routedFetch([[/PaymentState$/, () => jsonResponse(paymentState())]])
    const state = await fetchBarionPaymentState(PAYMENT_ID, { posKey: POS_KEY, fetch: api.fetch })
    expect(state.PaymentId).toBe(PAYMENT_ID)
    expect(api.requests[0]?.url).toBe(
      `https://api.barion.com/v4/Payment/${PAYMENT_ID}/PaymentState`,
    )
    expect(api.requests[0]?.headers.get('x-pos-key')).toBe(POS_KEY)
    expect(api.requests[0]?.method).toBe('GET')
  })

  test('a teszt környezetet és az egyedi URL-t is kezeli', async () => {
    const api = routedFetch([[/./, () => jsonResponse(paymentState())]])
    await fetchBarionPaymentState(PAYMENT_ID, { posKey: POS_KEY, sandbox: true, fetch: api.fetch })
    await fetchBarionPaymentState(PAYMENT_ID, {
      posKey: POS_KEY,
      apiUrl: 'http://localhost:9000/',
      fetch: api.fetch,
    })
    expect(api.requests.map((request) => request.url)).toEqual([
      `${BARION_SANDBOX_API_URL}/v4/Payment/${PAYMENT_ID}/PaymentState`,
      `http://localhost:9000/v4/Payment/${PAYMENT_ID}/PaymentState`,
    ])
  })

  test('a Barion hibakódjait a hibaüzenetbe teszi, a szabad szöveges leírást nem', async () => {
    const api = routedFetch([
      [
        /./,
        () =>
          jsonResponse(
            {
              Errors: [
                {
                  ErrorCode: 'AuthenticationFailed',
                  Title: 'Hibás POSKey',
                  Description: 'vevo@pelda.hu',
                },
              ],
            },
            400,
          ),
      ],
    ])
    const failure = await fetchBarionPaymentState(PAYMENT_ID, {
      posKey: POS_KEY,
      fetch: api.fetch,
    }).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      name: 'PaymentProviderError',
      status: 400,
      message: expect.stringContaining('AuthenticationFailed'),
    })
    expect(String((failure as Error).message)).not.toContain('vevo@pelda.hu')
    expect(String((failure as Error).message)).not.toContain(POS_KEY)
  })

  test('200-as válasz hibalistával, nem JSON válasz és hálózati hiba is hibát dob', async () => {
    const withErrors = routedFetch([[/./, () => jsonResponse({ Errors: [{}] })]])
    await expect(
      fetchBarionPaymentState(PAYMENT_ID, { posKey: POS_KEY, fetch: withErrors.fetch }),
    ).rejects.toMatchObject({ message: expect.stringContaining('ismeretlen hiba') })
    const notJson = routedFetch([[/./, () => new Response('<html>')]])
    await expect(
      fetchBarionPaymentState(PAYMENT_ID, { posKey: POS_KEY, fetch: notJson.fetch }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
    const offline = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(
      fetchBarionPaymentState(PAYMENT_ID, { posKey: POS_KEY, fetch: offline }),
    ).rejects.toBeInstanceOf(PaymentProviderError)
  })
})

describe('barionPaymentEvent', () => {
  test('a sikeres fizetésből tételes fizetést készít, a díjtranzakciót kihagyja', () => {
    expect(barionPaymentEvent(paymentState())).toEqual({
      provider: 'barion',
      kind: 'paid',
      id: PAYMENT_ID,
      eventId: `${PAYMENT_ID}:Succeeded:0`,
      eventType: 'Succeeded',
      orderRef: 'WEB-1001',
      amount: huf(3023),
      refundedAmount: undefined,
      refunds: undefined,
      paidAt: '2026-10-02T10:00:07',
      method: 'barion',
      customer: {
        name: 'Kovács Éva',
        email: 'eva@pelda.hu',
        phone: undefined,
        isBusiness: undefined,
      },
      items: [
        { name: 'Kávé', quantity: 2, totalGross: huf(1780), unit: 'db', sku: 'KAVE' },
        { name: 'Kifli', quantity: 1, totalGross: huf(1243), unit: 'db', sku: undefined },
      ],
      raw: paymentState(),
    })
  })

  test('a kereskedői tranzakcióazonosító nélküli (Barion-belső) tranzakciót nem veszi eladásnak', () => {
    const internal = {
      TransactionId: 'tr-internal',
      Total: 500,
      Currency: 'HUF',
      Status: 'Succeeded',
      TransactionType: 'Shop',
      Items: [{ Name: 'Belső', Quantity: 1, ItemTotal: 500 }],
    }
    const state = paymentState({
      Transactions: [...(paymentState().Transactions as unknown[]), internal],
    })
    expect(barionPaymentEvent(state)).toMatchObject({
      amount: huf(3023),
      items: [
        expect.objectContaining({ name: 'Kávé' }),
        expect.objectContaining({ name: 'Kifli' }),
      ],
    })
  })

  test('a vevő nevét nem a bejelentkezési névből (e-mail címből) képzi', () => {
    const state = paymentState({
      Transactions: [shopTransaction({ Payer: { Name: { LoginName: 'eva@pelda.hu' } } })],
    })
    expect(barionPaymentEvent(state).customer?.name).toBeUndefined()
  })

  test('cégnévnél a cég nevét és az isBusiness jelzést adja', () => {
    const state = paymentState({
      Transactions: [
        shopTransaction({
          Payer: { Name: { OrganizationName: 'Példa Kft.' }, Email: 'x@pelda.hu' },
        }),
      ],
    })
    expect(barionPaymentEvent(state).customer).toMatchObject({
      name: 'Példa Kft.',
      isBusiness: true,
    })
  })

  test('egyetlen teljes visszatérítésből refunded eseményt ad', () => {
    const state = paymentState({ Transactions: [shopTransaction(), refund(3023)] })
    expect(barionPaymentEvent(state)).toMatchObject({
      kind: 'refunded',
      refundedAmount: huf(3023),
      eventId: `${PAYMENT_ID}:Succeeded:1`,
      includesPayment: true,
      amount: huf(3023),
    })
    expect(barionPaymentEvent(paymentState()).includesPayment).toBeUndefined()
  })

  test('a részleges és a több részletben teljes visszatérítést részlegesnek jelöli, egész minor unitban hasonlít', () => {
    expect(
      barionPaymentEvent(paymentState({ Transactions: [shopTransaction(), refund(1000)] })).kind,
    ).toBe('partially-refunded')
    expect(
      barionPaymentEvent(
        paymentState({ Transactions: [shopTransaction(), refund(1000), refund(2023)] }),
      ).kind,
    ).toBe('partially-refunded')
    expect(
      barionPaymentEvent(paymentState({ Transactions: [shopTransaction(), refund(3022.99)] })).kind,
    ).toBe('partially-refunded')
  })

  test('a visszatérítéseket időrendben, a korábbi összeggel tételesen átadja', () => {
    const state = paymentState({
      Transactions: [
        shopTransaction(),
        refund(2023, { TransactionTime: '2026-10-04T10:00:00Z' }),
        refund(1000, { TransactionTime: '2026-10-03T10:00:00Z' }),
      ],
    })
    expect(barionPaymentEvent(state).refunds).toEqual([
      {
        id: 'tr-refund-1000',
        amount: huf(1000),
        refundedBefore: huf(0),
        createdAt: '2026-10-03T10:00:00Z',
      },
      {
        id: 'tr-refund-2023',
        amount: huf(2023),
        refundedBefore: huf(1000),
        createdAt: '2026-10-04T10:00:00Z',
      },
    ])
  })

  test('azonosító nélküli visszatérítésnél nem ad tételes listát', () => {
    const state = paymentState({
      Transactions: [
        shopTransaction(),
        refund(1000, { TransactionId: undefined, POSTransactionId: undefined }),
      ],
    })
    expect(barionPaymentEvent(state).refunds).toBeUndefined()
    expect(barionPaymentEvent(paymentState()).refunds).toBeUndefined()
  })

  test('a nem sikeres visszatérítést nem veszi figyelembe', () => {
    const state = paymentState({
      Transactions: [shopTransaction(), refund(3023, { Status: 'Rejected' })],
    })
    expect(barionPaymentEvent(state).kind).toBe('paid')
  })

  test('a sikertelen és a folyamatban lévő állapotokat felismeri', () => {
    for (const status of ['Canceled', 'Failed', 'Expired']) {
      expect(barionPaymentEvent(paymentState({ Status: status, Transactions: [] })).kind).toBe(
        'failed',
      )
    }
    for (const status of ['Prepared', 'Started', 'InProgress', 'Reserved', 'PartiallySucceeded']) {
      expect(barionPaymentEvent(paymentState({ Status: status })).kind).toBe('other')
    }
    expect(barionPaymentEvent(paymentState({ Status: undefined })).kind).toBe('other')
  })

  test('saját tranzakció nélkül a fizetés teljes összegét használja', () => {
    const state = paymentState({ Transactions: [], Total: 5000 })
    expect(barionPaymentEvent(state)).toMatchObject({ amount: huf(5000), items: undefined })
  })

  test('a banki átutalást wire_transfer-ként jelöli, a többit barion-ként, az opció felülírja', () => {
    expect(barionPaymentEvent(paymentState({ FundingSource: 'GooglePay' })).method).toBe('barion')
    expect(barionPaymentEvent(paymentState({ FundingSource: 'BankTransfer' })).method).toBe(
      'wire_transfer',
    )
    expect(barionPaymentEvent(paymentState({ FundingSource: 'Balance' })).method).toBe('barion')
    expect(barionPaymentEvent(paymentState(), { method: 'bankcard' }).method).toBe('bankcard')
  })

  test('hiányzó PaymentId-ra és ItemTotal-ra PaymentProviderError-t dob', () => {
    expect(() => barionPaymentEvent(paymentState({ PaymentId: '' }))).toThrow(PaymentProviderError)
    const state = paymentState({ Transactions: [shopTransaction({ Items: [{ Name: 'X' }] })] })
    expect(() => barionPaymentEvent(state)).toThrow(PaymentProviderError)
  })

  test('a fizetés és a visszatérítése ugyanarra a vendorId-ra képződik', async () => {
    const paid = barionPaymentEvent(paymentState())
    const refunded = barionPaymentEvent(
      paymentState({ Transactions: [shopTransaction(), refund(3023)] }),
    )
    expect(await paymentVendorId(paid)).toBe(`BARION-${PAYMENT_ID}`)
    expect(await paymentVendorId(refunded)).toBe(`BARION-${PAYMENT_ID}`)
  })
})

describe('barionWebhook', () => {
  test('a callback után lekérdezi az állapotot, és 200-at ad', async () => {
    const api = routedFetch([[/PaymentState$/, () => jsonResponse(paymentState())]])
    const onPayment = vi.fn()
    const handler = barionWebhook({ posKey: POS_KEY, fetch: api.fetch, onPayment })

    const response = await handler(
      webhookRequest(`paymentId=${PAYMENT_ID}`, {
        'content-type': 'application/x-www-form-urlencoded',
      }),
    )

    expect(response.status).toBe(200)
    expect(onPayment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'paid', id: PAYMENT_ID }),
    )
  })

  test('kötőjeles azonosítót is elfogad, ha a Barion ugyanazt adja vissza', async () => {
    const dashed = 'b6e8c5a0-c8a5-ed11-bc2b-001dd8b71cc5'
    const api = routedFetch([[/./, () => jsonResponse(paymentState())]])
    const handler = barionWebhook({ posKey: POS_KEY, fetch: api.fetch, onPayment: vi.fn() })
    const response = await handler(
      webhookRequest('', {}, `https://bolt.example.hu/barion?paymentId=${dashed}`),
    )
    expect(response.status).toBe(200)
  })

  test('hiányzó vagy érvénytelen paymentId-ra 400-at ad, lekérdezés nélkül', async () => {
    const api = routedFetch([[/./, () => jsonResponse(paymentState())]])
    const handler = barionWebhook({ posKey: POS_KEY, fetch: api.fetch, onPayment: vi.fn() })
    expect((await handler(webhookRequest(''))).status).toBe(400)
    expect((await handler(webhookRequest('paymentId=../../admin'))).status).toBe(400)
    expect(api.requests).toHaveLength(0)
  })

  test('ha a Barion más fizetést ad vissza, 500-at ad', async () => {
    const api = routedFetch([
      [/./, () => jsonResponse(paymentState({ PaymentId: '00000000000000000000000000000000' }))],
    ])
    const onPayment = vi.fn()
    const onError = vi.fn()
    const handler = barionWebhook({ posKey: POS_KEY, fetch: api.fetch, onPayment, onError })
    expect((await handler(webhookRequest(`paymentId=${PAYMENT_ID}`))).status).toBe(500)
    expect(onPayment).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(PaymentProviderError))
  })

  test('ha a fizetés callbackje elbukott, és közben visszatérítés jött, az újraküldött callback előbb kiállítja a fizetés bizonylatát', async () => {
    const billingo = createFakeBillingoFetch({ now: () => new Date('2026-10-02T10:00:00Z') })
    const tarca = createTarca({
      apiKey: 'tarca-teszt-kulcs',
      fetch: billingo.fetch,
      retryDelayMs: 0,
    })
    const values = new Map<string, string>()
    const ledger: KeyValueStore = {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value)
      },
      delete: (key) => {
        values.delete(key)
      },
      setIfAbsent: (key, value) => {
        if (values.has(key)) return false
        values.set(key, value)
        return true
      },
    }
    let state = paymentState()
    const api = routedFetch([[/PaymentState$/, () => jsonResponse(state)]])
    const handler = barionWebhook({
      posKey: POS_KEY,
      fetch: api.fetch,
      onError: () => undefined,
      onPayment: (payment) =>
        issueForPayment(tarca, payment, {
          vat: 27,
          recoveryDelayMs: 0,
          ledger,
          partner: {
            name: 'Példa Kft.',
            address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
            taxcode: '12345678-2-42',
            taxType: 'HAS_TAX_NUMBER',
          },
        }),
    })
    const callback = () => handler(webhookRequest(`paymentId=${PAYMENT_ID}`))
    billingo.fail({ status: 503 }, { operation: 'CreateDocument', times: 1 })

    expect((await callback()).status).toBe(500)
    state = paymentState({ Transactions: [shopTransaction(), refund(1000)] })
    const partial = await callback()
    const again = await callback()
    state = paymentState({ Transactions: [shopTransaction(), refund(1000), refund(2023)] })
    const rest = await callback()

    expect([partial.status, again.status, rest.status]).toEqual([200, 200, 200])
    const records = [...billingo.data.documents.values()]
    expect(
      records
        .filter((record) => record.document.type === 'invoice')
        .map((record) => record.vendorId),
    ).toEqual([`BARION-${PAYMENT_ID}`])
    const documents = records.map((record) => record.document)
    expect(
      documents
        .filter((document) => document.type === 'modification')
        .map((document) => document.grossTotal)
        .sort(),
    ).toEqual([-1000, -2023])
  })

  test('ha a fizetés callbackje elbukott, a teljes visszatérítés előbb kiállítja, majd sztornózza a bizonylatot', async () => {
    const billingo = createFakeBillingoFetch({ now: () => new Date('2026-10-02T10:00:00Z') })
    const tarca = createTarca({
      apiKey: 'tarca-teszt-kulcs',
      fetch: billingo.fetch,
      retryDelayMs: 0,
    })
    const event = barionPaymentEvent(
      paymentState({ Transactions: [shopTransaction(), refund(3023)] }),
    )

    const first = await issueForPayment(tarca, event, { vat: 27, recoveryDelayMs: 0 })
    const second = await issueForPayment(tarca, event, { vat: 27, recoveryDelayMs: 0 })

    expect(event.kind).toBe('refunded')
    expect(first).toMatchObject({ kind: 'cancellation', document: 'receipt', created: true })
    expect(second).toMatchObject({ kind: 'cancellation', created: false })
    expect(billingo.count('CreateReceipt')).toBe(1)
    expect(billingo.count('CancelDocument')).toBe(1)
    expect(
      [...billingo.data.documents.values()].find(
        (record) => record.vendorId === `BARION-${PAYMENT_ID}`,
      )?.document,
    ).toMatchObject({ type: 'receipt', cancelled: true })
  })

  test('POSKey nélkül létrehozáskor TypeError-t dob', () => {
    expect(() => barionWebhook({ posKey: ' ', onPayment: vi.fn() })).toThrow(TypeError)
  })
})
