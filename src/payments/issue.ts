import { abortable, type RequestOptions, sleep } from '../core/context'
import { digestHex } from '../core/crypto'
import { toBillingoDate, toBudapestDate } from '../core/dates'
import { BillingoError, configurationError, isBillingoError } from '../core/errors'
import { lineAmounts, roundHalfUp } from '../core/money'
import { DEFAULT_LOCK_TTL_SECONDS, isUncertainOutcome } from '../core/once-guard'
import type { KeyValueStore } from '../core/store'
import type { CurrenciesApi } from '../currencies/currencies'
import type { DocumentsApi } from '../documents/documents'
import { isOneOf, PAYMENT_METHODS, RECEIPT_VATS, toVatCode, VATS } from '../documents/enums'
import type { DocumentOnceInput } from '../documents/input'
import type { CreateOnceOptions, DocumentOnceResult } from '../documents/once'
import type { DocumentPaymentsApi } from '../documents/payments'
import type { Currency, Document, PaymentMethod, ReceiptVat, Vat } from '../generated/billingo'
import type { PartnerInput } from '../partners/partners'
import type { ReceiptOnceInput, ReceiptsApi } from '../receipts/receipts'
import { currencyExponent, decimalToMinor, isBillingoCurrency, normalizeCurrency } from './amounts'
import { chooseDocument, type DocumentDecision } from './choose'
import { refundLedgerKey } from './modification'
import {
  type IssuedModification,
  type IssuedRefundProposal,
  issueForPartialRefund,
  issueForRemainder,
  type PartialRefundMode,
  type RefundItemsResolver,
  refundBeforeDocumentError,
} from './partial-refund'
import { partnerFromCustomer } from './partner'
import type { PaymentAmount, PaymentEvent, PaymentLineItem, PaymentVat } from './types'

export interface PaymentTarca {
  readonly documents: Pick<
    DocumentsApi,
    'createOnce' | 'findByVendorId' | 'get' | 'list' | 'cancel' | 'createModification'
  > & { readonly payments: Pick<DocumentPaymentsApi, 'replace'> }
  readonly receipts: Pick<ReceiptsApi, 'createOnce'>
  readonly currencies: Pick<CurrenciesApi, 'rate'>
}

export interface PaymentDocumentItem {
  readonly name: string
  readonly quantity?: number | undefined
  readonly unit?: string | undefined
  readonly sku?: string | undefined
  readonly comment?: string | undefined
  readonly grossUnitPrice: number
  readonly vat: PaymentVat
}

export type PaymentReceiptOptions = Partial<
  Omit<ReceiptOnceInput, 'items' | 'vendorId' | 'currency' | 'conversionRate' | 'type'>
>

export type PaymentInvoiceOptions = Partial<
  Omit<DocumentOnceInput, 'items' | 'vendorId' | 'partner' | 'currency' | 'conversionRate' | 'type'>
>

export interface IssueForPaymentOptions extends CreateOnceOptions {
  readonly vat?: PaymentVat | undefined
  readonly vatFor?: ((item: PaymentLineItem) => PaymentVat | undefined) | undefined
  readonly items?: readonly PaymentDocumentItem[] | undefined
  readonly fallbackItemName?: string | undefined
  readonly document?: 'auto' | 'receipt' | 'invoice' | undefined
  readonly partner?: number | PartnerInput | undefined
  readonly buyerIsBusiness?: boolean | undefined
  readonly invoiceRequested?: boolean | undefined
  readonly cashRegisterRequired?: boolean | undefined
  readonly vendorId?: string | undefined
  readonly currency?: Currency | undefined
  readonly conversionRate?: number | undefined
  readonly method?: PaymentMethod | undefined
  readonly allowAmountMismatch?: boolean | undefined
  readonly partialRefund?: PartialRefundMode | undefined
  readonly refundItems?: RefundItemsResolver | undefined
  readonly ledger?: KeyValueStore | undefined
  readonly receipt?: PaymentReceiptOptions | undefined
  readonly invoice?: PaymentInvoiceOptions | undefined
}

export interface PaymentConversion {
  readonly rate: number
  readonly source: 'option' | 'billingo'
  readonly date: string | undefined
}

