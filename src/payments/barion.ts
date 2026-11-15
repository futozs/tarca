import type { PaymentMethod } from '../generated/billingo'
import { fromMinorUnits, normalizeCurrency, parseDecimalAmount } from './amounts'
import { plainResponse, readRawBody } from './body'
import { PaymentProviderError, WebhookVerificationError } from './errors'
import { type JsonRecord, numeric, record, records, text } from './json'
import type {
  PaymentAmount,
  PaymentCustomer,
  PaymentEvent,
  PaymentEventKind,
  PaymentLineItem,
  PaymentRefund,
  PaymentWebhookBaseOptions,
} from './types'
import {
  assertWebhookOptions,
  deliverPayment,
  respondToWebhook,
  type WebhookHandler,
} from './webhook'

export const BARION_LIVE_API_URL = 'https://api.barion.com'
export const BARION_SANDBOX_API_URL = 'https://api.test.barion.com'

const PAYMENT_ID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const SUCCEEDED = 'Succeeded'
const REFUND_TYPES: ReadonlySet<string> = new Set([
  'Refund',
  'RefundToBankCard',
  'RefundToBankAccount',
])
const NON_SALE_TYPES: ReadonlySet<string> = new Set([
  'Commission',
  'Storno',
  'StornoReserve',
  'TransferBack',
  'StornoUnSuccessfulRefundToBankCard',
  'StornoUnSuccessfulRefundToBankAccount',
  'UnderReview',
  'ReleaseReview',
])
const FAILED_STATUSES: ReadonlySet<string> = new Set(['Canceled', 'Failed', 'Expired'])

export interface BarionApiOptions {
  readonly posKey: string
  readonly sandbox?: boolean | undefined
  readonly apiUrl?: string | undefined
  readonly fetch?: typeof globalThis.fetch | undefined
}

function apiBase(options: Pick<BarionApiOptions, 'sandbox' | 'apiUrl'>): string {
  const base = options.apiUrl ?? (options.sandbox ? BARION_SANDBOX_API_URL : BARION_LIVE_API_URL)
  return base.replace(/\/+$/, '')
}

function barionErrorCodes(json: JsonRecord | undefined): string[] {
  return records(json?.Errors).map((error) => text(error.ErrorCode) ?? 'ismeretlen hiba')
}

export async function fetchBarionPaymentState(
  paymentId: string,
  options: BarionApiOptions,
): Promise<JsonRecord> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const url = `${apiBase(options)}/v4/Payment/${encodeURIComponent(paymentId)}/PaymentState`
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { 'x-pos-key': options.posKey, accept: 'application/json' },
    })
  } catch (error) {
    throw new PaymentProviderError(
      'barion',
      'A Barion PaymentState lekérése nem sikerült.',
      undefined,
      error,
    )
  }
  const json = record(await response.json().catch(() => undefined))
  const errors = barionErrorCodes(json)
  if (!response.ok || errors.length > 0 || !json) {
    const detail = errors.length > 0 ? `: ${errors.join(', ')}` : ''
    throw new PaymentProviderError(
      'barion',
      `A Barion PaymentState lekérése nem sikerült (HTTP ${response.status})${detail}.`,
      response.status,
    )
  }
  return json
}

function paymentIdFromBody(body: string, contentType: string | null): string | undefined {
  const trimmed = body.trim()
  if (trimmed === '') return undefined
  if (contentType?.includes('json') || trimmed.startsWith('{')) {
    try {
      const json = record(JSON.parse(trimmed))
      return text(json?.paymentId) ?? text(json?.PaymentId)
    } catch {
      return undefined
    }
  }
  const form = new URLSearchParams(trimmed)
  return text(form.get('paymentId')) ?? text(form.get('PaymentId'))
}

export function barionPaymentId(
  url: string | URL,
  body = '',
  contentType: string | null = null,
): string | undefined {
  const params = new URL(url).searchParams
  return (
    text(params.get('paymentId')) ??
    text(params.get('PaymentId')) ??
    paymentIdFromBody(body, contentType)
  )
}

