import { describe } from 'vitest'
import { createTarca } from '../../src/client'
import { createFakeBillingo } from '../fake-billingo'
import { TEST_API_KEY } from '../helpers'
import { defineE2eSuite } from './suite'

const TAX_CODE = '12345678'
const SANDBOX_NAV_MESSAGE =
  'To use this feature, please ensure you have a live connection to NAV (not available in sandbox mode)'

function withSandboxTaxNumberCheck(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  const wrapped = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!new URL(String(input)).pathname.startsWith('/v3/utils/check-tax-number/')) {
      return fetch(input, init)
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: SANDBOX_NAV_MESSAGE } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return wrapped as typeof globalThis.fetch
}

describe('az e2e forgatókönyv a fake Billingo ellen', () => {
  const billingo = createFakeBillingo({ taxCode: TAX_CODE })
  defineE2eSuite({
    createClient: ({ hooks, wrapFetch }) =>
      createTarca({
        apiKey: TEST_API_KEY,
        fetch: wrapFetch(withSandboxTaxNumberCheck(billingo.fetch)),
        retryDelayMs: 0,
        hooks,
      }),
    taxCode: TAX_CODE,
    email: 'e2e@tarca.test',
    validation: { mode: 'strict', redact: false, requireSpec: false },
  })
})
