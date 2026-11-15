import { CURRENCIES, DOCUMENT_LANGUAGES, PAYMENT_METHODS } from '../documents/enums'
import type { DocumentInput, DocumentItemInput } from '../documents/input'
import type { Country, DocumentInsertType, PartnerTaxType } from '../generated/billingo'
import type { PartnerAddressInput, PartnerInput } from '../partners/partners'
import type { ReceiptInput, ReceiptItemInput } from '../receipts/receipts'
import {
  assertKnownKeys,
  documentVat,
  field,
  objectArg,
  optionalArray,
  optionalBoolean,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalInteger,
  optionalNumber,
  optionalString,
  receiptVat,
  requiredArray,
  requiredBoolean,
  requiredString,
  stringList,
  ToolInputError,
} from './arguments'
import type { JsonObject } from './protocol'

export type McpDocumentType = Exclude<DocumentInsertType, 'draft'>

export const MCP_DOCUMENT_TYPES: readonly McpDocumentType[] = ['invoice', 'proforma', 'advance']

export const MCP_TAX_TYPES: readonly Exclude<PartnerTaxType, ''>[] = [
  'HAS_TAX_NUMBER',
  'NO_TAX_NUMBER',
  'FOREIGN',
]

export const MAX_TOOL_ITEMS = 100

export const MAX_EMAILS = 10

const PARTNER_KEYS = ['name', 'address', 'emails', 'taxcode', 'taxType', 'phone']
const ADDRESS_KEYS = ['postCode', 'city', 'address', 'countryCode']
const PRICED_ONLY_KEYS = ['name', 'unit', 'netUnitPrice', 'grossUnitPrice', 'vat']
const DOCUMENT_ITEM_KEYS = [...PRICED_ONLY_KEYS, 'quantity', 'comment', 'productId']
const RECEIPT_ITEM_KEYS = ['name', 'quantity', 'unit', 'grossUnitPrice', 'vat', 'productId']

export const DOCUMENT_INPUT_KEYS: readonly string[] = [
  'type',
  'vendorId',
  'partnerId',
  'partner',
  'items',
  'blockId',
  'bankAccountId',
  'fulfillmentDate',
  'dueDate',
  'dueInDays',
  'paymentMethod',
  'language',
  'currency',
  'conversionRate',
  'electronic',
  'comment',
  'orderNumber',
  'sendEmail',
  'advanceInvoiceIds',
]

export const RECEIPT_INPUT_KEYS: readonly string[] = [
  'vendorId',
  'partnerId',
  'partner',
  'name',
  'emails',
  'blockId',
  'paymentMethod',
  'currency',
  'conversionRate',
  'electronic',
  'items',
]

const COUNTRY_CODE = /^[A-Z]{2}$/

function isCountry(value: string): value is Exclude<Country, ''> {
  return COUNTRY_CODE.test(value)
}

function addressOf(value: unknown, path: string): PartnerAddressInput {
  const address = objectArg(value, path)
  assertKnownKeys(address, ADDRESS_KEYS, path)
  const countryCode = optionalString(address, 'countryCode', path)?.toUpperCase()
  if (countryCode !== undefined && !isCountry(countryCode)) {
    throw new ToolInputError(
      `A(z) ${path}.countryCode kétbetűs országkód legyen (például HU, AT, DE), kapott: ${countryCode}.`,
      { fields: [`${path}.countryCode`] },
    )
  }
  return {
    postCode: requiredString(address, 'postCode', path),
    city: requiredString(address, 'city', path),
    address: requiredString(address, 'address', path),
    ...(countryCode === undefined ? {} : { countryCode }),
  }
}

function partnerOf(value: unknown): PartnerInput {
  const partner = objectArg(value, 'partner')
  assertKnownKeys(partner, PARTNER_KEYS, 'partner')
  const emails =
    optionalArray(partner, 'emails', 'partner') === undefined
      ? undefined
      : stringList(partner, 'emails', 'partner', { min: 1, max: MAX_EMAILS })
  const taxcode = optionalString(partner, 'taxcode', 'partner')
  const taxType = optionalEnum(partner, 'taxType', 'partner', MCP_TAX_TYPES)
  const phone = optionalString(partner, 'phone', 'partner')
  return {
    name: requiredString(partner, 'name', 'partner'),
    address: addressOf(partner.address, 'partner.address'),
    ...(emails === undefined ? {} : { emails }),
    ...(taxcode === undefined ? {} : { taxcode }),
    ...(taxType === undefined ? {} : { taxType }),
    ...(phone === undefined ? {} : { phone }),
  }
}

