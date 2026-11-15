import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockBillingo, type Reply, TEST_API_KEY } from '../../tests/helpers'
import { createContext } from '../core/context'
import { BillingoError } from '../core/errors'
import { createDocumentFilesApi, DEFAULT_PDF_WAIT_MS, type PosPaperSize } from './files'

const ID = 141703673
const PDF_BYTES = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n'), 0, 1, 2])
const PDF_HEADERS = {
  'content-type': 'application/pdf',
  'content-disposition': 'attachment; filename=2026-1.pdf',
  'x-ratelimit-limit': '300',
  'x-ratelimit-remaining': '297',
}
const pdf: Reply = { status: 200, bytes: PDF_BYTES, headers: PDF_HEADERS }
const pos: Reply = {
  status: 200,
  bytes: PDF_BYTES,
  headers: { ...PDF_HEADERS, 'content-type': 'application/octet-stream' },
}
const NOT_READY_MESSAGE = 'Document PDF has not generated yet.'
const notReady: Reply = { status: 202, json: { error: { message: NOT_READY_MESSAGE } } }

function setup(maxAttempts: number, ...replies: Reply[]) {
  const mock = mockBillingo(...replies)
  const context = createContext({
    apiKey: TEST_API_KEY,
    fetch: mock.fetch,
    retryDelayMs: 0,
    maxAttempts,
  })
  return { mock, files: createDocumentFilesApi(context) }
}

function sent(mock: ReturnType<typeof mockBillingo>): string[] {
  return mock.requests.map(
    (request) => `${request.method} ${request.url.pathname}${request.url.search}`,
  )
}

describe('documents.pdf', () => {
  test('a PDF bájtjai, a tartalomtípus és a fájlnév a content-disposition fejlécből', async () => {
    const { mock, files } = setup(1, pdf)

    const file = await files.pdf(ID)

    expect(sent(mock)).toEqual([`GET /v3/documents/${ID}/download`])
    expect(mock.requests[0]?.operation).toBe('DownloadDocument')
    expect(mock.requests[0]?.headers.get('accept')).toContain('application/pdf')
    expect(file).toEqual({
      bytes: PDF_BYTES,
      contentType: 'application/pdf',
      filename: '2026-1.pdf',
    })
  })

  test('a bájtok ArrayBuffer-alapúak: a Response és a Blob közvetlenül megkapja őket', async () => {
    const { files } = setup(1, pdf)

    const file = await files.pdf(ID)
    const response = new Response(file.bytes, { headers: { 'content-type': 'application/pdf' } })
    const blob = new Blob([file.bytes], { type: 'application/pdf' })

    expect(file.bytes.buffer).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PDF_BYTES)
  })

  test('a nem PDF-tel kezdődő választ unexpected_response hibával utasítja el', async () => {
    const html = new TextEncoder().encode('<html>hiba</html>')
    const { files } = setup(1, { status: 200, bytes: html, headers: PDF_HEADERS })

    const error = await files.pdf(ID).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      category: 'unexpected_response',
      operation: 'DownloadDocument',
      retryable: false,
    })
    expect((error as BillingoError).message).toContain('application/pdf, 17 bájt')
  })

  test('a csonka, három bájtos %PD választ sem fogadja el', async () => {
    const { files } = setup(1, { status: 200, bytes: new Uint8Array([0x25, 0x50, 0x44]) })

    await expect(files.pdf(ID)).rejects.toMatchObject({ category: 'unexpected_response' })
  })

  test('nem not_ready hibánál nem vár és nem próbálja újra', async () => {
    const forbidden: Reply = {
      status: 403,
      json: { error: { message: 'You do not have permission for this operation.' } },
    }
    const { mock, files } = setup(1, forbidden)

    await expect(files.pdf(ID)).rejects.toMatchObject({ category: 'forbidden', status: 403 })
    expect(mock.requests).toHaveLength(1)
  })

  test('hibás maxWaitMs-re kérés nélkül RangeError', async () => {
    const { mock, files } = setup(1)

    for (const maxWaitMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(files.pdf(ID, { maxWaitMs })).rejects.toThrow(RangeError)
    }
    expect(mock.requests).toEqual([])
  })
})

