import { expect, test } from 'vitest'
import * as api from '../src/index'

test('a csomag nyilvános futásidejű exportjai', () => {
  expect(Object.keys(api).sort()).toEqual([
    'BILLINGO_API_URL',
    'BILLINGO_OPERATIONS',
    'BillingoError',
    'DEFAULT_TIMEOUT_MS',
    'MAX_ATTEMPTS',
    'MAX_PER_PAGE',
    'TARCA_VERSION',
    'addBudapestDays',
    'createTarca',
    'isBillingoError',
    'nullIfNotFound',
    'toBillingoDate',
    'toBudapestDate',
    'toBudapestTimestamp',
    'todayInBudapest',
  ])
})