function partnerOfArgs(args: JsonObject): number | PartnerInput | undefined {
  const partnerId = optionalId(args, 'partnerId', '')
  const inline = args.partner ?? undefined
  if (partnerId !== undefined && inline !== undefined) {
    throw new ToolInputError('A partnerId és a partner közül csak az egyiket add meg.', {
      fields: ['partnerId', 'partner'],
    })
  }
  return partnerId ?? (inline === undefined ? undefined : partnerOf(inline))
}

function requiredPartner(args: JsonObject): number | PartnerInput {
  const partner = partnerOfArgs(args)
  if (partner !== undefined) return partner
  throw new ToolInputError(
    'A vevő kötelező: add meg a partnerId-t (meglévő partner) vagy a partner objektumot (név és cím).',
    { fields: ['partnerId', 'partner'] },
  )
}

function quantityOf(item: JsonObject, path: string): number {
  const quantity = optionalNumber(item, 'quantity', path) ?? 1
  if (quantity === 0) {
    throw new ToolInputError(`A(z) ${path}.quantity nem lehet 0.`, {
      fields: [`${path}.quantity`],
    })
  }
  return quantity
}

function priceOf(
  item: JsonObject,
  path: string,
): { readonly netUnitPrice: number } | { readonly grossUnitPrice: number } {
  const net = optionalNumber(item, 'netUnitPrice', path)
  const gross = optionalNumber(item, 'grossUnitPrice', path)
  if (net !== undefined && gross === undefined) return { netUnitPrice: net }
  if (gross !== undefined && net === undefined) return { grossUnitPrice: gross }
  throw new ToolInputError(
    `A(z) ${path} tételnél pontosan az egyiket add meg: netUnitPrice (nettó egységár) vagy grossUnitPrice (bruttó egységár).`,
    { fields: [`${path}.netUnitPrice`, `${path}.grossUnitPrice`] },
  )
}

function documentItemOf(value: unknown, index: number): DocumentItemInput {
  const path = `items.${index}`
  const item = objectArg(value, path)
  assertKnownKeys(item, DOCUMENT_ITEM_KEYS, path)
  const quantity = quantityOf(item, path)
  const comment = optionalString(item, 'comment', path)
  const withComment = comment === undefined ? {} : { comment }
  const productId = optionalId(item, 'productId', path)
  if (productId !== undefined) {
    const extra = PRICED_ONLY_KEYS.filter((key) => item[key] !== undefined)
    if (extra.length > 0) {
      throw new ToolInputError(
        `A(z) ${path} termékes tétel (productId): a nevet, az árat és az áfát a Billingo a termékből veszi, ezek nem adhatók meg: ${extra.join(', ')}.`,
        { fields: extra.map((key) => field(path, key)) },
      )
    }
    return { productId, quantity, ...withComment }
  }
  const unit = optionalString(item, 'unit', path)
  return {
    name: requiredString(item, 'name', path),
    quantity,
    vat: documentVat(item.vat, `${path}.vat`),
    ...priceOf(item, path),
    ...(unit === undefined ? {} : { unit }),
    ...withComment,
  }
}

function receiptItemOf(value: unknown, index: number): ReceiptItemInput {
  const path = `items.${index}`
  const item = objectArg(value, path)
  assertKnownKeys(item, RECEIPT_ITEM_KEYS, path)
  const quantity = quantityOf(item, path)
  const productId = optionalId(item, 'productId', path)
  if (productId !== undefined) return { productId, quantity }
  const grossUnitPrice = optionalNumber(item, 'grossUnitPrice', path)
  if (grossUnitPrice === undefined) {
    throw new ToolInputError(
      `A(z) ${path}.grossUnitPrice kötelező: nyugtán bruttó egységár szerepel (vagy adj meg productId-t).`,
      { fields: [`${path}.grossUnitPrice`] },
    )
  }
  const unit = optionalString(item, 'unit', path)
  return {
    name: requiredString(item, 'name', path),
    grossUnitPrice,
    vat: receiptVat(item.vat, `${path}.vat`),
    quantity,
    ...(unit === undefined ? {} : { unit }),
  }
}

function dueOf(args: JsonObject): Pick<DocumentInput, 'dueDate' | 'dueInDays'> {
  const dueDate = optionalDate(args, 'dueDate', '')
  const dueInDays = optionalInteger(args, 'dueInDays', '')
  if (dueDate !== undefined && dueInDays !== undefined) {
    throw new ToolInputError('A dueDate és a dueInDays közül csak az egyiket add meg.', {
      fields: ['dueDate', 'dueInDays'],
    })
  }
  if (dueInDays !== undefined && dueInDays < 0) {
    throw new ToolInputError('A dueInDays nemnegatív egész szám legyen.', {
      fields: ['dueInDays'],
    })
  }
  if (dueDate !== undefined) return { dueDate }
  return dueInDays === undefined ? {} : { dueInDays }
}

