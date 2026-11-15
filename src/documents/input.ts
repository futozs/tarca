import { addBudapestDays, type DateInput, toBillingoDate } from '../core/dates'
import type { OperationId } from '../core/operations'
import type {
  Currency,
  DocumentInsert,
  DocumentInsertType,
  DocumentItemData,
  DocumentLanguage,
  DocumentProductData,
  DocumentSettings,
  Entitlement,
  PaymentMethod,
  Vat,
} from '../generated/billingo'
import type { PartnerInput } from '../partners/partners'
import { assertValid, createInputCheck, type InputCheck, type Wire } from './check'
import type { ResolvedDefaults } from './defaults'
import { DOCUMENT_LANGUAGES, isOneOf, PAYMENT_METHODS, toVatCode, VATS } from './enums'

export type VatInput = number | Vat

interface PricedItemBase {
  readonly name: string
  readonly quantity: number
  readonly unit?: string
  readonly vat: VatInput
  readonly comment?: string
  readonly entitlement?: Entitlement
  readonly sku?: string
}

export interface NetPricedItemInput extends PricedItemBase {
  readonly netUnitPrice: number
  readonly grossUnitPrice?: undefined
}

export interface GrossPricedItemInput extends PricedItemBase {
  readonly grossUnitPrice: number
  readonly netUnitPrice?: undefined
}

export interface ProductItemInput {
  readonly productId: number
  readonly quantity: number
  readonly comment?: string
}

export type DocumentItemInput = NetPricedItemInput | GrossPricedItemInput | ProductItemInput

export interface DocumentInput {
  readonly type?: DocumentInsertType
  readonly vendorId?: string
  readonly partner: number | PartnerInput
  readonly blockId?: number
  readonly bankAccountId?: number
  readonly items: readonly DocumentItemInput[]
  readonly fulfillmentDate?: DateInput
  readonly dueDate?: DateInput
  readonly dueInDays?: number
  readonly paymentMethod?: PaymentMethod
  readonly language?: DocumentLanguage
  readonly currency?: Currency
  readonly conversionRate?: number
  readonly electronic?: boolean
  readonly comment?: string
  readonly sendEmail?: boolean
  readonly orderNumber?: string
  readonly settings?: DocumentSettings
  readonly advanceInvoiceIds?: readonly number[]
  readonly discountPercent?: number
}

export interface DocumentOnceInput extends DocumentInput {
  readonly vendorId: string
}

export interface DraftFinalizeInput extends Omit<DocumentInput, 'type'> {
  readonly type?: Exclude<DocumentInsertType, 'draft'>
}

export type WireDocumentItem = Wire<DocumentItemData> | Wire<DocumentProductData>

export type DocumentBody = Wire<Omit<DocumentInsert, 'partnerId' | 'blockId' | 'items'>> & {
  readonly items: readonly WireDocumentItem[]
}

export interface PreparedDocument {
  readonly partner: number | PartnerInput
  readonly blockId: number | undefined
  readonly body: DocumentBody
}

export interface PrepareOptions {
  readonly vendorIdRequired?: boolean
  readonly now?: Date
}

const DOCUMENT_TYPES: readonly DocumentInsertType[] = ['invoice', 'proforma', 'advance', 'draft']

const FINAL_TYPES: readonly DocumentInsertType[] = ['invoice', 'proforma', 'advance']

export const DEFAULT_UNIT = 'db'

export const DEFAULT_DOCUMENT_PAYMENT_METHOD: PaymentMethod = 'wire_transfer'

function isProductItem(item: DocumentItemInput): item is ProductItemInput {
  return 'productId' in item
}

export function checkItem(check: InputCheck, item: DocumentItemInput, field: string): void {
  if (typeof item !== 'object' || item === null) {
    check.fail(field, 'A tétel objektum legyen.')
    return
  }
  check.finite(item.quantity, `${field}.quantity`)
  if (isProductItem(item)) {
    check.id(item.productId, `${field}.productId`)
    return
  }
  check.text(item.name, `${field}.name`)
  if ((item.netUnitPrice === undefined) === (item.grossUnitPrice === undefined)) {
    check.fail(
      field,
      'Pontosan az egyik árat add meg: netUnitPrice (nettó egységár) vagy grossUnitPrice (bruttó egységár).',
    )
  } else if (item.netUnitPrice !== undefined) {
    check.finite(item.netUnitPrice, `${field}.netUnitPrice`)
  } else {
    check.finite(item.grossUnitPrice, `${field}.grossUnitPrice`)
  }
  check.convert(`${field}.vat`, () => toVatCode(VATS, item.vat))
}

export function toItem(item: DocumentItemInput): WireDocumentItem {
  if (isProductItem(item)) {
    return { productId: item.productId, quantity: item.quantity, comment: item.comment }
  }
  const shared = {
    name: item.name,
    quantity: item.quantity,
    unit: item.unit ?? DEFAULT_UNIT,
    vat: toVatCode(VATS, item.vat),
    comment: item.comment,
    entitlement: item.entitlement,
    sku: item.sku,
  }
  if (item.netUnitPrice !== undefined) {
    return { ...shared, unitPrice: item.netUnitPrice, unitPriceType: 'net' }
  }
  return { ...shared, unitPrice: item.grossUnitPrice, unitPriceType: 'gross' }
}

