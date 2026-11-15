import { describe, expect, test, vi } from 'vitest'
import { createTarca, type Tarca } from '../client'
import type { TarcaHooks } from '../core/context'
import { DocumentHookError } from '../core/document-events'
import { BillingoError, type BillingoErrorCategory } from '../core/errors'
import { isUncertainOutcome } from '../core/once-guard'
import type { KeyValueStore } from '../core/store'
import type { DraftFinalizeInput } from '../documents/input'
import { memoryStore } from '../stores/memory'
import { resilientStore } from '../stores/resilient'
import { upstashRedisStore } from '../stores/upstash'
import { createFakeBillingoFetch, type FakeBillingo } from '../testing'
import {
  createJournal,
  type JournalEntry,
  type JournalStorage,
  JournalWriteError,
  kvJournal,
  MAX_JOURNAL_RANGE_DAYS,
  memoryJournal,
} from './index'

const NOW = new Date('2026-10-02T10:00:00Z')
const DAY = '2026-10-02'
const RANGE = { from: DAY, to: DAY }

const INVOICE: DraftFinalizeInput = {
  partner: {
    name: 'Vevő Kft.',
    address: { countryCode: 'HU', postCode: '1011', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Tanácsadás', quantity: 1, netUnitPrice: 10_000, vat: 27 }],
}

const RECEIPT = { items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 890, vat: 27 }] }

const storages: readonly [string, () => JournalStorage][] = [
  ['memoryJournal', () => memoryJournal()],
  ['kvJournal', () => kvJournal(memoryStore())],
]

interface Setup {
  readonly billingo: FakeBillingo
  readonly tarca: Tarca
}

function fakeTarca(hooks?: TarcaHooks): Setup {
  const billingo = createFakeBillingoFetch({ now: () => NOW })
  const tarca = createTarca({
    apiKey: 'teszt-kulcs',
    fetch: billingo.fetch,
    retryDelayMs: 0,
    ...(hooks ? { hooks } : {}),
  })
  return { billingo, tarca }
}

function entryOf(id: number, number: string, date = DAY): JournalEntry {
  return {
    id,
    number,
    type: 'invoice',
    action: 'created',
    date,
    relatedIds: [],
    grossTotal: 127,
    netTotal: 100,
    currency: 'HUF',
    recordedAt: '2026-10-02T12:00:00+02:00',
    source: 'manual',
  }
}

function clock(start: Date = NOW) {
  let current = start
  return {
    now: () => current,
    advance(seconds: number) {
      current = new Date(current.getTime() + seconds * 1000)
    },
  }
}

