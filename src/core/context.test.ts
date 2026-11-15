import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createTestContext,
  mockBillingo,
  mockBillingoWithoutContract,
  TEST_API_KEY,
} from '../../tests/helpers'
import {
  createContext,
  filenameFromContentDisposition,
  type HookWarning,
  MAX_ATTEMPTS,
  MAX_RETRY_AFTER_MS,
  MAX_TIMER_MS,
  parseRateLimit,
  parseRetryAfter,
  type RequestEvent,
  resolveApiKey,
  retryDelay,
  sleep,
} from './context'
import { BillingoError } from './errors'

afterEach(() => {
  vi.useRealTimers()
})

async function unhandledRejectionsOf(run: () => Promise<unknown>): Promise<unknown[]> {
  const reasons: unknown[] = []
  const listener = (reason: unknown): void => {
    reasons.push(reason)
  }
  process.on('unhandledRejection', listener)
  try {
    await run()
    await new Promise((resolve) => setTimeout(resolve, 10))
  } finally {
    process.off('unhandledRejection', listener)
  }
  return reasons
}

const BANK_ACCOUNT = { name: 'Fő', accountNumber: '11773016-11111018', currency: 'HUF' }
const SAVED_BANK_ACCOUNT = {
  status: 201,
  json: { id: 5, name: 'Fő', account_number: '11773016-11111018', currency: 'HUF' },
}

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

  test('a 422 minden mezőhibáját megtartja, nem csak az elsőt (P:083)', async () => {
    const errors = [
      { field: 'partner_id', message: 'The partner id field is required.' },
      { field: 'block_id', message: 'The block id field is required.' },
      { field: 'type', message: 'The type field is required.' },
      { field: 'fulfillment_date', message: 'The fulfillment date field is required.' },
      { field: 'due_date', message: 'The due date field is required.' },
      { field: 'payment_method', message: 'The payment method field is required.' },
      { field: 'language', message: 'The language field is required.' },
      { field: 'currency', message: 'The currency field is required.' },
      {
        field: 'conversion_rate',
        message: 'The conversion rate field is required unless currency is in HUF.',
      },
      { field: 'items', message: 'The items field is required.' },
    ]
    const mock = mockBillingoWithoutContract(
      'a P:083 élő próbája szándékosan üres törzset küldött',
      { status: 422, json: { message: 'Validation Failed', errors } },
    )
    const context = createTestContext(mock)

    const error = await context
      .json({ operation: 'CreateDocumentFromDraft', pathParams: { id: 141703701 }, body: {} })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ category: 'validation', status: 422, fieldErrors: errors })
    expect((error as BillingoError).message).toBe(
      `A Billingo elutasította a küldött adatokat. ${errors
        .map((item) => `${item.field}: ${item.message}`)
        .join('; ')}`,
    )
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

  test('olvasást újrapróbál 429 és 5xx után, ugyanazzal a requestId-val', async () => {
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

  test('a 429 Retry-After fejlécét kivárja, akkor is, ha a retryDelayMs 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const mock = mockBillingo(
      {
        status: 429,
        json: { error: { message: 'Too many requests' } },
        headers: { 'retry-after': '2' },
      },
      { status: 200, json: { epoch: 1 } },
    )
    const context = createTestContext(mock)

    const result = context.json({ operation: 'GetServerTime' })
    await vi.advanceTimersByTimeAsync(1_999)
    expect(mock.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toEqual({ epoch: 1 })
    expect(mock.requests).toHaveLength(2)
  })

  test('a maxAttempts felső korlátja 5: nagyobb értékkel is legfeljebb öt kérés megy ki', async () => {
    const down = { status: 503, json: { error: { message: 'down' } } }
    const mock = mockBillingo(...Array.from({ length: 10 }, () => down))
    const context = createContext({
      apiKey: TEST_API_KEY,
      fetch: mock.fetch,
      retryDelayMs: 0,
      maxAttempts: 10,
    })

    await expect(context.json({ operation: 'GetServerTime' })).rejects.toMatchObject({
      category: 'server',
    })
    expect(MAX_ATTEMPTS).toBe(5)
    expect(mock.requests).toHaveLength(5)
  })

  test('a 202-t (a fájl még készül) nem ismétli: arra a documents.pdf maxWaitMs-es várakozása való', async () => {
    const mock = mockBillingo(
      { status: 202, json: { error: { message: 'Document PDF has not generated yet.' } } },
      { status: 200, bytes: new TextEncoder().encode('%PDF-1.4') },
    )
    const context = createTestContext(mock)

    await expect(
      context.binary({ operation: 'DownloadDocument', pathParams: { id: 1 } }),
    ).rejects.toMatchObject({ category: 'not_ready', status: 202, retryable: true })
    expect(mock.requests).toHaveLength(1)
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

  test('a kérés közbeni megszakítást is változatlanul továbbdobja, nem időtúllépésként', async () => {
    const controller = new AbortController()
    let started = 0
    const fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        started += 1
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof globalThis.fetch
    const context = createContext({ apiKey: TEST_API_KEY, fetch })

    const pending = context
      .json({ operation: 'CreateBankAccount', body: BANK_ACCOUNT, signal: controller.signal })
      .catch((caught: unknown) => caught)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(started).toBe(1)
    controller.abort()
    const error = await pending

    expect(error).toBe(controller.signal.reason)
    expect(error).not.toBeInstanceOf(BillingoError)
    expect((error as DOMException).name).toBe('AbortError')
    expect(started).toBe(1)
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

  test('az aszinkron hook elutasítása is onWarning lesz, nem kezeletlen elutasítás', async () => {
    const mock = mockBillingo(SAVED_BANK_ACCOUNT)
    const warnings: HookWarning[] = []
    const context = createTestContext(mock, {
      onResponse: async () => {
        await Promise.resolve()
        throw new Error('a naplózó nem érhető el')
      },
      onWarning: (warning) => warnings.push(warning),
    })
    let saved: unknown

    const unhandled = await unhandledRejectionsOf(async () => {
      saved = await context.json({ operation: 'CreateBankAccount', body: BANK_ACCOUNT })
    })

    expect(saved).toMatchObject({ id: 5 })
    expect(unhandled).toEqual([])
    expect(warnings).toMatchObject([
      {
        hook: 'onResponse',
        operation: 'CreateBankAccount',
        error: new Error('a naplózó nem érhető el'),
      },
    ])
  })

  test('a dobó vagy elutasító onWarning sem töri meg a már sikeres írást', async () => {
    const failingHook = () => {
      throw new Error('hook hiba')
    }
    const throwing = createTestContext(mockBillingo(SAVED_BANK_ACCOUNT), {
      onResponse: failingHook,
      onWarning: () => {
        throw new Error('a figyelmeztetések naplója sem érhető el')
      },
    })
    const rejecting = createTestContext(mockBillingo(SAVED_BANK_ACCOUNT), {
      onRequest: async () => {
        await Promise.resolve()
        throw new Error('hook hiba')
      },
      onWarning: async () => {
        await Promise.resolve()
        throw new Error('a figyelmeztetések naplója sem érhető el')
      },
    })
    const results: unknown[] = []

    const unhandled = await unhandledRejectionsOf(async () => {
      results.push(await throwing.json({ operation: 'CreateBankAccount', body: BANK_ACCOUNT }))
      results.push(await rejecting.json({ operation: 'CreateBankAccount', body: BANK_ACCOUNT }))
    })

    expect(results).toMatchObject([{ id: 5 }, { id: 5 }])
    expect(unhandled).toEqual([])
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

  test('a timeoutMs 1 és 2147483647 közötti egész: a 0 és a túl nagy érték configuration hiba', () => {
    const rejected = [0, 0.5, MAX_TIMER_MS + 1, 2 ** 32, Number.MAX_SAFE_INTEGER, Infinity].map(
      (timeoutMs) => {
        try {
          createContext({ apiKey: 'k', timeoutMs })
          return 'elfogadva'
        } catch (error) {
          return error instanceof BillingoError ? error.category : String(error)
        }
      },
    )

    expect(MAX_TIMER_MS).toBe(2_147_483_647)
    expect(rejected).toEqual(Array.from({ length: 6 }, () => 'configuration'))
    expect(() => createContext({ apiKey: 'k', timeoutMs: 1 })).not.toThrow()
    expect(() => createContext({ apiKey: 'k', timeoutMs: MAX_TIMER_MS })).not.toThrow()
  })

  test('a sleep a 2147483647 ms-nál hosszabb várakozást sem rövidíti 1 ms-ra', async () => {
    const controller = new AbortController()

    const waiting = sleep(MAX_TIMER_MS + 1, controller.signal).then(
      () => 'lejárt',
      () => 'megszakítva',
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()

    expect(await waiting).toBe('megszakítva')
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