function normalizeId(value: string): string {
  return value.replace(/-/g, '').toLowerCase()
}

function isSaleTransaction(transaction: JsonRecord): boolean {
  const type = text(transaction.TransactionType) ?? ''
  return (
    text(transaction.POSTransactionId) !== undefined &&
    !REFUND_TYPES.has(type) &&
    !NON_SALE_TYPES.has(type) &&
    !type.includes('Fee')
  )
}

function isSucceededRefund(transaction: JsonRecord): boolean {
  return (
    REFUND_TYPES.has(text(transaction.TransactionType) ?? '') &&
    text(transaction.Status) === SUCCEEDED
  )
}

function absoluteAmount(value: unknown, currency: string): PaymentAmount | undefined {
  const amount = numeric(value)
  return amount === undefined ? undefined : parseDecimalAmount(Math.abs(amount), currency)
}

function itemsOf(sales: readonly JsonRecord[], currency: string): PaymentLineItem[] | undefined {
  const items = sales.flatMap((transaction) =>
    records(transaction.Items).map((item) => {
      const total = numeric(item.ItemTotal)
      if (total === undefined) {
        throw new PaymentProviderError('barion', 'A Barion tételből hiányzik az ItemTotal.')
      }
      return {
        name: text(item.Name) ?? text(item.Description) ?? 'Tétel',
        quantity: numeric(item.Quantity) ?? 1,
        totalGross: parseDecimalAmount(total, currency),
        unit: text(item.Unit),
        sku: text(item.SKU),
      }
    }),
  )
  return items.length > 0 ? items : undefined
}

function payerName(payer: JsonRecord | undefined): string | undefined {
  const name = record(payer?.Name)
  const organization = text(name?.OrganizationName)
  if (organization) return organization
  const parts = [text(name?.LastName), text(name?.FirstName)].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function customerOf(transactions: readonly JsonRecord[]): PaymentCustomer | undefined {
  const payer = transactions.map((transaction) => record(transaction.Payer)).find(Boolean)
  if (!payer) return undefined
  const organization = text(record(payer.Name)?.OrganizationName)
  return {
    name: payerName(payer),
    email: text(payer.Email),
    phone: text(payer.PhoneNumber),
    isBusiness: organization ? true : undefined,
  }
}

function methodOf(state: JsonRecord, configured: PaymentMethod | undefined): PaymentMethod {
  if (configured) return configured
  return text(state.FundingSource) === 'BankTransfer' ? 'wire_transfer' : 'barion'
}

function kindOf(
  status: string | undefined,
  paid: PaymentAmount | undefined,
  refunds: readonly PaymentAmount[],
): PaymentEventKind {
  if (refunds.length > 0) {
    const refunded = refunds.reduce((sum, refund) => sum + refund.minor, 0)
    return refunds.length === 1 && paid !== undefined && refunded === paid.minor
      ? 'refunded'
      : 'partially-refunded'
  }
  if (status === SUCCEEDED) return 'paid'
  if (status && FAILED_STATUSES.has(status)) return 'failed'
  return 'other'
}

function refundsOf(refunds: readonly JsonRecord[], currency: string): PaymentRefund[] | undefined {
  if (refunds.length === 0) return undefined
  const entries: { id: string; amount: PaymentAmount; createdAt: string | undefined }[] = []
  for (const refund of refunds) {
    const id = text(refund.TransactionId) ?? text(refund.POSTransactionId)
    const amount = absoluteAmount(refund.Total, currency)
    if (!id || !amount) return undefined
    entries.push({ id, amount, createdAt: text(refund.TransactionTime) })
  }
  entries.sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
  )
  let before = 0
  return entries.map((entry) => {
    const refund: PaymentRefund = {
      id: entry.id,
      amount: entry.amount,
      refundedBefore: fromMinorUnits(before, currency),
      createdAt: entry.createdAt,
    }
    before += entry.amount.minor
    return refund
  })
}

