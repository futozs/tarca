import { describe, expect, test } from 'vitest'
import { createTestContext, mockBillingo, TEST_API_KEY } from '../../tests/helpers'
import {
  createContext,
  filenameFromContentDisposition,
  MAX_RETRY_AFTER_MS,
  parseRateLimit,
  parseRetryAfter,
  type RequestEvent,
  resolveApiKey,
  retryDelay,
} from './context'
import { BillingoError } from './errors'

describe('createContext', () => {
  test('X-API-KEY fejléccel, snake_case törzzsel küld, és camelCase választ ad', async () => {
    const mock = mockBillingo({ status: 201, json: { id: 7, account_number: '1177' } })
    const context = createTestContext(mock)

    const result = await context.json<{ id: number; accountNumber: string }>({
      operation: 'CreateBankAccount',
      body: { name: 'Fő', accountNumber: '1177', currency: 'HUF', needQr: true },
    })

    expect(result).toEqual({ id: 7, accountNumber: '1177' })
    const [request] = mock.requests
    expect(request?.method).toBe('POST')
    expect(request?.url.href).toBe('https://api.billingo.hu/v3/bank-accounts')
    expect(request?.headers.get('x-api-key')).toBe(TEST_API_KEY)
    expect(request?.headers.get('content-type')).toBe('application/json')
    expect(request?.body).toEqual({
      name: 'Fő',
      account_number: '1177',
      currency: 'HUF',
      need_qr: true,
    })
  })

  test('kitölti az útvonal paramétereit és a query stringet', async () => {
    const mock = mockBillingo({ status: 200, json: { data: [] } })
    const context = createTestContext(mock)

    await context.json({
      operation: 'ListDocument',
      query: { perPage: 10, partnerId: 3, query: undefined },
    })
    await expect(
      context.json({ operation: 'GetDocument', pathParams: { id: '' } }),
    ).rejects.toThrow('Hiányzik az útvonal paramétere')

    expect(mock.requests[0]?.url.search).toBe('?per_page=10&partner_id=3')
  })

  test('a 204-es válasz üres', async () => {
    const mock = mockBillingo({ status: 204 })
    const context = createTestContext(mock)

    await expect(
      context.empty({ operation: 'DeleteBankAccount', pathParams: { id: 1 } }),
    ).resolves.toBeUndefined()
  })

  test('binárisan adja vissza a PDF-et a tartalomtípussal', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7')
    const mock = mockBillingo({
      status: 200,
      bytes: pdf,
      headers: { 'content-type': 'application/pdf' },
    })
    const context = createTestContext(mock)

    const result = await context.binary({ operation: 'DownloadDocument', pathParams: { id: 1 } })

    expect(result.contentType).toBe('application/pdf')
    expect(new TextDecoder().decode(result.bytes)).toBe('%PDF-1.7')
  })

  test('a bináris válasz fájlneve a Content-Disposition fejlécből jön, fejléc nélkül undefined', async () => {
    const mock = mockBillingo(
      {
        status: 200,
        bytes: new TextEncoder().encode('%PDF-1.4'),
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename=2026-1.pdf',
        },
      },
      { status: 200, bytes: new Uint8Array([1]) },
    )
    const context = createTestContext(mock)

    const named = await context.binary({ operation: 'DownloadDocument', pathParams: { id: 1 } })
    const unnamed = await context.binary({ operation: 'DownloadDocument', pathParams: { id: 2 } })

    expect(named.filename).toBe('2026-1.pdf')
    expect(unnamed).toEqual({
      bytes: new Uint8Array([1]),
      contentType: undefined,
      filename: undefined,
    })
  })

  test('filenameFromContentDisposition: sima, idézőjeles és escape-elt alak, a filename* nem', () => {
    expect(filenameFromContentDisposition('inline; filename=2026_11_15_15_06_59_export.csv')).toBe(
      '2026_11_15_15_06_59_export.csv',
    )
    expect(filenameFromContentDisposition('attachment; FileName = "TRCE 2026-000001.pdf"')).toBe(
      'TRCE 2026-000001.pdf',
    )
    expect(filenameFromContentDisposition('attachment; filename="a \\"b\\".pdf"; size=3')).toBe(
      'a "b".pdf',
    )
    expect(filenameFromContentDisposition('attachment; filename=x.csv ; creation-date=1')).toBe(
      'x.csv',
    )
    expect(filenameFromContentDisposition('filename=elso.pdf')).toBe('elso.pdf')
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''sz%C3%A1mla.pdf")).toBe(
      undefined,
    )
    expect(filenameFromContentDisposition('attachment; myfilename=x.pdf')).toBeUndefined()
    expect(filenameFromContentDisposition('attachment; filename=')).toBeUndefined()
    expect(filenameFromContentDisposition('attachment; filename=""')).toBeUndefined()
    expect(filenameFromContentDisposition('attachment')).toBeUndefined()
    expect(filenameFromContentDisposition(null)).toBeUndefined()
  })

  test('a 422-es hibából mezőszintű magyar hibát készít', async () => {
    const mock = mockBillingo({
      status: 422,
      json: {
        message: 'The given data was invalid.',
        errors: [{ field: 'name', message: 'required' }],
      },
    })
    const context = createTestContext(mock)

    const error = await context
      .json({
        operation: 'CreatePartner',
        body: {
          name: '',
          address: { countryCode: 'HU', postCode: '1011', city: 'Budapest', address: 'Fő utca 1.' },
        },
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      category: 'validation',
      status: 422,
      operation: 'CreatePartner',
      fieldErrors: [{ field: 'name', message: 'required' }],
    })
    expect((error as BillingoError).message).toContain('name: required')
  })

  test('írást soha nem próbál újra, még szerverhibánál sem', async () => {
    const mock = mockBillingo({ status: 500, json: { error: { message: 'boom' } } })
    const context = createTestContext(mock)

    const invoice = {
      partnerId: 1,
      blockId: 2,
      type: 'invoice',
      fulfillmentDate: '2026-11-15',
      dueDate: '2026-11-23',
      paymentMethod: 'wire_transfer',
      language: 'hu',
      currency: 'HUF',
      items: [{ productId: 3, quantity: 1 }],
    }

    await expect(
      context.json({ operation: 'CreateDocument', body: invoice }),
    ).rejects.toMatchObject({
      category: 'server',
      retryable: true,
    })
    expect(mock.requests).toHaveLength(1)
  })

  test('olvasást újrapróbál 429 és 5xx után, a Retry-After figyelembevételével', async () => {
    const mock = mockBillingo(
      {
        status: 429,
        json: { error: { message: 'Too many requests' } },
        headers: { 'retry-after': '0' },
      },
      { status: 503, json: { error: { message: 'down' } } },
      { status: 200, json: { epoch: 1 } },
    )
    const events: RequestEvent[] = []
    const context = createTestContext(mock, { onRequest: (event) => events.push(event) })

    await expect(context.json({ operation: 'GetServerTime' })).resolves.toEqual({ epoch: 1 })
    expect(events.map((event) => event.attempt)).toEqual([1, 2, 3])
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1)
  })

  test('a maxAttempts után feladja, és túl hosszú Retry-After esetén nem vár', async () => {
    const tooLong = String(MAX_RETRY_AFTER_MS / 1000 + 1)
    const mock = mockBillingo(
      { status: 429, json: {}, headers: { 'retry-after': tooLong } },
      { status: 500, json: {} },
      { status: 500, json: {} },
    )
    const context = createTestContext(mock)
    await expect(context.json({ operation: 'GetServerTime' })).rejects.toMatchObject({
      category: 'rate_limit',
      retryAfterMs: (MAX_RETRY_AFTER_MS / 1000 + 1) * 1000,
    })
    expect(mock.requests).toHaveLength(1)

    const limited = createContext({
      apiKey: TEST_API_KEY,
      fetch: mock.fetch,
      retryDelayMs: 0,
      maxAttempts: 2,
    })
    await expect(limited.json({ operation: 'GetServerTime' })).rejects.toMatchObject({
      category: 'server',
    })
    expect(mock.requests).toHaveLength(3)
  })

  test('hálózati hibát és időtúllépést magyar hibává alakít', async () => {
    const mock = mockBillingo(new TypeError('fetch failed'))
    const context = createContext({ apiKey: TEST_API_KEY, fetch: mock.fetch, maxAttempts: 1 })
    await expect(context.json({ operation: 'GetServerTime' })).rejects.toMatchObject({
      category: 'network',
    })

    const slow = createContext({
      apiKey: TEST_API_KEY,
      timeoutMs: 1,
      maxAttempts: 1,
      fetch: ((_: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })) as typeof globalThis.fetch,
    })
    await expect(slow.json({ operation: 'GetServerTime' })).rejects.toMatchObject({
      category: 'timeout',
    })
  })

  test('a hívó megszakítását változatlanul továbbdobja', async () => {
    const controller = new AbortController()
    controller.abort(new Error('mégsem'))
    const mock = mockBillingo({ status: 200, json: {} })
    const context = createTestContext(mock)

    await expect(
      context.json({ operation: 'GetServerTime', signal: controller.signal }),
    ).rejects.toThrow('mégsem')
    expect(mock.requests).toHaveLength(0)
  })

  test('a nem JSON sikeres válasz unexpected_response hiba', async () => {
    const mock = mockBillingo({ status: 200, bytes: new TextEncoder().encode('<html>') })
    const context = createTestContext(mock)

    const error = await context.json({ operation: 'GetServerTime' }).catch((caught) => caught)

    expect(error).toMatchObject({
      category: 'unexpected_response',
      status: 200,
      retryable: false,
      message: 'A Billingo válasza nem értelmezhető JSON.',
      cause: expect.any(SyntaxError),
    })
  })

  test('az üres sikeres törzs JSON helyett unexpected_response hiba, nem undefined', async () => {
    const mock = mockBillingo(
      { status: 200 },
      { status: 200, bytes: new TextEncoder().encode(' \n') },
    )
    const context = createTestContext(mock)

    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await context.json({ operation: 'GetServerTime' }).catch((caught) => caught)
      expect(error).toBeInstanceOf(BillingoError)
      expect(error).toMatchObject({
        category: 'unexpected_response',
        status: 200,
        operation: 'GetServerTime',
        message: 'A Billingo válasza üres (HTTP 200), pedig JSON törzset vártunk.',
      })
    }
    expect(mock.requests).toHaveLength(2)
  })

  test('írásnál az üres vagy hibás törzs hibája figyelmeztet, hogy a művelet megtörténhetett', async () => {
    const mock = mockBillingo(
      { status: 201 },
      { status: 201, bytes: new TextEncoder().encode('{"id":') },
    )
    const context = createTestContext(mock)
    const create = () =>
      context
        .json({
          operation: 'CreateBankAccount',
          body: { name: 'Fő', accountNumber: '11773016-11111018', currency: 'HUF' },
        })
        .catch((caught: unknown) => caught)

    const empty = await create()
    const broken = await create()

    expect(empty).toMatchObject({ category: 'unexpected_response', status: 201, retryable: false })
    expect(broken).toMatchObject({ category: 'unexpected_response', status: 201 })
    for (const error of [empty, broken]) {
      expect((error as BillingoError).message).toContain(
        'A művelet a Billingo oldalán ettől még végrehajtódhatott: ne ismételd meg vakon',
      )
    }
    expect((empty as BillingoError).message).toMatch(/^A Billingo válasza üres \(HTTP 201\)/)
    expect(mock.requests).toHaveLength(2)
  })

  test('a hookok hibája nem töri meg a kérést, hanem onWarning lesz belőle', async () => {
    const mock = mockBillingo({ status: 200, json: {} })
    const warnings: string[] = []
    const context = createTestContext(mock, {
      onResponse: () => {
        throw new Error('hook hiba')
      },
      onWarning: (warning) => warnings.push(`${warning.hook}:${warning.operation}`),
    })

    await expect(context.json({ operation: 'GetServerTime' })).resolves.toEqual({})
    expect(warnings).toEqual(['onResponse:GetServerTime'])
  })

  test('a nem BillingoError hibát újrapróbálás nélkül továbbadja', async () => {
    const mock = mockBillingo({ status: 200, json: {} })
    const outcomes: string[] = []
    const context = createTestContext(mock, {
      onComplete: (event) => outcomes.push(event.outcome),
    })

    await expect(
      context.json({ operation: 'CreateBankAccount', body: { amount: 1n } }),
    ).rejects.toThrow(TypeError)
    expect(outcomes).toEqual(['error'])
  })
})

