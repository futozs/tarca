import { bytesToHex, hmac, timingSafeEqual } from '../core/crypto'
import { toBudapestTimestamp } from '../core/dates'
import { isOneOf, PAYMENT_METHODS } from '../documents/enums'
import type { PaymentMethod } from '../generated/billingo'
import { fromMinorUnits, normalizeCurrency, parseDecimalAmount } from './amounts'
import { parseJsonObject, readRawBody } from './body'
import { PaymentProviderError, WebhookVerificationError } from './errors'
import { type JsonRecord, numeric, record, records, text } from './json'
import type {
  PaymentAmount,
  PaymentCustomer,
  PaymentEvent,
  PaymentEventKind,
  PaymentRefund,
  PaymentWebhookBaseOptions,
} from './types'
import {
  assertWebhookOptions,
  deliverPayment,
  respondToWebhook,
  type WebhookHandler,
} from './webhook'

export const SIMPLEPAY_LIVE_API_URL = 'https://secure.simplepay.hu/payment/v2'
export const SIMPLEPAY_SANDBOX_API_URL = 'https://sandbox.simplepay.hu/payment/v2'
export const SIMPLEPAY_SDK_VERSION = 'tarca'

const SALT_BYTES = 16
const FAILED_STATUSES: ReadonlySet<string> = new Set([
  'NOTAUTHORIZED',
  'FRAUD',
  'TIMEOUT',
  'CANCELLED',
  'REVERSED',
])

export interface SimplePayMerchant {
  readonly secretKey: string
  readonly method?: PaymentMethod | undefined
}

export type SimplePayMerchants = Readonly<Record<string, string | SimplePayMerchant>>

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToText(value: string): string {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export async function simplePaySignature(body: string, secretKey: string): Promise<string> {
  return bytesToBase64(await hmac('SHA-384', secretKey.trim(), body))
}

export async function verifySimplePaySignature(
  body: string,
  signature: string | null | undefined,
  secretKey: string,
): Promise<void> {
  const received = signature?.trim().replace(/ /g, '+')
  if (!received) {
    throw new WebhookVerificationError(
      'simplepay',
      'missing_signature',
      'Hiányzik a SimplePay Signature fejléc.',
    )
  }
  const expected = await simplePaySignature(body, secretKey)
  if (!timingSafeEqual(received, expected)) {
    throw new WebhookVerificationError(
      'simplepay',
      'invalid_signature',
      'A SimplePay aláírás nem egyezik.',
    )
  }
}

export interface SimplePayIpn {
  readonly merchant: string
  readonly orderRef: string
  readonly transactionId: string
  readonly status: string
  readonly method?: string | undefined
  readonly paymentDate?: string | undefined
  readonly finishDate?: string | undefined
  readonly raw: JsonRecord
}

export function parseSimplePayIpn(body: string): SimplePayIpn {
  const json = parseJsonObject('simplepay', body)
  const merchant = text(json.merchant)
  const orderRef = text(json.orderRef)
  const transactionId = text(json.transactionId)
  const status = text(json.status)?.toUpperCase()
  if (!merchant || !orderRef || !transactionId || !status) {
    throw new WebhookVerificationError(
      'simplepay',
      'invalid_payload',
      'A SimplePay IPN-ből hiányzik a merchant, az orderRef, a transactionId vagy a status.',
    )
  }
  return {
    merchant,
    orderRef,
    transactionId,
    status,
    method: text(json.method),
    paymentDate: text(json.paymentDate),
    finishDate: text(json.finishDate),
    raw: json,
  }
}

export interface SimplePayIpnResponse {
  readonly body: string
  readonly signature: string
}

export async function simplePayIpnResponse(
  body: string,
  secretKey: string,
  receivedAt: Date = new Date(),
): Promise<SimplePayIpnResponse> {
  parseJsonObject('simplepay', body)
  const end = body.lastIndexOf('}')
  const head = body.slice(0, end).trimEnd()
  const separator = head.endsWith('{') ? '' : ','
  const responseBody = `${head}${separator}"receiveDate":"${toBudapestTimestamp(receivedAt)}"${body.slice(end)}`
  return { body: responseBody, signature: await simplePaySignature(responseBody, secretKey) }
}

export interface SimplePayApiOptions {
  readonly merchant: string
  readonly secretKey: string
  readonly sandbox?: boolean | undefined
  readonly apiUrl?: string | undefined
  readonly fetch?: typeof globalThis.fetch | undefined
}

export interface SimplePayRefund {
  readonly transactionId?: string | undefined
  readonly total: PaymentAmount | undefined
  readonly status?: string | undefined
  readonly date?: string | undefined
}

export interface SimplePayTransaction {
  readonly transactionId: string
  readonly orderRef?: string | undefined
  readonly status: string
  readonly method?: string | undefined
  readonly total?: PaymentAmount | undefined
  readonly remainingTotal?: PaymentAmount | undefined
  readonly refundStatus?: string | undefined
  readonly refunds: readonly SimplePayRefund[]
  readonly paymentDate?: string | undefined
  readonly finishDate?: string | undefined
  readonly customer?: PaymentCustomer | undefined
  readonly raw: JsonRecord
}

function randomSalt(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))
}