export interface BarionPaymentOptions {
  readonly method?: PaymentMethod | undefined
}

export function barionPaymentEvent(
  state: JsonRecord,
  options: BarionPaymentOptions = {},
): PaymentEvent {
  const paymentId = text(state.PaymentId)
  if (!paymentId) {
    throw new PaymentProviderError(
      'barion',
      'A Barion PaymentState válaszából hiányzik a PaymentId.',
    )
  }
  const code = text(state.Currency)
  const currency = code ? normalizeCurrency(code) : undefined
  const transactions = records(state.Transactions)
  const sales = transactions.filter(
    (transaction) => isSaleTransaction(transaction) && text(transaction.Status) === SUCCEEDED,
  )
  const refundTransactions = transactions.filter(isSucceededRefund)
  const refundAmounts = currency
    ? refundTransactions.flatMap((refund) => absoluteAmount(refund.Total, currency) ?? [])
    : []
  const saleTotals = currency
    ? sales.flatMap((sale) => absoluteAmount(sale.Total, currency) ?? [])
    : []
  const amount = !currency
    ? undefined
    : saleTotals.length > 0
      ? fromMinorUnits(
          saleTotals.reduce((sum, total) => sum + total.minor, 0),
          currency,
        )
      : absoluteAmount(state.Total, currency)
  const status = text(state.Status)
  const refunded = refundAmounts.reduce((sum, refund) => sum + refund.minor, 0)
  return {
    provider: 'barion',
    kind: kindOf(status, amount, refundAmounts),
    id: paymentId,
    eventId: `${paymentId}:${status ?? 'unknown'}:${refundTransactions.length}`,
    eventType: status,
    orderRef: text(state.OrderNumber) ?? text(state.PaymentRequestId),
    amount,
    refundedAmount:
      refundAmounts.length > 0 && currency ? fromMinorUnits(refunded, currency) : undefined,
    refunds: currency ? refundsOf(refundTransactions, currency) : undefined,
    paidAt: text(state.CompletedAt),
    method: methodOf(state, options.method),
    customer: customerOf(sales.length > 0 ? sales : transactions),
    items: currency ? itemsOf(sales, currency) : undefined,
    includesPayment: refundTransactions.length > 0 && saleTotals.length > 0 ? true : undefined,
    raw: state,
  }
}

export interface BarionWebhookOptions extends PaymentWebhookBaseOptions {
  readonly posKey: string
  readonly sandbox?: boolean | undefined
  readonly apiUrl?: string | undefined
}

export function barionWebhook(options: BarionWebhookOptions): WebhookHandler {
  const posKey = typeof options.posKey === 'string' ? options.posKey.trim() : ''
  if (!posKey) throw new TypeError('Add meg a Barion POSKey-t (posKey).')
  assertWebhookOptions(options)
  return (request) =>
    respondToWebhook(options, async () => {
      const body = await readRawBody(request, 'barion', options.maxBodyBytes)
      const paymentId = barionPaymentId(request.url, body, request.headers.get('content-type'))
      if (!paymentId || !PAYMENT_ID_PATTERN.test(paymentId)) {
        throw new WebhookVerificationError(
          'barion',
          'invalid_payload',
          'A Barion callbackből hiányzik az érvényes paymentId.',
        )
      }
      const state = await fetchBarionPaymentState(paymentId, {
        posKey,
        sandbox: options.sandbox,
        apiUrl: options.apiUrl,
        fetch: options.fetch,
      })
      const returnedId = text(state.PaymentId)
      if (!returnedId || normalizeId(returnedId) !== normalizeId(paymentId)) {
        throw new PaymentProviderError(
          'barion',
          `A Barion más fizetést adott vissza a kért ${paymentId} helyett.`,
        )
      }
      await deliverPayment(options, barionPaymentEvent(state, { method: options.method }))
      return plainResponse(200, 'OK')
    })
}
