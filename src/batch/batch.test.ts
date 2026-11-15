import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTarca } from '../client'
import { DocumentHookError } from '../core/document-events'
import { BillingoError } from '../core/errors'
import type { KeyValueStore } from '../core/store'
import type { DocumentInput } from '../documents/input'
import type { DocumentOnceResult } from '../documents/once'
import { createJournal, JournalWriteError, memoryJournal } from '../journal'
import type { PartnerInput } from '../partners/partners'
import type { ReceiptInput } from '../receipts/receipts'
import { createFakeBillingoFetch, createMockTarca, type FakeBillingoOptions } from '../testing'
import {
  type BatchApi,
  type BatchItem,
  type BatchJournal,
  type BatchProgress,
  type BatchResult,
  MAX_BATCH_CONCURRENCY,
  MAX_BATCH_RATE_PER_MINUTE,
  type RunBatchOptions,
  runBatch,
} from './index'

afterEach(() => {
  vi.useRealTimers()
})

const KEY = 'tarca-batch-teszt-kulcs'
const NOW = new Date('2026-11-15T10:00:00Z')

const BUYER: PartnerInput = {
  name: 'Előfizető Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
}

const OTHER_BUYER: PartnerInput = {
  name: 'Másik Bérlő Bt.',
  address: { postCode: '6720', city: 'Szeged', address: 'Kárász utca 2.' },
}

function steppingClock(): () => Date {
  let time = NOW.getTime()
  return () => {
    time += 60_000
    return new Date(time)
  }
}

function fast(): Pick<RunBatchOptions, 'now' | 'recoveryDelayMs'> {
  return { now: steppingClock(), recoveryDelayMs: 0 }
}

function setup(options: FakeBillingoOptions = {}, fetch?: typeof globalThis.fetch) {
  const billingo = createFakeBillingoFetch({ now: () => NOW, ...options })
  const tarca = createTarca({ apiKey: KEY, fetch: fetch ?? billingo.fetch, retryDelayMs: 0 })
  return { billingo, tarca }
}

function invoice(overrides: Partial<DocumentInput> = {}): DocumentInput {
  return {
    partner: BUYER,
    items: [{ name: 'Havidíj', grossUnitPrice: 12_700, quantity: 1, vat: 27 }],
    ...overrides,
  }
}

function invoiceItem(key: string, overrides: Partial<DocumentInput> = {}): BatchItem {
  return { key, document: () => ({ kind: 'invoice', input: invoice(overrides) }) }
}

function receipt(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return { items: [{ name: 'Tagdíj', grossUnitPrice: 5_000, vat: 27 }], ...overrides }
}

function receiptItem(key: string, overrides: Partial<ReceiptInput> = {}): BatchItem {
  return { key, document: () => ({ kind: 'receipt', input: receipt(overrides) }) }
}

function keysOf(items: readonly { readonly key: string }[]): string[] {
  return items.map((item) => item.key)
}

function vendorIds(billingo: ReturnType<typeof createFakeBillingoFetch>): (string | undefined)[] {
  return [...billingo.data.documents.values()].map((record) => record.vendorId)
}

function emptyPartnerSearch(
  fetch: typeof globalThis.fetch,
  searches: string[],
): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/partners') && (init?.method ?? 'GET') === 'GET') {
      searches.push(url.searchParams.get('query') ?? '')
      return Response.json({ data: [], total: 0, per_page: 100, current_page: 1, last_page: 1 })
    }
    return fetch(input, init)
  }
}

async function drain<T>(promise: Promise<T>): Promise<T> {
  let settled = false
  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  for (let step = 0; step < 2_000 && !settled; step++) await vi.advanceTimersByTimeAsync(50)
  return promise
}

function plainStore(): KeyValueStore {
  const values = new Map<string, string>()
  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value)
    },
    delete: (key) => {
      values.delete(key)
    },
  }
}

function lockStore(overrides: Partial<KeyValueStore> = {}): KeyValueStore {
  const store = plainStore()
  return {
    ...store,
    setIfAbsent: async (key, value) => {
      if ((await store.get(key)) !== undefined) return false
      await store.set(key, value, 60)
      return true
    },
    ...overrides,
  }
}

