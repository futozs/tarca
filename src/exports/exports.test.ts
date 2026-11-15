import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestContext, mockBillingo } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { BillingoError } from '../core/errors'
import { createExportsApi, DEFAULT_EXPORT_WAIT_MS, type ExportInput } from './exports'

const EXPORT_ID = 'd25d7614-e0fd-11f1-908e-06964df6fe25'
const BOM = [0xef, 0xbb, 0xbf]
const CSV = new Uint8Array([...BOM, ...new TextEncoder().encode('"Számla sorszáma";Kelt\n')])
const CSV_HEADERS = {
  'content-type': 'text/csv; charset=UTF-8',
  'content-disposition': 'inline; filename=2026_11_15_15_06_59_export.csv',
  'x-ratelimit-limit': '300',
  'x-ratelimit-remaining': '286',
}

const INPUT: ExportInput = {
  queryType: 'invoice_date',
  startDate: new Date('2026-11-14T23:30:00Z'),
  endDate: '2026-11-15',
  exportType: 'simple_csv',
}

const FULL_INPUT: ExportInput = {
  ...INPUT,
  documentBlockId: 348455,
  numberStartYear: 2026,
  numberStartSequence: 1,
  numberEndYear: 2026,
  numberEndSequence: 99,
  paymentMethod: 'wire_transfer',
  sortBy: 'invoice_raw_number',
  otherOptions: 'outstanding',
  filterExtra: {
    ledgerNumber: { bevetel: '911', vevo: '311', penztar: '381', afa: '467' },
    useGrossValues: true,
    rlbKata: false,
  },
}

const created = { status: 201, json: { id: EXPORT_ID } }
const state = (value: string, message = '') => ({
  status: 200,
  json: { id: EXPORT_ID, state: value, message },
})
const csv = { status: 200, bytes: CSV, headers: CSV_HEADERS }

function setup(...replies: Parameters<typeof mockBillingo>) {
  const mock = mockBillingo(...replies)
  return { mock, exports: createExportsApi(createTestContext(mock)) }
}

function sent(mock: ReturnType<typeof mockBillingo>): string[] {
  return mock.requests.map((request) => `${request.method} ${request.url.pathname}`)
}

describe('exports: create, poll, download', () => {
  test('create: budapesti dátumok, snake_case törzs, a válasz UUID azonosítója', async () => {
    const { mock, exports } = setup(created)

    expect(await exports.create(INPUT)).toEqual({ id: EXPORT_ID })
    expect(sent(mock)).toEqual(['POST /v3/document-export'])
    expect(mock.requests[0]?.operation).toBe('Create')
    expect(mock.requests[0]?.body).toEqual({
      query_type: 'invoice_date',
      start_date: '2026-11-15',
      end_date: '2026-11-15',
      export_type: 'simple_csv',
    })
  })

  test('create és run: hibás dátumra kérés nélkül validation hiba mezőnként', async () => {
    const { mock, exports } = setup()

    const created = await exports
      .create({ ...INPUT, startDate: '2026-11-31', endDate: '2026-13-01' })
      .catch((caught: unknown) => caught)
    const run = await exports
      .run({ ...INPUT, startDate: '2026.11.01' })
      .catch((caught: unknown) => caught)

    expect(created).toBeInstanceOf(BillingoError)
    expect(created).toMatchObject({
      category: 'validation',
      operation: 'Create',
      fieldErrors: [
        { field: 'startDate', message: 'Nem létező naptári dátum: 2026-11-31' },
        { field: 'endDate', message: 'Nem létező naptári dátum: 2026-13-01' },
      ],
    })
    expect(run).toMatchObject({
      category: 'validation',
      fieldErrors: [{ field: 'startDate', message: expect.stringContaining('2026.11.01') }],
    })
    expect(mock.requests).toEqual([])
  })

  test('create: azonosító nélküli 201-re unexpected_response, ami szól, hogy az export elindulhatott', async () => {
    const { exports } = setup({ status: 201, json: {} })

    const error = await exports.create(INPUT).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      category: 'unexpected_response',
      status: 201,
      operation: 'Create',
      retryable: false,
    })
    expect((error as BillingoError).message).toContain('elindulhatott')
  })

  test('poll: az állapot a UUID útvonalon', async () => {
    const { mock, exports } = setup(state('processing'))

    expect(await exports.poll(EXPORT_ID)).toEqual({
      id: EXPORT_ID,
      state: 'processing',
      message: '',
    })
    expect(sent(mock)).toEqual([`GET /v3/document-export/${EXPORT_ID}/poll`])
    expect(mock.requests[0]?.operation).toBe('Poll')
  })

  test('download: text/csv tartalomtípust is elfogad, a BOM megmarad, a fájlnév a fejlécből jön', async () => {
    const { mock, exports } = setup(csv)

    const file = await exports.download(EXPORT_ID)

    expect(sent(mock)).toEqual([`GET /v3/document-export/${EXPORT_ID}/download`])
    expect(mock.requests[0]?.operation).toBe('Download')
    expect(file.contentType).toBe('text/csv; charset=UTF-8')
    expect(file.filename).toBe('2026_11_15_15_06_59_export.csv')
    expect([...file.bytes.slice(0, 3)]).toEqual(BOM)
    expect(new TextDecoder().decode(file.bytes)).toBe('"Számla sorszáma";Kelt\n')
  })
})

