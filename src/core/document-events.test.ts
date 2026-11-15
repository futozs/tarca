import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTarca } from '../client'
import type { DraftFinalizeInput } from '../documents/input'
import type { Document } from '../generated/billingo'
import type { PartnerInput } from '../partners/partners'
import { createFakeBillingoFetch, createMockTarca } from '../testing'
import type { HookWarning, TarcaHooks } from './context'
import {
  type DocumentEvent,
  DocumentHookError,
  emitDocumentEvent,
  isDocumentHookError,
} from './document-events'
import { BillingoError } from './errors'

const PARTNER: PartnerInput = {
  name: 'Vevő Kft.',
  address: { countryCode: 'HU', postCode: '1011', city: 'Budapest', address: 'Fő utca 1.' },
}

const INVOICE: DraftFinalizeInput = {
  partner: PARTNER,
  items: [{ name: 'Tanácsadás', quantity: 1, netUnitPrice: 10_000, vat: 27 }],
}

const RECEIPT = { items: [{ name: 'Kávé', grossUnitPrice: 890, vat: 27 }] }

const EVENT: DocumentEvent = {
  action: 'created',
  operation: 'CreateReceipt',
  document: { id: 7, invoiceNumber: 'NYT-2026-7', type: 'receipt' },
}

const failingHook = (): never => {
  throw new Error('a napló nem érhető el')
}

function fakeTarca(hooks: TarcaHooks) {
  const billingo = createFakeBillingoFetch()
  const tarca = createTarca({
    apiKey: 'teszt-kulcs',
    fetch: billingo.fetch,
    retryDelayMs: 0,
    hooks,
  })
  return { billingo, tarca }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('emitDocumentEvent', () => {
  test('hook nélkül nem csinál semmit', async () => {
    await expect(emitDocumentEvent(undefined, EVENT, { mode: 'throw' })).resolves.toBeUndefined()
  })

  test("alapból ('warn') console.warn-nal jelez a sorszámmal, és nem dob", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(emitDocumentEvent(failingHook, EVENT)).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('NYT-2026-7')
  })

  test('onWarning esetén oda jelez a console helyett, onDocument hookként', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const warnings: HookWarning[] = []

    await emitDocumentEvent(failingHook, EVENT, { warn: (warning) => warnings.push(warning) })

    expect(warn).not.toHaveBeenCalled()
    expect(warnings).toMatchObject([
      {
        hook: 'onDocument',
        operation: 'CreateReceipt',
        error: { message: 'a napló nem érhető el' },
      },
    ])
  })

  test("'throw' módban DocumentHookError-t dob, amely tartalmazza a bizonylatot", async () => {
    const error = await emitDocumentEvent(failingHook, EVENT, { mode: 'throw' }).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(DocumentHookError)
    expect(isDocumentHookError(error)).toBe(true)
    const hookError = error as DocumentHookError
    expect(hookError.name).toBe('DocumentHookError')
    expect(hookError.number).toBe('NYT-2026-7')
    expect(hookError.document).toBe(EVENT.document)
    expect(hookError.event).toBe(EVENT)
    expect((hookError.cause as Error).message).toBe('a napló nem érhető el')
    expect(hookError.message).toContain('ne állítsd ki újra')
  })

  test('sorszám nélküli bizonylatnál (piszkozat) az azonosítót írja', async () => {
    const draft: DocumentEvent = { ...EVENT, document: { id: 9, invoiceNumber: '', type: 'draft' } }

    const error = (await emitDocumentEvent(failingHook, draft, { mode: 'throw' }).catch(
      (caught: unknown) => caught,
    )) as DocumentHookError

    expect(error.number).toBeUndefined()
    expect(error.message).toContain('id: 9')
  })

  test('függvény módban a kezelő kapja meg a hibát; ha az is dob, DocumentHookError lesz', async () => {
    const handler = vi.fn()
    await emitDocumentEvent(failingHook, EVENT, { mode: handler })
    expect(handler).toHaveBeenCalledWith(expect.any(Error), EVENT)

    const rethrow = vi.fn(async () => {
      throw new Error('a tartalék mentés sem sikerült')
    })
    await expect(emitDocumentEvent(failingHook, EVENT, { mode: rethrow })).rejects.toMatchObject({
      name: 'DocumentHookError',
      cause: { message: 'a tartalék mentés sem sikerült' },
    })
    expect(isDocumentHookError(new Error('x'))).toBe(false)
  })

  test('a hookot kivárja: az aszinkron hook a hívás vége előtt lefut', async () => {
    const done: string[] = []
    await emitDocumentEvent(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      done.push('hook')
    }, EVENT)
    expect(done).toEqual(['hook'])
  })
})

