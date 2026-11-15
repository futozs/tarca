import type { RequestOptions, TarcaContext } from '../core/context'
import { type DateInput, toBudapestTimestamp, toOptionalBillingoDate } from '../core/dates'
import { nullIfNotFound } from '../core/errors'
import {
  assertPageQuery,
  iteratePages,
  type Page,
  type PageQuery,
  type RawPage,
  toPage,
} from '../core/pagination'
import type { Document, PaymentMethod, PaymentStatus } from '../generated/billingo'

export type DocumentListType = 'invoice' | 'receipt'

export interface DocumentListQuery extends PageQuery {
  readonly blockId?: number
  readonly partnerId?: number
  readonly paymentMethod?: PaymentMethod
  readonly paymentStatus?: PaymentStatus
  readonly startDate?: DateInput
  readonly endDate?: DateInput
  readonly startNumber?: number
  readonly endNumber?: number
  readonly startYear?: number
  readonly endYear?: number
  readonly type?: DocumentListType
  readonly query?: string
  readonly paidStartDate?: DateInput
  readonly paidEndDate?: DateInput
  readonly fulfillmentStartDate?: DateInput
  readonly fulfillmentEndDate?: DateInput
  readonly lastModifiedDate?: Date | string
}

export interface DocumentQueryApi {
  get(id: number, options?: RequestOptions): Promise<Document>
  getByVendorId(vendorId: string, options?: RequestOptions): Promise<Document>
  findByVendorId(vendorId: string, options?: RequestOptions): Promise<Document | null>
  list(query?: DocumentListQuery, options?: RequestOptions): Promise<Page<Document>>
  all(query?: Omit<DocumentListQuery, 'page'>, options?: RequestOptions): AsyncGenerator<Document>
}

const MODIFIED_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

export function toLastModified(value: Date | string): string {
  if (value instanceof Date) return toBudapestTimestamp(value).slice(0, 19).replace('T', ' ')
  if (!MODIFIED_FORMAT.test(value)) {
    throw new RangeError(
      `A lastModifiedDate Date objektum vagy budapesti idő „YYYY-MM-DD HH:MM:SS” alakban legyen, kapott: ${value}`,
    )
  }
  return value
}

function vendorPath(vendorId: string): { readonly vendor_id: string } {
  const trimmed = vendorId.trim()
  if (trimmed === '') throw new RangeError('A vendorId nem lehet üres.')
  return { vendor_id: trimmed }
}

export function createDocumentQueryApi(context: TarcaContext): DocumentQueryApi {
  const list = async (query: DocumentListQuery = {}, options?: RequestOptions) => {
    assertPageQuery(query)
    const raw = await context.json<RawPage<Document>>({
      operation: 'ListDocument',
      query: {
        page: query.page,
        perPage: query.perPage,
        blockId: query.blockId,
        partnerId: query.partnerId,
        paymentMethod: query.paymentMethod,
        paymentStatus: query.paymentStatus,
        startDate: toOptionalBillingoDate(query.startDate),
        endDate: toOptionalBillingoDate(query.endDate),
        startNumber: query.startNumber,
        endNumber: query.endNumber,
        startYear: query.startYear,
        endYear: query.endYear,
        type: query.type,
        query: query.query,
        paidStartDate: toOptionalBillingoDate(query.paidStartDate),
        paidEndDate: toOptionalBillingoDate(query.paidEndDate),
        fulfillmentStartDate: toOptionalBillingoDate(query.fulfillmentStartDate),
        fulfillmentEndDate: toOptionalBillingoDate(query.fulfillmentEndDate),
        lastModifiedDate:
          query.lastModifiedDate === undefined ? undefined : toLastModified(query.lastModifiedDate),
      },
      signal: options?.signal,
    })
    return toPage(raw, query)
  }
  const getByVendorId = async (vendorId: string, options?: RequestOptions) =>
    context.json<Document>({
      operation: 'GetDocumentByVendorId',
      pathParams: vendorPath(vendorId),
      signal: options?.signal,
    })
  return {
    get: (id, options) =>
      context.json<Document>({
        operation: 'GetDocument',
        pathParams: { id },
        signal: options?.signal,
      }),
    getByVendorId,
    findByVendorId: (vendorId, options) => nullIfNotFound(getByVendorId(vendorId, options)),
    list,
    all: (query = {}, options) => iteratePages(list, query, options),
  }
}
