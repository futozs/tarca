import { describe } from 'vitest'
import { createTarca } from '../../src/client'
import { createFakeBillingo } from '../fake-billingo'
import { TEST_API_KEY } from '../helpers'
import { defineE2eSuite } from './suite'

const TAX_CODE = '12345678'

describe('az e2e forgatókönyv a fake Billingo ellen', () => {
  const billingo = createFakeBillingo({ taxCode: TAX_CODE })
  defineE2eSuite({
    createClient: (hooks) =>
      createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch, retryDelayMs: 0, hooks }),
    taxCode: TAX_CODE,
  })
})
