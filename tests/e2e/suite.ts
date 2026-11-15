import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import type { Tarca } from '../../src/client'
import type { TarcaHooks } from '../../src/core/context'
import type { OperationId } from '../../src/core/operations'
import { billingoSpecValidator, SPEC_AVAILABLE, type ValidationMode } from '../openapi'
import { createE2eRun, type E2eContext, type E2eExclusions } from './context'
import { createResponseRecorder, validateRecording } from './recorder'
import {
  BANK_ACCOUNTS_E2E_EXCLUDED,
  BANK_ACCOUNTS_E2E_OPERATIONS,
  defineBankAccountsSteps,
} from './steps/bank-accounts'
import { CLEANUP_E2E_EXCLUDED, CLEANUP_E2E_OPERATIONS, defineCleanupSteps } from './steps/cleanup'
import {
  DOCUMENT_ACTIONS_E2E_EXCLUDED,
  DOCUMENT_ACTIONS_E2E_OPERATIONS,
  DOCUMENT_CANCELLATION_E2E_EXCLUDED,
  DOCUMENT_CANCELLATION_E2E_OPERATIONS,
  defineDocumentActionsSteps,
  defineDocumentCancellationSteps,
} from './steps/document-actions'
import {
  DOCUMENT_BLOCKS_E2E_EXCLUDED,
  DOCUMENT_BLOCKS_E2E_OPERATIONS,
  defineDocumentBlocksSteps,
} from './steps/document-blocks'
import {
  DOCUMENTS_E2E_EXCLUDED,
  DOCUMENTS_E2E_OPERATIONS,
  defineDocumentsSteps,
} from './steps/documents'
import { defineExportsSteps, EXPORTS_E2E_EXCLUDED, EXPORTS_E2E_OPERATIONS } from './steps/exports'
import { defineGuardSteps, GUARD_E2E_EXCLUDED, GUARD_E2E_OPERATIONS } from './steps/guard'
import {
  definePartnerIndexSteps,
  definePartnersSteps,
  PARTNER_INDEX_E2E_EXCLUDED,
  PARTNER_INDEX_E2E_OPERATIONS,
  PARTNERS_E2E_EXCLUDED,
  PARTNERS_E2E_OPERATIONS,
} from './steps/partners'
import {
  defineProductsSteps,
  PRODUCTS_E2E_EXCLUDED,
  PRODUCTS_E2E_OPERATIONS,
} from './steps/products'
import {
  defineReceiptsSteps,
  RECEIPTS_E2E_EXCLUDED,
  RECEIPTS_E2E_OPERATIONS,
} from './steps/receipts'
import {
  defineSpendingsSteps,
  SPENDINGS_E2E_EXCLUDED,
  SPENDINGS_E2E_OPERATIONS,
} from './steps/spendings'
import { defineUtilsSteps, UTILS_E2E_EXCLUDED, UTILS_E2E_OPERATIONS } from './steps/utils'

export interface E2eGroup {
  readonly title: string
  readonly define: (ctx: E2eContext) => void
  readonly operations: readonly OperationId[]
  readonly excluded: E2eExclusions
}

