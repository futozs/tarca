import type { RequestOptions, TarcaContext } from '../core/context'
import type { OnceGuard } from '../core/once-guard'
import type { OperationId } from '../core/operations'
import { assertValid, createInputCheck, type InputCheck, type Wire } from '../documents/check'
import type { BlockResolver, ResolvedDefaults } from '../documents/defaults'
import { isOneOf, PAYMENT_METHODS, RECEIPT_VATS, toVatCode } from '../documents/enums'
import { resolvePartnerId } from '../documents/issue'
import { type CreateOnceOptions, type DocumentOnceResult, issueOnce } from '../documents/once'
import type { DocumentQueryApi } from '../documents/query'
import type {
  Currency,
  Document,
  PaymentMethod,
  ReceiptInsert,
  ReceiptItemData,
  ReceiptProductData,
  ReceiptVat,
} from '../generated/billingo'
import type { PartnerInput, PartnersApi } from '../partners/partners'

export type ReceiptVatInput = number | ReceiptVat

export interface ReceiptPricedItemInput {
  readonly name: string
  readonly grossUnitPrice: number
  readonly vat: ReceiptVatInput
  readonly quantity?: number
  readonly unit?: string
}

export interface ReceiptProductItemInput {
  readonly productId: number
  readonly quantity?: number
}

export type ReceiptItemInput = ReceiptPricedItemInput | ReceiptProductItemInput

export type ReceiptType = 'receipt' | 'draft'

export interface ReceiptInput {
  readonly type?: ReceiptType
  readonly vendorId?: string
  readonly partner?: number | PartnerInput
  readonly name?: string
  readonly emails?: readonly string[]
  readonly blockId?: number
  readonly paymentMethod?: PaymentMethod
  readonly currency?: Currency
  readonly conversionRate?: number
  readonly electronic?: boolean
  readonly items: readonly ReceiptItemInput[]
}

export interface ReceiptOnceInput extends ReceiptInput {
  readonly vendorId: string
}

export interface ReceiptFinalizeInput extends Omit<ReceiptInput, 'type'> {
  readonly type?: 'receipt'
}

export interface ReceiptsApi {
  create(input: ReceiptInput, options?: RequestOptions): Promise<Document>
  createOnce(input: ReceiptOnceInput, options?: CreateOnceOptions): Promise<DocumentOnceResult>
  finalizeDraft(
    id: number,
    input: ReceiptFinalizeInput,
    options?: RequestOptions,
  ): Promise<Document>
}

export interface ReceiptsApiDeps {
  readonly partners: PartnersApi
  readonly blocks: BlockResolver
  readonly defaults: ResolvedDefaults
  readonly guard: OnceGuard
  readonly query: DocumentQueryApi
}

type WireReceiptItem = Wire<ReceiptItemData> | Wire<ReceiptProductData>

type ReceiptBody = Wire<Omit<ReceiptInsert, 'blockId' | 'partnerId' | 'items'>> & {
  readonly items: readonly WireReceiptItem[]
}

type ReceiptRequestBody = ReceiptBody & {
  readonly blockId: number
  readonly partnerId: number | undefined
}

interface PreparedReceipt {
  readonly partner: number | PartnerInput | undefined
  readonly blockId: number | undefined
  readonly body: ReceiptBody
}

export const DEFAULT_RECEIPT_PAYMENT_METHOD: PaymentMethod = 'cash'

const DEFAULT_RECEIPT_UNIT = 'db'

function isProductItem(item: ReceiptItemInput): item is ReceiptProductItemInput {
  return 'productId' in item
}

function checkItem(check: InputCheck, item: ReceiptItemInput, field: string): void {
  if (typeof item !== 'object' || item === null) {
    check.fail(field, 'A tétel objektum legyen.')
    return
  }
  if (item.quantity !== undefined) check.finite(item.quantity, `${field}.quantity`)
  if (isProductItem(item)) {
    check.id(item.productId, `${field}.productId`)
    return
  }
  check.text(item.name, `${field}.name`)
  check.finite(item.grossUnitPrice, `${field}.grossUnitPrice`)
  check.convert(`${field}.vat`, () => toVatCode(RECEIPT_VATS, item.vat))
}

