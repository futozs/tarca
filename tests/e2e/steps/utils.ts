import { expect } from 'vitest'
import { BillingoError } from '../../../src/core/errors'
import type { OperationId } from '../../../src/core/operations'
import type { E2eContext, E2eExclusions } from '../context'

export const UTILS_E2E_OPERATIONS: readonly OperationId[] = [
  'GetServerTime',
  'GetConversionRate',
  'CheckTaxNumber',
]

export const UTILS_E2E_EXCLUDED: E2eExclusions = {
  GetId: 'A teszt profilban nincs régi (v2) azonosító, amit át lehetne váltani.',
}

const RATE_DATE = '2026-11-13'
const PUBLIC_TAX_NUMBER = '13421739-2-41'

export function defineUtilsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  step('szerveridő', async () => {
    const time = await ctx.tarca.utils.serverTime()
    expect(Number.isInteger(time.epoch)).toBe(true)
    expect(time.epoch).toBeGreaterThan(1_700_000_000)
  })
  step('EUR → HUF árfolyam dátum nélkül', async () => {
    const rate = await ctx.tarca.currencies.rate({ from: 'EUR', to: 'HUF' })
    expect(rate).toMatchObject({ from: 'EUR', to: 'HUF' })
    expect(rate.rate).toBeGreaterThan(0)
  })
  step(`EUR → HUF árfolyam adott napra (${RATE_DATE})`, async () => {
    const rate = await ctx.tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: RATE_DATE })
    expect(rate).toMatchObject({ from: 'EUR', to: 'HUF' })
    expect(rate.rate).toBeGreaterThan(0)
  })
  step('adószám-ellenőrzés: NAV kapcsolat nélkül nav_unavailable, nem kulcshiba', async () => {
    const outcome = await ctx.tarca.utils.checkTaxNumber(PUBLIC_TAX_NUMBER).then(
      () => 'sikeres válasz',
      (error: unknown) => error,
    )
    expect(outcome).toBeInstanceOf(BillingoError)
    expect(outcome).toMatchObject({ category: 'nav_unavailable', status: 401, retryable: false })
  })
}