describe('onDocument a kliensben', () => {
  test('minden új bizonylatnál egyszer szól, a befizetésnél és a meglévő createOnce-nál nem', async () => {
    const events: DocumentEvent[] = []
    const { tarca } = fakeTarca({ onDocument: (event) => void events.push(event) })

    const invoice = await tarca.documents.create({ ...INVOICE, vendorId: 'V-1' })
    const raw = await tarca.documents.createRaw({
      vendorId: 'RAW-1',
      partnerId: invoice.partner?.id ?? 0,
      blockId: 1,
      type: 'invoice',
      fulfillmentDate: '2026-11-15',
      dueDate: '2026-11-23',
      paymentMethod: 'cash',
      language: 'hu',
      currency: 'HUF',
      electronic: false,
      items: [
        {
          name: 'Nyers',
          unitPrice: 100,
          unitPriceType: 'net',
          quantity: 1,
          unit: 'db',
          vat: '27%',
        },
      ],
    })
    const once = await tarca.documents.createOnce({ ...INVOICE, vendorId: 'V-2' })
    const again = await tarca.documents.createOnce({ ...INVOICE, vendorId: 'V-2' })
    const draft = await tarca.documents.create({ ...INVOICE, type: 'draft' })
    const finalized = await tarca.documents.finalizeDraft(draft.id ?? 0, INVOICE)
    const proforma = await tarca.documents.create({ ...INVOICE, type: 'proforma' })
    const converted = await tarca.documents.createFromProforma(proforma.id ?? 0)
    const copy = await tarca.documents.copy(invoice.id ?? 0)
    await tarca.documents.archive(proforma.id ?? 0)
    await tarca.documents.deleteDraft(copy.id ?? 0)
    await tarca.documents.payments.add(raw.id ?? 0, {
      date: '2026-11-15',
      price: 127,
      paymentMethod: 'cash',
    })
    const modification = await tarca.documents.createModification(raw.id ?? 0, {
      items: [{ name: 'Engedmény', quantity: -1, netUnitPrice: 10, vat: 27 }],
    })
    const cancellation = await tarca.documents.cancel(invoice.id ?? 0)
    const receipt = await tarca.receipts.create({ ...RECEIPT, vendorId: 'NY-1' })
    const receiptOnce = await tarca.receipts.createOnce({ ...RECEIPT, vendorId: 'NY-2' })
    const receiptAgain = await tarca.receipts.createOnce({ ...RECEIPT, vendorId: 'NY-2' })
    const receiptDraft = await tarca.receipts.create({ ...RECEIPT, type: 'draft' })
    const receiptFinal = await tarca.receipts.finalizeDraft(receiptDraft.id ?? 0, RECEIPT)

    expect(again.created).toBe(false)
    expect(receiptAgain.created).toBe(false)
    expect(events.map((event) => [event.operation, event.action, event.document.id])).toEqual([
      ['CreateDocument', 'created', invoice.id],
      ['CreateDocument', 'created', raw.id],
      ['CreateDocument', 'created', once.document.id],
      ['CreateDocument', 'created', draft.id],
      ['CreateDocumentFromDraft', 'finalized', finalized.id],
      ['CreateDocument', 'created', proforma.id],
      ['CreateDocumentFromProforma', 'converted', converted.id],
      ['DocumentCopy', 'copied', copy.id],
      ['CreateModificationDocument', 'modified', modification.id],
      ['CancelDocument', 'cancelled', cancellation.id],
      ['CreateReceipt', 'created', receipt.id],
      ['CreateReceipt', 'created', receiptOnce.document.id],
      ['CreateReceipt', 'created', receiptDraft.id],
      ['CreateReceiptFromDraft', 'finalized', receiptFinal.id],
    ])
    expect(events.map((event) => event.vendorId)).toEqual([
      'V-1',
      'RAW-1',
      'V-2',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'NY-1',
      'NY-2',
      undefined,
      undefined,
    ])
    expect(
      events.filter((event) => event.sourceId !== undefined).map((event) => event.sourceId),
    ).toEqual([proforma.id, invoice.id, raw.id, invoice.id])
    expect(events.find((event) => event.action === 'cancelled')?.document).toEqual(cancellation)
  })

  test('a bizonytalan hiba után visszakeresett bizonylatnál is szól, egyszer', async () => {
    const events: DocumentEvent[] = []
    const { billingo, tarca } = fakeTarca({ onDocument: (event) => void events.push(event) })
    billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })

    const result = await tarca.documents.createOnce(
      { ...INVOICE, vendorId: 'ELVESZETT-1' },
      { recoveryDelayMs: 0 },
    )

    expect(result.created).toBe(true)
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      vendorId: 'ELVESZETT-1',
      document: { id: result.document.id },
    })
  })

  test('a kiállítás hibájánál nem szól', async () => {
    const onDocument = vi.fn()
    const { billingo, tarca } = fakeTarca({ onDocument })
    billingo.fail({ status: 402 }, { operation: 'CreateDocument' })

    await expect(tarca.documents.create(INVOICE)).rejects.toBeInstanceOf(BillingoError)

    expect(onDocument).not.toHaveBeenCalled()
  })

  test('a hookot kivárja, mielőtt a create visszatér', async () => {
    const order: string[] = []
    const { tarca } = fakeTarca({
      onDocument: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push('hook')
      },
    })

    await tarca.receipts.create(RECEIPT)
    order.push('create')

    expect(order).toEqual(['hook', 'create'])
  })
})