describe.each(storages)('%s', (_name, makeStorage) => {
  function setup() {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const fake = fakeTarca({
      onDocument: (event) => journal.record(event),
      onDocumentError: 'throw',
    })
    return { journal, ...fake }
  }

  test('az onDocument hookból a számlát, a sztornót és a módosítót naplózza, a befizetést nem', async () => {
    const { journal, tarca } = setup()
    const { document: invoice } = await tarca.documents.createOnce({
      ...INVOICE,
      vendorId: 'WEB-1',
    })
    await tarca.documents.payments.add(invoice.id ?? 0, {
      date: DAY,
      price: 12_700,
      paymentMethod: 'cash',
    })
    const other = await tarca.documents.create(INVOICE)
    const modification = await tarca.documents.createModification(other.id ?? 0, {
      items: [{ name: 'Engedmény', quantity: -1, netUnitPrice: 1_000, vat: 27 }],
    })
    const cancellation = await tarca.documents.cancel(invoice.id ?? 0)

    const entries = await journal.entries(RANGE)

    expect(entries.map((entry) => [entry.id, entry.type, entry.action])).toEqual([
      [invoice.id, 'invoice', 'created'],
      [other.id, 'invoice', 'created'],
      [modification.id, 'modification', 'modified'],
      [cancellation.id, 'cancellation', 'cancelled'],
    ])
    expect(entries[0]).toEqual({
      id: invoice.id,
      vendorId: 'WEB-1',
      number: invoice.invoiceNumber,
      type: 'invoice',
      action: 'created',
      date: DAY,
      relatedIds: [],
      grossTotal: 12_700,
      netTotal: 10_000,
      currency: 'HUF',
      conversionRate: 1,
      paymentStatus: 'outstanding',
      recordedAt: '2026-10-02T12:00:00+02:00',
      source: 'hook',
    })
    expect(entries[2]?.relatedIds).toEqual([other.id])
    expect(entries[3]).toMatchObject({ relatedIds: [invoice.id], grossTotal: -12_700 })
  })

  test('nyugtát és díjbekérőt naplóz, piszkozatot és másolatot nem, a véglegesítettet igen', async () => {
    const { journal, tarca } = setup()
    const receipt = await tarca.receipts.create(RECEIPT)
    const proforma = await tarca.documents.create({ ...INVOICE, type: 'proforma' })
    const draft = await tarca.documents.create({ ...INVOICE, type: 'draft' })
    await tarca.documents.copy(proforma.id ?? 0)
    const converted = await tarca.documents.createFromProforma(proforma.id ?? 0)
    const finalized = await tarca.documents.finalizeDraft(draft.id ?? 0, INVOICE)

    const entries = await journal.entries(RANGE)

    expect(entries.map((entry) => [entry.id, entry.type, entry.action]).sort()).toEqual(
      [
        [receipt.id, 'receipt', 'created'],
        [proforma.id, 'proforma', 'created'],
        [converted.id, 'invoice', 'converted'],
        [finalized.id, 'invoice', 'finalized'],
      ].sort(),
    )
    expect(entries.find((entry) => entry.id === converted.id)?.relatedIds).toContain(proforma.id)
    expect(await journal.entries({ ...RANGE, type: 'receipt' })).toHaveLength(1)
  })

  test('ugyanazt a bizonylatot kétszer sem naplózza kétszer, és nem írja felül', async () => {
    const { journal, tarca } = setup()
    const { document } = await tarca.documents.createOnce({ ...INVOICE, vendorId: 'WEB-1' })

    await journal.record(document)
    await journal.record({ ...document, grossTotal: 1 })
    await journal.track('WEB-1', () =>
      tarca.documents.createOnce({ ...INVOICE, vendorId: 'WEB-1' }),
    )

    const entries = await journal.entries(RANGE)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ source: 'hook', vendorId: 'WEB-1', grossTotal: 12_700 })
    expect(await journal.storage.getEntry(document.id ?? 0)).toEqual(entries[0])
  })

  test('a kézzel átadott bizonylat forrása manual, az eseményé hook a saját műveletével', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { tarca } = fakeTarca()
    const invoice = await tarca.documents.create(INVOICE)
    const { relatedDocuments: _related, ...cancellation } = await tarca.documents.cancel(
      invoice.id ?? 0,
    )

    await journal.record(invoice)
    await journal.record({
      action: 'cancelled',
      operation: 'CancelDocument',
      document: cancellation,
      sourceId: invoice.id,
    })

    expect(await journal.storage.getEntry(invoice.id ?? 0)).toMatchObject({
      source: 'manual',
      action: 'created',
      relatedIds: [],
    })
    expect(await journal.storage.getEntry(cancellation.id ?? 0)).toMatchObject({
      source: 'hook',
      action: 'cancelled',
      relatedIds: [invoice.id],
    })
  })

  test('az azonos napi bejegyzéseket a sorszám számértéke szerint rendezi', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    await journal.storage.putEntry(entryOf(3, 'E-10'))
    await journal.storage.putEntry(entryOf(1, 'E-9'))
    await journal.storage.putEntry(entryOf(2, 'E-2'))
    await journal.storage.putEntry(entryOf(4, 'A-99', '2026-10-01'))

    const entries = await journal.entries({ from: '2026-10-01', to: DAY })

    expect(entries.map((entry) => entry.number)).toEqual(['A-99', 'E-2', 'E-9', 'E-10'])
  })

  test('a track sikeres kiállítás után naplóz, és nem hagy befejezetlen tételt', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { tarca } = fakeTarca()

    const result = await journal.track('WEB-1', () =>
      tarca.receipts.createOnce({ ...RECEIPT, vendorId: 'WEB-1' }),
    )

    expect(result.created).toBe(true)
    expect(await journal.pending(RANGE)).toEqual([])
    expect(await journal.entries(RANGE)).toMatchObject([
      { id: result.document.id, source: 'track', vendorId: 'WEB-1', type: 'receipt' },
    ])
  })

  test('a track a már meglévő bizonylatot (created: false) is naplózza', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { tarca } = fakeTarca()
    await tarca.documents.createOnce({ ...INVOICE, vendorId: 'INV-1' })

    const result = await journal.track('INV-1', () =>
      tarca.documents.createOnce({ ...INVOICE, vendorId: 'INV-1' }),
    )

    expect(result.created).toBe(false)
    expect(await journal.entries(RANGE)).toMatchObject([
      { id: result.document.id, vendorId: 'INV-1', grossTotal: 12_700, source: 'track' },
    ])
  })

  test('a track sima Document eredményt is naplóz, a piszkozatot nem, de a foglalást elengedi', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { tarca } = fakeTarca()

    const invoice = await journal.track('D-1', () =>
      tarca.documents.create({ ...INVOICE, vendorId: 'D-1' }),
    )
    await journal.track('D-2', () => tarca.documents.create({ ...INVOICE, type: 'draft' }))

    expect((await journal.entries(RANGE)).map((entry) => entry.id)).toEqual([invoice.id])
    expect(await journal.pending(RANGE)).toEqual([])
  })

  test('bizonytalan kimenetelnél a tétel befejezetlen marad, a settle később pótolja', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { billingo, tarca } = fakeTarca()
    billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })

    await expect(
      journal.track('WEB-1', () => tarca.documents.create({ ...INVOICE, vendorId: 'WEB-1' })),
    ).rejects.toMatchObject({ category: 'timeout' })

    expect(await journal.pending(RANGE)).toMatchObject([{ vendorId: 'WEB-1', date: DAY }])
    expect(await journal.entries(RANGE)).toEqual([])

    const settled = await journal.settle(tarca, { range: RANGE })

    expect(settled.recorded).toMatchObject([{ vendorId: 'WEB-1' }])
    expect(settled.notFound).toEqual([])
    expect(await journal.pending(RANGE)).toEqual([])
    expect(await journal.entries(RANGE)).toMatchObject([{ source: 'settle', vendorId: 'WEB-1' }])
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  test('biztos Billingo hibánál (402) nem hagy befejezetlen tételt', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { billingo, tarca } = fakeTarca()
    billingo.fail({ status: 402 }, { operation: 'CreateDocument' })

    await expect(
      journal.track('WEB-1', () => tarca.documents.createOnce({ ...INVOICE, vendorId: 'WEB-1' })),
    ).rejects.toMatchObject({ category: 'subscription' })

    expect(await journal.pending(RANGE)).toEqual([])
  })

  test('a foglalás törlésének hibája nem takarja el a kiállítás eredeti hibáját', async () => {
    const storage = makeStorage()
    const journal = createJournal(
      { ...storage, deleteReservation: () => Promise.reject(new Error('tároló leállt')) },
      { now: () => NOW },
    )
    const error = new BillingoError('hibás adat', { category: 'validation' })

    await expect(journal.track('V-9', () => Promise.reject(error))).rejects.toBe(error)
  })

  test('nem Billingo hibánál óvatosan befejezetlenként hagyja', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    await expect(
      journal.track('INV-9', async () => {
        throw new Error('saját kód hiba a kiállítás után')
      }),
    ).rejects.toThrow('saját kód')
    expect(await journal.pending(RANGE)).toHaveLength(1)
  })

  test('a settle a nem talált tételt megtartja, releaseNotFound esetén elengedi', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { tarca } = fakeTarca()
    await journal.reserve('NINCS-1')
    await journal.reserve('NINCS-2')

    const first = await journal.settle(tarca, { range: RANGE })
    expect(first.notFound).toHaveLength(2)
    expect(await journal.pending(RANGE)).toHaveLength(2)

    const second = await journal.settle(tarca, { range: RANGE, releaseNotFound: true })
    expect(second.notFound).toHaveLength(2)
    expect(await journal.pending(RANGE)).toEqual([])
  })

  test('a settle a lekérdezési hibát tételenként jelzi, a többit rendezi', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { tarca } = fakeTarca()
    await tarca.documents.create({ ...INVOICE, vendorId: 'A-2' })
    await journal.reserve('A-1')
    await journal.reserve('A-2')
    const lookupError = new BillingoError('Szerverhiba', { category: 'server' })

    const settled = await journal.settle(
      {
        documents: {
          findByVendorId: (vendorId) =>
            vendorId === 'A-1'
              ? Promise.reject(lookupError)
              : tarca.documents.findByVendorId(vendorId),
        },
      },
      { range: RANGE },
    )

    expect(settled.failed).toEqual([
      { reservation: expect.objectContaining({ vendorId: 'A-1' }), error: lookupError },
    ])
    expect(settled.recorded).toMatchObject([{ vendorId: 'A-2' }])
    expect(await journal.pending(RANGE)).toMatchObject([{ vendorId: 'A-1' }])
  })

  test('hiányos bizonylatot nem naplóz nullákkal: TypeError a hiányzó mezővel', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const { tarca } = fakeTarca()
    const { summary: _summary, ...document } = await tarca.documents.create(INVOICE)

    await expect(journal.record(document)).rejects.toThrow('summary.netAmount')
    await expect(journal.record({ ...document, invoiceNumber: '' })).rejects.toBeInstanceOf(
      TypeError,
    )
    expect(await journal.entries(RANGE)).toEqual([])
  })

  test('a pending alapból az utolsó 30 napot nézi', async () => {
    const time = clock()
    const journal = createJournal(makeStorage(), { now: time.now })
    await journal.reserve('R-1')
    time.advance(29 * 86_400)
    expect(await journal.pending()).toHaveLength(1)
    time.advance(86_400)
    expect(await journal.pending()).toEqual([])
    expect(await journal.pending(RANGE)).toHaveLength(1)
    await journal.release('R-1')
    expect(await journal.pending(RANGE)).toEqual([])
  })

  test('üres vendorId-ra RangeError, kiállítás nélkül', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    const run = vi.fn()
    await expect(journal.reserve('  ')).rejects.toBeInstanceOf(RangeError)
    await expect(journal.track('', run)).rejects.toBeInstanceOf(RangeError)
    await expect(journal.release('')).rejects.toBeInstanceOf(RangeError)
    expect(run).not.toHaveBeenCalled()
  })

  test('érvénytelen időszakra RangeError', async () => {
    const journal = createJournal(makeStorage(), { now: () => NOW })
    await expect(journal.entries({ from: '2026-10-05', to: '2026-10-01' })).rejects.toBeInstanceOf(
      RangeError,
    )
    await expect(journal.entries({ from: '2026/10/01', to: DAY })).rejects.toThrow('YYYY-MM-DD')
    await expect(journal.entries({ from: '2025-01-01', to: '2026-12-31' })).rejects.toThrow(
      String(MAX_JOURNAL_RANGE_DAYS),
    )
    await expect(journal.entries({ from: '2026-01-01', to: '2027-01-01' })).resolves.toEqual([])
  })
})

