import { expect } from 'vitest'
import type { OperationId } from '../../../src/core/operations'
import type { E2eContext, E2eExclusions } from '../context'

export const BANK_ACCOUNTS_E2E_OPERATIONS: readonly OperationId[] = [
  'CreateBankAccount',
  'GetBankAccount',
  'UpdateBankAccount',
  'ListBankAccount',
  'DeleteBankAccount',
]

export const BANK_ACCOUNTS_E2E_EXCLUDED: E2eExclusions = {}

const ACCOUNT_NUMBER = '11773016-11111018'

export function defineBankAccountsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  step('létrehozás és lekérés', async () => {
    const account = await ctx.tarca.bankAccounts.create({
      name: ctx.name(),
      accountNumber: ACCOUNT_NUMBER,
      currency: 'HUF',
    })
    ctx.state.bankAccountId = ctx.required(account.id, 'bankszámla id')
    const fetched = await ctx.tarca.bankAccounts.get(ctx.state.bankAccountId)
    expect(fetched).toMatchObject({
      name: ctx.name(),
      accountNumber: ACCOUNT_NUMBER,
      currency: 'HUF',
    })
  })
  step('módosítás és listázás', async () => {
    const id = ctx.required(ctx.state.bankAccountId, 'bankszámla id')
    const updated = await ctx.tarca.bankAccounts.update(id, {
      name: ctx.name('módosítva'),
      accountNumber: ACCOUNT_NUMBER,
      currency: 'HUF',
    })
    expect(updated.name).toBe(ctx.name('módosítva'))
    const page = await ctx.tarca.bankAccounts.list({ perPage: 100 })
    expect(page.data.some((item) => item.id === id)).toBe(true)
  })
  step('törlés', async () => {
    await ctx.tarca.bankAccounts.delete(ctx.required(ctx.state.bankAccountId, 'bankszámla id'))
  })
}