export interface IssuedReceipt {
  readonly kind: 'receipt'
  readonly vendorId: string
  readonly created: boolean
  readonly document: Document
  readonly decision: DocumentDecision | undefined
  readonly conversion: PaymentConversion | undefined
}

export interface IssuedInvoice {
  readonly kind: 'invoice'
  readonly vendorId: string
  readonly created: boolean
  readonly document: Document
  readonly decision: DocumentDecision | undefined
  readonly conversion: PaymentConversion | undefined
  readonly paymentRecorded: boolean
}

export interface IssuedCancellation {
  readonly kind: 'cancellation'
  readonly vendorId: string
  readonly document: 'receipt' | 'invoice'
  readonly originalId: number
  readonly cancellation: Document | undefined
  readonly created: boolean
}

export interface IssuedRefundFailure {
  readonly kind: 'refund-failed'
  readonly vendorId: string
  readonly document: Document
  readonly reason: string
}

export interface SkippedPayment {
  readonly kind: 'skipped'
  readonly vendorId: string
  readonly reason: string
}

export type IssuedDocument =
  | IssuedReceipt
  | IssuedInvoice
  | IssuedCancellation
  | IssuedModification
  | IssuedRefundProposal
  | IssuedRefundFailure
  | SkippedPayment

interface ResolvedItem {
  readonly name: string
  readonly quantity: number
  readonly unit: string | undefined
  readonly sku: string | undefined
  readonly comment: string | undefined
  readonly grossUnitPrice: number
  readonly vat: Vat | ReceiptVat
  readonly lineMinor: number
}

const DEFAULT_ITEM_NAME = 'Termék vagy szolgáltatás'
const DEFAULT_RECOVERY_DELAY_MS = 1_000
const CANCEL_LOOKUPS = 2
const VENDOR_ID_SAFE = /^[A-Za-z0-9_.:-]+$/
const PROVIDER_NAME = /^[A-Z0-9_]+$/
const MAX_VENDOR_ID = 64
const CANNOT_CANCEL = /^Cannot cancel the document/
const CANCEL_LOCK_REFUND_ID = 'sztorno'
const ALL_VATS: readonly (Vat | ReceiptVat)[] = [...VATS, 'none']

function validation(message: string, hint?: string): BillingoError {
  return new BillingoError(message, { category: 'validation', hint })
}

function skipped(vendorId: string, reason: string): SkippedPayment {
  return { kind: 'skipped', vendorId, reason }
}

function requestOptions(options: IssueForPaymentOptions): RequestOptions {
  return options.signal === undefined ? {} : { signal: options.signal }
}

function onceOptions(options: IssueForPaymentOptions): CreateOnceOptions {
  return {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.recoveryDelayMs === undefined ? {} : { recoveryDelayMs: options.recoveryDelayMs }),
    ...(options.lock === undefined ? {} : { lock: options.lock }),
    ...(options.lockTtlSeconds === undefined ? {} : { lockTtlSeconds: options.lockTtlSeconds }),
    ...(options.lockWaitMs === undefined ? {} : { lockWaitMs: options.lockWaitMs }),
    ...(options.lockFailure === undefined ? {} : { lockFailure: options.lockFailure }),
  }
}

function resolveRecoveryDelay(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RECOVERY_DELAY_MS
  if (!Number.isFinite(value) || value < 0) {
    throw configurationError(
      `A recoveryDelayMs értéke nemnegatív szám legyen, kapott: ${String(value)}`,
    )
  }
  return value
}

export async function paymentVendorId(
  payment: Pick<PaymentEvent, 'provider' | 'id'>,
): Promise<string> {
  const provider = String(payment.provider).trim().toUpperCase()
  if (!PROVIDER_NAME.test(provider)) {
    throw validation(
      `A fizetési szolgáltató neve (provider) csak angol betűt, számot és aláhúzást tartalmazhat, kapott: „${String(payment.provider)}”.`,
    )
  }
  const id = typeof payment.id === 'string' ? payment.id.trim() : ''
  if (id === '') throw validation('A fizetés azonosítója (id) üres, ebből nem képezhető vendorId.')
  const plain = `${provider}-${id}`
  if (VENDOR_ID_SAFE.test(id) && plain.length <= MAX_VENDOR_ID) return plain
  return `${provider}-h${(await digestHex('SHA-256', id)).slice(0, 16)}`
}