describe('beállítások', () => {
  test('a kulcsot az opcióból vagy a BILLINGO_API_KEY változóból veszi', () => {
    const previous = process.env.BILLINGO_API_KEY
    try {
      delete process.env.BILLINGO_API_KEY
      expect(() => resolveApiKey({})).toThrow('Hiányzik a Billingo API kulcs')
      process.env.BILLINGO_API_KEY = ' kornyezeti '
      expect(resolveApiKey({})).toBe('kornyezeti')
      expect(resolveApiKey({ apiKey: ' sajat ' })).toBe('sajat')
    } finally {
      if (previous === undefined) delete process.env.BILLINGO_API_KEY
      else process.env.BILLINGO_API_KEY = previous
    }
  })

  test('elutasítja a hibás számszerű beállításokat', () => {
    expect(() => createContext({ apiKey: 'k', maxAttempts: 0 })).toThrow('maxAttempts')
    expect(() => createContext({ apiKey: 'k', timeoutMs: -1 })).toThrow('timeoutMs')
    expect(() => createContext({ apiKey: 'k', retryDelayMs: Number.NaN })).toThrow('retryDelayMs')
    expect(() =>
      createContext({ apiKey: 'k', fetch: 'nem fetch' as unknown as typeof fetch }),
    ).toThrow('fetch')
  })
})