describe('reconcile', () => {
  test('pótolja a csak a Billingóban lévő bizonylatot, dryRun esetén csak jelzi', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const { tarca } = fakeTarca()
    const invoice = await tarca.documents.create(INVOICE)
    await tarca.documents.create({ ...INVOICE, type: 'draft' })

    const dry = await journal.reconcile(tarca, { ...RANGE, dryRun: true })
    expect(dry.added).toMatchObject([{ id: invoice.id, source: 'reconcile' }])
    expect(await journal.entries(RANGE)).toEqual([])

    const result = await journal.reconcile(tarca, RANGE)
    expect(result).toMatchObject({ range: RANGE, missing: [], mismatched: [], matched: 0 })
    expect(await journal.entries(RANGE)).toMatchObject([{ id: invoice.id, source: 'reconcile' }])

    const again = await journal.reconcile(tarca, RANGE)
    expect(again).toMatchObject({ added: [], matched: 1, changed: [] })
  })

  test('a csak a naplóban lévő tételt a türelmi idő után hiányzónak jelzi', async () => {
    const time = clock()
    const journal = createJournal(memoryJournal(), { now: time.now })
    const { tarca } = fakeTarca()
    const invoice = await tarca.documents.create(INVOICE)
    await journal.record(invoice)
    const foreign: JournalEntry = {
      id: 99_999,
      number: 'MASIK-1',
      type: 'invoice',
      action: 'created',
      date: DAY,
      relatedIds: [],
      grossTotal: 100,
      netTotal: 79,
      currency: 'HUF',
      recordedAt: '2026-10-02T12:00:00+02:00',
      source: 'manual',
    }
    await journal.storage.putEntry(foreign)

    expect((await journal.reconcile(tarca, RANGE)).missing).toEqual([])
    time.advance(119)
    expect((await journal.reconcile(tarca, RANGE)).missing).toEqual([])
    time.advance(1)
    const result = await journal.reconcile(tarca, RANGE)
    expect(result.missing).toEqual([foreign])
    expect(result.matched).toBe(1)
    expect((await journal.reconcile(tarca, { ...RANGE, graceSeconds: 600 })).missing).toEqual([])
  })

  test('az eltérő sorszámot, típust, bruttót és pénznemet jelzi, és nem írja felül a bejegyzést', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const { tarca } = fakeTarca()
    const invoice = await tarca.documents.create(INVOICE)
    const wrong: JournalEntry = {
      id: invoice.id ?? 0,
      number: 'ROSSZ-1',
      type: 'proforma',
      action: 'created',
      date: DAY,
      relatedIds: [],
      grossTotal: 1,
      netTotal: 1,
      currency: 'EUR',
      paymentStatus: 'outstanding',
      recordedAt: '2026-10-02T12:00:00+02:00',
      source: 'manual',
    }
    await journal.storage.putEntry(wrong)

    const result = await journal.reconcile(tarca, RANGE)

    expect(result.mismatched).toMatchObject([
      {
        id: invoice.id,
        fields: ['number', 'type', 'grossTotal', 'currency'],
        journal: wrong,
        billingo: { number: invoice.invoiceNumber, grossTotal: 12_700, currency: 'HUF' },
      },
    ])
    expect(result.matched).toBe(0)
    expect(await journal.storage.getEntry(invoice.id ?? 0)).toEqual(wrong)
  })

  test('a fizetett és a sztornózott állapotot jelzi, a bejegyzést nem írja át', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const fake = fakeTarca({ onDocument: (event) => journal.record(event) })
    const paid = await fake.tarca.documents.create(INVOICE)
    const cancelled = await fake.tarca.documents.create(INVOICE)
    await fake.tarca.documents.payments.add(paid.id ?? 0, {
      date: DAY,
      price: 12_700,
      paymentMethod: 'cash',
    })
    const cancellation = await fake.tarca.documents.cancel(cancelled.id ?? 0)

    const result = await journal.reconcile(fake.tarca, RANGE)

    expect(result.changed).toEqual([
      {
        id: paid.id,
        number: paid.invoiceNumber,
        cancelled: false,
        recordedPaymentStatus: 'outstanding',
        paymentStatus: 'paid',
      },
      {
        id: cancelled.id,
        number: cancelled.invoiceNumber,
        cancelled: true,
        recordedPaymentStatus: 'outstanding',
        paymentStatus: 'none',
      },
    ])
    expect(result).toMatchObject({ added: [], missing: [], mismatched: [], matched: 3 })
    expect((await journal.storage.getEntry(paid.id ?? 0))?.paymentStatus).toBe('outstanding')
    expect((await journal.storage.getEntry(cancellation.id ?? 0))?.relatedIds).toEqual([
      cancelled.id,
    ])
  })

  test('a sztornózást akkor is jelzi, ha a fizetési állapot nem változott', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const { tarca } = fakeTarca()
    const invoice = await tarca.documents.create(INVOICE)
    await journal.record(invoice)
    const api = {
      documents: {
        get: tarca.documents.get,
        async *all() {
          yield { ...invoice, cancelled: true }
        },
      },
    }

    const result = await journal.reconcile(api, RANGE)

    expect(result.changed).toEqual([
      {
        id: invoice.id,
        number: invoice.invoiceNumber,
        cancelled: true,
        recordedPaymentStatus: 'outstanding',
        paymentStatus: 'outstanding',
      },
    ])
    expect(result.matched).toBe(1)
  })

  test('a megszakító jelet a listának és a díjbekérő visszakeresésének is átadja', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    await journal.storage.putEntry({ ...entryOf(7, 'D-7'), type: 'proforma' })
    const controller = new AbortController()
    const signals: (AbortSignal | undefined)[] = []
    const api = {
      documents: {
        get: async (_id: number, options?: { readonly signal?: AbortSignal | undefined }) => {
          signals.push(options?.signal)
          throw new BillingoError('nincs', { category: 'forbidden' })
        },
        async *all(
          _query?: unknown,
          options?: { readonly signal?: AbortSignal | undefined },
        ): AsyncGenerator<never> {
          signals.push(options?.signal)
          yield* []
        },
      },
    }

    await journal.reconcile(api, { ...RANGE, signal: controller.signal })

    expect(signals).toEqual([controller.signal, controller.signal])
  })

  test('az archivált díjbekérőt egyenként visszakeresi, nem jelzi hiányzónak', async () => {
    const time = clock()
    const journal = createJournal(memoryJournal(), { now: time.now })
    const { billingo, tarca } = fakeTarca()
    const proforma = await tarca.documents.create({ ...INVOICE, type: 'proforma' })
    await journal.record(proforma)
    await tarca.documents.archive(proforma.id ?? 0)
    time.advance(600)

    const result = await journal.reconcile(tarca, RANGE)

    expect(result).toMatchObject({ missing: [], matched: 1 })
    expect(billingo.count('GetDocument')).toBe(1)
  })

  test('a másik profilból származó díjbekérő hiányzó, a többi lekérdezési hiba továbbmegy', async () => {
    const time = clock()
    const journal = createJournal(memoryJournal(), { now: time.now })
    const { billingo, tarca } = fakeTarca()
    const foreign: JournalEntry = {
      id: 4_242,
      number: 'D-1',
      type: 'proforma',
      action: 'created',
      date: DAY,
      relatedIds: [],
      grossTotal: 12_700,
      netTotal: 10_000,
      currency: 'HUF',
      recordedAt: '2026-10-02T12:00:00+02:00',
      source: 'manual',
    }
    await journal.storage.putEntry(foreign)
    time.advance(600)

    expect((await journal.reconcile(tarca, RANGE)).missing).toEqual([foreign])

    billingo.fail({ status: 500 }, { operation: 'GetDocument', times: 3 })
    await expect(journal.reconcile(tarca, RANGE)).rejects.toMatchObject({ category: 'server' })
  })

  test('100-as lapokban, a dátumtartományra szűrve kérdez, a tartományon kívülit kihagyja', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const { billingo, tarca } = fakeTarca()
    await tarca.documents.create(INVOICE)

    await journal.reconcile(tarca, { from: '2026-10-03', to: '2026-10-04' })
    const all = {
      documents: {
        get: tarca.documents.get,
        async *all() {
          yield* tarca.documents.all({ perPage: 100 })
        },
      },
    }
    const outside = await journal.reconcile(all, { from: '2026-10-03', to: '2026-10-04' })

    expect(
      billingo.requests.find((request) => request.operation === 'ListDocument')?.query,
    ).toEqual({
      page: '1',
      per_page: '100',
      start_date: '2026-10-03',
      end_date: '2026-10-04',
    })
    expect(outside.added).toEqual([])
    await expect(journal.reconcile(tarca, { from: DAY, to: '2027-10-03' })).rejects.toBeInstanceOf(
      RangeError,
    )
    await expect(journal.reconcile(tarca, { ...RANGE, graceSeconds: -1 })).rejects.toBeInstanceOf(
      RangeError,
    )
  })
})

