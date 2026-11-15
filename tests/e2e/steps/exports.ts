import { expect } from 'vitest'
import { todayInBudapest } from '../../../src/core/dates'
import type { OperationId } from '../../../src/core/operations'
import type { E2eContext, E2eExclusions } from '../context'

export const EXPORTS_E2E_OPERATIONS: readonly OperationId[] = ['Create', 'Poll', 'Download']

export const EXPORTS_E2E_EXCLUDED: E2eExclusions = {}

const UTF8_BOM = [0xef, 0xbb, 0xbf]

export function defineExportsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()

  step(
    'a mai számlák CSV exportja: létrehozás, poll, letöltés, nem üres fájl BOM-mal',
    async () => {
      const today = todayInBudapest()
      const result = await ctx.tarca.exports.run(
        { queryType: 'invoice_date', startDate: today, endDate: today, exportType: 'simple_csv' },
        { maxWaitMs: 30_000 },
      )
      ctx.state.exportId = result.id
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(['success', 'warning']).toContain(result.state)
      expect(result.contentType?.toLowerCase()).toMatch(/^text\/csv/)
      expect(result.filename).toMatch(/\.csv$/)
      expect([...result.bytes.slice(0, 3)]).toEqual(UTF8_BOM)
      const text = new TextDecoder().decode(result.bytes)
      expect(text.startsWith('"Számla sorszáma";')).toBe(true)
      expect(text.split('\n')[0]?.split(';').length).toBeGreaterThan(20)
    },
  )

  step('a kész export állapota újra lekérve is kész', async () => {
    const id = ctx.required(ctx.state.exportId, 'export id')
    const status = await ctx.tarca.exports.poll(id)
    expect(status).toMatchObject({ id, state: expect.stringMatching(/^(success|warning)$/) })
  })
}