function advanceIdsOf(args: JsonObject): readonly number[] | undefined {
  return optionalArray(args, 'advanceInvoiceIds', '')?.map((value, index) => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
    throw new ToolInputError(
      `A(z) advanceInvoiceIds.${index} elemnek pozitív egész azonosítónak kell lennie.`,
      { fields: [`advanceInvoiceIds.${index}`] },
    )
  })
}

export function documentInputOf(
  args: JsonObject,
  extraKeys: readonly string[] = [],
): DocumentInput {
  assertKnownKeys(args, [...DOCUMENT_INPUT_KEYS, ...extraKeys], '')
  const type = optionalEnum(args, 'type', '', MCP_DOCUMENT_TYPES)
  const vendorId = optionalString(args, 'vendorId', '')
  const partner = requiredPartner(args)
  const items = requiredArray(args, 'items', '', { min: 1, max: MAX_TOOL_ITEMS }).map(
    documentItemOf,
  )
  const blockId = optionalId(args, 'blockId', '')
  const bankAccountId = optionalId(args, 'bankAccountId', '')
  const fulfillmentDate = optionalDate(args, 'fulfillmentDate', '')
  const paymentMethod = optionalEnum(args, 'paymentMethod', '', PAYMENT_METHODS)
  const language = optionalEnum(args, 'language', '', DOCUMENT_LANGUAGES)
  const currency = optionalEnum(args, 'currency', '', CURRENCIES)
  const conversionRate = optionalNumber(args, 'conversionRate', '')
  const electronic = optionalBoolean(args, 'electronic', '')
  const comment = optionalString(args, 'comment', '')
  const orderNumber = optionalString(args, 'orderNumber', '')
  const advanceInvoiceIds = advanceIdsOf(args)
  return {
    partner,
    items,
    ...dueOf(args),
    sendEmail: optionalBoolean(args, 'sendEmail', '') ?? false,
    ...(type === undefined ? {} : { type }),
    ...(vendorId === undefined ? {} : { vendorId }),
    ...(blockId === undefined ? {} : { blockId }),
    ...(bankAccountId === undefined ? {} : { bankAccountId }),
    ...(fulfillmentDate === undefined ? {} : { fulfillmentDate }),
    ...(paymentMethod === undefined ? {} : { paymentMethod }),
    ...(language === undefined ? {} : { language }),
    ...(currency === undefined ? {} : { currency }),
    ...(conversionRate === undefined ? {} : { conversionRate }),
    ...(electronic === undefined ? {} : { electronic }),
    ...(comment === undefined ? {} : { comment }),
    ...(orderNumber === undefined ? {} : { orderNumber }),
    ...(advanceInvoiceIds === undefined ? {} : { advanceInvoiceIds }),
  }
}

export function receiptInputOf(args: JsonObject, extraKeys: readonly string[] = []): ReceiptInput {
  assertKnownKeys(args, [...RECEIPT_INPUT_KEYS, ...extraKeys], '')
  const vendorId = optionalString(args, 'vendorId', '')
  const partner = partnerOfArgs(args)
  const name = optionalString(args, 'name', '')
  const emails =
    optionalArray(args, 'emails', '') === undefined
      ? undefined
      : stringList(args, 'emails', '', { min: 1, max: MAX_EMAILS })
  const blockId = optionalId(args, 'blockId', '')
  const paymentMethod = optionalEnum(args, 'paymentMethod', '', PAYMENT_METHODS)
  const currency = optionalEnum(args, 'currency', '', CURRENCIES)
  const conversionRate = optionalNumber(args, 'conversionRate', '')
  const electronic = requiredBoolean(args, 'electronic', '')
  const items = requiredArray(args, 'items', '', { min: 1, max: MAX_TOOL_ITEMS }).map(receiptItemOf)
  return {
    electronic,
    items,
    ...(vendorId === undefined ? {} : { vendorId }),
    ...(partner === undefined ? {} : { partner }),
    ...(name === undefined ? {} : { name }),
    ...(emails === undefined ? {} : { emails }),
    ...(blockId === undefined ? {} : { blockId }),
    ...(paymentMethod === undefined ? {} : { paymentMethod }),
    ...(currency === undefined ? {} : { currency }),
    ...(conversionRate === undefined ? {} : { conversionRate }),
  }
}