function vatCode(vat: PaymentVat | undefined, label: string): Vat | ReceiptVat {
  if (vat === undefined) {
    throw validation(
      `A(z) „${label}” tételhez nincs áfakulcs.`,
      'Add meg az alapértelmezett áfakulcsot (vat), vagy tételenként (vatFor). A tárca soha nem találgat áfát.',
    )
  }
  try {
    return toVatCode(ALL_VATS, vat)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    throw validation(
      `A(z) „${label}” tétel áfakulcsa nem ismert: ${error.message}`,
      'Add meg a vatFor opciót a helyes áfakulcs kiválasztásához.',
    )
  }
}

function modelVat(vat: Vat | ReceiptVat): Vat {
  return vat === 'none' ? '0%' : vat
}

function lineMinorOf(
  name: string,
  grossUnitPrice: number,
  quantity: number,
  vat: Vat | ReceiptVat,
  exponent: number,
): number {
  if (!Number.isFinite(grossUnitPrice)) {
    throw validation(`A(z) „${name}” tétel bruttó egységára nem véges szám.`)
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw validation(`A(z) „${name}” tétel mennyisége nem pozitív szám.`)
  }
  const gross = lineAmounts({
    unitPrice: grossUnitPrice,
    unitPriceType: 'gross',
    quantity,
    vat: modelVat(vat),
  }).grossAmount
  const minor = decimalToMinor(gross, exponent)
  if (minor === undefined) {
    throw validation(
      `A(z) „${name}” tétel bruttó összege (${gross}) nem írható le a bizonylat pénznemében (${exponent} tizedesjegy).`,
    )
  }
  return minor
}

function resolved(item: PaymentDocumentItem, exponent: number): ResolvedItem {
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (name === '') throw validation('A bizonylat tételének neve nem lehet üres.')
  const quantity = item.quantity ?? 1
  const vat = vatCode(item.vat, name)
  return {
    name,
    quantity,
    unit: item.unit,
    sku: item.sku,
    comment: item.comment,
    grossUnitPrice: item.grossUnitPrice,
    vat,
    lineMinor: lineMinorOf(name, item.grossUnitPrice, quantity, vat, exponent),
  }
}

function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 6 }).format(quantity)
}

function fromLineItem(
  item: PaymentLineItem,
  currency: string,
  exponent: number,
  options: IssueForPaymentOptions,
): ResolvedItem {
  const name = item.name?.trim() || DEFAULT_ITEM_NAME
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw validation(`A(z) „${name}” tétel mennyisége nem pozitív szám.`)
  }
  const total = item.totalGross
  if (normalizeCurrency(total.currency) !== currency) {
    throw validation(
      `A(z) „${name}” tétel pénzneme (${total.currency}) eltér a fizetésétől (${currency}).`,
    )
  }
  const vat = vatCode(options.vatFor?.(item) ?? item.vat ?? options.vat, name)
  const unitMinor = total.minor / item.quantity
  const exact = Number.isSafeInteger(unitMinor) && unitMinor * item.quantity === total.minor
  if (exact) {
    return resolved(
      {
        name,
        quantity: item.quantity,
        unit: item.unit,
        sku: item.sku,
        grossUnitPrice: unitMinor / 10 ** exponent,
        vat,
      },
      exponent,
    )
  }
  return resolved(
    {
      name: `${name} (${formatQuantity(item.quantity)} ${item.unit?.trim() || 'db'})`,
      quantity: 1,
      sku: item.sku,
      grossUnitPrice: total.value,
      vat,
    },
    exponent,
  )
}

