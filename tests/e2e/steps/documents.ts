import { expect } from 'vitest'
import { todayInBudapest } from '../../../src/core/dates'
import type { OperationId } from '../../../src/core/operations'
import type { DocumentItemInput } from '../../../src/documents/input'
import type { DocumentListQuery } from '../../../src/documents/query'
import type { Document, DocumentSummary } from '../../../src/generated/billingo'
import type { E2eContext, E2eExclusions } from '../context'

export const DOCUMENTS_E2E_OPERATIONS: readonly OperationId[] = [
  'CreateDocument',
  'GetDocument',
  'CreateDocumentFromDraft',
  'DeleteDocument',
  'GetDocumentByVendorId',
  'ListDocument',
]

export const DOCUMENTS_E2E_EXCLUDED: E2eExclusions = {}

export const HUF_ROUNDING_ITEMS: readonly DocumentItemInput[] = [
  { name: '27% nettó 10000 x 1', netUnitPrice: 10000, quantity: 1, vat: 27 },
  { name: '5% nettó 1000 x 3', netUnitPrice: 1000, quantity: 3, vat: 5 },
  { name: '27% bruttó 1270 x 3', grossUnitPrice: 1270, quantity: 3, vat: 27 },
]

export const HUF_ROUNDING_SUMMARY: Required<DocumentSummary> = {
  netAmount: 16000,
  netAmountLocal: 16000,
  grossAmountLocal: 19660,
  vatAmount: 3660,
  vatAmountLocal: 3660,
  vatRateSummary: [
    {
      vatName: '27%',
      vatPercentage: 0.27,
      vatRateNetAmount: 13000,
      vatRateVatAmount: 3510,
      vatRateVatAmountLocal: 3510,
      vatRateGrossAmount: 16510,
    },
    {
      vatName: '5%',
      vatPercentage: 0.05,
      vatRateNetAmount: 3000,
      vatRateVatAmount: 150,
      vatRateVatAmountLocal: 150,
      vatRateGrossAmount: 3150,
    },
  ],
}

export const EUR_CONVERSION_RATE = 389.17

export const EUR_ROUNDING_ITEMS: readonly DocumentItemInput[] = [
  { name: 'EUR 27% nettó 12.34 x 3', netUnitPrice: 12.34, quantity: 3, vat: 27 },
  { name: 'EUR 5% nettó 0.99 x 7', netUnitPrice: 0.99, quantity: 7, vat: 5 },
]

export const EUR_ROUNDING_SUMMARY: Required<DocumentSummary> = {
  netAmount: 43.95,
  netAmountLocal: 17104.0215,
  grossAmountLocal: 21128.0393,
  vatAmount: 10.34,
  vatAmountLocal: 4024,
  vatRateSummary: [
    {
      vatName: '27%',
      vatPercentage: 0.27,
      vatRateNetAmount: 37.02,
      vatRateVatAmount: 10,
      vatRateVatAmountLocal: 3890,
      vatRateGrossAmount: 47.02,
    },
    {
      vatName: '5%',
      vatPercentage: 0.05,
      vatRateNetAmount: 6.93,
      vatRateVatAmount: 0.35,
      vatRateVatAmountLocal: 135,
      vatRateGrossAmount: 7.28,
    },
  ],
}

const LIST_WAIT_MS = 90_000
const LIST_POLL_MS = 8_000

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + LIST_WAIT_MS
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() + LIST_POLL_MS > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, LIST_POLL_MS))
  }
}

export function recordIssued(ctx: E2eContext, document: Document): number {
  const id = ctx.required(document.id, 'kiállított bizonylat id')
  ctx.state.issuedDocumentIds = [...(ctx.state.issuedDocumentIds ?? []), id]
  return id
}

