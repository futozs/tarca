import type { RequestOptions, TarcaContext } from '../core/context'
import { BillingoError } from '../core/errors'
import {
  assertPageQuery,
  iteratePages,
  type Page,
  type PageQuery,
  type RawPage,
  toPage,
} from '../core/pagination'
import type { Product } from '../generated/billingo'

type ProductFields = Omit<Product, 'id' | 'netUnitPrice' | 'grossUnitPrice'>

export type ProductInput = ProductFields &
  (
    | { readonly netUnitPrice: number; readonly grossUnitPrice?: undefined }
    | { readonly grossUnitPrice: number; readonly netUnitPrice?: undefined }
  )

export interface ProductListQuery extends PageQuery {
  readonly query?: string
}

export interface ProductsApi {
  list(query?: ProductListQuery, options?: RequestOptions): Promise<Page<Product>>
  all(query?: Omit<ProductListQuery, 'page'>, options?: RequestOptions): AsyncGenerator<Product>
  get(id: number, options?: RequestOptions): Promise<Product>
  create(input: ProductInput, options?: RequestOptions): Promise<Product>
  update(id: number, input: ProductInput, options?: RequestOptions): Promise<Product>
  delete(id: number, options?: RequestOptions): Promise<void>
}

type ProductWrite = 'CreateProduct' | 'UpdateProduct'

const PRICE_FIELDS = ['netUnitPrice', 'grossUnitPrice'] as const

function priceError(operation: ProductWrite, message: string): BillingoError {
  return new BillingoError(message, {
    category: 'validation',
    operation,
    fieldErrors: PRICE_FIELDS.map((field) => ({ field, message })),
    hint: 'A Billingo ár nélkül és két árral is 422-t ad („You must specify only one price”), a másik árat ő számolja ki. Lekért termék visszaküldésekor hagyd el az egyik árat.',
  })
}

function assertSinglePrice(input: ProductInput, operation: ProductWrite): void {
  const [field, extra] = PRICE_FIELDS.filter((name) => input[name] !== undefined)
  if (field === undefined || extra !== undefined) {
    throw priceError(
      operation,
      'A termékhez pontosan egy árat adj meg: netUnitPrice (nettó egységár) vagy grossUnitPrice (bruttó egységár).',
    )
  }
  const price = input[field]
  if (!Number.isFinite(price)) {
    throw priceError(operation, `A ${field} értéke véges szám legyen, kapott: ${String(price)}`)
  }
}

export function createProductsApi(context: TarcaContext): ProductsApi {
  const list = async (query: ProductListQuery = {}, options?: RequestOptions) => {
    assertPageQuery(query)
    const raw = await context.json<RawPage<Product>>({
      operation: 'ListProduct',
      query: { page: query.page, perPage: query.perPage, query: query.query },
      signal: options?.signal,
    })
    return toPage(raw, query)
  }
  return {
    list,
    all: (query = {}, options) => iteratePages(list, query, options),
    get: (id, options) =>
      context.json<Product>({
        operation: 'GetProduct',
        pathParams: { id },
        signal: options?.signal,
      }),
    async create(input, options) {
      assertSinglePrice(input, 'CreateProduct')
      return context.json<Product>({
        operation: 'CreateProduct',
        body: input,
        signal: options?.signal,
      })
    },
    async update(id, input, options) {
      assertSinglePrice(input, 'UpdateProduct')
      return context.json<Product>({
        operation: 'UpdateProduct',
        pathParams: { id },
        body: input,
        signal: options?.signal,
      })
    },
    delete: (id, options) =>
      context.empty({
        operation: 'DeleteProduct',
        pathParams: { id },
        signal: options?.signal,
      }),
  }
}