describe('onDocumentError a kliensben', () => {
  test("'throw' módban a createOnce a hibát adja, a számla mégis elkészült, és nem lesz második", async () => {
    const { billingo, tarca } = fakeTarca({ onDocument: failingHook, onDocumentError: 'throw' })

    const error = await tarca.documents
      .createOnce({ ...INVOICE, vendorId: 'HOOK-1' })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DocumentHookError)
    const hookError = error as DocumentHookError
    expect(hookError.number).toBe(billingo.data.documents.get(1)?.document.invoiceNumber)
    expect(hookError.event).toMatchObject({ vendorId: 'HOOK-1', operation: 'CreateDocument' })
    expect(billingo.data.documents.size).toBe(1)
    const again = await tarca.documents.createOnce({ ...INVOICE, vendorId: 'HOOK-1' })
    expect(again).toMatchObject({ created: false, document: { id: 1 } })
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  test('alapból az onWarning kapja a hibát, a hívás sikeres', async () => {
    const warnings: HookWarning[] = []
    const { tarca } = fakeTarca({
      onDocument: failingHook,
      onWarning: (warning) => warnings.push(warning),
    })

    const receipt = await tarca.receipts.create(RECEIPT)
    await tarca.documents.cancel(receipt.id ?? 0)

    expect(warnings.map((warning) => [warning.hook, warning.operation])).toEqual([
      ['onDocument', 'CreateReceipt'],
      ['onDocument', 'CancelDocument'],
    ])
    expect(warnings[0]?.message).toContain(receipt.invoiceNumber)
  })

  test('a dobó vagy elutasító onWarning sem töri meg a már kiállított bizonylat hívását', async () => {
    for (const onWarning of [
      () => {
        throw new Error('onWarning dob')
      },
      () => Promise.reject(new Error('onWarning elutasít')),
    ]) {
      const { billingo, tarca } = fakeTarca({
        onDocument: failingHook,
        onWarning,
      })

      await expect(tarca.receipts.create(RECEIPT)).resolves.toMatchObject({ type: 'receipt' })
      expect(billingo.count('CreateReceipt')).toBe(1)
    }
  })

  test('a kezelőfüggvény a bizonylattal együtt kapja a hibát', async () => {
    const handled: Document[] = []
    const { tarca } = fakeTarca({
      onDocument: failingHook,
      onDocumentError: (_error, event) => void handled.push(event.document),
    })

    const receipt = await tarca.receipts.create(RECEIPT)

    expect(handled).toEqual([receipt])
  })

  test('érvénytelen onDocumentError configuration hiba a createTarca-nál', () => {
    expect(() =>
      createTarca({
        apiKey: 'k',
        fetch: createFakeBillingoFetch().fetch,
        hooks: { onDocumentError: 'ignore' as never },
      }),
    ).toThrow(expect.objectContaining({ category: 'configuration' }))
  })

  test('a mock tárca ugyanígy viselkedik', async () => {
    const tarca = createMockTarca({ hooks: { onDocument: failingHook, onDocumentError: 'throw' } })

    await expect(tarca.receipts.create(RECEIPT)).rejects.toBeInstanceOf(DocumentHookError)

    expect(tarca.billingo.data.documents.size).toBe(1)
  })
})