function itemsOf(
  payment: PaymentEvent,
  currency: string,
  exponent: number,
  options: IssueForPaymentOptions,
): ResolvedItem[] {
  if (options.items && options.items.length > 0) {
    return options.items.map((item) => resolved(item, exponent))
  }
  if (payment.items && payment.items.length > 0) {
    return payment.items.map((item) => fromLineItem(item, currency, exponent, options))
  }
  if (payment.amount) {
    const name = options.fallbackItemName?.trim() || DEFAULT_ITEM_NAME
    return [
      resolved(
        { name, grossUnitPrice: payment.amount.value, vat: vatCode(options.vat, name) },
        exponent,
      ),
    ]
  }
  throw validation(
    `A(z) ${payment.provider} fizetésből (${payment.id}) sem összeg, sem tétel nem olvasható ki.`,
    'Add meg a tételeket az items opcióban (például a saját rendelésedből).',
  )
}

function currencyOf(payment: PaymentEvent, options: IssueForPaymentOptions): Currency {
  const paid = payment.amount ? normalizeCurrency(payment.amount.currency) : undefined
  const configured = options.currency ? normalizeCurrency(options.currency) : undefined
  if (paid && configured && paid !== configured) {
    throw validation(
      `A fizetés pénzneme (${paid}) eltér a megadott pénznemtől (${configured}).`,
      'A bizonylat pénzneme mindig a fizetésé; a currency opció csak akkor kell, ha a fizetésből nem olvasható ki.',
    )
  }
  const currency = paid ?? configured ?? 'HUF'
  if (!isBillingoCurrency(currency)) {
    throw validation(
      `A(z) ${currency} pénznemben a Billingo nem állít ki bizonylatot.`,
      'A Billingo pénznemei: a Currency típus értékei (például HUF, EUR, USD).',
    )
  }
  return currency
}

function assertAmount(amount: PaymentAmount, payment: PaymentEvent): void {
  const exponent = currencyExponent(amount.currency)
  if (
    !Number.isSafeInteger(amount.minor) ||
    amount.minor < 0 ||
    decimalToMinor(amount.value, exponent) !== amount.minor
  ) {
    throw validation(
      `A(z) ${payment.provider} fizetés összege érvénytelen: value ${amount.value}, minor ${amount.minor} ${amount.currency}.`,
      `A minor a pénznem váltóegységében megadott nemnegatív egész (${amount.currency}: ${exponent} tizedesjegy), a value ennek a ${10 ** exponent}-ad része. Használd a fromMinorUnits vagy a parseDecimalAmount függvényt.`,
    )
  }
}

function assertOptions(options: IssueForPaymentOptions): void {
  resolveRecoveryDelay(options.recoveryDelayMs)
  if (options.method !== undefined && !isOneOf(PAYMENT_METHODS, options.method)) {
    throw validation(`Ismeretlen Billingo fizetési mód (method): „${String(options.method)}”.`)
  }
  const rate = options.conversionRate
  if (rate !== undefined && !(Number.isFinite(rate) && rate > 0)) {
    throw validation(`A conversionRate pozitív szám legyen, kapott: ${String(rate)}.`)
  }
}

function paidDateOf(payment: PaymentEvent): string {
  const parsed = payment.paidAt === undefined ? Number.NaN : Date.parse(payment.paidAt)
  return toBudapestDate(Number.isNaN(parsed) ? new Date() : new Date(parsed))
}

function fulfillmentDateOf(payment: PaymentEvent, options: IssueForPaymentOptions): string {
  const configured = options.invoice?.fulfillmentDate
  if (configured === undefined) return paidDateOf(payment)
  try {
    return toBillingoDate(configured)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    throw validation(`Hibás invoice.fulfillmentDate: ${error.message}`)
  }
}

async function conversionOf(
  tarca: PaymentTarca,
  currency: Currency,
  date: string,
  options: IssueForPaymentOptions,
): Promise<PaymentConversion | undefined> {
  if (currency === 'HUF') return undefined
  if (options.conversionRate !== undefined) {
    return { rate: options.conversionRate, source: 'option', date: undefined }
  }
  const rate = await tarca.currencies.rate(
    { from: currency, to: 'HUF', date },
    requestOptions(options),
  )
  return { rate: rate.rate, source: 'billingo', date: rate.date ?? date }
}

function isBusinessPartner(partner: number | PartnerInput | undefined): boolean {
  if (partner === undefined || typeof partner === 'number') return false
  return partner.taxType === 'HAS_TAX_NUMBER' || partner.taxType === 'FOREIGN'
}

