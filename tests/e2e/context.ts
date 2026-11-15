import { test } from 'vitest'
import type { Tarca } from '../../src/client'
import type { TarcaHooks } from '../../src/core/context'
import { isBillingoError } from '../../src/core/errors'
import type { OperationId } from '../../src/core/operations'
import { E2E_NAME_PREFIX } from './guard'

export interface E2eState {
  bankAccountId?: number
  blockId?: number
  receiptBlockId?: number
  partnerId?: number
  productId?: number
  draftId?: number
  proformaId?: number
  invoiceId?: number
  advanceInvoiceId?: number
  finalInvoiceId?: number
  modifiedInvoiceId?: number
  receiptId?: number
  spendingId?: number
  exportId?: string
}

export type E2eExclusions = Readonly<Partial<Record<OperationId, string>>>

export type E2eStep = (name: string, body: () => Promise<void>) => void

export interface E2eGroupOptions {
  readonly critical?: boolean
}

export interface E2eContext {
  readonly runId: string
  readonly taxCode: string
  readonly state: E2eState
  readonly tarca: Tarca
  name(label?: string): string
  vendorId(label: string): string
  email(): string
  required<T>(value: T | undefined, what: string): T
  groupSteps(options?: E2eGroupOptions): E2eStep
}

export type StepRegistrar = (name: string, run: (skip: () => never) => Promise<void>) => void

export interface E2eRunSettings {
  readonly taxCode: string
  readonly email: string | undefined
  readonly runId?: string
  readonly register?: StepRegistrar
}

export interface E2eRun {
  readonly runId: string
  readonly hooks: TarcaHooks
  readonly fatal: boolean
  readonly seen: ReadonlySet<OperationId>
  readonly seenByGroup: ReadonlyMap<string, ReadonlySet<OperationId>>
  connect(tarca: Tarca): void
  group(title: string): E2eContext
}

export const FATAL_CATEGORIES: ReadonlySet<string> = new Set(['auth', 'subscription', 'rate_limit'])

const vitestRegistrar: StepRegistrar = (name, run) => {
  test(name, (testContext) =>
    run(() => {
      testContext.skip()
      throw new Error('A lépés kimaradt.')
    }),
  )
}

export function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Hiányzik a korábbi lépés eredménye: ${what}.`)
  return value
}

export function createE2eRun(settings: E2eRunSettings): E2eRun {
  const runId = settings.runId ?? Date.now().toString(36).toUpperCase()
  const register = settings.register ?? vitestRegistrar
  const state: E2eState = {}
  const seen = new Set<OperationId>()
  const seenByGroup = new Map<string, Set<OperationId>>()
  let client: Tarca | undefined
  let fatal = false
  let current: string | undefined

  const hooks: TarcaHooks = {
    onRequest: (event) => {
      seen.add(event.operation)
      if (current !== undefined) seenByGroup.get(current)?.add(event.operation)
    },
  }

  function group(title: string): E2eContext {
    if (seenByGroup.has(title)) throw new Error(`Két e2e csoportnak azonos a neve: ${title}`)
    seenByGroup.set(title, new Set())
    return {
      runId,
      taxCode: settings.taxCode,
      state,
      get tarca(): Tarca {
        if (!client) throw new Error('Az e2e kliens még nem jött létre (beforeAll).')
        return client
      },
      name: (label) =>
        label ? `${E2E_NAME_PREFIX} ${runId} ${label}` : `${E2E_NAME_PREFIX} ${runId}`,
      vendorId: (label) => `${E2E_NAME_PREFIX}-${runId}-${label}`,
      email: () => {
        if (!settings.email) {
          throw new Error(
            'Hiányzik a BILLINGO_E2E_EMAIL: a küldés csak a tulajdonos saját címére mehet, nélküle a lépés nem futhat.',
          )
        }
        return settings.email
      },
      required,
      groupSteps: (options = {}) => {
        const chain = { failed: false }
        return (name, body) => {
          register(name, async (skip) => {
            if (fatal || chain.failed) skip()
            current = title
            try {
              await body()
            } catch (error) {
              chain.failed = true
              const fatalCategory = isBillingoError(error) && FATAL_CATEGORIES.has(error.category)
              if (options.critical === true || fatalCategory) fatal = true
              throw error
            } finally {
              current = undefined
            }
          })
        }
      },
    }
  }

  return {
    runId,
    hooks,
    get fatal(): boolean {
      return fatal
    },
    seen,
    seenByGroup,
    connect(tarca) {
      client = tarca
    },
    group,
  }
}
