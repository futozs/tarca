import { expect } from 'vitest'
import type { OperationId } from '../../../src/core/operations'
import type { ReceiptItemInput } from '../../../src/receipts/receipts'
import type { E2eContext, E2eExclusions } from '../context'
import { recordIssued } from './documents'

export const RECEIPTS_E2E_OPERATIONS: readonly OperationId[] = [
  'CreateReceipt',
  'CreateReceiptFromDraft',
  'GetDocumentByVendorId',
]

export const RECEIPTS_E2E_EXCLUDED: E2eExclusions = {}

export function defineReceiptsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  const vendorId = ctx.vendorId('nyugta')
  const items = (label: string): ReceiptItemInput[] => [
    { name: ctx.name(label), grossUnitPrice: 1270, vat: 27 },
  ]

  step(
    'createOnce partner nélkül: a nyugtatömbbe kerül, fizetett, „Magánszemély” vevővel',
    async () => {
      const result = await ctx.tarca.receipts.createOnce({ vendorId, items: items('nyugta tétel') })
      ctx.state.receiptId = recordIssued(ctx, result.document)
      const receipt = result.document
      expect(result.created).toBe(true)
      expect([receipt.type, receipt.paymentStatus, receipt.kobakReceiptStatus]).toEqual([
        'receipt',
        'paid',
        'pending',
      ])
      expect(receipt.blockId).toBe(ctx.required(ctx.state.receiptBlockId, 'nyugtatömb id'))
      expect(receipt.dueDate).toBe(receipt.invoiceDate)
      expect(receipt.partner?.name).toBe('Magánszemély')
      expect(
        receipt.items?.map((item) => [item.netUnitAmount, item.netAmount, item.vatAmount]),
      ).toEqual([[1000.000001, 1000, 270]])
      expect(receipt.grossTotal).toBe(1270)
    },
  )
  step('createOnce újra ugyanazzal a vendorId-val: ugyanaz a nyugta, created: false', async () => {
    const again = await ctx.tarca.receipts.createOnce({ vendorId, items: items('nyugta tétel') })
    expect([again.created, again.document.id]).toEqual([false, ctx.state.receiptId])
  })
  step('nyugta piszkozatból: a véglegesítés 201, ugyanaz az id, sorszámot kap', async () => {
    const draft = await ctx.tarca.receipts.create({
      type: 'draft',
      items: items('nyugta piszkozat'),
    })
    const id = ctx.required(draft.id, 'nyugta piszkozat id')
    expect([draft.type, draft.invoiceNumber, draft.paymentStatus]).toEqual(['draft', '', 'none'])
    const receipt = await ctx.tarca.receipts.finalizeDraft(id, {
      items: [{ name: ctx.name('bruttó 10 x 7'), grossUnitPrice: 10, vat: 27, quantity: 7 }],
    })
    recordIssued(ctx, receipt)
    expect([receipt.id, receipt.type, receipt.paymentStatus]).toEqual([id, 'receipt', 'paid'])
    expect(receipt.invoiceNumber).not.toBe('')
    expect(
      receipt.items?.map((item) => [
        item.netUnitAmount,
        item.netAmount,
        item.vatAmount,
        item.grossAmount,
      ]),
    ).toEqual([[7.874016, 55.12, 14.88, 70]])
  })
}