describe('runBatch kiállítás', () => {
  test('minden tételt kiállít, a kulcs lesz a vendorId, a végösszeget a Billingo számolja', async () => {
    const { billingo, tarca } = setup()
    const progress: BatchProgress[] = []

    const result = await runBatch(tarca, {
      ...fast(),
      items: [invoiceItem('SUB-1-2026-11'), invoiceItem('SUB-2-2026-11'), receiptItem('TAG-1')],
      onProgress: (event) => progress.push(event),
    })

    expect(keysOf(result.created)).toEqual(['SUB-1-2026-11', 'SUB-2-2026-11', 'TAG-1'])
    expect(result.created.map((item) => [item.kind, item.number, item.grossTotal])).toEqual([
      ['invoice', '2026-1', 12_700],
      ['invoice', '2026-2', 12_700],
      ['receipt', 'NYT-2026-1', 5_000],
    ])
    expect(result.created[0]?.document?.id).toBeTypeOf('number')
    expect(result.grossTotals).toEqual({ HUF: 30_400 })
    expect(result.stopped).toBeUndefined()
    expect(vendorIds(billingo)).toEqual(['SUB-1-2026-11', 'SUB-2-2026-11', 'TAG-1'])
    expect(progress.map((event) => [event.key, event.done, event.created])).toEqual([
      ['SUB-1-2026-11', 1, 1],
      ['SUB-2-2026-11', 2, 2],
      ['TAG-1', 3, 3],
    ])
    expect(progress.at(-1)).toMatchObject({ total: 3, failed: 0, skipped: 0, status: 'created' })
    expect(progress.every((event) => event.total === 3)).toBe(true)
  })

  test('a megszakadt futás újraindítható, nem állít ki duplát', async () => {
    const { billingo, tarca } = setup()
    const items = [invoiceItem('A'), invoiceItem('B'), invoiceItem('C')]
    await runBatch(tarca, { ...fast(), items: items.slice(0, 2) })

    const rerun = await runBatch(tarca, { ...fast(), items })

    expect(keysOf(rerun.existing)).toEqual(['A', 'B'])
    expect(keysOf(rerun.created)).toEqual(['C'])
    expect(rerun.grossTotals).toEqual({ HUF: 38_100 })
    expect(billingo.count('CreateDocument')).toBe(3)
    expect(billingo.data.documents.size).toBe(3)
  })

  test('createMockTarca-val is fut, a hívások a createOnce-on át mennek', async () => {
    const tarca = createMockTarca()
    await runBatch(tarca, { ...fast(), items: [invoiceItem('M-1'), receiptItem('M-2')] })
    expect(tarca.calls.map((call) => call.method)).toEqual([
      'documents.createOnce',
      'receipts.createOnce',
    ])
  })

  test('egy tétel hibája nem állítja meg a többit, a hibás tételre kérés sem megy', async () => {
    const { billingo, tarca } = setup()
    const broken = invoiceItem('ROSSZ', { items: [] })
    const thrower: BatchItem = {
      key: 'DOBO',
      document: () => {
        throw new Error('az adatbázis nem válaszolt')
      },
    }

    const result = await runBatch(tarca, {
      ...fast(),
      items: [invoiceItem('A'), broken, thrower, invoiceItem('B')],
    })

    expect(keysOf(result.failed)).toEqual(['ROSSZ', 'DOBO'])
    expect(result.failed[0]?.error).toMatchObject({ category: 'validation' })
    expect(result.failed[0]?.kind).toBe('invoice')
    expect(result.failed[1]?.kind).toBeUndefined()
    expect(keysOf(result.created)).toEqual(['A', 'B'])
    expect(result.stopped).toBeUndefined()
    expect(billingo.count('GetDocumentByVendorId')).toBe(2)
  })

  test('a bizonytalan hiba (hálózat) a visszakeresés után is csak a tételt bukja, a futás megy tovább', async () => {
    const { billingo, tarca } = setup()
    billingo.fail('network', { operation: 'CreateDocument' })

    const result = await runBatch(tarca, {
      ...fast(),
      items: [invoiceItem('A'), invoiceItem('B')],
    })

    expect(keysOf(result.failed)).toEqual(['A'])
    expect(result.failed[0]?.error).toMatchObject({ category: 'network' })
    expect(keysOf(result.created)).toEqual(['B'])
    expect(result.stopped).toBeUndefined()
    expect(billingo.count('CreateDocument')).toBe(2)
  })

  test('az elveszett válaszú kiállítást a visszakeresés megtalálja: created, nincs dupla', async () => {
    const { billingo, tarca } = setup()
    billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })

    const result = await runBatch(tarca, { ...fast(), items: [invoiceItem('A')] })

    expect(keysOf(result.created)).toEqual(['A'])
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(billingo.data.documents.size).toBe(1)
  })

  test('a kulcstól eltérő vendorId-jú tétel kérés nélkül hibás, az egyező elfogadott', async () => {
    const { billingo, tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      items: [invoiceItem('A', { vendorId: 'MAS' }), receiptItem('B', { vendorId: ' B ' })],
    })
    expect(result.failed[0]?.error).toMatchObject({
      category: 'validation',
      fieldErrors: [{ field: 'vendorId' }],
    })
    expect(result.failed[0]?.error).toMatchObject({
      message: expect.stringContaining('eltér a kulcstól'),
    })
    expect(keysOf(result.created)).toEqual(['B'])
    expect(billingo.count('GetDocumentByVendorId')).toBe(1)
  })

  test('a document() rossz alakú eredménye validációs hiba', async () => {
    const { tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      items: [{ key: 'X', document: () => ({ kind: 'proforma', input: invoice() }) as never }],
    })
    expect(result.failed[0]?.error).toMatchObject({ category: 'validation' })
  })

  test('pénznemenként összesít, a forintot és az eurót nem adja össze', async () => {
    const { tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      items: [
        invoiceItem('HUF-1'),
        invoiceItem('EUR-1', {
          currency: 'EUR',
          conversionRate: 390,
          items: [{ name: 'Havidíj', netUnitPrice: 99.99, quantity: 3, vat: 27 }],
        }),
        invoiceItem('EUR-2', {
          currency: 'EUR',
          conversionRate: 390,
          items: [{ name: 'Havidíj', grossUnitPrice: 0.1, quantity: 3, vat: 27 }],
        }),
      ],
    })
    const eur = result.created.filter((item) => item.currency === 'EUR')
    expect(eur.map((item) => item.grossTotal)).toEqual([380.96, 0.3])
    expect(result.grossTotals).toEqual({ HUF: 12_700, EUR: 381.26 })
  })

  test('a napló track-jén át fut minden tétel, a meglévő is', async () => {
    const { tarca } = setup()
    const tracked: [string, boolean][] = []
    const journal: BatchJournal = {
      async track(vendorId, run) {
        const result: DocumentOnceResult = await run()
        tracked.push([vendorId, result.created])
        return result
      },
    }
    await runBatch(tarca, { ...fast(), items: [invoiceItem('A')] })

    await runBatch(tarca, { ...fast(), journal, items: [invoiceItem('A'), receiptItem('T')] })

    expect(tracked).toEqual([
      ['A', false],
      ['T', true],
    ])
  })

  test('a tarca/journal naplója minden kiállítást rögzít, befejezetlen tétel nem marad', async () => {
    const { tarca } = setup()
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const range = { from: '2026-11-01', to: '2026-11-30' }

    await runBatch(tarca, { ...fast(), journal, items: [invoiceItem('A'), receiptItem('T')] })

    expect(
      (await journal.entries(range)).map((entry) => [entry.vendorId, entry.number, entry.source]),
    ).toEqual([
      ['A', '2026-1', 'track'],
      ['T', 'NYT-2026-1', 'track'],
    ])
    expect(await journal.pending(range)).toEqual([])
  })

  test('ha a bizonylat elkészült, de a naplóba írás elbukik, a tétel created marad a hibával', async () => {
    const { billingo, tarca } = setup()
    const storage = memoryJournal()
    const journal = createJournal(
      {
        ...storage,
        putEntry: async () => {
          throw new Error('a napló tárolója megtelt')
        },
      },
      { now: () => NOW },
    )
    const items = [invoiceItem('A')]

    const result = await runBatch(tarca, { ...fast(), journal, items })

    expect(keysOf(result.created)).toEqual(['A'])
    expect(result.failed).toEqual([])
    expect(result.created[0]?.error).toBeInstanceOf(JournalWriteError)
    expect(result.created[0]?.number).toBe('2026-1')
    expect(result.grossTotals).toEqual({ HUF: 12_700 })
    expect(await storage.listReservations({ from: '2026-11-01', to: '2026-11-30' })).toMatchObject([
      { vendorId: 'A' },
    ])

    const rerun = await runBatch(tarca, { ...fast(), items })

    expect(keysOf(rerun.existing)).toEqual(['A'])
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  test('ha a kiállítás után az onDocument hook dob, a tétel created marad, a partnerét is megjegyzi', async () => {
    const searches: string[] = []
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    const tarca = createTarca({
      apiKey: KEY,
      fetch: emptyPartnerSearch(billingo.fetch, searches),
      retryDelayMs: 0,
      hooks: {
        onDocument: () => {
          throw new Error('az értesítő nem válaszolt')
        },
        onDocumentError: 'throw',
      },
    })
    const items = [invoiceItem('A'), receiptItem('B'), invoiceItem('C')]

    const result = await runBatch(tarca, { ...fast(), items })

    expect(keysOf(result.created)).toEqual(['A', 'B', 'C'])
    expect(result.failed).toEqual([])
    expect(result.created.every((item) => item.error instanceof DocumentHookError)).toBe(true)
    expect(result.created.map((item) => item.number)).toEqual(['2026-1', 'NYT-2026-1', '2026-2'])
    expect(result.grossTotals).toEqual({ HUF: 30_400 })
    expect(billingo.count('CreatePartner')).toBe(1)

    const rerun = await runBatch(tarca, { ...fast(), items })

    expect(keysOf(rerun.existing)).toEqual(['A', 'B', 'C'])
    expect(billingo.data.documents.size).toBe(3)
  })

  test('a createOnce minden zár- és visszakeresési beállítást megkap, a megszakító jelet nem', async () => {
    const { tarca } = setup()
    const lock = lockStore()
    const seen: unknown[] = []
    const api: BatchApi = {
      documents: {
        findByVendorId: (vendorId, options) => tarca.documents.findByVendorId(vendorId, options),
        createOnce: (input, options) => {
          seen.push(options)
          return tarca.documents.createOnce(input, options)
        },
      },
      receipts: {
        createOnce: (input, options) => {
          seen.push(options)
          return tarca.receipts.createOnce(input, options)
        },
      },
    }

    const result = await runBatch(api, {
      now: steppingClock(),
      recoveryDelayMs: 25,
      signal: new AbortController().signal,
      once: { lock, lockTtlSeconds: 90, lockWaitMs: 0, lockFailure: 'proceed' },
      items: [invoiceItem('A'), receiptItem('B')],
    })

    expect(keysOf(result.created)).toEqual(['A', 'B'])
    const expected = {
      lock,
      lockTtlSeconds: 90,
      lockWaitMs: 0,
      lockFailure: 'proceed',
      recoveryDelayMs: 25,
    }
    expect(seen).toEqual([expected, expected])
    expect(seen.some((options) => options instanceof Object && 'signal' in options)).toBe(false)
  })

  test('a piszkozatnak nincs sorszáma, a number üres szöveg helyett undefined', async () => {
    const { tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      items: [receiptItem('PISZKOZAT', { type: 'draft' })],
    })
    expect(result.created[0]?.document?.invoiceNumber).toBe('')
    expect(result.created[0]).toHaveProperty('number', undefined)
  })

  test('a createOnce zárbeállításait minden tételnek átadja', async () => {
    const { tarca } = setup()
    const keys: string[] = []
    const lock = lockStore({
      setIfAbsent: (key) => {
        keys.push(key)
        return true
      },
    })
    const result = await runBatch(tarca, {
      ...fast(),
      once: { lock },
      items: [invoiceItem('A'), receiptItem('B')],
    })
    expect(keysOf(result.created)).toEqual(['A', 'B'])
    expect(keys).toHaveLength(2)
    expect(keys.every((key) => key.startsWith('tarca:once:'))).toBe(true)
  })

  test('üres listára üres eredményt ad', async () => {
    const { billingo, tarca } = setup()
    expect(await runBatch(tarca, { items: [] })).toEqual({
      dryRun: false,
      items: [],
      created: [],
      existing: [],
      validated: [],
      failed: [],
      skipped: [],
      stopped: undefined,
      grossTotals: {},
    })
    expect(billingo.count()).toBe(0)
  })

  test('a dobó vagy elutasító onProgress sem állítja meg a futást', async () => {
    const { tarca } = setup()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      for (const onProgress of [
        () => {
          throw new Error('rossz kijelző')
        },
        async () => {
          throw new Error('rossz aszinkron kijelző')
        },
      ]) {
        const result = await runBatch(tarca, {
          ...fast(),
          items: [invoiceItem('A'), invoiceItem('B')],
          onProgress,
        })
        expect(result.items.map((item) => item.status)).not.toContain('failed')
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('runBatch megállás', () => {
  test('402-re (API + Tömeges hiányzik, vagy elfogyott a keret) megáll, és nem próbálja újra', async () => {
    const { billingo, tarca } = setup()
    billingo.fail({ status: 402 }, { operation: 'CreateDocument' })

    const result = await runBatch(tarca, {
      ...fast(),
      items: [invoiceItem('A'), invoiceItem('B'), invoiceItem('C')],
    })

    expect(keysOf(result.failed)).toEqual(['A'])
    expect(keysOf(result.skipped)).toEqual(['B', 'C'])
    expect(result.stopped?.reason).toContain('(subscription)')
    expect(result.stopped?.reason).toContain('API + Tömeges')
    expect(result.stopped?.error).toBe(result.failed[0]?.error)
    expect(result.skipped.every((item) => item.reason === result.stopped?.reason)).toBe(true)
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(billingo.count('GetDocumentByVendorId')).toBe(1)
  })

  test('a kiállításra kapott 429-nél megáll, az írást nem ismétli, és újraindítva folytatja', async () => {
    const { billingo, tarca } = setup()
    billingo.fail({ status: 429 }, { operation: 'CreateDocument' })
    const items = [invoiceItem('A'), invoiceItem('B'), invoiceItem('C')]

    const first = await runBatch(tarca, { ...fast(), items })

    expect(keysOf(first.failed)).toEqual(['A'])
    expect(first.failed[0]?.error).toMatchObject({ category: 'rate_limit', status: 429 })
    expect(keysOf(first.skipped)).toEqual(['B', 'C'])
    expect(first.stopped?.reason).toContain('(rate_limit)')
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(billingo.data.documents.size).toBe(0)

    const second = await runBatch(tarca, { ...fast(), items })

    expect(keysOf(second.created)).toEqual(['A', 'B', 'C'])
    expect(billingo.data.documents.size).toBe(3)
  })

  test('a GET 429-e a transport újrapróbálásai után is megállítja a futást', async () => {
    const { billingo, tarca } = setup()
    billingo.fail({ status: 429 }, { operation: 'GetDocumentByVendorId', times: 3 })

    const result = await runBatch(tarca, { ...fast(), items: [invoiceItem('A'), invoiceItem('B')] })

    expect(result.stopped?.reason).toContain('(rate_limit)')
    expect(keysOf(result.skipped)).toEqual(['B'])
    expect(billingo.count('GetDocumentByVendorId')).toBe(3)
    expect(billingo.count('CreateDocument')).toBe(0)
  })

  test.each([
    ['auth', 401, 'GetDocumentByVendorId'],
    ['forbidden', 403, 'CreateDocument'],
  ] as const)('a(z) %s hibánál megáll', async (category, status, operation) => {
    const { billingo, tarca } = setup()
    billingo.fail({ status }, { operation })

    const result = await runBatch(tarca, { ...fast(), items: [invoiceItem('A'), invoiceItem('B')] })

    expect(result.failed[0]?.error).toMatchObject({ category })
    expect(keysOf(result.skipped)).toEqual(['B'])
    expect(result.stopped?.reason).toContain(`(${category})`)
  })

  test('a zár tárolójának hibájánál (store_unavailable) és hibás zárnál (configuration) megáll', async () => {
    for (const [category, lock] of [
      [
        'store_unavailable',
        lockStore({
          setIfAbsent: () => {
            throw new Error('a Redis nem érhető el')
          },
        }),
      ],
      ['configuration', plainStore()],
    ] as const) {
      const { billingo, tarca } = setup()
      const result = await runBatch(tarca, {
        ...fast(),
        once: { lock },
        items: [invoiceItem('A'), invoiceItem('B')],
      })
      expect(result.failed[0]?.error).toMatchObject({ category })
      expect(keysOf(result.skipped)).toEqual(['B'])
      expect(result.stopped?.reason).toContain(`(${category})`)
      expect(billingo.count()).toBe(0)
    }
  })

  test('párhuzamos futásban az első megállító hiba marad a leállás oka', async () => {
    const { billingo, tarca } = setup()
    billingo.fail({ status: 402 }, { operation: 'CreateDocument', times: 2 })

    const result = await runBatch(tarca, {
      ...fast(),
      concurrency: 2,
      items: [invoiceItem('A'), invoiceItem('B', { partner: OTHER_BUYER }), invoiceItem('C')],
    })

    expect(keysOf(result.failed)).toEqual(['A', 'B'])
    expect(keysOf(result.skipped)).toEqual(['C'])
    expect(result.stopped?.error).toBe(result.failed[0]?.error)
    expect(result.stopped?.error).not.toBe(result.failed[1]?.error)
  })

  test('ha egy másik folyamat épp kiállítja (in_progress), csak azt a tételt hagyja ki', async () => {
    const { tarca } = setup()
    const busy = lockStore({ setIfAbsent: (key) => !key.startsWith('tarca:once:') })
    const result = await runBatch(tarca, {
      ...fast(),
      once: { lock: busy, lockWaitMs: 0 },
      items: [invoiceItem('A'), receiptItem('B')],
    })
    expect(result.skipped.map((item) => [item.key, item.kind])).toEqual([
      ['A', 'invoice'],
      ['B', 'receipt'],
    ])
    expect(result.skipped[0]?.error).toMatchObject({ category: 'in_progress' })
    expect(result.skipped[0]?.reason).toContain('Futtasd újra később')
    expect(result.stopped).toBeUndefined()
  })
})

describe('runBatch partnerek', () => {
  test('az új vevőt a futáson belül egyszer hozza létre, akkor is, ha a Billingo keresése még nem látja', async () => {
    const searches: string[] = []
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    const { tarca } = setup({}, emptyPartnerSearch(billingo.fetch, searches))
    const reordered: PartnerInput = {
      address: { address: 'Fő utca 1.', city: 'Budapest', postCode: '1111', countryCode: 'HU' },
      name: 'Előfizető Kft.',
    }

    const result = await runBatch(tarca, {
      ...fast(),
      items: [
        invoiceItem('A'),
        invoiceItem('B', { partner: reordered }),
        invoiceItem('C', { partner: OTHER_BUYER }),
        receiptItem('D', { partner: BUYER }),
      ],
    })

    expect(keysOf(result.created)).toEqual(['A', 'B', 'C', 'D'])
    expect(billingo.count('CreatePartner')).toBe(2)
    expect(searches).toEqual(['Előfizető Kft.', 'Másik Bérlő Bt.'])
    const partnerIds = result.created.map((item) => item.document?.partner?.id)
    expect(partnerIds[0]).toBeTypeOf('number')
    expect(partnerIds[1]).toBe(partnerIds[0])
    expect(partnerIds[3]).toBe(partnerIds[0])
    expect(partnerIds[2]).not.toBe(partnerIds[0])
  })

  test('párhuzamos futásban a második tétel megvárja az első partnerét', async () => {
    const searches: string[] = []
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    const { tarca } = setup({}, emptyPartnerSearch(billingo.fetch, searches))

    const result = await runBatch(tarca, {
      ...fast(),
      concurrency: MAX_BATCH_CONCURRENCY,
      items: ['A', 'B', 'C', 'D'].map((key) => invoiceItem(key)),
    })

    expect(result.created).toHaveLength(4)
    expect(billingo.count('CreatePartner')).toBe(1)
    expect(searches).toHaveLength(1)
  })

  test('ha a partner első tétele elbukik, a következő tétel veszi át a partner feloldását', async () => {
    const searches: string[] = []
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    const { tarca } = setup({}, emptyPartnerSearch(billingo.fetch, searches))
    billingo.fail({ status: 422, message: 'Validation Failed' }, { operation: 'CreateDocument' })

    const result = await runBatch(tarca, {
      ...fast(),
      items: [invoiceItem('A'), invoiceItem('B'), invoiceItem('C')],
    })

    expect(keysOf(result.failed)).toEqual(['A'])
    expect(keysOf(result.created)).toEqual(['B', 'C'])
    expect(result.created[1]?.document?.partner?.id).toBe(result.created[0]?.document?.partner?.id)
    expect(searches).toHaveLength(2)
  })

  test('a már meglévő bizonylat partnerét nem veszi át, az új tétel a saját partnerét keresi', async () => {
    const searches: string[] = []
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    const { tarca } = setup({}, emptyPartnerSearch(billingo.fetch, searches))
    await runBatch(tarca, { ...fast(), items: [invoiceItem('A')] })

    const rerun = await runBatch(tarca, {
      ...fast(),
      items: [invoiceItem('A'), invoiceItem('B'), invoiceItem('C')],
    })

    expect(keysOf(rerun.existing)).toEqual(['A'])
    expect(keysOf(rerun.created)).toEqual(['B', 'C'])
    expect(searches).toHaveLength(2)
  })
})

describe('runBatch dryRun', () => {
  test('helyben validál, csak GET-et küld, semmit nem ír, piszkozatot sem', async () => {
    const { billingo, tarca } = setup()
    await runBatch(tarca, { ...fast(), items: [invoiceItem('MEGVAN')] })
    const before = billingo.requests.length

    const result = await runBatch(tarca, {
      ...fast(),
      dryRun: true,
      items: [
        invoiceItem('A', {
          items: [{ name: 'Havidíj', grossUnitPrice: 10_000, quantity: 1, vat: 27 }],
        }),
        receiptItem('T'),
        invoiceItem('MEGVAN'),
        invoiceItem('ROSSZ', { items: [] }),
      ],
    })

    expect(result.dryRun).toBe(true)
    expect(result.validated.map((item) => [item.key, item.kind, item.grossTotal])).toEqual([
      ['A', 'invoice', 10_000.01],
      ['T', 'receipt', 5_000],
    ])
    expect(result.existing.map((item) => [item.key, item.number])).toEqual([['MEGVAN', '2026-1']])
    expect(keysOf(result.failed)).toEqual(['ROSSZ'])
    expect(result.grossTotals).toEqual({ HUF: 27_700.01 })
    const dryRequests = billingo.requests.slice(before)
    expect(dryRequests.map((request) => request.operation)).toEqual([
      'GetDocumentByVendorId',
      'GetDocumentByVendorId',
      'GetDocumentByVendorId',
    ])
    expect(billingo.data.documents.size).toBe(1)
    expect(billingo.data.partners.size).toBe(1)
  })

  test('a becslés a Billingo kerekítését követi: egyezik az éles futás végösszegeivel', async () => {
    const { tarca } = setup()
    const items = [
      invoiceItem('NETTO', {
        items: [
          { name: 'Óradíj', netUnitPrice: 8_333.33, quantity: 3, vat: 27 },
          { name: 'Könyv', netUnitPrice: 2_499, quantity: 2, vat: 5 },
          { name: 'Mentes', netUnitPrice: 1_000, quantity: 1, vat: 'AAM' },
        ],
      }),
      invoiceItem('BRUTTO', {
        items: [
          { name: 'Csomag', grossUnitPrice: 9_999, quantity: 7, vat: 27 },
          { name: 'Szállítás', grossUnitPrice: 1_490, quantity: 1, vat: 18 },
        ],
      }),
      invoiceItem('EUR', {
        currency: 'EUR',
        conversionRate: 391.5,
        items: [{ name: 'Licenc', netUnitPrice: 49.99, quantity: 3, vat: '5,5%' }],
      }),
      receiptItem('NYUGTA', {
        items: [
          { name: 'Kávé', grossUnitPrice: 650, quantity: 3, vat: 27 },
          { name: 'Pogácsa', grossUnitPrice: 290, vat: 5 },
        ],
      }),
    ]

    const dry = await runBatch(tarca, { ...fast(), dryRun: true, items })
    const real = await runBatch(tarca, { ...fast(), items })

    expect(dry.validated.map((item) => [item.key, item.currency, item.grossTotal])).toEqual(
      real.created.map((item) => [item.key, item.currency, item.grossTotal]),
    )
    expect(dry.grossTotals).toEqual(real.grossTotals)
    expect(Object.keys(real.grossTotals).sort()).toEqual(['EUR', 'HUF'])
  })

  test('termékes tételnél, kedvezménynél és nulla áfás nyugtatételnél nem becsül', async () => {
    const { tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      dryRun: true,
      items: [
        invoiceItem('TERMEK', { items: [{ productId: 3, quantity: 1 }] }),
        invoiceItem('KEDVEZMENY', { discountPercent: 10 }),
        invoiceItem('ELOLEG', { advanceInvoiceIds: [5] }),
        receiptItem('NONE', { items: [{ name: 'Adómentes', grossUnitPrice: 100, vat: 'none' }] }),
        receiptItem('OK'),
      ],
    })
    expect(result.validated.map((item) => [item.key, item.currency, item.grossTotal])).toEqual([
      ['TERMEK', 'HUF', undefined],
      ['KEDVEZMENY', 'HUF', undefined],
      ['ELOLEG', 'HUF', undefined],
      ['NONE', 'HUF', undefined],
      ['OK', 'HUF', 5_000],
    ])
    expect(result.grossTotals).toEqual({ HUF: 5_000 })
  })

  test('a nyugta helyi ellenőrzése ugyanazt a mezőhibát adja, mint a receipts.createOnce', async () => {
    const { billingo, tarca } = setup()
    const broken: ReceiptInput[] = [
      receipt({ items: [] }),
      receipt({ type: 'proforma' as never }),
      receipt({ partner: 0 }),
      receipt({ partner: { name: ' ', address: null as never } }),
      receipt({ blockId: -1, paymentMethod: 'csekk' as never, electronic: 'igen' as never }),
      receipt({ currency: 'EUR' }),
      receipt({ currency: 'XYZ' as never, conversionRate: 0 }),
      receipt({
        items: [
          null as never,
          { productId: 0, quantity: Number.NaN },
          { name: '', grossUnitPrice: Number.POSITIVE_INFINITY, vat: 12 },
        ],
      }),
    ]

    for (const [index, input] of broken.entries()) {
      const key = `R-${index}`
      const dry = await runBatch(tarca, {
        ...fast(),
        dryRun: true,
        items: [{ key, document: () => ({ kind: 'receipt', input }) }],
      })
      const direct = await tarca.receipts.createOnce({ ...input, vendorId: key }).then(
        () => undefined,
        (error: unknown) => error,
      )
      if (!(direct instanceof BillingoError)) throw new Error(`a(z) ${key} nyugta nem bukott el`)
      expect(dry.failed[0]?.error).toMatchObject({
        category: 'validation',
        fieldErrors: direct.fieldErrors,
        message: direct.message,
      })
    }
    expect(billingo.count()).toBe(0)
  })

  test('a defaults alapján validál és becsül, mint az éles kliens, nyugtánál is', async () => {
    const { tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      dryRun: true,
      defaults: { currency: 'EUR' },
      items: [
        invoiceItem('ARFOLYAM-NELKUL'),
        invoiceItem('ARFOLYAMMAL', {
          conversionRate: 390,
          items: [{ name: 'Havidíj', netUnitPrice: 100, quantity: 1, vat: 27 }],
        }),
        receiptItem('NYUGTA-ARFOLYAM-NELKUL'),
        receiptItem('NYUGTA-ARFOLYAMMAL', { conversionRate: 390 }),
      ],
    })
    expect(keysOf(result.failed)).toEqual(['ARFOLYAM-NELKUL', 'NYUGTA-ARFOLYAM-NELKUL'])
    for (const failed of result.failed) {
      expect(failed.error).toMatchObject({
        fieldErrors: [expect.objectContaining({ field: 'conversionRate' })],
      })
    }
    expect(result.validated.map((item) => [item.currency, item.grossTotal])).toEqual([
      ['EUR', 127],
      ['EUR', 5_000],
    ])
    expect(result.grossTotals).toEqual({ EUR: 5_127 })
  })

  test('a pont és a két pont kulcsot helyben elutasítja, a dokumentumlistára sem megy kérés', async () => {
    const { billingo, tarca } = setup()
    for (const dryRun of [true, false]) {
      const result = await runBatch(tarca, {
        ...fast(),
        dryRun,
        items: [invoiceItem('.'), receiptItem('..')],
      })
      expect(result.failed.map((item) => item.error)).toEqual([
        expect.objectContaining({
          category: 'validation',
          fieldErrors: [expect.objectContaining({ field: 'vendorId' })],
        }),
        expect.objectContaining({
          category: 'validation',
          fieldErrors: [expect.objectContaining({ field: 'vendorId' })],
        }),
      ])
    }
    expect(billingo.count()).toBe(0)
  })

  test('a dryRun is megáll a megállító hibán', async () => {
    const { billingo, tarca } = setup()
    billingo.fail({ status: 401 }, { operation: 'GetDocumentByVendorId' })
    const result = await runBatch(tarca, {
      ...fast(),
      dryRun: true,
      items: [invoiceItem('A'), invoiceItem('B')],
    })
    expect(result.stopped?.reason).toContain('(auth)')
    expect(keysOf(result.skipped)).toEqual(['B'])
  })
})

describe('runBatch ütemezés', () => {
  test('a tételek indítása között tartja a percenkénti sebességet, párhuzamosan is', async () => {
    vi.useFakeTimers({ now: NOW })
    const { tarca } = setup()
    const started: number[] = []
    const items = ['A', 'B', 'C', 'D'].map((key) => ({
      key,
      document: () => {
        started.push(Date.now())
        return { kind: 'invoice' as const, input: invoice() }
      },
    }))

    const result = await drain(
      runBatch(tarca, { items, ratePerMinute: 60, concurrency: 2, recoveryDelayMs: 0 }),
    )

    expect(result.created).toHaveLength(4)
    expect(started.map((time) => time - NOW.getTime())).toEqual([0, 1_000, 2_000, 3_000])
  })

  test('alapból percenként 30 tételt indít', async () => {
    vi.useFakeTimers({ now: NOW })
    const { tarca } = setup()
    const started: number[] = []
    const items = ['A', 'B', 'C'].map((key) => ({
      key,
      document: () => {
        started.push(Date.now())
        return { kind: 'receipt' as const, input: receipt() }
      },
    }))

    await drain(runBatch(tarca, { items, recoveryDelayMs: 0 }))

    expect(started.map((time) => time - NOW.getTime())).toEqual([0, 2_000, 4_000])
  })

  test('párhuzamos futásban a már ütemezett tétel a megállás után nem indul el', async () => {
    vi.useFakeTimers({ now: NOW })
    const { billingo, tarca } = setup()
    billingo.fail({ status: 402 }, { operation: 'CreateDocument' })

    const result = await drain(
      runBatch(tarca, {
        items: [invoiceItem('A'), invoiceItem('B'), invoiceItem('C')],
        ratePerMinute: 60,
        concurrency: 2,
        recoveryDelayMs: 0,
      }),
    )

    expect(keysOf(result.failed)).toEqual(['A'])
    expect(keysOf(result.skipped)).toEqual(['B', 'C'])
    expect(result.skipped[0]?.reason).toContain('(subscription)')
    expect(billingo.count('GetDocumentByVendorId')).toBe(1)
  })

  test('párhuzamosan is futtat, de legfeljebb a megadott számút', async () => {
    const { tarca } = setup()
    let active = 0
    let peak = 0
    const items = Array.from({ length: 6 }, (_, index) => ({
      key: `P-${index}`,
      document: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { kind: 'invoice' as const, input: invoice({ partner: 1 }) }
      },
    }))
    await runBatch(tarca, { ...fast(), items: [invoiceItem('PARTNER')] })

    const result = await runBatch(tarca, { ...fast(), concurrency: 2, items })

    expect(result.created).toHaveLength(6)
    expect(peak).toBe(2)
  })
})

describe('runBatch megszakítás', () => {
  test('megszakításkor nem indít új tételt, a már futó tétel befejeződik', async () => {
    const { billingo, tarca } = setup()
    const controller = new AbortController()
    const items = ['A', 'B', 'C'].map((key) => ({
      key,
      document: () => {
        if (key === 'A') controller.abort(new Error('leállítva'))
        return { kind: 'invoice' as const, input: invoice() }
      },
    }))

    const result = await runBatch(tarca, { ...fast(), items, signal: controller.signal })

    expect(keysOf(result.created)).toEqual(['A'])
    expect(keysOf(result.skipped)).toEqual(['B', 'C'])
    expect(result.stopped?.reason).toContain('megszakították')
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  test('a várakozás alatti megszakítás azonnal leállítja a futást', async () => {
    const { tarca } = setup()
    const controller = new AbortController()
    const pending = runBatch(tarca, {
      items: [invoiceItem('A'), invoiceItem('B'), invoiceItem('C')],
      recoveryDelayMs: 0,
      signal: controller.signal,
      onProgress: (event) => {
        if (event.key === 'A') setTimeout(() => controller.abort(new Error('elég')), 5)
      },
    })

    const result: BatchResult = await pending

    expect(keysOf(result.created)).toEqual(['A'])
    expect(result.skipped.map((item) => [item.key, item.reason])).toEqual([
      ['B', 'A batch futását megszakították.'],
      ['C', 'A batch futását megszakították.'],
    ])
  })

  test('a megszakítás közben valódi hibával elbukó tétel failed marad, a hibája nem vész el', async () => {
    const { billingo, tarca } = setup()
    const controller = new AbortController()
    const result = await runBatch(tarca, {
      ...fast(),
      signal: controller.signal,
      items: [
        {
          key: 'A',
          document: () => {
            controller.abort(new Error('leállítva'))
            return { kind: 'invoice', input: invoice({ items: [] }) }
          },
        },
        invoiceItem('B'),
      ],
    })
    expect(keysOf(result.failed)).toEqual(['A'])
    expect(result.failed[0]?.error).toMatchObject({ category: 'validation' })
    expect(keysOf(result.skipped)).toEqual(['B'])
    expect(result.stopped?.reason).toContain('megszakították')
    expect(billingo.count()).toBe(0)
  })

  test('a document() által dobott megszakítás a tételt kihagyja', async () => {
    const { tarca } = setup()
    const controller = new AbortController()
    const result = await runBatch(tarca, {
      ...fast(),
      signal: controller.signal,
      items: [
        {
          key: 'A',
          document: () => {
            controller.abort(new Error('mégse'))
            throw controller.signal.reason
          },
        },
        invoiceItem('B'),
      ],
    })
    expect(result.skipped.map((item) => item.key)).toEqual(['A', 'B'])
    expect(result.failed).toEqual([])
  })

  test('már megszakított jellel semmit nem küld', async () => {
    const { billingo, tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      signal: AbortSignal.abort(new Error('korán')),
      items: [invoiceItem('A'), invoiceItem('B')],
    })
    expect(keysOf(result.skipped)).toEqual(['A', 'B'])
    expect(result.stopped?.reason).toContain('megszakították')
    expect(billingo.count()).toBe(0)
  })
})

describe('runBatch beállítások', () => {
  test('érvénytelen beállításokra és kulcsokra hibát dob, mielőtt bármit küldene', async () => {
    const { billingo, tarca } = setup()
    const one = [invoiceItem('A')]
    for (const options of [
      { concurrency: 0 },
      { concurrency: MAX_BATCH_CONCURRENCY + 1 },
      { concurrency: 1.5 },
      { ratePerMinute: 0 },
      { ratePerMinute: MAX_BATCH_RATE_PER_MINUTE + 1 },
      { ratePerMinute: Number.NaN },
      { recoveryDelayMs: -1 },
      { defaults: { dueInDays: -1 } },
    ]) {
      await expect(runBatch(tarca, { items: one, ...options })).rejects.toMatchObject({
        category: 'configuration',
      })
    }
    for (const items of [
      [invoiceItem('A'), invoiceItem(' A ')],
      [invoiceItem(' ')],
      [
        {
          key: undefined as never,
          document: () => ({ kind: 'invoice' as const, input: invoice() }),
        },
      ],
    ]) {
      await expect(runBatch(tarca, { items })).rejects.toMatchObject({ category: 'validation' })
    }
    await expect(
      runBatch(tarca, { items: [invoiceItem('A'), invoiceItem('B'), invoiceItem('A')] }),
    ).rejects.toMatchObject({ fieldErrors: [{ field: 'items.2.key' }] })
    expect(billingo.count()).toBe(0)
  })

  test('a legnagyobb megengedett sebességgel és párhuzamossággal elindul', async () => {
    const { tarca } = setup()
    const result = await runBatch(tarca, {
      ...fast(),
      ratePerMinute: MAX_BATCH_RATE_PER_MINUTE,
      concurrency: MAX_BATCH_CONCURRENCY,
      items: [invoiceItem('A')],
    })
    expect(result.created).toHaveLength(1)
  })
})