export const E2E_GROUPS: readonly E2eGroup[] = [
  {
    title: 'tesztprofil-őr',
    define: defineGuardSteps,
    operations: GUARD_E2E_OPERATIONS,
    excluded: GUARD_E2E_EXCLUDED,
  },
  {
    title: 'segédfüggvények',
    define: defineUtilsSteps,
    operations: UTILS_E2E_OPERATIONS,
    excluded: UTILS_E2E_EXCLUDED,
  },
  {
    title: 'bankszámlák',
    define: defineBankAccountsSteps,
    operations: BANK_ACCOUNTS_E2E_OPERATIONS,
    excluded: BANK_ACCOUNTS_E2E_EXCLUDED,
  },
  {
    title: 'termékek és készlet',
    define: defineProductsSteps,
    operations: PRODUCTS_E2E_OPERATIONS,
    excluded: PRODUCTS_E2E_EXCLUDED,
  },
  {
    title: 'költségek',
    define: defineSpendingsSteps,
    operations: SPENDINGS_E2E_OPERATIONS,
    excluded: SPENDINGS_E2E_EXCLUDED,
  },
  {
    title: 'partnerek',
    define: definePartnersSteps,
    operations: PARTNERS_E2E_OPERATIONS,
    excluded: PARTNERS_E2E_EXCLUDED,
  },
  {
    title: 'számlatömbök',
    define: defineDocumentBlocksSteps,
    operations: DOCUMENT_BLOCKS_E2E_OPERATIONS,
    excluded: DOCUMENT_BLOCKS_E2E_EXCLUDED,
  },
  {
    title: 'bizonylatok: kiállítás',
    define: defineDocumentsSteps,
    operations: DOCUMENTS_E2E_OPERATIONS,
    excluded: DOCUMENTS_E2E_EXCLUDED,
  },
  {
    title: 'nyugták',
    define: defineReceiptsSteps,
    operations: RECEIPTS_E2E_OPERATIONS,
    excluded: RECEIPTS_E2E_EXCLUDED,
  },
  {
    title: 'bizonylatok: műveletek',
    define: defineDocumentActionsSteps,
    operations: DOCUMENT_ACTIONS_E2E_OPERATIONS,
    excluded: DOCUMENT_ACTIONS_E2E_EXCLUDED,
  },
  {
    title: 'partnerek: késleltetett keresőindex',
    define: definePartnerIndexSteps,
    operations: PARTNER_INDEX_E2E_OPERATIONS,
    excluded: PARTNER_INDEX_E2E_EXCLUDED,
  },
  {
    title: 'export',
    define: defineExportsSteps,
    operations: EXPORTS_E2E_OPERATIONS,
    excluded: EXPORTS_E2E_EXCLUDED,
  },
  {
    title: 'bizonylatok: sztornó',
    define: defineDocumentCancellationSteps,
    operations: DOCUMENT_CANCELLATION_E2E_OPERATIONS,
    excluded: DOCUMENT_CANCELLATION_E2E_EXCLUDED,
  },
  {
    title: 'takarítás',
    define: defineCleanupSteps,
    operations: CLEANUP_E2E_OPERATIONS,
    excluded: CLEANUP_E2E_EXCLUDED,
  },
]

export const E2E_OPERATIONS: readonly OperationId[] = [
  ...new Set(E2E_GROUPS.flatMap((group) => group.operations)),
]

export const E2E_EXCLUDED: E2eExclusions = Object.fromEntries(
  E2E_GROUPS.flatMap((group) => Object.entries(group.excluded)),
)

export interface E2eClientSetup {
  readonly hooks: TarcaHooks
  readonly wrapFetch: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch
}

export interface E2eResponseValidation {
  readonly mode: ValidationMode
  readonly redact: boolean
  readonly requireSpec: boolean
  readonly reportPath?: string
}

export interface E2eSuiteOptions {
  readonly createClient: (setup: E2eClientSetup) => Tarca
  readonly taxCode: string
  readonly email: string | undefined
  readonly validation: E2eResponseValidation
}

export function defineE2eSuite(options: E2eSuiteOptions): void {
  const run = createE2eRun({ taxCode: options.taxCode, email: options.email })
  const recorder = createResponseRecorder()

  beforeAll(() => {
    run.connect(options.createClient({ hooks: run.hooks, wrapFetch: recorder.wrap }))
  })

  for (const group of E2E_GROUPS) {
    describe(group.title, () => {
      group.define(run.group(group.title))
    })
  }

  describe('lefedettség', () => {
    test('minden csoport lefuttatta a saját műveleteit', (testContext) => {
      if (run.fatal) testContext.skip()
      const missing = E2E_GROUPS.flatMap((group) => {
        const seen = run.seenByGroup.get(group.title) ?? new Set<OperationId>()
        return group.operations
          .filter((operation) => !seen.has(operation))
          .map((operation) => `${group.title}: ${operation}`)
      })
      expect(missing).toEqual([])
      expect(E2E_OPERATIONS.filter((operation) => !run.seen.has(operation))).toEqual([])
    })
  })

  const validation = options.validation
  describe.skipIf(!SPEC_AVAILABLE && !validation.requireSpec)(
    'kérések és válaszok a spec ellen',
    () => {
      test('minden rögzített kérés és válasz megfelel a friss Billingo spec-nek', (testContext) => {
        if (run.fatal) testContext.skip()
        const report = validateRecording(recorder.records, billingoSpecValidator(), {
          mode: validation.mode,
          redact: validation.redact,
          expectedOperations: run.seen,
        })
        if (validation.reportPath) {
          mkdirSync(dirname(validation.reportPath), { recursive: true })
          writeFileSync(
            validation.reportPath,
            `${JSON.stringify({ mode: validation.mode, ...report }, null, 2)}\n`,
          )
          console.info(
            `Válasz-validáció: ${report.exchanges} kérés-válasz, ${report.errors.length} hiba, ${report.warnings.length} figyelmeztetés. Részletek: ${validation.reportPath}`,
          )
        }
        expect(report.exchanges).toBeGreaterThan(0)
        expect(report.errors).toEqual([])
        if (validation.mode === 'strict') expect(report.warnings).toEqual([])
      })
    },
  )
}