describe('befejezetlen tételek több folyamat között', () => {
  test('ha a foglalás már egy másik hívásé, a biztos hiba sem törli', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    await journal.reserve('SHARED-1')

    await expect(
      journal.track('SHARED-1', async () => {
        throw new BillingoError('hibás adat', { category: 'validation' })
      }),
    ).rejects.toMatchObject({ category: 'validation' })

    expect(await journal.pending(RANGE)).toHaveLength(1)
  })

  test('in_progress, store_unavailable és a vendorId-visszakeresés hibája után a saját foglalás is megmarad', async () => {
    for (const error of [
      new BillingoError('másik folyamat', { category: 'in_progress' }),
      new BillingoError('tároló', { category: 'store_unavailable' }),
      new BillingoError('létezik, de nem olvasható', {
        category: 'rate_limit',
        operation: 'GetDocumentByVendorId',
      }),
      new BillingoError('időtúllépés', { category: 'timeout', operation: 'CreateDocument' }),
    ]) {
      const journal = createJournal(memoryJournal(), { now: () => NOW })
      await expect(
        journal.track('X-1', async () => {
          throw error
        }),
      ).rejects.toBe(error)
      expect(await journal.pending(RANGE), error.category).toHaveLength(1)
    }
  })

  test('a foglalást pontosan a createOnce szerint bizonytalan kategóriáknál tartja meg', async () => {
    const categories: readonly BillingoErrorCategory[] = [
      'auth',
      'nav_unavailable',
      'subscription',
      'forbidden',
      'not_found',
      'validation',
      'rate_limit',
      'server',
      'not_ready',
      'network',
      'timeout',
      'configuration',
      'unexpected_response',
      'in_progress',
      'store_unavailable',
    ]
    for (const category of categories) {
      const journal = createJournal(memoryJournal(), { now: () => NOW })
      const error = new BillingoError(category, { category, operation: 'CreateDocument' })
      await journal.track('C-1', () => Promise.reject(error)).catch(() => undefined)
      const kept = (await journal.pending(RANGE)).length === 1
      const unsettled =
        isUncertainOutcome(error) || category === 'in_progress' || category === 'store_unavailable'
      expect(kept, category).toBe(unsettled)
    }
  })

  test('a createOnce zár foglaltsága (in_progress) után a settle pótol', async () => {
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const { tarca } = fakeTarca()
    await tarca.documents.createOnce({ ...INVOICE, vendorId: 'LOCK-1' })

    await expect(
      journal.track('LOCK-1', async () => {
        throw new BillingoError('másik folyamat', { category: 'in_progress' })
      }),
    ).rejects.toMatchObject({ category: 'in_progress' })
    const settled = await journal.settle(tarca, { range: RANGE })

    expect(settled.recorded).toHaveLength(1)
    expect(await journal.entries(RANGE)).toMatchObject([{ vendorId: 'LOCK-1', source: 'settle' }])
  })

  test('az index nélkül maradt foglalás egy újabb foglaláskor láthatóvá válik', async () => {
    const store = memoryStore()
    const journal = createJournal(kvJournal(store), { now: () => NOW })
    await store.set(
      'tarca:journal:reservation:LOST-1',
      JSON.stringify({ vendorId: 'LOST-1', date: DAY, reservedAt: DAY }),
      60,
    )
    expect(await journal.pending(RANGE)).toEqual([])

    expect(await journal.reserve('LOST-1')).toBe(false)

    expect(await journal.pending(RANGE)).toMatchObject([{ vendorId: 'LOST-1' }])
  })
})

