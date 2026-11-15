import { expect } from 'vitest'
import type { OperationId } from '../../../src/core/operations'
import type { E2eContext, E2eExclusions } from '../context'

export const CLEANUP_E2E_OPERATIONS: readonly OperationId[] = ['DeletePartner', 'GetPartner']

export const CLEANUP_E2E_EXCLUDED: E2eExclusions = {}

export function defineCleanupSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  step('az e2e partnerek törlése a futás végén', async () => {
    const leftover = ctx.state.findOrCreatePartnerId
    if (leftover !== undefined) await ctx.tarca.partners.delete(leftover)
    const id = ctx.required(ctx.state.partnerId, 'partner id')
    await ctx.tarca.partners.delete(id)
    await expect(ctx.tarca.partners.get(id)).rejects.toMatchObject({
      category: 'not_found',
      status: 404,
    })
  })
}
