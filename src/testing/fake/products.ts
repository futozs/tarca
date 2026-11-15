import type { Entitlement, Vat } from '../../generated/billingo'
import { isCurrency } from './enums'
import {
  bodyFields,
  clientError,
  type FakeFieldError,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  LARAVEL_MESSAGES,
  noContent,
  ok,
  optionalBoolean,
  optionalString,
  paginate,
  positiveIntegerParam,
  requiredEnum,
  requiredString,
  validationFailed,
} from './http'
import { type FakeBillingoState, type FakeProduct, nextId } from './state'

export const PRODUCT_NOT_FOUND = 'Product is not found.'

export const ONLY_ONE_PRICE = 'You must specify only one price (net_unit_price or gross_unit_price)'

export const PRICE_REQUIRED =
  'The net unit price field is required when gross unit price is not present.'

const VAT_FLAGS: Readonly<Record<Vat, true>> = {
  '0%': true,
  '1%': true,
  '2%': true,
  '3%': true,
  '4%': true,
  '5%': true,
  '5,5%': true,
  '6%': true,
  '7%': true,
  '7,7%': true,
  '8%': true,
  '8,1%': true,
  '9%': true,
  '9,5%': true,
  '10%': true,
  '11%': true,
  '12%': true,
  '13%': true,
  '13,5%': true,
  '14%': true,
  '15%': true,
  '16%': true,
  '17%': true,
  '18%': true,
  '19%': true,
  '20%': true,
  '21%': true,
  '22%': true,
  '23%': true,
  '24%': true,
  '25%': true,
  '25,5%': true,
  '26%': true,
  '27%': true,
  AAM: true,
  AM: true,
  EU: true,
  EUK: true,
  'F.AFA': true,
  FAD: true,
  'K.AFA': true,
  MAA: true,
  TAM: true,
  ÁKK: true,
  ÁTHK: true,
}

const ENTITLEMENT_FLAGS: Readonly<Record<Entitlement, true>> = {
  AAM: true,
  ANTIQUES: true,
  ARTWORK: true,
  ATK: true,
  EAM: true,
  EUE: true,
  EUFAD37: true,
  EUFADE: true,
  HO: true,
  KBAET: true,
  NAM_1: true,
  NAM_2: true,
  SECOND_HAND: true,
  TAM: true,
  TRAVEL_AGENCY: true,
  WITHOUT_ENTITLEMENT: true,
}

export const VATS: readonly string[] = Object.keys(VAT_FLAGS)

export const ENTITLEMENTS: readonly string[] = Object.keys(ENTITLEMENT_FLAGS)

function isVat(value: unknown): value is Vat {
  return typeof value === 'string' && Object.hasOwn(VAT_FLAGS, value)
}

function isEntitlement(value: unknown): value is Entitlement {
  return typeof value === 'string' && Object.hasOwn(ENTITLEMENT_FLAGS, value)
}