function decide(
  payment: PaymentEvent,
  gross: number,
  currency: Currency,
  conversion: PaymentConversion | undefined,
  options: IssueForPaymentOptions,
): DocumentDecision {
  if (options.document === 'receipt' || options.document === 'invoice') {
    const rate = currency === 'HUF' ? 1 : conversion?.rate
    return {
      type: options.document,
      reasons: ['A bizonylat típusát a hívó adta meg.'],
      grossTotalHuf: rate === undefined ? Number.NaN : roundHalfUp(gross * rate, 2),
    }
  }
  const decision = chooseDocument({
    grossTotal: gross,
    currency,
    conversionRate: conversion?.rate,
    buyer: {
      taxNumber: payment.customer?.taxNumber,
      euTaxNumber: payment.customer?.euTaxNumber,
      isBusiness:
        options.buyerIsBusiness ??
        (isBusinessPartner(options.partner) ? true : payment.customer?.isBusiness),
    },
    paidByFulfillment: true,
    invoiceRequested: options.invoiceRequested,
    cashRegisterRequired: options.cashRegisterRequired,
  })
  if (decision.type === 'cash-register') throw validation(decision.reasons.join(' '))
  return decision
}

function receiptVat(item: ResolvedItem): ReceiptVat {
  if (isOneOf(RECEIPT_VATS, item.vat)) return item.vat
  throw validation(
    `A(z) „${item.name}” tétel áfakulcsa (${item.vat}) nyugtán nem használható; nyugtán ezek lehetnek: ${RECEIPT_VATS.join(', ')}.`,
    'Válassz nyugtán használható áfakulcsot, vagy állíts ki számlát (document: invoice).',
  )
}

function invoiceVat(item: ResolvedItem): Vat {
  if (isOneOf(VATS, item.vat)) return item.vat
  throw validation(
    `A(z) „${item.name}” tétel áfakulcsa (${item.vat}) számlán nem használható.`,
    'A none áfakulcs csak nyugtán érvényes; számlához add meg a valódi áfakulcsot.',
  )
}

function issueReceipt(
  tarca: PaymentTarca,
  vendorId: string,
  items: readonly ResolvedItem[],
  currency: Currency,
  method: PaymentMethod,
  conversion: PaymentConversion | undefined,
  options: IssueForPaymentOptions,
): Promise<DocumentOnceResult> {
  const lines = items.map((item) => ({
    name: item.name,
    grossUnitPrice: item.grossUnitPrice,
    quantity: item.quantity,
    vat: receiptVat(item),
    ...(item.unit === undefined ? {} : { unit: item.unit }),
  }))
  return tarca.receipts.createOnce(
    {
      ...options.receipt,
      vendorId,
      paymentMethod: options.receipt?.paymentMethod ?? method,
      currency,
      ...(conversion === undefined ? {} : { conversionRate: conversion.rate }),
      items: lines,
    },
    onceOptions(options),
  )
}

function issueInvoice(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  items: readonly ResolvedItem[],
  currency: Currency,
  method: PaymentMethod,
  fulfillmentDate: string,
  conversion: PaymentConversion | undefined,
  options: IssueForPaymentOptions,
): Promise<DocumentOnceResult> {
  const partner = options.partner ?? partnerFromCustomer(payment.customer)
  if (partner === undefined) {
    throw validation(
      'Számlához a vevő neve, teljes címe (irányítószám, város, utca) és kétbetűs országkódja kell, ezt a fizetésből nem lehetett kiolvasni.',
      'Add meg a vevőt a partner opcióban (Billingo partner azonosító vagy PartnerInput).',
    )
  }
  const lines = items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    grossUnitPrice: item.grossUnitPrice,
    vat: invoiceVat(item),
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    ...(item.sku === undefined ? {} : { sku: item.sku }),
    ...(item.comment === undefined ? {} : { comment: item.comment }),
  }))
  return tarca.documents.createOnce(
    {
      fulfillmentDate,
      ...options.invoice,
      type: 'invoice',
      vendorId,
      partner,
      paymentMethod: options.invoice?.paymentMethod ?? method,
      currency,
      ...(conversion === undefined ? {} : { conversionRate: conversion.rate }),
      items: lines,
    },
    onceOptions(options),
  )
}

