import type { RequestOptions, TarcaContext } from '../core/context'
import {
  assertPageQuery,
  iteratePages,
  type Page,
  type PageQuery,
  type RawPage,
  toPage,
} from '../core/pagination'
import type { BankAccount } from '../generated/billingo'

export type BankAccountInput = Omit<BankAccount, 'id'>

export interface BankAccountsApi {
  list(query?: PageQuery, options?: RequestOptions): Promise<Page<BankAccount>>
  all(query?: Omit<PageQuery, 'page'>, options?: RequestOptions): AsyncGenerator<BankAccount>
  get(id: number, options?: RequestOptions): Promise<BankAccount>
  create(input: BankAccountInput, options?: RequestOptions): Promise<BankAccount>
  update(id: number, input: BankAccountInput, options?: RequestOptions): Promise<BankAccount>
  delete(id: number, options?: RequestOptions): Promise<void>
}

export function createBankAccountsApi(context: TarcaContext): BankAccountsApi {
  const list = async (query: PageQuery = {}, options?: RequestOptions) => {
    assertPageQuery(query)
    const raw = await context.json<RawPage<BankAccount>>({
      operation: 'ListBankAccount',
      query: { page: query.page, perPage: query.perPage },
      signal: options?.signal,
    })
    return toPage(raw, query)
  }
  return {
    list,
    all: (query = {}, options) => iteratePages(list, query, options),
    get: (id, options) =>
      context.json<BankAccount>({
        operation: 'GetBankAccount',
        pathParams: { id },
        signal: options?.signal,
      }),
    create: (input, options) =>
      context.json<BankAccount>({
        operation: 'CreateBankAccount',
        body: input,
        signal: options?.signal,
      }),
    update: (id, input, options) =>
      context.json<BankAccount>({
        operation: 'UpdateBankAccount',
        pathParams: { id },
        body: input,
        signal: options?.signal,
      }),
    delete: (id, options) =>
      context.empty({
        operation: 'DeleteBankAccount',
        pathParams: { id },
        signal: options?.signal,
      }),
  }
}
