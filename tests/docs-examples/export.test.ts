import { describe, expect } from 'vitest'
import { BillingoError, isBillingoError } from '../../src/index'
import { docsClient, docsExample, sentBodies } from './helpers'

const OKTOBER = {
  queryType: 'invoice_date',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  exportType: 'simple_csv',
} as const

describe('export', () => {
  docsExample('export/keres', 'érvénytelen dátumra validation hiba, kérés nélkül', async () => {
    const { tarca, billingo } = docsClient()
    let hiba: unknown

    try {
      await tarca.exports.run({
        queryType: 'invoice_date',
        startDate: '2026-11-01',
        endDate: '2026-11-31',
        exportType: 'simple_csv',
      })
    } catch (error) {
      if (isBillingoError(error)) hiba = error
    }

    expect(hiba).toBeInstanceOf(BillingoError)
    expect(hiba).toMatchObject({
      category: 'validation',
      operation: 'Create',
      fieldErrors: [{ field: 'endDate' }],
    })
    expect(billingo.requests).toEqual([])
  })

  docsExample(
    'export/keres',
    'maxWaitMs: negatívra RangeError, nullánál egy lekérdezés',
    async () => {
      const { tarca, billingo } = docsClient()

      await expect(tarca.exports.run(OKTOBER, { maxWaitMs: -1 })).rejects.toThrow(
        new RangeError('A maxWaitMs értéke nemnegatív szám legyen, kapott: -1'),
      )
      expect(billingo.requests).toEqual([])

      await expect(tarca.exports.run(OKTOBER, { maxWaitMs: 0 })).rejects.toMatchObject({
        category: 'not_ready',
      })
      expect(billingo.requests.map((request) => request.operation)).toEqual(['Create', 'Poll'])
    },
  )

  docsExample('export/keres', 'a megszakított várakozás a signal okával áll le', async () => {
    const { tarca } = docsClient()
    const vezerlo = new AbortController()

    const fut = tarca.exports.run(OKTOBER, { signal: vezerlo.signal })
    setTimeout(() => vezerlo.abort(new Error('leállítva')), 10)

    await expect(fut).rejects.toThrow('leállítva')
  })

  docsExample('export/valasz', 'simple_csv: BOM, pontosvessző, magyar fejléc', async () => {
    const { tarca } = docsClient()

    const fajl = await tarca.exports.run({
      queryType: 'invoice_date',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      exportType: 'simple_csv',
    })

    const sorok = new TextDecoder().decode(fajl.bytes).trimEnd().split('\n')
    const fejlec = sorok[0]?.split(';') ?? []

    expect([fejlec.length, sorok.length - 1]).toEqual([27, 0])
    expect(fejlec.slice(0, 3)).toEqual(['"Számla sorszáma"', '"Kapcsolódó számla"', 'Kelt'])
    expect([...fajl.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(fajl).toMatchObject({
      state: 'success',
      message: undefined,
      contentType: 'text/csv; charset=UTF-8',
    })
    expect(fajl.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(fajl.filename).toMatch(/^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_export\.csv$/)
  })

  docsExample('export/valasz', 'not_ready után a régi export folytatható', async () => {
    const { tarca, billingo } = docsClient()

    const hiba = await tarca.exports.run(OKTOBER, { maxWaitMs: 500 }).catch((error) => error)
    const id = billingo.requests[1]?.path.split('/')[2] ?? ''

    expect(hiba).toMatchObject({ category: 'not_ready', retryable: true })
    expect(hiba.message).toBe(`Az export (id: ${id}) 500 ms alatt nem készült el.`)
    expect(hiba.hint).toContain(`exports.poll('${id}')`)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  docsExample(
    'export/valasz',
    'letoltHaKesz: előbb undefined, kész állapotban a fájl',
    async () => {
      const { tarca, billingo } = docsClient()

      const { id } = await tarca.exports.create({
        queryType: 'invoice_date',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        exportType: 'simple_csv',
      })

      async function letoltHaKesz(exportId: string) {
        const allapot = await tarca.exports.poll(exportId)
        if (allapot.state === 'fail')
          throw new Error(allapot.message || 'Az export nem készült el.')
        if (allapot.state !== 'success' && allapot.state !== 'warning') return undefined
        return tarca.exports.download(exportId)
      }

      const fajl = await letoltHaKesz(id)

      expect(fajl).toBeUndefined()
      await expect(tarca.exports.download(id)).rejects.toMatchObject({
        category: 'not_found',
        apiMessage: 'Document export is not finished yet.',
      })
      expect((await letoltHaKesz(id))?.filename).toMatch(/_export\.csv$/)
      expect(billingo.requests.map((request) => `${request.operation} ${request.status}`)).toEqual([
        'Create 201',
        'Poll 200',
        'Download 404',
        'Poll 200',
        'Download 200',
      ])
    },
  )

  docsExample('export/minta', 'run: indítás, két lekérdezés, letöltés', async () => {
    const { tarca, billingo } = docsClient()

    const exportfajl = await tarca.exports.run({
      queryType: 'invoice_date',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      exportType: 'simple_csv',
    })
    const csv = new TextDecoder().decode(exportfajl.bytes)

    expect(exportfajl.filename).toMatch(/_export\.csv$/)
    expect(exportfajl.bytes.byteLength).toBeGreaterThan(3)
    expect(csv.split(';').slice(0, 2)).toEqual(['"Számla sorszáma"', '"Kapcsolódó számla"'])
    expect(billingo.requests.map((request) => `${request.operation} ${request.status}`)).toEqual([
      'Create 201',
      'Poll 200',
      'Poll 200',
      'Download 200',
    ])
    expect(sentBodies(billingo, 'Create')).toEqual([
      {
        query_type: 'invoice_date',
        start_date: '2026-11-01',
        end_date: '2026-11-30',
        export_type: 'simple_csv',
      },
    ])
  })

  docsExample('export/minta', 'a hamis Billingo más formátumra 501-et ad', async () => {
    const { tarca } = docsClient()

    await expect(
      tarca.exports.create({ ...OKTOBER, exportType: 'simple_excel' }),
    ).rejects.toMatchObject({ category: 'server', status: 501 })
  })
})