export function vatRate(vat: Vat): number {
  const match = /^(\d+(?:,\d+)?)%$/.exec(vat)
  return match?.[1] ? Number(match[1].replace(',', '.')) / 100 : 0
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

export function numberField(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): number | undefined {
  const value = fields[field]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  errors.push({ field, message: `The ${field.replace(/_/g, ' ')} must be a number.` })
  return undefined
}

export function integerField(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): number | null {
  const value = fields[field]
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  errors.push({ field, message: LARAVEL_MESSAGES.integer(field) })
  return null
}

type ProductFields = Omit<FakeProduct, 'id'>

interface Prices {
  readonly netUnitPrice: number
  readonly grossUnitPrice: number
}

function prices(net: number | undefined, gross: number | undefined, vat: Vat): Prices | undefined {
  const rate = 1 + vatRate(vat)
  if (net !== undefined) return { netUnitPrice: net, grossUnitPrice: roundCents(net * rate) }
  if (gross !== undefined) return { netUnitPrice: roundCents(gross / rate), grossUnitPrice: gross }
  return undefined
}

function readProduct(
  body: unknown,
): { readonly fields: ProductFields } | { readonly errors: FakeFieldError[] } {
  const input = bodyFields(body)
  const errors: FakeFieldError[] = []
  const name = requiredString(input, 'name', errors)
  const currency = requiredEnum(input, 'currency', isCurrency, errors)
  const vat = requiredEnum(input, 'vat', isVat, errors)
  const unit = requiredString(input, 'unit', errors)
  const net = numberField(input, 'net_unit_price', errors)
  const gross = numberField(input, 'gross_unit_price', errors)
  const given = [input.net_unit_price, input.gross_unit_price].filter(
    (price) => price !== undefined && price !== null,
  )
  if (given.length === 0) errors.push({ field: 'net_unit_price', message: PRICE_REQUIRED })
  if (given.length === 2) errors.push({ field: 'net_unit_price', message: ONLY_ONE_PRICE })
  const entitlementValue = input.entitlement
  let entitlement: Entitlement | null = null
  if (entitlementValue !== undefined && entitlementValue !== null) {
    if (isEntitlement(entitlementValue)) entitlement = entitlementValue
    else errors.push({ field: 'entitlement', message: LARAVEL_MESSAGES.selected('entitlement') })
  }
  const purchasePrice = numberField(input, 'purchase_price', errors) ?? null
  const connectProductId = integerField(input, 'connect_product_id', errors)
  const fields = {
    comment: optionalString(input, 'comment', errors),
    generalLedgerNumber: optionalString(input, 'general_ledger_number', errors),
    generalLedgerTaxcode: optionalString(input, 'general_ledger_taxcode', errors),
    ean: optionalString(input, 'ean', errors),
    sku: optionalString(input, 'sku', errors),
    isManage: optionalBoolean(input, 'is_manage', errors),
    isGenerateEraseCode: optionalBoolean(input, 'is_generate_erase_code', errors),
    applyDiscount: optionalBoolean(input, 'apply_discount', errors),
    applyQuantity: optionalBoolean(input, 'apply_quantity', errors),
    isConnectProduct: optionalBoolean(input, 'is_connect_product', errors),
    isDepositFee: optionalBoolean(input, 'is_deposit_fee', errors),
  }
  const priced = vat === undefined ? undefined : prices(net, gross, vat)
  if (errors.length > 0 || currency === undefined || vat === undefined || priced === undefined) {
    return { errors }
  }
  return {
    fields: {
      name,
      comment: fields.comment,
      currency,
      vat,
      netUnitPrice: priced.netUnitPrice,
      grossUnitPrice: priced.grossUnitPrice,
      unit,
      generalLedgerNumber: fields.generalLedgerNumber,
      generalLedgerTaxcode: fields.generalLedgerTaxcode,
      entitlement,
      ean: fields.ean,
      sku: fields.sku,
      isManage: fields.isManage,
      purchasePrice,
      isGenerateEraseCode: fields.isGenerateEraseCode,
      connectProductId,
      applyDiscount: fields.applyDiscount,
      applyQuantity: fields.applyQuantity,
      isConnectProduct: fields.isConnectProduct,
      isDepositFee: fields.isDepositFee,
    },
  }
}

function readBack(product: FakeProduct): FakeProduct {
  return { ...product, purchasePrice: product.purchasePrice ?? 0 }
}

export function withExistingProduct(
  state: FakeBillingoState,
  request: FakeRequest,
  respond: (product: FakeProduct) => FakeResponse,
): FakeResponse {
  const id = positiveIntegerParam(request, 'id')
  const product = id === undefined ? undefined : state.products.get(id)
  return product ? respond(product) : clientError(404, PRODUCT_NOT_FOUND)
}

export const productRoutes: FakeRoutes = {
  ListProduct: (state, request) => {
    const query = (request.query.get('query') ?? '').trim().toLowerCase()
    return paginate(
      request,
      [...state.products.values()]
        .filter((product) => product.name.toLowerCase().includes(query))
        .sort((a, b) => b.id - a.id)
        .map(readBack),
    )
  },
  CreateProduct: (state, request) => {
    const input = readProduct(request.body)
    if ('errors' in input) return validationFailed(input.errors)
    const product: FakeProduct = { id: nextId(state, 'products'), ...input.fields }
    state.products.set(product.id, product)
    return ok(product, 201)
  },
  GetProduct: (state, request) =>
    withExistingProduct(state, request, (product) => ok(readBack(product))),
  UpdateProduct: (state, request) =>
    withExistingProduct(state, request, (existing) => {
      const input = readProduct(request.body)
      if ('errors' in input) return validationFailed(input.errors)
      const product: FakeProduct = { id: existing.id, ...input.fields }
      state.products.set(product.id, product)
      return ok(product)
    }),
  DeleteProduct: (state, request) =>
    withExistingProduct(state, request, (product) => {
      state.products.delete(product.id)
      return noContent()
    }),
}
