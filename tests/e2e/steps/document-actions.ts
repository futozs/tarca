import { expect } from 'vitest'
import { addBudapestDays, todayInBudapest } from '../../../src/core/dates'
import { isBillingoError } from '../../../src/core/errors'
import type { OperationId } from '../../../src/core/operations'
import type { DocumentItemInput } from '../../../src/documents/input'
import type { Document } from '../../../src/generated/billingo'
import { type E2eContext, type E2eExclusions, FATAL_CATEGORIES } from '../context'
import { recordIssued } from './documents'

export const DOCUMENT_ACTIONS_E2E_OPERATIONS: readonly OperationId[] = [
  'GetDocument',
  'DownloadDocument',
  'PosPrint',
  'GetPublicUrl',
  'GetOnlineSzamlaStatus',
  'GetDocumentReminderEventList',
  'SendDocument',
  'UpdatePayment',
  'GetPayment',
  'DeletePayment',
  'DocumentCopy',
  'DeleteDocument',
  'CreateDocumentFromProforma',
  'ArchiveDocument',
  'CreateDocument',
  'CreateModificationDocument',
  'CancelDocument',
]

export const DOCUMENT_ACTIONS_E2E_EXCLUDED: E2eExclusions = {}

export const DOCUMENT_CANCELLATION_E2E_OPERATIONS: readonly OperationId[] = [
  'CancelDocument',
  'GetDocument',
]

export const DOCUMENT_CANCELLATION_E2E_EXCLUDED: E2eExclusions = {}

const PDF_SIGNATURE = '%PDF-'

const NO_NAV_SETTINGS = {
  transactionId: '',
  status: 'no_online_szamla_settings',
  messages: [
    {
      validationResultCode: '',
      validationErrorCode: '',
      humanReadableMessage: 'NAV Online Számla összeköttetés nincs beállítva.',
    },
  ],
}

const NAV_RECORD_POLLS = 40

async function navStatusOnceRecorded(ctx: E2eContext, id: number) {
  for (let poll = 1; poll < NAV_RECORD_POLLS; poll += 1) {
    const status = await ctx.tarca.documents.navStatus(id)
    if (status !== null) return status
  }
  return ctx.tarca.documents.navStatus(id)
}

function signature(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.slice(0, PDF_SIGNATURE.length))
}

export function cancellationOrder(ctx: E2eContext): number[] {
  const proformaId = ctx.state.proformaId
  return [...(ctx.state.issuedDocumentIds ?? [])].reverse().filter((id) => id !== proformaId)
}

