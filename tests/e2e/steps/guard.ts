import type { OperationId } from '../../../src/core/operations'
import type { E2eContext, E2eExclusions } from '../context'
import { assertTestProfile } from '../guard'

export const GUARD_E2E_OPERATIONS: readonly OperationId[] = ['GetOrganizationData']

export const GUARD_E2E_EXCLUDED: E2eExclusions = {}

export function defineGuardSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps({ critical: true })
  step('a kulcs a várt teszt szervezethez tartozik, NAV kapcsolat nélkül', async () => {
    await assertTestProfile(ctx.tarca, ctx.taxCode)
  })
}
