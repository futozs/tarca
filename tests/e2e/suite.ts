import { beforeAll, describe, expect, test } from 'vitest'
import type { Tarca } from '../../src/client'
import type { TarcaHooks } from '../../src/core/context'
import { isBillingoError } from '../../src/core/errors'
import type { OperationId } from '../../src/core/operations'
import type { BankAccount } from '../../src/generated/billingo'
import { assertTestProfile, E2E_NAME_PREFIX } from './guard'

export const E2E_OPERATIONS: readonly OperationId[] = [
  'GetOrganizationData',
  'GetServerTime',
  'GetConversionRate',
  'CreateBankAccount',
  'GetBankAccount',
  'UpdateBankAccount',
  'ListBankAccount',
  'DeleteBankAccount',
]

export const E2E_EXCLUDED: Readonly<Partial<Record<OperationId, string>>> = {
  CheckTaxNumber:
    'A teszt profilnak nincs NAV kapcsolata, a hivatalos MCP mérése szerint itt 401-et ad. Előbb élőben ellenőrizni kell a pontos választ.',
  GetId: 'A teszt profilban nincs régi (v2) azonosító, amit át lehetne váltani.',
}

export interface E2eSuiteOptions {
  readonly createClient: (hooks: TarcaHooks) => Tarca
  readonly taxCode: string
}

interface Run {
  fatal: boolean
}

type Step = (name: string, body: () => Promise<void>) => void

const FATAL_CATEGORIES: ReadonlySet<string> = new Set(['auth', 'subscription', 'rate_limit'])

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Hiányzik a korábbi lépés eredménye: ${what}.`)
  return value
}

function groupSteps(run: Run, options: { readonly critical?: boolean } = {}): Step {
  const group = { failed: false }
  return (name, body) => {
    test(name, async (context) => {
      if (run.fatal || group.failed) context.skip()
      try {
        await body()
      } catch (error) {
        group.failed = true
        if (options.critical) run.fatal = true
        if (isBillingoError(error) && FATAL_CATEGORIES.has(error.category)) run.fatal = true
        throw error
      }
    })
  }
}

export function defineE2eSuite(options: E2eSuiteOptions): void {
  const seen = new Set<OperationId>()
  const run: Run = { fatal: false }
  const runId = Date.now().toString(36).toUpperCase()
  let tarca: Tarca

  beforeAll(() => {
    tarca = options.createClient({
      onRequest: (event) => {
        seen.add(event.operation)
      },
    })
  })

  describe('tesztprofil-őr', () => {
    const step = groupSteps(run, { critical: true })
    step('a kulcs a várt teszt szervezethez tartozik, NAV kapcsolat nélkül', async () => {
      await assertTestProfile(tarca, options.taxCode)
    })
  })

  describe('segédfüggvények', () => {
    const step = groupSteps(run)
    step('szerveridő', async () => {
      const time = await tarca.utils.serverTime()
      expect(typeof time.epoch).toBe('number')
    })
    step('EUR → HUF árfolyam', async () => {
      const rate = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' })
      expect(rate.rate).toBeGreaterThan(0)
    })
  })

  describe('bankszámlák', () => {
    const step = groupSteps(run)
    let account: BankAccount | undefined
    step('létrehozás és lekérés', async () => {
      account = await tarca.bankAccounts.create({
        name: `${E2E_NAME_PREFIX} ${runId}`,
        accountNumber: '11773016-11111018',
        currency: 'HUF',
      })
      const fetched = await tarca.bankAccounts.get(required(account.id, 'bankszámla id'))
      expect(fetched.name).toBe(`${E2E_NAME_PREFIX} ${runId}`)
    })
    step('módosítás és listázás', async () => {
      const id = required(account?.id, 'bankszámla id')
      const updated = await tarca.bankAccounts.update(id, {
        name: `${E2E_NAME_PREFIX} ${runId} módosítva`,
        accountNumber: '11773016-11111018',
        currency: 'HUF',
      })
      expect(updated.name).toContain('módosítva')
      const page = await tarca.bankAccounts.list({ perPage: 100 })
      expect(page.data.some((item) => item.id === id)).toBe(true)
    })
    step('törlés', async () => {
      await tarca.bankAccounts.delete(required(account?.id, 'bankszámla id'))
    })
  })

  describe('lefedettség', () => {
    test('az e2e minden műveletet lefuttatott', (context) => {
      if (run.fatal) context.skip()
      expect(E2E_OPERATIONS.filter((operation) => !seen.has(operation))).toEqual([])
    })
  })
}