describe('documents.pdf: saját, korlátos várakozás a 202-re', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('a 202-t csak a saját várakozás kezeli: 3 kísérletes kliensen is 1, majd 2 mp után kér újra', async () => {
    const { mock, files } = setup(3, notReady, notReady, pdf)

    const running = files.pdf(ID)
    await vi.advanceTimersByTimeAsync(999)
    expect(mock.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(mock.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)

    expect((await running).filename).toBe('2026-1.pdf')
    expect(mock.requests).toHaveLength(3)
  })

  test.each([
    [undefined, DEFAULT_PDF_WAIT_MS, 6],
    [5_000, 5_000, 4],
    [0, 0, 1],
  ] as const)(
    'alapbeállítású kliensen (3 kísérlet, 1 mp visszalépés) a maxWaitMs: %s a teljes várakozás felső határa',
    async (maxWaitMs, elapsed, requests) => {
      const mock = mockBillingo(...Array.from({ length: 30 }, () => notReady))
      const files = createDocumentFilesApi(
        createContext({ apiKey: TEST_API_KEY, fetch: mock.fetch }),
      )
      const startedAt = Date.now()

      const outcome = files
        .pdf(ID, maxWaitMs === undefined ? {} : { maxWaitMs })
        .catch((caught: unknown) => caught)
      await vi.runAllTimersAsync()
      const error = await outcome

      expect(error).toMatchObject({ category: 'not_ready', status: 202 })
      expect((error as BillingoError).message).toContain(`${elapsed} ms várakozás után`)
      expect([Date.now() - startedAt, mock.requests.length]).toEqual([elapsed, requests])
    },
  )

  test('a kérések ideje is beleszámít: 1 mp-es válaszidőnél a határ a maxWaitMs és az utolsó kérés', async () => {
    const mock = mockBillingo(...Array.from({ length: 10 }, () => notReady))
    const slow: typeof globalThis.fetch = async (input, init) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return mock.fetch(input, init)
    }
    const files = createDocumentFilesApi(
      createContext({ apiKey: TEST_API_KEY, fetch: slow, maxAttempts: 1 }),
    )
    const startedAt = Date.now()

    const outcome = files.pdf(ID).catch((caught: unknown) => caught)
    await vi.runAllTimersAsync()

    expect(await outcome).toMatchObject({ category: 'not_ready' })
    expect([Date.now() - startedAt, mock.requests.length]).toEqual([DEFAULT_PDF_WAIT_MS + 1_000, 6])
  })

  test('1 mp várakozás után újra kéri, és a kész PDF-et adja', async () => {
    const { mock, files } = setup(1, notReady, pdf)

    const running = files.pdf(ID)
    await vi.advanceTimersByTimeAsync(0)
    expect(mock.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(mock.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    expect((await running).bytes).toEqual(PDF_BYTES)
    expect(mock.requests).toHaveLength(2)
  })

  test('1, 2, 4, 8 mp, a maradék a maxWaitMs-ig, utána not_ready a Billingo üzenetével', async () => {
    const { mock, files } = setup(1, ...Array.from({ length: 6 }, () => notReady))

    const outcome = files.pdf(ID, { maxWaitMs: 20_000 }).catch((caught: unknown) => caught)
    let now = 0
    for (const [index, at] of [1_000, 3_000, 7_000, 15_000, 20_000].entries()) {
      await vi.advanceTimersByTimeAsync(at - 1 - now)
      expect([at, mock.requests.length]).toEqual([at, 1 + index])
      await vi.advanceTimersByTimeAsync(1)
      expect([at, mock.requests.length]).toEqual([at, 2 + index])
      now = at
    }
    const error = await outcome

    expect(mock.requests).toHaveLength(6)
    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      category: 'not_ready',
      status: 202,
      operation: 'DownloadDocument',
      apiMessage: NOT_READY_MESSAGE,
      retryable: true,
    })
    expect((error as BillingoError).message).toContain(`id: ${ID}`)
    expect((error as BillingoError).message).toContain('20000 ms')
    expect((error as BillingoError).hint).toContain(`documents.pdf(${ID})`)
    const cause = (error as BillingoError).cause as BillingoError
    expect(cause).toMatchObject({ category: 'not_ready', status: 202 })
    expect((error as BillingoError).requestId).toEqual(expect.any(String))
    expect((error as BillingoError).requestId).toBe(cause.requestId)
  })

  test('maxWaitMs nélkül 30 mp a határ: 1, 2, 4, 8, 15 mp várakozás, hat kérés', async () => {
    const { mock, files } = setup(1, ...Array.from({ length: 7 }, () => notReady))

    const outcome = files.pdf(ID).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(DEFAULT_PDF_WAIT_MS - 1)
    expect(mock.requests).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(1)

    expect(DEFAULT_PDF_WAIT_MS).toBe(30_000)
    expect(await outcome).toMatchObject({ category: 'not_ready' })
    expect(mock.requests).toHaveLength(6)
  })

  test('maxWaitMs: 0 esetén egyetlen kérés, várakozás nélkül', async () => {
    const { mock, files } = setup(1, notReady)

    const outcome = files.pdf(ID, { maxWaitMs: 0 }).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(0)

    expect(await outcome).toMatchObject({ category: 'not_ready', status: 202 })
    expect(mock.requests).toHaveLength(1)
  })

  test('a megszakítás a várakozás közben azonnal leállítja, több kérés nem megy ki', async () => {
    const { mock, files } = setup(1, notReady, notReady)
    const controller = new AbortController()

    const outcome = files.pdf(ID, { signal: controller.signal }).catch((caught: unknown) => caught)
    let settled = false
    void outcome.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(500)
    controller.abort(new Error('megszakítva'))
    await vi.advanceTimersByTimeAsync(0)

    expect(settled).toBe(true)
    expect(await outcome).toEqual(new Error('megszakítva'))
    expect(mock.requests).toHaveLength(1)
  })
})