describe('fejlécek értelmezése', () => {
  test('a Retry-After lehet másodperc vagy HTTP dátum', () => {
    const now = Date.parse('2026-11-15T12:00:00Z')
    expect(parseRetryAfter(null, now)).toBeUndefined()
    expect(parseRetryAfter('3', now)).toBe(3000)
    expect(parseRetryAfter('Sun, 15 Nov 2026 12:00:05 GMT', now)).toBe(5000)
    expect(parseRetryAfter('Sun, 15 Nov 2026 11:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('később', now)).toBeUndefined()
  })

  test('a rate limit fejlécekből csak a számokat veszi át', () => {
    expect(parseRateLimit(new Headers())).toBeUndefined()
    expect(
      parseRateLimit(
        new Headers({
          'x-ratelimit-limit': '300',
          'x-ratelimit-remaining': 'sok',
          'x-ratelimit-reset': '1700000000',
        }),
      ),
    ).toEqual({ limit: 300, remaining: undefined, resetAt: new Date(1_700_000_000_000) })
  })

  test('a visszalépés exponenciális, jitterrel', () => {
    expect(retryDelay(1000, 1, 0.5)).toBe(1000)
    expect(retryDelay(1000, 3, 0.5)).toBe(4000)
    expect(retryDelay(1000, 1, 0)).toBe(800)
    expect(retryDelay(1000, 1, 1)).toBe(1200)
  })
})