function kindOf(document: Document): 'receipt' | 'invoice' {
  return document.type === 'receipt' ? 'receipt' : 'invoice'
}

function idOf(document: Document): number {
  if (document.id === undefined) {
    throw new BillingoError('A Billingo a bizonylatot azonosító nélkül adta vissza.', {
      category: 'unexpected_response',
    })
  }
  return document.id
}

async function settle(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  document: Document,
  created: boolean,
  method: PaymentMethod,
  decision: DocumentDecision | undefined,
  conversion: PaymentConversion | undefined,
  options: IssueForPaymentOptions,
): Promise<IssuedReceipt | IssuedInvoice | SkippedPayment> {
  if (document.cancelled === true) {
    return skipped(
      vendorId,
      `A fizetéshez tartozó bizonylatot (${document.invoiceNumber ?? idOf(document)}) már sztornózták, ezért nem készül új bizonylat.`,
    )
  }
  if (kindOf(document) === 'receipt') {
    return { kind: 'receipt', vendorId, created, document, decision, conversion }
  }
  let paymentRecorded = false
  if (document.paymentStatus !== 'paid') {
    const price = document.grossTotal ?? payment.amount?.value
    if (price === undefined) {
      throw new BillingoError('A Billingo a számlát bruttó végösszeg nélkül adta vissza.', {
        category: 'unexpected_response',
      })
    }
    const rate =
      document.currency === undefined || document.currency === 'HUF'
        ? undefined
        : (document.conversionRate ?? conversion?.rate)
    await tarca.documents.payments.replace(
      idOf(document),
      [
        {
          date: paidDateOf(payment),
          price,
          paymentMethod: method,
          ...(rate === undefined ? {} : { conversionRate: rate }),
        },
      ],
      requestOptions(options),
    )
    paymentRecorded = true
  }
  return { kind: 'invoice', vendorId, created, document, decision, conversion, paymentRecorded }
}

async function issueForPaid(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  options: IssueForPaymentOptions,
): Promise<IssuedReceipt | IssuedInvoice | SkippedPayment> {
  if (payment.amount) assertAmount(payment.amount, payment)
  if (payment.amount?.minor === 0) {
    return skipped(vendorId, 'A fizetett összeg 0, ezért nem készül bizonylat.')
  }
  const currency = currencyOf(payment, options)
  const exponent = currencyExponent(currency)
  const items = itemsOf(payment, currency, exponent, options)
  const linesMinor = items.reduce((sum, item) => sum + item.lineMinor, 0)
  if (
    payment.amount &&
    options.allowAmountMismatch !== true &&
    linesMinor !== payment.amount.minor
  ) {
    throw validation(
      `A bizonylat tételeinek bruttó összege (${linesMinor / 10 ** exponent} ${currency}) eltér a kifizetett összegtől (${payment.amount.value} ${currency}).`,
      'Ellenőrizd a tételeket (szállítás, kedvezmény), vagy ha szándékos, add meg az allowAmountMismatch: true opciót.',
    )
  }
  const method = options.method ?? payment.method
  if (!isOneOf(PAYMENT_METHODS, method)) {
    throw validation(`Ismeretlen Billingo fizetési mód: „${String(method)}”.`)
  }
  const existing = await tarca.documents.findByVendorId(vendorId, requestOptions(options))
  if (existing) {
    return settle(tarca, payment, vendorId, existing, false, method, undefined, undefined, options)
  }
  const fulfillmentDate = fulfillmentDateOf(payment, options)
  const conversion = await conversionOf(tarca, currency, fulfillmentDate, options)
  const gross = (payment.amount?.minor ?? linesMinor) / 10 ** exponent
  const decision = decide(payment, gross, currency, conversion, options)
  const result =
    decision.type === 'receipt'
      ? await issueReceipt(tarca, vendorId, items, currency, method, conversion, options)
      : await issueInvoice(
          tarca,
          payment,
          vendorId,
          items,
          currency,
          method,
          fulfillmentDate,
          conversion,
          options,
        )
  return settle(
    tarca,
    payment,
    vendorId,
    result.document,
    result.created,
    method,
    decision,
    conversion,
    options,
  )
}

