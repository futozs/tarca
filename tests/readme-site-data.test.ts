import { describe, expect, test } from 'vitest'
import { hungarianArticle, loadOperationCounts } from '../readme/site-data.mjs'
import { BILLINGO_OPERATIONS } from '../src/core/operations'

describe('README adatok', () => {
  test('a műveletek száma és a nem dokumentáltaké a művelettáblából jön', async () => {
    const operations = Object.values(BILLINGO_OPERATIONS)

    const counts = await loadOperationCounts()

    expect(counts.total).toBe(operations.length)
    expect(counts.undocumented).toBe(
      operations.filter((operation) => operation.spec === 'undocumented').length,
    )
    expect(counts.article).toBe(hungarianArticle(operations.length))
  })

  test('a határozott névelő a szám kiejtéséhez igazodik', () => {
    expect([1, 5, 50, 54, 57, 500, 1000, 1999].map(hungarianArticle)).toEqual([
      'az',
      'az',
      'az',
      'az',
      'az',
      'az',
      'az',
      'az',
    ])
    expect([2, 3, 10, 17, 64, 100, 150, 2000].map(hungarianArticle)).toEqual([
      'a',
      'a',
      'a',
      'a',
      'a',
      'a',
      'a',
      'a',
    ])
  })
})
