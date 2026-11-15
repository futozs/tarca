import type { RequestOptions, TarcaContext } from '../core/context'
import { type DateInput, toBillingoDate, toOptionalBillingoDate } from '../core/dates'
import type { OperationId } from '../core/operations'
import {
  assertPageQuery,
  iteratePages,
  type Page,
  type PageQuery,
  type RawPage,
  toPage,
} from '../core/pagination'
import { assertValid, createInputCheck } from '../documents/check'
import type {
  Category,
  Currency,
  DateType,
  PaymentMethod,
  PaymentStatusSpending,
  Source,
  Spending,
  SpendingListItem,
  SpendingSave,
  SpendingShow,
} from '../generated/billingo'

type SpendingDateField = 'fulfillmentDate' | 'invoiceDate' | 'dueDate' | 'paidAt'

export interface SpendingInput extends Omit<SpendingSave, SpendingDateField> {
  readonly fulfillmentDate: DateInput
  readonly invoiceDate: DateInput
  readonly dueDate: DateInput
  readonly paidAt?: DateInput
}

export interface SpendingListQuery extends PageQuery {
  readonly q?: string
  readonly spendingDate?: DateType
  readonly startDate?: DateInput
  readonly endDate?: DateInput
  readonly paymentStatus?: PaymentStatusSpending
  readonly spendingType?: Source
  readonly categories?: Category
  readonly currencies?: Currency
  readonly paymentMethods?: PaymentMethod
}

export interface SpendingsApi {
  list(query?: SpendingListQuery, options?: RequestOptions): Promise<Page<SpendingListItem>>
  all(
    query?: Omit<SpendingListQuery, 'page'>,
    options?: RequestOptions,
  ): AsyncGenerator<SpendingListItem>
  get(id: number, options?: RequestOptions): Promise<SpendingShow>
  create(input: SpendingInput, options?: RequestOptions): Promise<Spending>
  update(id: number, input: SpendingInput, options?: RequestOptions): Promise<Spending>
  delete(id: number, options?: RequestOptions): Promise<void>
}

function toSpendingSave(
  { fulfillmentDate, invoiceDate, dueDate, paidAt, ...rest }: SpendingInput,
  operation: OperationId,
): SpendingSave {
  const check = createInputCheck()
  check.convert('fulfillmentDate', () => toBillingoDate(fulfillmentDate))
  check.convert('invoiceDate', () => toBillingoDate(invoiceDate))
  check.convert('dueDate', () => toBillingoDate(dueDate))
  if (paidAt !== undefined) check.convert('paidAt', () => toBillingoDate(paidAt))
  assertValid(check, operation, 'költségadatok')
  return {
    ...rest,
    fulfillmentDate: toBillingoDate(fulfillmentDate),
    invoiceDate: toBillingoDate(invoiceDate),
    dueDate: toBillingoDate(dueDate),
    ...(paidAt === undefined ? {} : { paidAt: toBillingoDate(paidAt) }),
  }
}

export function createSpendingsApi(context: TarcaContext): SpendingsApi {
  const list = async (query: SpendingListQuery = {}, options?: RequestOptions) => {
    assertPageQuery(query)
    const raw = await context.json<RawPage<SpendingListItem>>({
      operation: 'SpendingList',
      query: {
        ...query,
        startDate: toOptionalBillingoDate(query.startDate),
        endDate: toOptionalBillingoDate(query.endDate),
      },
      signal: options?.signal,
    })
    return toPage(raw, query)
  }
  return {
    list,
    all: (query = {}, options) => iteratePages(list, query, options),
    get: (id, options) =>
      context.json<SpendingShow>({
        operation: 'SpendingShow',
        pathParams: { id },
        signal: options?.signal,
      }),
    async create(input, options) {
      return context.json<Spending>({
        operation: 'SpendingSave',
        body: toSpendingSave(input, 'SpendingSave'),
        signal: options?.signal,
      })
    },
    async update(id, input, options) {
      return context.json<Spending>({
        operation: 'SpendingUpdate',
        pathParams: { id },
        body: toSpendingSave(input, 'SpendingUpdate'),
        signal: options?.signal,
      })
    },
    delete: (id, options) =>
      context.empty({
        operation: 'SpendingDelete',
        pathParams: { id },
        signal: options?.signal,
      }),
  }
}