export function defineDocumentActionsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  const invoiceId = (): number => ctx.required(ctx.state.invoiceId, 'fő számla id')
  const line = (label: string, netUnitPrice: number): DocumentItemInput => ({
    name: ctx.name(label),
    netUnitPrice,
    quantity: 1,
    vat: 27,
  })
  let invoiceNumber = ''

  step('pdf: a fő számla PDF-je, application/pdf, a fájlnév a sorszám', async () => {
    const invoice = await ctx.tarca.documents.get(invoiceId())
    invoiceNumber = ctx.required(invoice.invoiceNumber, 'fő számla sorszáma')
    const file = await ctx.tarca.documents.pdf(invoiceId())
    expect(signature(file.bytes)).toBe(PDF_SIGNATURE)
    expect(file.contentType).toBe('application/pdf')
    expect(file.filename).toBe(`${invoiceNumber}.pdf`)
  })
  step('posPdf 80 mm: PDF bájtok application/octet-stream tartalomtípussal', async () => {
    const file = await ctx.tarca.documents.posPdf(invoiceId(), { size: 80 })
    expect(signature(file.bytes)).toBe(PDF_SIGNATURE)
    expect(file.contentType).toBe('application/octet-stream')
    expect(file.filename).toBe(`${invoiceNumber}.pdf`)
  })
  step('publicUrl: a document-access hivatkozás az API hostján', async () => {
    const url = await ctx.tarca.documents.publicUrl(invoiceId())
    expect(url).toMatch(/^https:\/\/api\.billingo\.hu\/document-access\/[A-Za-z0-9]{32}$/)
  })
  step(
    'navStatus: a NAV-rekord elkészülte után a teszt profilon 200 no_online_szamla_settings',
    async () => {
      expect(await navStatusOnceRecorded(ctx, invoiceId())).toEqual(NO_NAV_SETTINGS)
      const finalized = ctx.required(ctx.state.draftId, 'piszkozatból véglegesített számla id')
      expect.soft(await navStatusOnceRecorded(ctx, finalized)).toEqual(NO_NAV_SETTINGS)
    },
  )
  step('reminders: küldés előtt három üres lista', async () => {
    expect(await ctx.tarca.documents.reminders(invoiceId())).toEqual({
      sentReminders: [],
      upcomingReminders: [],
      sentPostalMail: [],
    })
  })
  step('send: csak a BILLINGO_E2E_EMAIL címre, a válasz ugyanezt a címet adja', async () => {
    const email = ctx.email()
    const result = await ctx.tarca.documents.send(invoiceId(), { emails: [email] })
    expect(result.emails?.length).toBe(1)
    expect(result.emails?.[0] === email).toBe(true)
  })
  step('befizetés: részösszeg, lista, hozzáadás, törlés, és a payment_status követi', async () => {
    const id = invoiceId()
    const today = todayInBudapest()
    const partial = await ctx.tarca.documents.payments.replace(id, [
      { date: today, price: 500, paymentMethod: 'wire_transfer' },
    ])
    expect(partial).toEqual([
      {
        date: today,
        price: 500,
        paymentMethod: 'wire_transfer',
        voucherNumber: '',
        conversionRate: 1,
      },
    ])
    expect(await ctx.tarca.documents.payments.list(id)).toEqual(partial)
    expect.soft((await ctx.tarca.documents.get(id)).paymentStatus).toBe('partially_paid')
    const full = await ctx.tarca.documents.payments.add(id, {
      date: today,
      price: 770,
      paymentMethod: 'cash',
    })
    expect(full.map((payment) => [payment.price, payment.paymentMethod])).toEqual([
      [500, 'wire_transfer'],
      [770, 'cash'],
    ])
    expect((await ctx.tarca.documents.get(id)).paymentStatus).toBe('paid')
    await ctx.tarca.documents.payments.clear(id)
    expect(await ctx.tarca.documents.payments.list(id)).toEqual([])
    expect((await ctx.tarca.documents.get(id)).paymentStatus).toBe('outstanding')
  })
  step('copy: a másolat piszkozat sorszám nélkül, utána törölhető', async () => {
    const copy = await ctx.tarca.documents.copy(invoiceId())
    const id = ctx.required(copy.id, 'másolat id')
    expect([copy.type, copy.invoiceNumber, copy.paymentStatus]).toEqual(['draft', '', 'none'])
    expect(copy.items?.map((item) => item.name)).toEqual([ctx.name('createOnce tétel')])
    await ctx.tarca.documents.deleteDraft(id)
  })
  step(
    'createFromProforma: fizetett számla a díjbekérőből, utána a díjbekérő archiválható',
    async () => {
      const proformaId = ctx.required(ctx.state.proformaId, 'díjbekérő id')
      const invoice = await ctx.tarca.documents.createFromProforma(proformaId, {
        comment: ctx.name('díjbekérőből'),
      })
      recordIssued(ctx, invoice)
      expect([invoice.type, invoice.paymentStatus, invoice.grossTotal]).toEqual([
        'invoice',
        'paid',
        1270,
      ])
      expect([invoice.fulfillmentDate, invoice.dueDate]).toEqual([
        todayInBudapest(),
        addBudapestDays(new Date(), 8),
      ])
      expect(invoice.relatedDocuments?.map((document) => document.id)).toEqual([proformaId])
      expect(await ctx.tarca.documents.archive(proformaId)).toBeUndefined()
    },
  )
  step(
    'createModification külön számlán; utána az eredeti nem sztornózható (400, magyar tipp)',
    async () => {
      const original = await ctx.tarca.documents.create({
        partner: ctx.required(ctx.state.partnerId, 'partner id'),
        comment: ctx.name('módosítandó'),
        items: [line('módosítandó tétel', 1000)],
      })
      const id = ctx.required(original.id, 'módosítandó számla id')
      ctx.state.modifiedInvoiceId = id
      expect.soft([null, NO_NAV_SETTINGS]).toContainEqual(await ctx.tarca.documents.navStatus(id))
      const modification = await ctx.tarca.documents.createModification(id, {
        comment: ctx.name('módosító'),
        items: [line('módosítás', -1000)],
      })
      expect([modification.type, modification.grossTotal]).toEqual(['modification', -1270])
      expect(modification.relatedDocuments?.map((document) => document.id)).toEqual([id])
      const refused = await ctx.tarca.documents
        .cancel(id, { reason: ctx.name('módosított számla sztornó próba') })
        .catch((caught: unknown) => caught)
      expect(refused).toMatchObject({ category: 'validation', status: 400 })
      expect((refused as { apiMessage?: string }).apiMessage).toMatch(/^Cannot cancel the document/)
      expect((refused as { hint?: string }).hint).toContain('módosító számla után')
      const after = await ctx.tarca.documents.get(id)
      expect.soft([after.cancelled, after.correctionType]).toEqual([false, 'modified'])
    },
  )
}

export function defineDocumentCancellationSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()

  step(
    'sztornó minden kiállított bizonylatra, a legújabb elöl (a végszámla az előleg előtt); a módosítási lánc és az archivált díjbekérő marad',
    async () => {
      const order = cancellationOrder(ctx)
      const finalId = ctx.required(ctx.state.finalInvoiceId, 'végszámla id')
      const advanceId = ctx.required(ctx.state.advanceInvoiceId, 'előleg id')
      expect(order.indexOf(finalId)).toBeLessThan(order.indexOf(advanceId))
      const receiptBlockId = ctx.required(ctx.state.receiptBlockId, 'nyugtatömb id')
      const mainId = ctx.required(ctx.state.invoiceId, 'fő számla id')
      const failures: string[] = []
      const cancelled: Document[] = []
      for (const id of order) {
        try {
          const storno = await ctx.tarca.documents.cancel(id, {
            reason: ctx.name('takarítás'),
            ...(id === mainId ? { recipients: [ctx.email()] } : {}),
          })
          cancelled.push(storno)
          const expected =
            storno.blockId === receiptBlockId ? 'receipt_cancellation' : 'cancellation'
          if (storno.type !== expected) failures.push(`${id}: ${String(storno.type)} ≠ ${expected}`)
          if (!storno.relatedDocuments?.some((document) => document.id === id)) {
            failures.push(`${id}: a sztornó nem hivatkozik az eredetire`)
          }
        } catch (error) {
          if (isBillingoError(error) && FATAL_CATEGORIES.has(error.category)) throw error
          failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      expect(failures).toEqual([])
      expect(cancelled).toHaveLength(order.length)
      const main = await ctx.tarca.documents.get(mainId)
      expect([main.cancelled, main.correctionType, main.paymentStatus]).toEqual([
        true,
        'canceled',
        'none',
      ])
    },
  )
}