export interface DueDateInput {
  readonly dueDate?: DateInput
  readonly dueInDays?: number
}

export function dueDateOf(input: DueDateInput, defaults: ResolvedDefaults, now: Date): string {
  if (input.dueDate !== undefined) {
    if (input.dueInDays !== undefined) {
      throw new RangeError('A dueDate és a dueInDays közül csak az egyiket add meg.')
    }
    return toBillingoDate(input.dueDate)
  }
  const days = input.dueInDays ?? defaults.dueInDays
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new RangeError(`A dueInDays nemnegatív egész szám legyen, kapott: ${String(days)}`)
  }
  return addBudapestDays(now, days)
}

function settingsOf(input: DocumentInput, defaults: ResolvedDefaults): DocumentSettings {
  return {
    ...input.settings,
    shouldSendEmail: input.sendEmail ?? input.settings?.shouldSendEmail ?? defaults.sendEmail,
    ...(input.orderNumber === undefined ? {} : { orderNumber: input.orderNumber }),
  }
}

function checkDocument(
  input: DocumentInput,
  defaults: ResolvedDefaults,
  operation: OperationId,
  options: PrepareOptions,
  now: Date,
): InputCheck {
  const check = createInputCheck()
  const finalizing = operation === 'CreateDocumentFromDraft'
  const types = finalizing ? FINAL_TYPES : DOCUMENT_TYPES
  if (!isOneOf(types, input.type ?? 'invoice')) {
    check.fail('type', `A típus ${types.join(', ')} lehet, kapott: ${String(input.type)}.`)
  }
  check.vendorId(input.vendorId, options.vendorIdRequired === true)
  check.partner(input.partner, 'partner')
  if (input.blockId !== undefined) check.id(input.blockId, 'blockId')
  if (input.bankAccountId !== undefined) check.id(input.bankAccountId, 'bankAccountId')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    check.fail('items', 'Legalább egy tétel kell.')
  } else {
    input.items.forEach((item, index) => {
      checkItem(check, item, `items.${index}`)
    })
  }
  const fulfillmentDate = input.fulfillmentDate
  if (fulfillmentDate !== undefined) {
    check.convert('fulfillmentDate', () => toBillingoDate(fulfillmentDate))
  }
  check.convert(input.dueDate === undefined ? 'dueInDays' : 'dueDate', () =>
    dueDateOf(input, defaults, now),
  )
  if (input.paymentMethod !== undefined) {
    check.choice(PAYMENT_METHODS, input.paymentMethod, 'paymentMethod', 'fizetési mód')
  }
  if (input.language !== undefined) {
    check.choice(DOCUMENT_LANGUAGES, input.language, 'language', 'nyelv')
  }
  check.currency(input.currency ?? defaults.currency, input.conversionRate)
  check.flag(input.electronic, 'electronic')
  check.flag(input.sendEmail, 'sendEmail')
  input.advanceInvoiceIds?.forEach((id, index) => {
    check.id(id, `advanceInvoiceIds.${index}`)
  })
  const discount = input.discountPercent
  if (discount !== undefined && !(Number.isFinite(discount) && discount > 0 && discount <= 100)) {
    check.fail(
      'discountPercent',
      `0-nál nagyobb, legfeljebb 100 százalék kell, kapott: ${String(discount)}.`,
    )
  }
  return check
}

export function prepareDocument(
  input: DocumentInput,
  defaults: ResolvedDefaults,
  operation: OperationId,
  options: PrepareOptions = {},
): PreparedDocument {
  const now = options.now ?? new Date()
  assertValid(checkDocument(input, defaults, operation, options, now), operation, 'bizonylatadatok')
  const advanceInvoice = input.advanceInvoiceIds ?? []
  return {
    partner: input.partner,
    blockId: input.blockId,
    body: {
      vendorId: input.vendorId?.trim(),
      bankAccountId: input.bankAccountId ?? defaults.bankAccountId,
      type: input.type ?? 'invoice',
      fulfillmentDate: toBillingoDate(input.fulfillmentDate ?? now),
      dueDate: dueDateOf(input, defaults, now),
      paymentMethod:
        input.paymentMethod ?? defaults.paymentMethod ?? DEFAULT_DOCUMENT_PAYMENT_METHOD,
      language: input.language ?? defaults.language,
      currency: input.currency ?? defaults.currency,
      conversionRate: input.conversionRate,
      electronic: input.electronic ?? defaults.electronic,
      items: input.items.map(toItem),
      comment: input.comment,
      settings: settingsOf(input, defaults),
      advanceInvoice: advanceInvoice.length > 0 ? advanceInvoice : undefined,
      discount:
        input.discountPercent === undefined
          ? undefined
          : { type: 'percent', value: input.discountPercent },
    },
  }
}
