import type { RequestOptions } from './context'

export const MAX_PER_PAGE = 100

export interface PageQuery {
  readonly page?: number
  readonly perPage?: number
}

export interface Page<T> {
  readonly data: readonly T[]
  readonly total: number
  readonly perPage: number
  readonly currentPage: number
  readonly lastPage: number
}

export interface RawPage<T> {
  readonly data?: readonly T[]
  readonly total?: number
  readonly perPage?: number
  readonly currentPage?: number
  readonly lastPage?: number
}

export function toPage<T>(raw: RawPage<T>, query: PageQuery): Page<T> {
  const data = raw.data ?? []
  const currentPage = raw.currentPage ?? query.page ?? 1
  return {
    data,
    total: raw.total ?? data.length,
    perPage: raw.perPage ?? query.perPage ?? data.length,
    currentPage,
    lastPage: raw.lastPage ?? currentPage,
  }
}

export function assertPageQuery(query: PageQuery): void {
  if (query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1)) {
    throw new RangeError(`A page értéke legalább 1 egész szám legyen, kapott: ${query.page}`)
  }
  if (
    query.perPage !== undefined &&
    (!Number.isInteger(query.perPage) || query.perPage < 1 || query.perPage > MAX_PER_PAGE)
  ) {
    throw new RangeError(
      `A perPage értéke 1 és ${MAX_PER_PAGE} közötti egész szám legyen, kapott: ${query.perPage}`,
    )
  }
}

export async function* iteratePages<T, Q extends PageQuery>(
  fetchPage: (query: Q, options?: RequestOptions) => Promise<Page<T>>,
  query: Q,
  options?: RequestOptions,
): AsyncGenerator<T, void, undefined> {
  let page = query.page ?? 1
  for (;;) {
    const result = await fetchPage(
      { ...query, page, perPage: query.perPage ?? MAX_PER_PAGE },
      options,
    )
    yield* result.data
    if (result.data.length === 0 || page >= result.lastPage) return
    page += 1
  }
}