function isCancelRefused(error: unknown): boolean {
  return (
    isBillingoError(error) && error.status === 400 && CANNOT_CANCEL.test(error.apiMessage ?? '')
  )
}

async function cancelledAfterFailure(
  tarca: PaymentTarca,
  id: number,
  options: IssueForPaymentOptions,
): Promise<boolean> {
  const delay = resolveRecoveryDelay(options.recoveryDelayMs)
  for (let attempt = 1; attempt <= CANCEL_LOOKUPS; attempt++) {
    await sleep(delay * attempt, options.signal)
    try {
      return (await tarca.documents.get(id, requestOptions(options))).cancelled === true
    } catch (error) {
      if (!isBillingoError(error) || !error.retryable) return false
    }
  }
  return false
}

function cancellation(
  vendorId: string,
  document: Document,
  cancelled: Document | undefined,
  created: boolean,
): IssuedCancellation {
  return {
    kind: 'cancellation',
    vendorId,
    document: kindOf(document),
    originalId: idOf(document),
    cancellation: cancelled,
    created,
  }
}

const refundsInFlight = new WeakMap<object, Map<string, Promise<unknown>>>()

async function oneAtATime<T>(
  scope: object,
  key: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  let running = refundsInFlight.get(scope)
  if (!running) {
    running = new Map()
    refundsInFlight.set(scope, running)
  }
  for (;;) {
    const pending = running.get(key)
    if (!pending) break
    await abortable(pending, signal).catch(() => undefined)
    signal?.throwIfAborted()
  }
  const current = run()
  running.set(key, current)
  try {
    return await current
  } finally {
    if (running.get(key) === current) running.delete(key)
  }
}

async function cancelDocument(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  document: Document,
  options: IssueForPaymentOptions,
): Promise<IssuedDocument> {
  const id = idOf(document)
  try {
    const cancelled = await tarca.documents.cancel(id, {}, requestOptions(options))
    return cancellation(vendorId, document, cancelled, true)
  } catch (error) {
    if (isCancelRefused(error)) {
      const current = await tarca.documents.get(id, requestOptions(options))
      if (current.cancelled === true) return cancellation(vendorId, current, undefined, false)
      if (kindOf(current) === 'invoice') {
        return issueForRemainder(tarca, payment, vendorId, current, options)
      }
      throw error
    }
    if (!isUncertainOutcome(error)) throw error
    if (await cancelledAfterFailure(tarca, id, options)) {
      return cancellation(vendorId, document, undefined, true)
    }
    throw error
  }
}

function cancelLockUnavailable(error: unknown): BillingoError {
  return new BillingoError(
    'A visszatérítési főkönyv (ledger) nem érhető el, ezért a tárca nem sztornózta a bizonylatot: nem tudta kizárni, hogy egy másik folyamat éppen sztornózza.',
    {
      category: 'store_unavailable',
      hint: 'Ellenőrizd a ledger tároló elérhetőségét; a webhook újraküldésekor a tárca folytatja.',
      cause: error,
    },
  )
}

async function releaseCancelLock(ledger: KeyValueStore, key: string, value: string): Promise<void> {
  try {
    if (ledger.deleteIfEquals) await ledger.deleteIfEquals(key, value)
    else if ((await ledger.get(key)) === value) await ledger.delete(key)
  } catch {
    return
  }
}