describe('exports.run', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('létrehoz, korlátos visszalépéssel pollol (1, 1, 2 mp), és a sikeres exportot letölti', async () => {
    const { mock, exports } = setup(
      created,
      state('pending'),
      state('processing'),
      state('success'),
      csv,
    )

    const running = exports.run(INPUT)
    await vi.advanceTimersByTimeAsync(0)
    expect(mock.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(mock.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(mock.requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(mock.requests).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(mock.requests).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    const result = await running

    expect(sent(mock)).toEqual([
      'POST /v3/document-export',
      `GET /v3/document-export/${EXPORT_ID}/poll`,
      `GET /v3/document-export/${EXPORT_ID}/poll`,
      `GET /v3/document-export/${EXPORT_ID}/poll`,
      `GET /v3/document-export/${EXPORT_ID}/download`,
    ])
    expect(result).toEqual({
      id: EXPORT_ID,
      state: 'success',
      message: undefined,
      bytes: CSV,
      contentType: 'text/csv; charset=UTF-8',
      filename: '2026_11_15_15_06_59_export.csv',
    })
  })

  test('a várakozás 5 mp-nél nem nő tovább, és a maxWaitMs határán még egyszer pollol', async () => {
    const pending = Array.from({ length: 7 }, () => state('pending'))
    const { mock, exports } = setup(created, ...pending)

    const outcome = exports.run(INPUT, { maxWaitMs: 20_000 }).catch((caught: unknown) => caught)
    let now = 0
    for (const [index, pollAt] of [1_000, 2_000, 4_000, 8_000, 13_000, 18_000, 20_000].entries()) {
      await vi.advanceTimersByTimeAsync(pollAt - 1 - now)
      expect([pollAt, mock.requests.length]).toEqual([pollAt, 1 + index])
      await vi.advanceTimersByTimeAsync(1)
      expect([pollAt, mock.requests.length]).toEqual([pollAt, 2 + index])
      now = pollAt
    }
    const error = await outcome

    expect(mock.requests).toHaveLength(8)
    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({ category: 'not_ready', operation: 'Poll', retryable: true })
    expect((error as BillingoError).message).toContain(EXPORT_ID)
    expect((error as BillingoError).message).toContain('20000 ms')
    expect((error as BillingoError).hint).toContain(`exports.download('${EXPORT_ID}')`)
  })

  test('maxWaitMs nélkül 60 mp a határ', async () => {
    const pending = Array.from({ length: 15 }, () => state('pending'))
    const { mock, exports } = setup(created, ...pending)

    const outcome = exports.run(INPUT).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(DEFAULT_EXPORT_WAIT_MS - 1)
    expect(mock.requests).toHaveLength(1 + 14)
    await vi.advanceTimersByTimeAsync(1)

    expect(DEFAULT_EXPORT_WAIT_MS).toBe(60_000)
    expect(await outcome).toMatchObject({ category: 'not_ready' })
    expect(mock.requests).toHaveLength(1 + 15)
  })

  test('maxWaitMs: 0 esetén egyszer, azonnal pollol', async () => {
    const done = setup(created, state('success'), csv)
    const waiting = setup(created, state('pending'))

    const result = done.exports.run(INPUT, { maxWaitMs: 0 })
    const error = waiting.exports.run(INPUT, { maxWaitMs: 0 }).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(0)

    expect((await result).state).toBe('success')
    expect(await error).toMatchObject({ category: 'not_ready' })
    expect(waiting.mock.requests).toHaveLength(2)
  })

  test('warning állapotban is letölt, és visszaadja a figyelmeztetést', async () => {
    const { mock, exports } = setup(created, state('warning', 'Nincs találat'), csv)

    const running = exports.run(INPUT)
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await running

    expect(result).toMatchObject({ state: 'warning', message: 'Nincs találat', id: EXPORT_ID })
    expect(mock.requests).toHaveLength(3)
  })

  test('fail állapotban hibát ad a Billingo üzenetével, és nem tölt le', async () => {
    const failed = setup(created, state('fail', 'Export failed'))
    const silent = setup(created, state('fail'))

    const error = failed.exports.run(INPUT).catch((caught: unknown) => caught)
    const quiet = silent.exports.run(INPUT).catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await error).toBeInstanceOf(BillingoError)
    expect(await error).toMatchObject({
      category: 'server',
      operation: 'Poll',
      apiMessage: 'Export failed',
    })
    expect(((await error) as BillingoError).message).toContain(`id: ${EXPORT_ID}) (Export failed)`)
    expect(await quiet).toMatchObject({ apiMessage: undefined })
    expect(((await quiet) as BillingoError).message).toContain(`(id: ${EXPORT_ID}).`)
    expect(failed.mock.requests).toHaveLength(2)
  })

  test('a megszakítás a várakozás közben azonnal leállítja, több kérés nem megy ki', async () => {
    const { mock, exports } = setup(created, state('pending'), state('pending'))
    const controller = new AbortController()

    const outcome = exports
      .run(INPUT, { signal: controller.signal })
      .catch((caught: unknown) => caught)
    let settled = false
    void outcome.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(1_500)
    controller.abort(new Error('megszakítva'))
    await vi.advanceTimersByTimeAsync(0)

    expect(settled).toBe(true)
    expect(await outcome).toEqual(new Error('megszakítva'))
    expect(mock.requests).toHaveLength(2)
  })

  test('hibás maxWaitMs-re kérés nélkül RangeError', async () => {
    const { mock, exports } = setup()

    for (const maxWaitMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(exports.run(INPUT, { maxWaitMs })).rejects.toThrow(RangeError)
    }
    expect(mock.requests).toEqual([])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('az export kérése a friss Billingo spec ellen', () => {
  test('a minimális és a minden szűrőt tartalmazó törzs is megfelel a CreateDocumentExport sémának', async () => {
    const { mock, exports } = setup(created, created)

    await exports.create(INPUT)
    await exports.create(FULL_INPUT)

    expect(requestErrors('Create', mock.requests[0]?.body)).toEqual([])
    expect(requestErrors('Create', mock.requests[1]?.body)).toEqual([])
    expect(mock.requests[1]?.body).toMatchObject({
      document_block_id: 348455,
      filter_extra: { ledger_number: { bevetel: '911' }, use_gross_values: true },
    })
  })
})