describe('onDocumentError: throw a naplóval', () => {
  test('ha a napló írása elbukik, a hívó DocumentHookError-t kap a bizonylattal, és a bizonylat megvan', async () => {
    const broken: JournalStorage = {
      ...memoryJournal(),
      putEntry: () => Promise.reject(new Error('DB leállt')),
    }
    const journal = createJournal(broken, { now: () => NOW })
    const { billingo, tarca } = fakeTarca({
      onDocument: (event) => journal.record(event),
      onDocumentError: 'throw',
    })

    const error = await tarca.receipts.create(RECEIPT).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DocumentHookError)
    expect((error as DocumentHookError).number).toBe('NYT-2026-1')
    expect(billingo.data.documents.size).toBe(1)
  })

  test('a track naplóírási hibája JournalWriteError az eredménnyel, a tétel befejezetlen marad', async () => {
    const storage = memoryJournal()
    const journal = createJournal(
      { ...storage, putEntry: () => Promise.reject(new Error('DB leállt')) },
      { now: () => NOW },
    )
    const { tarca } = fakeTarca()

    const error = await journal
      .track('WEB-1', () => tarca.receipts.createOnce({ ...RECEIPT, vendorId: 'WEB-1' }))
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(JournalWriteError)
    expect((error as JournalWriteError).vendorId).toBe('WEB-1')
    expect((error as JournalWriteError).result).toMatchObject({ created: true })
    expect((error as JournalWriteError).message).toContain('Ne állítsd ki újra')
    expect(await storage.listReservations(RANGE)).toHaveLength(1)
  })

  test('nem bizonylat eredménynél is JournalWriteError, a tétel befejezetlen marad', async () => {
    const storage = memoryJournal()
    const journal = createJournal(storage, { now: () => NOW })

    await expect(journal.track('W-2', async () => 'kész')).rejects.toBeInstanceOf(JournalWriteError)
    await expect(journal.track('W-3', async () => ({ ok: true }))).rejects.toBeInstanceOf(
      JournalWriteError,
    )
    await expect(journal.track('W-4', async () => null)).rejects.toBeInstanceOf(JournalWriteError)
    expect((await storage.listReservations(RANGE)).map((item) => item.vendorId).sort()).toEqual([
      'W-2',
      'W-3',
      'W-4',
    ])
  })
})