async function cancelOnce(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  document: Document,
  options: IssueForPaymentOptions,
): Promise<IssuedDocument> {
  const ledger = options.ledger
  if (!ledger) return cancelDocument(tarca, payment, vendorId, document, options)
  const setIfAbsent = ledger.setIfAbsent?.bind(ledger)
  if (!setIfAbsent) {
    throw configurationError(
      'A visszatérítési főkönyvhöz (ledger) setIfAbsent műveletet ismerő tároló kell (például Redis vagy Durable Object); e nélkül két folyamat egyszerre sztornózhatna.',
    )
  }
  const id = idOf(document)
  const key = await refundLedgerKey(vendorId, id, CANCEL_LOCK_REFUND_ID)
  const value = JSON.stringify({ state: 'pending', at: new Date().toISOString() })
  let reserved: boolean
  try {
    reserved = await setIfAbsent(key, value, DEFAULT_LOCK_TTL_SECONDS)
  } catch (error) {
    throw cancelLockUnavailable(error)
  }
  if (!reserved) {
    const current = await tarca.documents.get(id, requestOptions(options))
    if (current.cancelled === true) return cancellation(vendorId, current, undefined, false)
    throw new BillingoError(
      `Egy másik folyamat éppen sztornózza a(z) ${current.invoiceNumber ?? id} bizonylatot (vendorId: ${vendorId}).`,
      {
        category: 'in_progress',
        hint: 'Ne sztornózd kézzel. A webhook 500-at ad, a szolgáltató újraküldi a visszatérítést, és akkor a tárca a bizonylat cancelled jelzője alapján dönt.',
      },
    )
  }
  try {
    return await cancelDocument(tarca, payment, vendorId, document, options)
  } finally {
    await releaseCancelLock(ledger, key, value)
  }
}

async function refundOnce(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  options: IssueForPaymentOptions,
): Promise<IssuedDocument> {
  const document = await tarca.documents.findByVendorId(vendorId, requestOptions(options))
  if (!document) throw refundBeforeDocumentError(payment, vendorId)
  if (document.cancelled === true) return cancellation(vendorId, document, undefined, false)
  if (kindOf(document) === 'invoice' && document.correctionType === 'modified') {
    return issueForRemainder(tarca, payment, vendorId, document, options)
  }
  return cancelOnce(tarca, payment, vendorId, document, options)
}

function issueForRefund(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  options: IssueForPaymentOptions,
): Promise<IssuedDocument> {
  return oneAtATime(tarca.documents, vendorId, options.signal, () =>
    refundOnce(tarca, payment, vendorId, options),
  )
}

async function issueForRefundFailure(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  options: IssueForPaymentOptions,
): Promise<IssuedRefundFailure | SkippedPayment> {
  const refundIds = (payment.refunds ?? []).map((refund) => refund.id).join(', ')
  const which = refundIds === '' ? payment.id : refundIds
  const document = await tarca.documents.findByVendorId(vendorId, requestOptions(options))
  if (!document) {
    return skipped(
      vendorId,
      `A(z) ${payment.provider} visszatérítés (${which}) meghiúsult vagy visszavonták, és a fizetéshez nem tartozik kiállított bizonylat, így nincs mit javítani.`,
    )
  }
  return {
    kind: 'refund-failed',
    vendorId,
    document,
    reason: `A(z) ${payment.provider} visszatérítés (${which}) meghiúsult vagy visszavonták, a pénz nem ment vissza a vevőnek. A tárca a visszatérítésre kiállított sztornót vagy módosító számlát nem fordítja vissza magától: ellenőrizd a(z) ${document.invoiceNumber ?? idOf(document)} bizonylatot és a hozzá tartozó javító bizonylatokat, és ha kell, állíts ki kézzel új számlát a vevőnél maradt összegről.`,
  }
}

export async function issueForPayment(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  options: IssueForPaymentOptions = {},
): Promise<IssuedDocument> {
  assertOptions(options)
  const vendorId = options.vendorId?.trim() || (await paymentVendorId(payment))
  switch (payment.kind) {
    case 'paid':
      return issueForPaid(tarca, payment, vendorId, options)
    case 'refunded':
      return issueForRefund(tarca, payment, vendorId, options)
    case 'partially-refunded':
      return issueForPartialRefund(tarca, payment, vendorId, options)
    case 'refund-failed':
      return issueForRefundFailure(tarca, payment, vendorId, options)
    case 'other':
      return skipped(
        vendorId,
        `A(z) ${payment.provider} esemény (${payment.eventType ?? 'other'}) nem olyan fizetés vagy visszatérítés, amelyből a tárca bizonylatot állít ki.`,
      )
    default:
      return skipped(
        vendorId,
        `A fizetés állapota (${String(payment.kind)}) nem sikeres fizetés, ezért nem készül bizonylat.`,
      )
  }
}