describe('documents.posPdf és publicUrl', () => {
  test('posPdf: a size query paraméter, az application/octet-stream PDF-et is elfogadja', async () => {
    const { mock, files } = setup(1, pos, pos)

    const wide = await files.posPdf(ID, { size: 80 })
    await files.posPdf(ID, { size: 58 })

    expect(sent(mock)).toEqual([
      `GET /v3/documents/${ID}/print/pos?size=80`,
      `GET /v3/documents/${ID}/print/pos?size=58`,
    ])
    expect(mock.requests[0]?.operation).toBe('PosPrint')
    expect(wide).toEqual({
      bytes: PDF_BYTES,
      contentType: 'application/octet-stream',
      filename: '2026-1.pdf',
    })
  })

  test('posPdf: más papírszélességre kérés nélkül validation hiba', async () => {
    const { mock, files } = setup(1)

    const error = await files
      .posPdf(ID, { size: 57 as PosPaperSize })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      category: 'validation',
      operation: 'PosPrint',
      fieldErrors: [{ field: 'size', message: expect.stringContaining('kapott: 57') }],
    })
    expect(mock.requests).toEqual([])
  })

  test('posPdf: nem PDF tartalomra unexpected_response a PosPrint műveletre', async () => {
    const { files } = setup(1, { status: 200, bytes: new TextEncoder().encode('{}') })

    await expect(files.posPdf(ID, { size: 80 })).rejects.toMatchObject({
      category: 'unexpected_response',
      operation: 'PosPrint',
    })
  })

  test('publicUrl: a nyilvános hivatkozás szövegként', async () => {
    const url = 'https://api.billingo.hu/document-access/AbCdEfGhIjKlMnOpQrStUvWxYz012345'
    const { mock, files } = setup(1, { status: 200, json: { public_url: url } })

    expect(await files.publicUrl(ID)).toBe(url)
    expect(sent(mock)).toEqual([`GET /v3/documents/${ID}/public-url`])
  })

  test('publicUrl: hivatkozás nélküli válaszra unexpected_response', async () => {
    const { files } = setup(1, { status: 200, json: {} }, { status: 200, json: { public_url: '' } })

    await expect(files.publicUrl(ID)).rejects.toMatchObject({
      category: 'unexpected_response',
      operation: 'GetPublicUrl',
    })
    await expect(files.publicUrl(ID)).rejects.toMatchObject({ category: 'unexpected_response' })
  })
})