function toItem(item: ReceiptItemInput): WireReceiptItem {
  if (isProductItem(item)) return { productId: item.productId, quantity: item.quantity ?? 1 }
  return {
    name: item.name,
    unitPrice: item.grossUnitPrice,
    vat: toVatCode(RECEIPT_VATS, item.vat),
    quantity: item.quantity ?? 1,
    unit: item.unit ?? DEFAULT_RECEIPT_UNIT,
  }
}

const RECEIPT_TYPES: readonly ReceiptType[] = ['receipt', 'draft']

function prepareReceipt(
  input: ReceiptInput,
  defaults: ResolvedDefaults,
  operation: OperationId,
  vendorIdRequired: boolean,
): PreparedReceipt {
  const check = createInputCheck()
  const types: readonly ReceiptType[] =
    operation === 'CreateReceiptFromDraft' ? ['receipt'] : RECEIPT_TYPES
  if (!isOneOf(types, input.type ?? 'receipt')) {
    check.fail('type', `A típus ${types.join(', ')} lehet, kapott: ${String(input.type)}.`)
  }
  check.vendorId(input.vendorId, vendorIdRequired)
  if (input.partner !== undefined) check.partner(input.partner, 'partner')
  if (input.blockId !== undefined) check.id(input.blockId, 'blockId')
  if (input.paymentMethod !== undefined) {
    check.choice(PAYMENT_METHODS, input.paymentMethod, 'paymentMethod', 'fizetési mód')
  }
  check.currency(input.currency ?? defaults.currency, input.conversionRate)
  check.flag(input.electronic, 'electronic')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    check.fail('items', 'Legalább egy tétel kell.')
  } else {
    input.items.forEach((item, index) => {
      checkItem(check, item, `items.${index}`)
    })
  }
  assertValid(check, operation, 'nyugtaadatok')
  return {
    partner: input.partner,
    blockId: input.blockId,
    body: {
      vendorId: input.vendorId?.trim(),
      name: input.name,
      emails: input.emails,
      type: input.type ?? 'receipt',
      paymentMethod:
        input.paymentMethod ?? defaults.paymentMethod ?? DEFAULT_RECEIPT_PAYMENT_METHOD,
      currency: input.currency ?? defaults.currency,
      conversionRate: input.conversionRate,
      electronic: input.electronic ?? defaults.electronic,
      items: input.items.map(toItem),
    },
  }
}

export function createReceiptsApi(context: TarcaContext, deps: ReceiptsApiDeps): ReceiptsApi {
  const bodyOf = async (
    prepared: PreparedReceipt,
    options: RequestOptions | undefined,
  ): Promise<ReceiptRequestBody> => {
    const blockId = prepared.blockId ?? (await deps.blocks.resolve('receipt', options))
    const partnerId =
      prepared.partner === undefined
        ? undefined
        : await resolvePartnerId(deps.partners, prepared.partner, options)
    return { ...prepared.body, blockId, partnerId }
  }
  const post = (body: ReceiptRequestBody, options: RequestOptions | undefined) =>
    context.json<Document>({ operation: 'CreateReceipt', body, signal: options?.signal })
  return {
    async create(input, options) {
      const prepared = prepareReceipt(input, deps.defaults, 'CreateReceipt', false)
      return post(await bodyOf(prepared, options), options)
    },
    async createOnce(input, options = {}) {
      const prepared = prepareReceipt(input, deps.defaults, 'CreateReceipt', true)
      const vendorId = input.vendorId.trim()
      return issueOnce(
        deps.guard,
        {
          vendorId,
          operation: 'CreateReceipt',
          find: () => deps.query.findByVendorId(vendorId, options),
          target: () => bodyOf(prepared, options),
          issue: (body) => post(body, options),
        },
        options,
      )
    },
    async finalizeDraft(id, input, options) {
      const prepared = prepareReceipt(input, deps.defaults, 'CreateReceiptFromDraft', false)
      return context.json<Document>({
        operation: 'CreateReceiptFromDraft',
        pathParams: { id },
        body: await bodyOf(prepared, options),
        signal: options?.signal,
      })
    },
  }
}
