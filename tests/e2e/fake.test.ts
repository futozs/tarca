import { describe } from 'vitest'
import { createTarca } from '../../src/client'
import { createFakeBillingoFetch } from '../../src/testing'
import { TEST_API_KEY } from '../helpers'
import { defineE2eSuite } from './suite'

const TAX_CODE = '12345678-2-41'

const LIVE_REQUEST_SPACING_MS = 1_500

describe('az e2e forgatókönyv a fake Billingo ellen', () => {
  let clock = Date.now()
  const billingo = createFakeBillingoFetch({
    taxCode: TAX_CODE,
    apiKeys: [TEST_API_KEY],
    now: () => new Date(clock),
  })
  const spaced: typeof globalThis.fetch = (input, init) => {
    clock += LIVE_REQUEST_SPACING_MS
    return billingo.fetch(input, init)
  }
  defineE2eSuite({
    createClient: ({ hooks, wrapFetch }) =>
      createTarca({
        apiKey: TEST_API_KEY,
        fetch: wrapFetch(spaced),
        retryDelayMs: 0,
        hooks,
      }),
    taxCode: TAX_CODE,
    email: 'e2e@tarca.test',
    validation: { mode: 'strict', redact: false, requireSpec: false },
  })
})
