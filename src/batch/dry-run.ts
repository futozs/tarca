import { documentTotals, lineAmounts, type PricedLine } from '../core/money'
import { assertValid, createInputCheck, type InputCheck } from '../documents/check'
import type { ResolvedDefaults } from '../documents/defaults'
import { isOneOf, PAYMENT_METHODS, RECEIPT_VATS, toVatCode, VATS } from '../documents/enums'
import { type DocumentInput, type DocumentItemInput, prepareDocument } from '../documents/input'
import type { Currency } from '../generated/billingo'
import type { ReceiptInput, ReceiptItemInput } from '../receipts/receipts'

export interface DryRunEstimate {
  readonly currency: Currency
  readonly grossTotal: number | undefined
}

const RECEIPT_TYPES: readonly string[] = ['receipt', 'draft']

function grossOf(
  lines: readonly (PricedLine | undefined)[],
  conversionRate: number,
): number | undefined {
  const priced: PricedLine[] = []
  for (const line of lines) {
    if (!line) return undefined
    priced.push(line)
  }
  return documentTotals(
    priced.map((line) => ({ ...lineAmounts(line), vat: line.vat })),
    conversionRate,
  ).grossTotal
}

function documentLine(item: DocumentItemInput): PricedLine | undefined {
  if ('productId' in item) return undefined
  const vat = toVatCode(VATS, item.vat)
  if (item.netUnitPrice !== undefined) {
    return { unitPrice: item.netUnitPrice, unitPriceType: 'net', quantity: item.quantity, vat }
  }
  return { unitPrice: item.grossUnitPrice, unitPriceType: 'gross', quantity: item.quantity, vat }
}

export function checkDocument(input: DocumentInput, defaults: ResolvedDefaults): DryRunEstimate {
  const { body } = prepareDocument(input, defaults, 'CreateDocument', { vendorIdRequired: true })
  const estimable = input.discountPercent === undefined && body.advanceInvoice === undefined
  return {
    currency: body.currency ?? defaults.currency,
    grossTotal: estimable
      ? grossOf(input.items.map(documentLine), input.conversionRate ?? 1)
      : undefined,
  }
}

function checkReceiptItem(check: InputCheck, item: ReceiptItemInput, field: string): void {
  if (typeof item !== 'object' || item === null) {
    check.fail(field, 'A tétel objektum legyen.')
    return
  }
  if (item.quantity !== undefined) check.finite(item.quantity, `${field}.quantity`)
  if ('productId' in item) {
    check.id(item.productId, `${field}.productId`)
    return
  }
  check.text(item.name, `${field}.name`)
  check.finite(item.grossUnitPrice, `${field}.grossUnitPrice`)
  check.convert(`${field}.vat`, () => toVatCode(RECEIPT_VATS, item.vat))
}

function receiptLine(item: ReceiptItemInput): PricedLine | undefined {
  if ('productId' in item) return undefined
  const vat = toVatCode(RECEIPT_VATS, item.vat)
  if (!isOneOf(VATS, vat)) return undefined
  return {
    unitPrice: item.grossUnitPrice,
    unitPriceType: 'gross',
    quantity: item.quantity ?? 1,
    vat,
  }
}

export function checkReceipt(input: ReceiptInput, defaults: ResolvedDefaults): DryRunEstimate {
  const check = createInputCheck()
  if (!isOneOf(RECEIPT_TYPES, input.type ?? 'receipt')) {
    check.fail('type', `A típus ${RECEIPT_TYPES.join(', ')} lehet, kapott: ${String(input.type)}.`)
  }
  check.vendorId(input.vendorId, true)
  if (input.partner !== undefined) check.partner(input.partner, 'partner')
  if (input.blockId !== undefined) check.id(input.blockId, 'blockId')
  if (input.paymentMethod !== undefined) {
    check.choice(PAYMENT_METHODS, input.paymentMethod, 'paymentMethod', 'fizetési mód')
  }
  const currency = input.currency ?? defaults.currency
  check.currency(currency, input.conversionRate)
  check.flag(input.electronic, 'electronic')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    check.fail('items', 'Legalább egy tétel kell.')
  } else {
    input.items.forEach((item, index) => {
      checkReceiptItem(check, item, `items.${index}`)
    })
  }
  assertValid(check, 'CreateReceipt', 'nyugtaadatok')
  return { currency, grossTotal: grossOf(input.items.map(receiptLine), input.conversionRate ?? 1) }
}