function apiBase(options: Pick<SimplePayApiOptions, 'sandbox' | 'apiUrl'>): string {
  const base =
    options.apiUrl ?? (options.sandbox ? SIMPLEPAY_SANDBOX_API_URL : SIMPLEPAY_LIVE_API_URL)
  return base.replace(/\/+$/, '')
}

function serializeRequest(body: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(body).replace(/\//g, '\\/')
}

function errorCodesOf(json: JsonRecord): string[] {
  const codes = json.errorCodes
  if (!Array.isArray(codes)) return []
  return codes.map((code) => String(code))
}

export async function simplePayRequest(
  operation: string,
  payload: Readonly<Record<string, unknown>>,
  options: SimplePayApiOptions,
): Promise<JsonRecord> {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const body = serializeRequest({
    ...payload,
    merchant: options.merchant,
    salt: randomSalt(),
    sdkVersion: SIMPLEPAY_SDK_VERSION,
  })
  let response: Response
  try {
    response = await fetchImpl(`${apiBase(options)}/${operation}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        signature: await simplePaySignature(body, options.secretKey),
      },
      body,
    })
  } catch (error) {
    throw new PaymentProviderError(
      'simplepay',
      `A SimplePay ${operation} hívás nem sikerült.`,
      undefined,
      error,
    )
  }
  const responseText = await response.text()
  if (!response.ok) {
    throw new PaymentProviderError(
      'simplepay',
      `A SimplePay ${operation} hívás nem sikerült (HTTP ${response.status}).`,
      response.status,
    )
  }
  let json: JsonRecord
  try {
    json = parseJsonObject('simplepay', responseText)
  } catch (error) {
    throw new PaymentProviderError(
      'simplepay',
      `A SimplePay ${operation} válasza nem JSON objektum.`,
      response.status,
      error,
    )
  }
  const codes = errorCodesOf(json)
  if (codes.length > 0) {
    throw new PaymentProviderError(
      'simplepay',
      `A SimplePay ${operation} hívás hibakóddal tért vissza: ${codes.join(', ')}.`,
      response.status,
    )
  }
  try {
    await verifySimplePaySignature(
      responseText,
      response.headers.get('signature'),
      options.secretKey,
    )
  } catch (error) {
    throw new PaymentProviderError(
      'simplepay',
      `A SimplePay ${operation} válaszának aláírása hibás vagy hiányzik.`,
      response.status,
      error,
    )
  }
  return json
}

function customerOf(transaction: JsonRecord): PaymentCustomer | undefined {
  const invoice = record(transaction.invoice)
  const email = text(transaction.customerEmail)
  const company = text(invoice?.company)
  const name = company ?? text(invoice?.name) ?? text(invoice?.lname) ?? text(transaction.customer)
  if (!invoice && !email && !name) return undefined
  return {
    name,
    email,
    phone: text(invoice?.phone),
    isBusiness: company ? true : undefined,
    address: invoice && {
      country: text(invoice.country)?.toUpperCase(),
      zip: text(invoice.zip),
      city: text(invoice.city),
      line1: text(invoice.address),
      line2: text(invoice.address2),
    },
  }
}

function decimalOf(value: unknown, currency: string | undefined): PaymentAmount | undefined {
  const amount = numeric(value)
  if (amount === undefined || !currency) return undefined
  return parseDecimalAmount(Math.abs(amount), currency)
}

function transactionOf(json: JsonRecord): SimplePayTransaction | undefined {
  const transactionId = text(json.transactionId)
  const status = text(json.status)?.toUpperCase()
  if (!transactionId || !status) return undefined
  const code = text(json.currency)
  const currency = code ? normalizeCurrency(code) : undefined
  return {
    transactionId,
    orderRef: text(json.orderRef),
    status,
    method: text(json.method),
    total: decimalOf(json.total, currency),
    remainingTotal: decimalOf(json.remainingTotal, currency),
    refundStatus: text(json.refundStatus)?.toUpperCase(),
    refunds: records(json.refunds).map((refund) => ({
      transactionId: text(refund.transactionId),
      total: decimalOf(refund.refundTotal, currency),
      status: text(refund.status)?.toUpperCase(),
      date: text(refund.refundDate),
    })),
    paymentDate: text(json.paymentDate),
    finishDate: text(json.finishDate),
    customer: customerOf(json),
    raw: json,
  }
}

export async function querySimplePayTransaction(
  transactionId: string,
  options: SimplePayApiOptions,
): Promise<SimplePayTransaction | undefined> {
  const json = await simplePayRequest(
    'query',
    { transactionIds: [transactionId], detailed: true, refunds: true },
    options,
  )
  return records(json.transactions)
    .map(transactionOf)
    .find((transaction) => transaction?.transactionId === transactionId)
}

export interface SimplePayPaymentOptions {
  readonly method?: PaymentMethod | undefined
  readonly transaction?: SimplePayTransaction | undefined
}

function methodOf(
  ipnMethod: string | undefined,
  configured: PaymentMethod | undefined,
): PaymentMethod {
  if (configured) return configured
  return ipnMethod?.toUpperCase() === 'WIRE' ? 'wire_transfer' : 'simple_pay'
}

function finishedRefunds(transaction: SimplePayTransaction): SimplePayRefund[] {
  return transaction.refunds.filter(
    (refund) => refund.status === undefined || refund.status === 'FINISHED',
  )
}

function refundedMinor(refunds: readonly SimplePayRefund[]): number {
  return refunds.reduce((sum, refund) => sum + (refund.total?.minor ?? 0), 0)
}

function refundKind(transaction: SimplePayTransaction | undefined): PaymentEventKind {
  if (!transaction?.total) return 'partially-refunded'
  const finished = finishedRefunds(transaction)
  const single = finished.length === 1
  const complete = refundedMinor(finished) === transaction.total.minor
  return single && complete && (transaction.remainingTotal?.minor ?? 0) === 0
    ? 'refunded'
    : 'partially-refunded'
}

function kindOf(status: string, transaction: SimplePayTransaction | undefined): PaymentEventKind {
  if (status === 'FINISHED') return 'paid'
  if (status === 'REFUND') return refundKind(transaction)
  if (FAILED_STATUSES.has(status)) return 'failed'
  return 'other'
}

function refundedAmountOf(
  transaction: SimplePayTransaction | undefined,
): PaymentAmount | undefined {
  const total = transaction?.total
  if (!transaction || !total || transaction.refunds.length === 0) return undefined
  return fromMinorUnits(refundedMinor(transaction.refunds), total.currency)
}

function refundsOf(transaction: SimplePayTransaction | undefined): PaymentRefund[] | undefined {
  if (!transaction?.total) return undefined
  const finished = finishedRefunds(transaction)
  if (finished.length === 0) return undefined
  const entries: { id: string; total: PaymentAmount; date: string | undefined }[] = []
  for (const refund of finished) {
    if (!refund.transactionId || !refund.total) return undefined
    entries.push({ id: refund.transactionId, total: refund.total, date: refund.date })
  }
  entries.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id.localeCompare(b.id))
  const currency = transaction.total.currency
  let before = 0
  return entries.map((entry) => {
    const refund: PaymentRefund = {
      id: entry.id,
      amount: entry.total,
      refundedBefore: fromMinorUnits(before, currency),
      createdAt: entry.date,
    }
    before += entry.total.minor
    return refund
  })
}

function eventIdOf(
  ipn: SimplePayIpn,
  transaction: SimplePayTransaction | undefined,
): string | undefined {
  if (ipn.status !== 'REFUND') return `${ipn.transactionId}:${ipn.status}`
  if (!transaction) return undefined
  const finished = finishedRefunds(transaction)
  return `${ipn.transactionId}:${ipn.status}:${finished.length}:${refundedMinor(finished)}`
}

export function simplePayPaymentEvent(
  ipn: SimplePayIpn,
  options: SimplePayPaymentOptions = {},
): PaymentEvent {
  const transaction = options.transaction
  return {
    provider: 'simplepay',
    kind: kindOf(ipn.status, transaction),
    id: ipn.transactionId,
    eventId: eventIdOf(ipn, transaction),
    eventType: ipn.status,
    orderRef: ipn.orderRef,
    amount: transaction?.total,
    refundedAmount: ipn.status === 'REFUND' ? refundedAmountOf(transaction) : undefined,
    refunds: ipn.status === 'REFUND' ? refundsOf(transaction) : undefined,
    paidAt: ipn.finishDate ?? ipn.paymentDate,
    method: methodOf(ipn.method, options.method),
    customer: transaction?.customer,
    raw: ipn.raw,
  }
}

export interface SimplePayWebhookOptions extends PaymentWebhookBaseOptions {
  readonly secretKey?: string | undefined
  readonly merchants?: SimplePayMerchants | undefined
  readonly fetchDetails?: boolean | undefined
  readonly sandbox?: boolean | undefined
  readonly apiUrl?: string | undefined
  readonly now?: (() => Date) | undefined
}

function merchantOf(
  merchants: SimplePayMerchants | undefined,
  secretKey: string | undefined,
  merchant: string,
): SimplePayMerchant | undefined {
  const configured =
    merchants && Object.hasOwn(merchants, merchant) ? merchants[merchant] : undefined
  if (typeof configured === 'string') return { secretKey: configured }
  if (configured) return configured
  return secretKey ? { secretKey } : undefined
}

function assertConfigured(options: Pick<SimplePayWebhookOptions, 'secretKey' | 'merchants'>): void {
  const entries = Object.values(options.merchants ?? {})
  const keys = [
    options.secretKey,
    ...entries.map((entry) => (typeof entry === 'string' ? entry : entry.secretKey)),
  ]
  if (keys.some((key) => key !== undefined && (typeof key !== 'string' || key.trim() === ''))) {
    throw new TypeError('A SimplePay titkos kulcs (SECRET_KEY) nem lehet üres.')
  }
  if (!keys.some((key) => key?.trim())) {
    throw new TypeError('Add meg a SimplePay titkos kulcsot (secretKey vagy merchants).')
  }
  for (const entry of entries) {
    if (typeof entry !== 'string' && entry.method !== undefined) {
      if (!isOneOf(PAYMENT_METHODS, entry.method)) {
        throw new TypeError(`Ismeretlen Billingo fizetési mód (method): ${String(entry.method)}`)
      }
    }
  }
}

function needsDetails(status: string): boolean {
  return status === 'FINISHED' || status === 'REFUND'
}

async function requireTransaction(
  ipn: SimplePayIpn,
  merchant: SimplePayMerchant,
  options: SimplePayWebhookOptions,
): Promise<SimplePayTransaction> {
  const transaction = await querySimplePayTransaction(ipn.transactionId, {
    merchant: ipn.merchant,
    secretKey: merchant.secretKey,
    sandbox: options.sandbox,
    apiUrl: options.apiUrl,
    fetch: options.fetch,
  })
  if (!transaction) {
    throw new PaymentProviderError(
      'simplepay',
      `A SimplePay lekérdezés nem adta vissza a(z) ${ipn.transactionId} tranzakciót.`,
    )
  }
  return transaction
}

export function simplePayWebhook(options: SimplePayWebhookOptions): WebhookHandler {
  assertConfigured(options)
  assertWebhookOptions(options)
  return (request) =>
    respondToWebhook(options, async () => {
      const body = await readRawBody(request, 'simplepay', options.maxBodyBytes)
      const ipn = parseSimplePayIpn(body)
      const merchant = merchantOf(options.merchants, options.secretKey, ipn.merchant)
      if (!merchant) {
        throw new WebhookVerificationError(
          'simplepay',
          'verification_failed',
          'Az IPN kereskedőjéhez (merchant) nincs beállított SimplePay titkos kulcs.',
        )
      }
      await verifySimplePaySignature(body, request.headers.get('signature'), merchant.secretKey)
      const transaction =
        options.fetchDetails !== false && needsDetails(ipn.status)
          ? await requireTransaction(ipn, merchant, options)
          : undefined
      await deliverPayment(
        options,
        simplePayPaymentEvent(ipn, { method: merchant.method ?? options.method, transaction }),
      )
      const response = await simplePayIpnResponse(
        body,
        merchant.secretKey,
        options.now?.() ?? new Date(),
      )
      return new Response(response.body, {
        status: 200,
        headers: { 'content-type': 'application/json', signature: response.signature },
      })
    })
}

export type SimplePayRedirectEvent = 'SUCCESS' | 'FAIL' | 'TIMEOUT' | 'CANCEL'

export interface SimplePayRedirect {
  readonly responseCode: number
  readonly transactionId: string
  readonly event: SimplePayRedirectEvent | (string & {})
  readonly merchant: string
  readonly orderRef: string
}

function redirectParams(input: URL | URLSearchParams | string): URLSearchParams {
  if (input instanceof URLSearchParams) return input
  if (input instanceof URL) return input.searchParams
  const query = input.includes('?') ? input.slice(input.indexOf('?') + 1) : input
  return new URLSearchParams(query)
}

function invalidRedirect(message: string): WebhookVerificationError {
  return new WebhookVerificationError('simplepay', 'invalid_payload', message)
}

export async function verifySimplePayRedirect(
  input: URL | URLSearchParams | string,
  keys: string | SimplePayMerchants,
): Promise<SimplePayRedirect> {
  const params = redirectParams(input)
  const encoded = params.get('r')?.replace(/ /g, '+')
  const signature = params.get('s')
  if (!encoded) throw invalidRedirect('Hiányzik a SimplePay visszairányítás r paramétere.')
  let decoded: string
  try {
    decoded = base64ToText(encoded)
  } catch {
    throw invalidRedirect('A SimplePay r paramétere nem érvényes base64.')
  }
  const json = parseJsonObject('simplepay', decoded)
  const merchant = text(json.m)
  const transactionId = text(json.t)
  const responseCode = numeric(json.r)
  const event = text(json.e)?.toUpperCase()
  if (!merchant || !transactionId || responseCode === undefined || !event) {
    throw invalidRedirect('A SimplePay r paraméteréből hiányzik az r, t, e vagy m mező.')
  }
  const config =
    typeof keys === 'string' ? { secretKey: keys } : merchantOf(keys, undefined, merchant)
  if (!config) {
    throw new WebhookVerificationError(
      'simplepay',
      'verification_failed',
      'A visszairányítás kereskedőjéhez (merchant) nincs beállított SimplePay titkos kulcs.',
    )
  }
  await verifySimplePaySignature(decoded, signature, config.secretKey)
  return { responseCode, transactionId, event, merchant, orderRef: text(json.o) ?? '' }
}