describe('kvJournal', () => {
  test('increment nélküli tárolóval configuration hibát dob', () => {
    const plain: KeyValueStore = { get: () => undefined, set: () => undefined, delete: () => {} }
    expect(() => kvJournal(plain)).toThrow(expect.objectContaining({ category: 'configuration' }))
  })

  test('érvénytelen megőrzési időre configuration hibát dob', () => {
    expect(() => kvJournal(memoryStore(), { retentionDays: 0 })).toThrow(BillingoError)
    expect(() => kvJournal(memoryStore(), { reservationTtlDays: Number.NaN })).toThrow(
      BillingoError,
    )
  })

  test('két folyamat párhuzamos írása sem veszít bejegyzést', async () => {
    const shared = memoryStore()
    const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3))
    const slowStore: KeyValueStore = {
      get: async (key) => {
        await jitter()
        return shared.get(key)
      },
      set: async (key, value, ttl) => {
        await jitter()
        return shared.set(key, value, ttl)
      },
      delete: (key) => shared.delete(key),
      increment: (key, ttl) => shared.increment?.(key, ttl) ?? 0,
      setIfAbsent: (key, value, ttl) => shared.setIfAbsent?.(key, value, ttl) ?? false,
    }
    const first = createJournal(kvJournal(slowStore), { now: () => NOW })
    const second = createJournal(kvJournal(slowStore), { now: () => NOW })
    const { tarca } = fakeTarca()
    const receipts = []
    for (let index = 0; index < 20; index++) receipts.push(await tarca.receipts.create(RECEIPT))

    await Promise.all(
      receipts.map((receipt, index) => (index % 2 === 0 ? first : second).record(receipt)),
    )
    await Promise.all(receipts.slice(0, 5).map((receipt) => second.record(receipt)))

    const entries = await first.entries(RANGE)
    expect(entries).toHaveLength(20)
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(20)
  })

  test('a sérült vagy idegen tárolt értéket kihagyja', async () => {
    const store = memoryStore()
    const storage = kvJournal(store, { prefix: 'app:j:' })
    const journal = createJournal(storage, { now: () => NOW })
    await journal.reserve('R-1')
    await store.set('app:j:day:2026-10-02:count', '4', 60)
    await store.set('app:j:day:2026-10-02:1', 'e:1', 60)
    await store.set('app:j:day:2026-10-02:2', 'ismeretlen:2', 60)
    await store.set('app:j:day:2026-10-02:3', 'e:', 60)
    await store.set('app:j:day:2026-10-02:4', 'e:2', 60)
    await store.set('app:j:entry:1', '{nem json', 60)
    await store.set(
      'app:j:entry:2',
      JSON.stringify({ id: 3, number: 'X', type: 'invoice', date: DAY }),
      60,
    )
    await store.set(
      'app:j:entry:6',
      JSON.stringify({ ...entryOf(6, 'E-6'), date: '2026/10/02' }),
      60,
    )
    await store.set('app:j:day:2026-10-02:count', '5', 60)
    await store.set('app:j:day:2026-10-02:5', 'v:5', 60)
    await store.set('app:j:entry:5', JSON.stringify(entryOf(5, 'E-5')), 60)
    await store.set('app:j:rday:2026-10-02:count', 'x', 60)

    expect(await journal.entries(RANGE)).toEqual([])
    expect(await journal.pending(RANGE)).toEqual([])
    await store.set('app:j:rday:2026-10-02:count', '2', 60)
    await store.set('app:j:rday:2026-10-02:2', 'v:R-2', 60)
    await store.set(
      'app:j:reservation:R-2',
      JSON.stringify({ vendorId: 'R-3', date: DAY, reservedAt: DAY }),
      60,
    )
    expect(await journal.pending(RANGE)).toMatchObject([{ vendorId: 'R-1' }])
    expect(await storage.getEntry(1)).toBeUndefined()
    expect(await storage.getEntry(2)).toBeUndefined()
    expect(await storage.getEntry(6)).toBeUndefined()
  })

  test('párhuzamos írásnál sem írja felül a már meglévő bejegyzést', async () => {
    const inner = memoryStore()
    let hideEntries = false
    const store: KeyValueStore = {
      ...inner,
      get: (key) => (hideEntries && key.includes(':entry:') ? undefined : inner.get(key)),
    }
    const storage = kvJournal(store)
    expect(await storage.putEntry(entryOf(1, 'E-1'))).toBe(true)

    hideEntries = true
    expect(await storage.putEntry({ ...entryOf(1, 'E-1'), grossTotal: 1 })).toBe(false)
    hideEntries = false

    expect(await storage.getEntry(1)).toEqual(entryOf(1, 'E-1'))
  })

  test('setIfAbsent nélküli (de increment-es) tárolón is működik', async () => {
    const inner = memoryStore()
    const store: KeyValueStore = {
      get: inner.get,
      set: inner.set,
      delete: inner.delete,
      increment: (key, ttl) => inner.increment?.(key, ttl) ?? 0,
    }
    const storage = kvJournal(store)
    const journal = createJournal(storage, { now: () => NOW })
    const { tarca } = fakeTarca()
    const receipt = await tarca.receipts.create(RECEIPT)
    await journal.record(receipt)

    expect(await storage.putEntry((await journal.entries(RANGE))[0] as JournalEntry)).toBe(false)
    await journal.reserve('R-1')
    expect(await journal.reserve('R-1')).toBe(false)
    expect(await journal.pending(RANGE)).toHaveLength(1)
    expect(await journal.entries(RANGE)).toHaveLength(1)
  })

  test('setIfAbsent nélküli tárolón, ha egy másik író közben a saját foglalását vagy bejegyzését írta be, false-t ad, és a track nem törli a másik foglalását', async () => {
    const inner = memoryStore()
    const store: KeyValueStore = {
      get: inner.get,
      delete: inner.delete,
      increment: (key, ttl) => inner.increment?.(key, ttl) ?? 0,
      set: async (key, value, ttl) => {
        await inner.set(key, value, ttl)
        if (key.includes(':reservation:') || key.includes(':entry:')) {
          const rival = { ...JSON.parse(value), reservedAt: 'másik', recordedAt: 'másik' }
          await inner.set(key, JSON.stringify(rival), ttl)
        }
      },
    }
    const storage = kvJournal(store)
    const journal = createJournal(storage, { now: () => NOW })

    expect(await journal.reserve('RACE-1')).toBe(false)
    await expect(
      journal.track('RACE-2', async () => {
        throw new BillingoError('hibás adat', { category: 'validation' })
      }),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(await storage.putEntry(entryOf(5, 'E-5'))).toBe(false)

    expect(
      (await journal.pending(RANGE)).map((reservation) => reservation.vendorId).sort(),
    ).toEqual(['RACE-1', 'RACE-2'])
    expect(await storage.getEntry(5)).toMatchObject({ id: 5, recordedAt: 'másik' })
  })

  test('a bejegyzés a megőrzési idővel, a foglalás a saját idejével íródik', async () => {
    const store = memoryStore()
    const set = vi.spyOn(store, 'set')
    const increment = vi.spyOn(store, 'increment')
    const setIfAbsent = vi.spyOn(store, 'setIfAbsent')
    const journal = createJournal(kvJournal(store, { retentionDays: 10, reservationTtlDays: 2 }), {
      now: () => NOW,
    })
    const { tarca } = fakeTarca()

    await journal.record(await tarca.receipts.create(RECEIPT))
    expect(
      [...set.mock.calls, ...increment.mock.calls, ...setIfAbsent.mock.calls].map((call) =>
        call.at(-1),
      ),
    ).toEqual([10 * 86_400, 10 * 86_400, 10 * 86_400])

    const ttls = () => [...set.mock.calls, ...setIfAbsent.mock.calls].map((call) => call[2])
    set.mockClear()
    setIfAbsent.mockClear()
    await journal.reserve('R-1')
    expect(ttls()).toEqual([2 * 86_400, 2 * 86_400])

    set.mockClear()
    setIfAbsent.mockClear()
    const fractional = kvJournal(store, { retentionDays: 1.5 })
    await fractional.putEntry(entryOf(9, 'E-9'))
    expect(ttls()).toEqual([2 * 86_400, 2 * 86_400])
  })

  test('resilientStore fölött a napi index írása nem vész el: a set hibája helyett a setIfAbsent ír', async () => {
    const inner = memoryStore()
    const flaky: KeyValueStore = {
      ...inner,
      set: (key, value, ttl) => {
        if (/:day:\d{4}-\d{2}-\d{2}:\d+$/.test(key)) throw new Error('a Redis nem érhető el')
        return inner.set(key, value, ttl)
      },
    }
    const journal = createJournal(kvJournal(resilientStore(flaky, { onError: () => undefined })), {
      now: () => NOW,
    })
    const { tarca } = fakeTarca()

    const created = await journal.track('V7', () =>
      tarca.documents.create({ ...INVOICE, vendorId: 'V7' }),
    )

    expect(await journal.entries(RANGE)).toMatchObject([{ id: created.id, vendorId: 'V7' }])
    expect(await journal.reconcile(tarca, RANGE)).toMatchObject({ added: [], matched: 1 })
  })

  test('setIfAbsent nélküli resilientStore fölött a napi index elnyelt hibája JournalWriteError, a settle pótolja', async () => {
    const inner = memoryStore()
    let failIndex = true
    const flaky: KeyValueStore = {
      get: inner.get,
      delete: inner.delete,
      increment: (key, ttl) => inner.increment?.(key, ttl) ?? 0,
      set: (key, value, ttl) => {
        if (failIndex && /:day:\d{4}-\d{2}-\d{2}:\d+$/.test(key)) {
          throw new Error('a Redis nem érhető el')
        }
        return inner.set(key, value, ttl)
      },
    }
    const journal = createJournal(kvJournal(resilientStore(flaky, { onError: () => undefined })), {
      now: () => NOW,
    })
    const { tarca } = fakeTarca()

    const failure = await journal
      .track('V8', () => tarca.documents.create({ ...INVOICE, vendorId: 'V8' }))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(JournalWriteError)
    expect((failure as JournalWriteError).cause).toMatchObject({ category: 'store_unavailable' })
    expect(await journal.entries(RANGE)).toEqual([])
    failIndex = false
    expect(await journal.settle(tarca)).toMatchObject({ recorded: [{ vendorId: 'V8' }] })
    expect(await journal.entries(RANGE)).toMatchObject([{ vendorId: 'V8' }])
  })

  test('setIfAbsent nélküli resilientStore fölött a bejegyzés elnyelt írása JournalWriteError, a foglalás megmarad, a settle pótolja', async () => {
    const inner = memoryStore()
    let failEntry = true
    const flaky: KeyValueStore = {
      get: inner.get,
      delete: inner.delete,
      increment: (key, ttl) => inner.increment?.(key, ttl) ?? 0,
      set: (key, value, ttl) => {
        if (failEntry && key.includes(':entry:')) throw new Error('a Redis nem érhető el')
        return inner.set(key, value, ttl)
      },
    }
    const journal = createJournal(kvJournal(resilientStore(flaky, { onError: () => undefined })), {
      now: () => NOW,
    })
    const { tarca } = fakeTarca()

    const failure = await journal
      .track('V9', () => tarca.documents.create({ ...INVOICE, vendorId: 'V9' }))
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(JournalWriteError)
    expect((failure as JournalWriteError).cause).toMatchObject({ category: 'store_unavailable' })
    expect(await journal.entries(RANGE)).toEqual([])
    expect(await journal.pending(RANGE)).toMatchObject([{ vendorId: 'V9' }])
    failEntry = false
    expect(await journal.settle(tarca)).toMatchObject({ recorded: [{ vendorId: 'V9' }] })
    expect(await journal.entries(RANGE)).toMatchObject([{ vendorId: 'V9' }])
  })

  test('setIfAbsent nélküli resilientStore fölött a foglalás elnyelt írása store_unavailable, a bizonylat ki sem állítódik', async () => {
    const inner = memoryStore()
    const flaky: KeyValueStore = {
      get: inner.get,
      delete: inner.delete,
      increment: (key, ttl) => inner.increment?.(key, ttl) ?? 0,
      set: (key, value, ttl) => {
        if (key.includes(':reservation:')) throw new Error('a Redis nem érhető el')
        return inner.set(key, value, ttl)
      },
    }
    const journal = createJournal(kvJournal(resilientStore(flaky, { onError: () => undefined })), {
      now: () => NOW,
    })
    const { billingo, tarca } = fakeTarca()

    await expect(
      journal.track('V10', () => tarca.documents.create({ ...INVOICE, vendorId: 'V10' })),
    ).rejects.toMatchObject({ category: 'store_unavailable' })
    expect(billingo.count('CreateDocument')).toBe(0)
  })

  test('a reconcile a tárolt, de indexből hiányzó bejegyzést újraindexeli, és nem jelzi újra', async () => {
    const store = memoryStore()
    const journal = createJournal(kvJournal(store), { now: () => NOW })
    const { tarca } = fakeTarca()
    const invoice = await tarca.documents.create(INVOICE)
    await store.set(
      `tarca:journal:entry:${invoice.id}`,
      JSON.stringify({ ...entryOf(invoice.id ?? 0, invoice.invoiceNumber ?? ''), source: 'hook' }),
      60,
    )

    const first = await journal.reconcile(tarca, RANGE)
    const second = await journal.reconcile(tarca, RANGE)

    expect(first.added).toMatchObject([{ id: invoice.id }])
    expect(await journal.entries(RANGE)).toMatchObject([{ id: invoice.id, source: 'hook' }])
    expect(second).toMatchObject({ added: [] })
  })
})

