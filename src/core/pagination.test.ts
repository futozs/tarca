import { describe, expect, test } from 'vitest'
import { assertPageQuery, iteratePages, type Page, toPage } from './pagination'

describe('lapozás', () => {
  test('a hiányzó lapadatokat a kérésből és a tartalomból pótolja', () => {
    expect(toPage({ data: [1, 2] }, { page: 3 })).toEqual({
      data: [1, 2],
      total: 2,
      perPage: 2,
      currentPage: 3,
      lastPage: 3,
    })
    expect(toPage({}, {}).data).toEqual([])
  })

  test('ellenőrzi a page és perPage értékét', () => {
    expect(() => assertPageQuery({ page: 0 })).toThrow('page')
    expect(() => assertPageQuery({ perPage: 101 })).toThrow('perPage')
    expect(() => assertPageQuery({ perPage: 1.5 })).toThrow('perPage')
    expect(() => assertPageQuery({ page: 2, perPage: 100 })).not.toThrow()
  })

  test('az összes lapot sorban bejárja, 100-as lapmérettel', async () => {
    const queries: unknown[] = []
    const pages: Record<number, Page<string>> = {
      1: { data: ['a', 'b'], total: 3, perPage: 2, currentPage: 1, lastPage: 2 },
      2: { data: ['c'], total: 3, perPage: 2, currentPage: 2, lastPage: 2 },
    }
    const items: string[] = []
    for await (const item of iteratePages(async (query: { page?: number; perPage?: number }) => {
      queries.push(query)
      return (
        pages[query.page ?? 1] ?? { data: [], total: 0, perPage: 2, currentPage: 9, lastPage: 9 }
      )
    }, {})) {
      items.push(item)
    }

    expect(items).toEqual(['a', 'b', 'c'])
    expect(queries).toEqual([
      { page: 1, perPage: 100 },
      { page: 2, perPage: 100 },
    ])
  })

  test('üres lapnál megáll akkor is, ha a lastPage nagyobb', async () => {
    const seen: number[] = []
    for await (const item of iteratePages(
      async () => ({ data: [] as number[], total: 0, perPage: 100, currentPage: 1, lastPage: 5 }),
      { perPage: 10 },
    )) {
      seen.push(item)
    }
    expect(seen).toEqual([])
  })
})
