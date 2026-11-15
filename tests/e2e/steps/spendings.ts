import { expect } from 'vitest'
import { addBudapestDays, todayInBudapest } from '../../../src/core/dates'
import type { OperationId } from '../../../src/core/operations'
import type { SpendingInput } from '../../../src/spendings/spendings'
import type { E2eContext, E2eExclusions } from '../context'

export const SPENDINGS_E2E_OPERATIONS: readonly OperationId[] = [
  'SpendingSave',
  'SpendingShow',
  'SpendingList',
  'SpendingUpdate',
  'SpendingDelete',
]

export const SPENDINGS_E2E_EXCLUDED: E2eExclusions = {}

export function defineSpendingsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  const cleanup = ctx.groupSteps()
  const spendingId = () => ctx.required(ctx.state.spendingId, 'költség id')
  const today = todayInBudapest()
  const input = (): SpendingInput => ({
    category: 'other',
    currency: 'HUF',
    conversionRate: 1,
    totalGross: 1270,
    totalGrossHuf: 1270,
    totalVatAmount: 270,
    totalVatAmountHuf: 270,
    fulfillmentDate: new Date(),
    invoiceNumber: ctx.vendorId('koltseg'),
    invoiceDate: today,
    dueDate: addBudapestDays(new Date(), 8),
    paymentMethod: 'cash',
  })

  step('létrehozás az élőben kötelező mezőkkel, partner nélkül', async () => {
    const spending = await ctx.tarca.spendings.create({ ...input(), comment: ctx.name() })
    ctx.state.spendingId = ctx.required(spending.id, 'költség id')
    expect(spending).toMatchObject({
      invoiceNumber: ctx.vendorId('koltseg'),
      fulfillmentDate: today,
      invoiceDate: today,
      dueDate: addBudapestDays(new Date(), 8),
      partner: null,
      paidAt: null,
      totalGrossLocal: 1270,
      totalVatAmountLocal: 270,
      comment: ctx.name(),
    })
  })

  step('lekérés: created_by_nav false', async () => {
    const spending = await ctx.tarca.spendings.get(spendingId())
    expect(spending).toMatchObject({
      id: spendingId(),
      invoiceNumber: ctx.vendorId('koltseg'),
      createdByNav: false,
    })
  })

  step('lista dátum-, kategória-, pénznem-, fizetésimód- és fizetetlen szűrővel', async () => {
    const page = await ctx.tarca.spendings.list({
      spendingDate: 'invoice_date',
      startDate: today,
      endDate: today,
      categories: 'other',
      currencies: 'HUF',
      paymentMethods: 'cash',
      paymentStatus: 'unpaid',
      perPage: 100,
    })
    const found = page.data.find((item) => item.id === spendingId())
    expect(found).toMatchObject({ createdByNav: false, paidAt: null })
  })

  step('teljes cserés módosítás fizetési dátummal: a kihagyott megjegyzés kiürül', async () => {
    const updated = await ctx.tarca.spendings.update(spendingId(), { ...input(), paidAt: today })
    expect(updated).toMatchObject({ id: spendingId(), paidAt: today, comment: '' })
    const paid = await ctx.tarca.spendings.list({
      spendingDate: 'invoice_date',
      startDate: today,
      endDate: today,
      paymentStatus: 'paid',
      perPage: 100,
    })
    expect(paid.data.map((item) => item.id)).toContain(spendingId())
  })

  cleanup('takarítás: törlés', async () => {
    await expect(ctx.tarca.spendings.delete(spendingId())).resolves.toBeUndefined()
  })
}