export function defineDocumentsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  const vendorId = ctx.vendorId('szamla')
  const once = { comment: ctx.name('createOnce'), vendorId }
  const line = (label: string, netUnitPrice: number): DocumentItemInput => ({
    name: ctx.name(label),
    netUnitPrice,
    quantity: 1,
    vat: 27,
  })
  const partner = (): number => ctx.required(ctx.state.partnerId, 'partner id')
  let startedAt = new Date()

  step('piszkozat: létrehozás az alapértelmezett számlatömbbe, lekérés', async () => {
    startedAt = new Date(Date.now() - 5 * 60_000)
    const draft = await ctx.tarca.documents.create({
      type: 'draft',
      partner: partner(),
      items: [line('piszkozat tétel', 1000)],
      comment: ctx.name('piszkozat'),
    })
    ctx.state.draftId = ctx.required(draft.id, 'piszkozat id')
    expect([draft.type, draft.invoiceNumber, draft.paymentStatus]).toEqual(['draft', '', 'none'])
    expect(draft.blockId).toBe(ctx.required(ctx.state.blockId, 'számlatömb id'))
    const fetched = await ctx.tarca.documents.get(ctx.state.draftId)
    expect([fetched.id, fetched.type, fetched.items?.[0]?.name]).toEqual([
      ctx.state.draftId,
      'draft',
      ctx.name('piszkozat tétel'),
    ])
  })
  step('piszkozat véglegesítése: ugyanaz az id, számla és sorszám lesz belőle', async () => {
    const id = ctx.required(ctx.state.draftId, 'piszkozat id')
    const invoice = await ctx.tarca.documents.finalizeDraft(id, {
      partner: partner(),
      items: [line('piszkozat tétel', 1000)],
      comment: ctx.name('piszkozatból'),
    })
    recordIssued(ctx, invoice)
    expect([invoice.id, invoice.type, invoice.paymentStatus]).toEqual([
      id,
      'invoice',
      'outstanding',
    ])
    expect(invoice.invoiceNumber).not.toBe('')
    expect(invoice.grossTotal).toBe(1270)
  })
  step(
    'createOnce kétszer ugyanazzal a vendorId-val: egy számla, created egyszer igaz',
    async () => {
      const input = { ...once, partner: partner(), items: [line('createOnce tétel', 1000)] }
      const first = await ctx.tarca.documents.createOnce(input)
      ctx.state.invoiceId = recordIssued(ctx, first.document)
      const second = await ctx.tarca.documents.createOnce(input)
      expect([first.created, second.created]).toEqual([true, false])
      expect(second.document.id).toBe(ctx.state.invoiceId)
      expect(first.document.type).toBe('invoice')
    },
  )
  step(
    'a sima create ugyanazzal a vendorId-val 400 „Duplicate vendor id.”, nem állít ki másodikat',
    async () => {
      const error = await ctx.tarca.documents
        .create({ ...once, partner: partner(), items: [line('createOnce tétel', 1000)] })
        .catch((caught: unknown) => caught)
      expect(error).toMatchObject({ category: 'validation', status: 400 })
      expect((error as { apiMessage?: string }).apiMessage).toMatch(/^Duplicate vendor id\./)
    },
  )
  step('getByVendorId a számlát adja, a findByVendorId hiányzó vendorId-ra null', async () => {
    const found = await ctx.tarca.documents.getByVendorId(vendorId)
    expect(found.id).toBe(ctx.state.invoiceId)
    expect(await ctx.tarca.documents.findByVendorId(ctx.vendorId('nincs-ilyen'))).toBeNull()
  })
  step('kerekítés: forintos számla, nettó és bruttó egységár, két áfakulcs', async () => {
    const invoice = await ctx.tarca.documents.create({
      partner: partner(),
      comment: ctx.name('kerekítés HUF'),
      items: HUF_ROUNDING_ITEMS,
    })
    recordIssued(ctx, invoice)
    expect(invoice.summary).toEqual(HUF_ROUNDING_SUMMARY)
    expect(invoice.grossTotal).toBe(19660)
    expect(invoice.items?.map((item) => item.netUnitAmount)).toEqual([10000, 1000, 1000.000001])
  })
  step('kerekítés: euró számla árfolyammal, a forint áfa kulcsonként és összesen', async () => {
    const invoice = await ctx.tarca.documents.create({
      partner: partner(),
      comment: ctx.name('kerekítés EUR'),
      currency: 'EUR',
      conversionRate: EUR_CONVERSION_RATE,
      items: EUR_ROUNDING_ITEMS,
    })
    recordIssued(ctx, invoice)
    expect(invoice.summary).toEqual(EUR_ROUNDING_SUMMARY)
    expect([invoice.grossTotal, invoice.conversionRate]).toEqual([54.29, EUR_CONVERSION_RATE])
    expect(invoice.items?.map((item) => [item.netAmount, item.vatAmount])).toEqual([
      [37.02, 10],
      [6.93, 0.35],
    ])
  })
  step('díjbekérő', async () => {
    const proforma = await ctx.tarca.documents.create({
      type: 'proforma',
      partner: partner(),
      comment: ctx.name('díjbekérő'),
      items: [line('díjbekérő tétel', 1000)],
    })
    ctx.state.proformaId = recordIssued(ctx, proforma)
    expect([proforma.type, proforma.paymentStatus, proforma.grossTotal]).toEqual([
      'proforma',
      'outstanding',
      1270,
    ])
  })
  step('előlegszámla, utána végszámla az előleg levonásával', async () => {
    const advance = await ctx.tarca.documents.create({
      type: 'advance',
      partner: partner(),
      comment: ctx.name('előleg'),
      items: [line('előleg', 1000)],
    })
    ctx.state.advanceInvoiceId = recordIssued(ctx, advance)
    expect(advance.type).toBe('advance')
    const final = await ctx.tarca.documents.create({
      partner: partner(),
      comment: ctx.name('végszámla'),
      items: [line('végszámla', 3000)],
      advanceInvoiceIds: [ctx.state.advanceInvoiceId],
    })
    ctx.state.finalInvoiceId = recordIssued(ctx, final)
    expect(final.grossTotal).toBe(2540)
    expect(final.items?.map((item) => [item.name, item.netAmount, item.grossAmount])).toEqual([
      [ctx.name('végszámla'), 3000, 3810],
      [ctx.name('előleg'), -1000, -1270],
    ])
    expect(final.relatedDocuments?.map((document) => document.id)).toEqual([
      ctx.state.advanceInvoiceId,
    ])
  })
  step('lista szűrőkkel: partner, típus, dátum, módosítás ideje, számlaszám', async () => {
    const id = ctx.required(ctx.state.invoiceId, 'számla id')
    const today = todayInBudapest()
    const listed = (query: DocumentListQuery) =>
      eventually(
        async () => (await ctx.tarca.documents.list({ ...query, perPage: 100 })).data,
        (documents) => documents.some((document) => document.id === id),
      )
    const byPartner = await listed({
      partnerId: partner(),
      type: 'invoice',
      startDate: today,
      endDate: today,
    })
    expect(byPartner.filter((document) => document.id === id)).toHaveLength(1)
    expect(byPartner.filter((document) => document.comment === once.comment)).toHaveLength(1)
    expect(byPartner.every((document) => document.partner?.id === partner())).toBe(true)
    const modified = await listed({
      blockId: ctx.required(ctx.state.blockId, 'számlatömb id'),
      lastModifiedDate: startedAt,
    })
    expect(modified.map((document) => document.id)).toContain(id)
    const invoiceNumber = (await ctx.tarca.documents.get(id)).invoiceNumber ?? ''
    const byNumber = await listed({ query: invoiceNumber })
    expect(byNumber.map((document) => document.id)).toContain(id)
  })
  step('a piszkozat törölhető, utána a lekérés 403 (nem 404)', async () => {
    const draft = await ctx.tarca.documents.create({
      type: 'draft',
      partner: partner(),
      items: [line('törölt piszkozat', 1000)],
    })
    const id = ctx.required(draft.id, 'törlendő piszkozat id')
    await ctx.tarca.documents.deleteDraft(id)
    await expect(ctx.tarca.documents.get(id)).rejects.toMatchObject({
      category: 'forbidden',
      status: 403,
    })
  })
}