describe('reconcile saját tárolóval', () => {
  test('ha a tároló tartalmazza, de nem listázza és nem tudja újraindexelni a bejegyzést, hibát dob', async () => {
    const { tarca } = fakeTarca()
    const invoice = await tarca.documents.create(INVOICE)
    const stored = entryOf(invoice.id ?? 0, invoice.invoiceNumber ?? '')
    const storage: JournalStorage = {
      ...memoryJournal(),
      getEntry: async () => stored,
      putEntry: async () => false,
    }

    await expect(
      createJournal(storage, { now: () => NOW }).reconcile(tarca, RANGE),
    ).rejects.toThrow('újraindexelni')
  })

  test('Upstash fölött is olvasható: az automatikusan visszaalakított JSON-t és számot kezeli', async () => {
    const data = new Map<string, string>()
    const deserialize = (raw: string | undefined): unknown => {
      if (raw === undefined) return null
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    }
    const redis = {
      get: async (key: string) => deserialize(data.get(key)),
      set: async (key: string, value: string) => {
        data.set(key, value)
        return 'OK'
      },
      del: async (key: string) => (data.delete(key) ? 1 : 0),
      eval: async (script: string, keys: string[], args: string[]) => {
        const key = keys[0] ?? ''
        if (script.includes('INCR')) {
          const next = Number(data.get(key) ?? '0') + 1
          data.set(key, String(next))
          return next
        }
        if (data.has(key)) return 0
        data.set(key, args[0] ?? '')
        return 1
      },
    }
    const journal = createJournal(kvJournal(upstashRedisStore(redis)), { now: () => NOW })
    const { tarca } = fakeTarca()
    const receipt = await tarca.receipts.create(RECEIPT)

    await journal.record(receipt)
    await journal.reserve('12')

    expect(await journal.entries(RANGE)).toMatchObject([{ id: receipt.id, number: 'NYT-2026-1' }])
    expect(await journal.pending(RANGE)).toMatchObject([{ vendorId: '12' }])
  })
})
