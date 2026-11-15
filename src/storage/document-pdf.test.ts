import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTarca } from '../client'
import { BillingoError } from '../core/errors'
import type { DraftFinalizeInput } from '../documents/input'
import { createFakeBillingoFetch } from '../testing'
import { storeDocumentPdf } from './document-pdf'
import { StorageError } from './errors'
import { memoryStorage } from './memory'

const NOW = new Date('2026-09-16T10:00:00Z')

const INVOICE: DraftFinalizeInput = {
  partner: {
    name: 'Vevő Kft.',
    address: { countryCode: 'HU', postCode: '1011', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Tanácsadás', quantity: 1, netUnitPrice: 10_000, vat: 27 }],
}

function setup() {
  const billingo = createFakeBillingoFetch({ now: () => NOW })
  const tarca = createTarca({ apiKey: 'teszt-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  return { billingo, tarca, storage: memoryStorage() }
}

const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes)

afterEach(() => {
  vi.useRealTimers()
})

describe('storeDocumentPdf', () => {
  test('a kiállított számla PDF-jét a sorszámából képzett kulcsra menti', async () => {
    const { billingo, tarca, storage } = setup()
    const invoice = await tarca.documents.create(INVOICE)

    const stored = await storeDocumentPdf(tarca, storage, invoice)

    expect(stored).toMatchObject({
      key: 'szamlak/2026/09/2026-1.pdf',
      contentType: 'application/pdf',
    })
    expect(text(await storage.get(stored.key))).toContain(`%PDF-1.4\n% tarca hamis Billingo`)
    expect(billingo.count('GetDocument')).toBe(0)
    expect(billingo.count('DownloadDocument')).toBe(1)
  })

  test('azonosítóval lekéri a bizonylatot a kulcshoz, megadott kulccsal nem', async () => {
    const { billingo, tarca, storage } = setup()
    const receipt = await tarca.receipts.create({
      items: [{ name: 'Kávé', grossUnitPrice: 890, vat: 27 }],
    })

    const byId = await storeDocumentPdf(tarca, storage, receipt.id ?? 0)
    const byKey = await storeDocumentPdf(tarca, storage, receipt.id ?? 0, {
      key: 'sajat/nyugta.pdf',
    })

    expect(byId.key).toBe('nyugtak/2026/09/NYT-2026-1.pdf')
    expect(byKey.key).toBe('sajat/nyugta.pdf')
    expect(billingo.count('GetDocument')).toBe(1)
    expect([...storage.files.keys()]).toEqual([
      'nyugtak/2026/09/NYT-2026-1.pdf',
      'sajat/nyugta.pdf',
    ])
  })

  test('kivárja a 202-t (a PDF még készül), és utána ment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const { billingo, tarca, storage } = setup()
    const invoice = await tarca.documents.create(INVOICE)
    billingo.fail('notReady', { operation: 'DownloadDocument', times: 2 })

    const pending = storeDocumentPdf(tarca, storage, invoice)
    await vi.advanceTimersByTimeAsync(3_000)

    await expect(pending).resolves.toMatchObject({ key: 'szamlak/2026/09/2026-1.pdf' })
    expect(billingo.count('DownloadDocument')).toBe(3)
    expect(storage.files.size).toBe(1)
  })

  test('ha a PDF a maxWaitMs alatt sem készül el, not_ready hibát ad, és nem ment semmit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const { billingo, tarca, storage } = setup()
    const invoice = await tarca.documents.create(INVOICE)
    billingo.fail('notReady', { operation: 'DownloadDocument', times: 10 })

    const pending = storeDocumentPdf(tarca, storage, invoice, { maxWaitMs: 1_500 }).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(2_000)

    expect(await pending).toMatchObject({ name: 'BillingoError', category: 'not_ready' })
    expect(storage.files.size).toBe(0)
  })

  test('piszkozatnál letöltés nélkül StorageError', async () => {
    const { billingo, tarca, storage } = setup()
    const draft = await tarca.documents.create({ ...INVOICE, type: 'draft' })

    await expect(storeDocumentPdf(tarca, storage, draft)).rejects.toMatchObject({
      name: 'StorageError',
      operation: 'key',
    })
    await expect(storeDocumentPdf(tarca, storage, draft.id ?? 0)).rejects.toBeInstanceOf(
      StorageError,
    )
    expect(billingo.count('DownloadDocument')).toBe(0)
  })

  test('azonosító nélküli bizonylatnál StorageError, ismeretlen azonosítónál a Billingo hibája', async () => {
    const { tarca, storage } = setup()

    await expect(
      storeDocumentPdf(tarca, storage, {
        type: 'invoice',
        invoiceNumber: 'E-1',
        invoiceDate: '2026-09-16',
      }),
    ).rejects.toThrow('nincs azonosítója')
    await expect(storeDocumentPdf(tarca, storage, 999)).rejects.toBeInstanceOf(BillingoError)
  })

  test('a tárhely hibáját továbbadja, a megszakítást átadja a letöltésnek', async () => {
    const { tarca } = setup()
    const invoice = await tarca.documents.create(INVOICE)
    const failing = { put: () => Promise.reject(new StorageError('tele', { operation: 'put' })) }
    const controller = new AbortController()
    controller.abort(new Error('megszakítva'))

    await expect(storeDocumentPdf(tarca, failing, invoice)).rejects.toThrow('tele')
    await expect(
      storeDocumentPdf(tarca, memoryStorage(), invoice, { signal: controller.signal }),
    ).rejects.toThrow('megszakítva')
  })

  test('azonosítónál a bizonylat lekérése is megkapja a megszakító jelet', async () => {
    const { tarca, storage } = setup()
    const invoice = await tarca.documents.create(INVOICE)
    const controller = new AbortController()
    const signals: (AbortSignal | undefined)[] = []
    const source = {
      documents: {
        get: async (_id: number, options?: { readonly signal?: AbortSignal | undefined }) => {
          signals.push(options?.signal)
          return invoice
        },
        pdf: tarca.documents.pdf,
      },
    }

    await storeDocumentPdf(source, storage, invoice.id ?? 0, { signal: controller.signal })

    expect(signals).toEqual([controller.signal])
  })

  test('bizonylat mellett megadott kulcsot is tiszteletben tart', async () => {
    const { tarca, storage } = setup()
    const invoice = await tarca.documents.create(INVOICE)

    const stored = await storeDocumentPdf(tarca, storage, invoice, { key: 'sajat/szamla.pdf' })

    expect(stored.key).toBe('sajat/szamla.pdf')
    expect([...storage.files.keys()]).toEqual(['sajat/szamla.pdf'])
  })
})
