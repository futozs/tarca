import { join } from 'node:path'
import { describe } from 'vitest'
import { createTarca } from '../../src/index'
import { defineE2eSuite } from './suite'
import { resolveDelayMs, throttledFetch } from './throttle'

const apiKey = process.env.BILLINGO_TEST_API_KEY?.trim()
const delayMs = resolveDelayMs(process.env.BILLINGO_E2E_DELAY_MS)
const REPORT_PATH = join(import.meta.dirname, '..', '..', '.research', 'e2e-response-report.json')

describe.skipIf(!apiKey)('élő Billingo teszt profil (e2e)', () => {
  defineE2eSuite({
    createClient: ({ hooks, wrapFetch }) => {
      if (!apiKey) throw new Error('Hiányzik a BILLINGO_TEST_API_KEY.')
      return createTarca({
        apiKey,
        hooks,
        fetch: wrapFetch(throttledFetch(globalThis.fetch, delayMs)),
      })
    },
    taxCode: process.env.BILLINGO_E2E_TAX_CODE?.trim() ?? '',
    email: process.env.BILLINGO_E2E_EMAIL?.trim() || undefined,
    validation: { mode: 'lenient', redact: true, requireSpec: true, reportPath: REPORT_PATH },
  })
})
