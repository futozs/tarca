import { describe, expect, test, vi } from 'vitest'
import {
  createFakeExchangeLog,
  fakeExchangeSpecErrors,
  succeededOperations,
} from '../../../tests/fake-exchanges'
import { loadMergedSpec, SPEC_AVAILABLE } from '../../../tests/openapi'
import {
  EXPORT_NOT_FINISHED,
  EXPORT_NOT_FOUND,
  EXPORT_TYPES,
  exportRoutes,
  SIMPLE_CSV_HEADER,
} from './exports'

const log = createFakeExchangeLog()

const NOW = new Date('2026-11-15T14:06:59Z')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REQUEST = {
  query_type: 'invoice_date',
  start_date: '2026-11-15',
  end_date: '2026-11-15',
  export_type: 'simple_csv',
}

function harness() {
  return log.harness({ now: () => NOW })
}

async function createExport(call: ReturnType<typeof harness>['call']): Promise<string> {
  const created = await call('POST', '/document-export', REQUEST)
  return (created.body as { id: string }).id
}

describe('hamis Billingo: export', () => {
  test('létrehozás: 201 egyetlen UUID string azonosítóval, mint élőben', async () => {
    const { call, billingo } = harness()

    const created = await call('POST', '/document-export', { ...REQUEST, document_block_id: 1 })

    expect(created.status).toBe(201)
    expect(Object.keys(created.body as object)).toEqual(['id'])
    expect((created.body as { id: string }).id).toMatch(UUID)
    expect([...billingo.data.documentExports.values()]).toEqual([
      {
        id: (created.body as { id: string }).id,
        queryType: 'invoice_date',
        startDate: '2026-11-15',
        endDate: '2026-11-15',
        exportType: 'simple_csv',
        documentBlockId: 1,
        polls: 0,
      },
    ])
  })

  test('az állapot pending-ből success-re vált, a letöltés előtte 404, utána BOM-os CSV', async () => {
    const { call } = harness()
    const id = await createExport(call)

    const early = await call('GET', `/document-export/${id}/download`)
    const first = await call('GET', `/document-export/${id}/poll`)
    const notYet = await call('GET', `/document-export/${id}/download`)
    const second = await call('GET', `/document-export/${id}/poll`)
    const third = await call('GET', `/document-export/${id}/poll`)
    const file = await call('GET', `/document-export/${id}/download`)

    expect(early).toMatchObject({ status: 404, body: { error: { message: EXPORT_NOT_FINISHED } } })
    expect(first.body).toEqual({ id, state: 'pending', message: '' })
    expect(notYet.status).toBe(404)
    expect(second.body).toEqual({ id, state: 'success', message: '' })
    expect(third.body).toEqual({ id, state: 'success', message: '' })
    expect(file.status).toBe(200)
    expect(file.contentType).toBe('text/csv; charset=UTF-8')
    expect(file.headers.get('content-disposition')).toBe(
      'inline; filename=2026_11_15_15_06_59_export.csv',
    )
    expect([...file.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.bytes)
    expect(text).toBe(`﻿${SIMPLE_CSV_HEADER.join(';')}\n`)
    expect(text.startsWith('﻿"Számla sorszáma";"Kapcsolódó számla";Kelt;')).toBe(true)
  })

  test('ismeretlen azonosító: poll és letöltés 404', async () => {
    const { call } = harness()

    const poll = await call('GET', '/document-export/nincs-ilyen/poll')
    const download = await call('GET', '/document-export/nincs-ilyen/download')

    expect([poll.status, poll.body]).toEqual([404, { error: { message: EXPORT_NOT_FOUND } }])
    expect([download.status, download.body]).toEqual([
      404,
      { error: { message: EXPORT_NOT_FOUND } },
    ])
  })

  test('validáció: kötelező mezők, enumok, dátumformátum; a nem CSV formátum 501', async () => {
    const { call, billingo } = harness()

    const empty = await call('POST', '/document-export', {})
    const wrong = await call('POST', '/document-export', {
      query_type: 'kelt',
      start_date: '2026-11-31',
      end_date: '15/11/2026',
      export_type: 'csv',
      document_block_id: 'egy',
    })
    const excel = await call('POST', '/document-export', {
      ...REQUEST,
      export_type: 'simple_excel',
    })

    expect(empty.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'query_type', message: 'The query type field is required.' },
        { field: 'start_date', message: 'The start date field is required.' },
        { field: 'end_date', message: 'The end date field is required.' },
        { field: 'export_type', message: 'The export type field is required.' },
      ],
    })
    expect((wrong.body as { errors: { field: string }[] }).errors.map((e) => e.field)).toEqual([
      'query_type',
      'start_date',
      'end_date',
      'export_type',
      'document_block_id',
    ])
    expect(excel.status).toBe(501)
    expect((excel.body as { error: { message: string } }).error.message).toContain('simple_excel')
    expect(billingo.data.documentExports.size).toBe(0)
  })

  test('a kliens exports.run-ja a hamis Billingón végigmegy: létrehoz, pollol, letölt', async () => {
    const { tarca, billingo } = harness()

    vi.useFakeTimers()
    const running = tarca.exports.run(
      { queryType: 'invoice_date', startDate: NOW, endDate: NOW, exportType: 'simple_csv' },
      { maxWaitMs: 5_000 },
    )
    await vi.advanceTimersByTimeAsync(2_000).finally(() => vi.useRealTimers())
    const result = await running

    expect(result).toMatchObject({
      state: 'success',
      message: undefined,
      contentType: 'text/csv; charset=UTF-8',
      filename: '2026_11_15_15_06_59_export.csv',
    })
    expect(result.id).toMatch(UUID)
    expect(result.bytes.length).toBeGreaterThan(3)
    expect(billingo.counts()).toEqual({ Create: 1, Poll: 2, Download: 1 })
  })
})

describe.skipIf(!SPEC_AVAILABLE)('hamis Billingo: export a friss spec ellen', () => {
  test('az exportformátumok listája azonos a spec DocumentExportType enumjával', () => {
    const schemas = loadMergedSpec()?.components.schemas
    expect([...EXPORT_TYPES].sort()).toEqual([...(schemas?.DocumentExportType?.enum ?? [])].sort())
  })

  test('a fenti tesztek minden válasza megfelel a spec válaszsémájának, a CSV is', () => {
    const csv = log.exchanges.filter((exchange) => exchange.contentType?.startsWith('text/csv'))

    expect(csv.length).toBeGreaterThan(0)
    expect(log.exchanges.length).toBeGreaterThan(15)
    expect(log.exchanges.flatMap(fakeExchangeSpecErrors)).toEqual([])
  })

  test('minden exportművelet legalább egy sikeres válasza át lett vizsgálva', () => {
    const succeeded = succeededOperations(log.exchanges)
    const operations = Object.keys(exportRoutes)

    expect(operations).toHaveLength(3)
    expect(operations.filter((operation) => !succeeded.has(operation))).toEqual([])
  })
})
