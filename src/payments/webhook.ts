import { isBillingoError } from '../core/errors'
import { isOneOf, PAYMENT_METHODS } from '../documents/enums'
import { plainResponse, resolveMaxBodyBytes } from './body'
import { PaymentProviderError, WebhookVerificationError } from './errors'
import type {
  DedupeStoreOperation,
  PaymentEvent,
  PaymentWarning,
  PaymentWebhookBaseOptions,
} from './types'

export const WEBHOOK_DEDUPE_KEY_PREFIX = 'tarca:evt:'
export const DEFAULT_DEDUPE_TTL_SECONDS: number = 7 * 86_400

export type WebhookHandler = (request: Request) => Promise<Response>

type DedupeOptions = Pick<
  PaymentWebhookBaseOptions,
  'onPayment' | 'onWarning' | 'dedupe' | 'dedupeTtlSeconds'
>

function resolveDedupeTtl(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DEDUPE_TTL_SECONDS
  if (!Number.isFinite(value) || value < 1) {
    throw new TypeError(`A dedupeTtlSeconds legalább 1 másodperc legyen, kapott: ${String(value)}`)
  }
  return Math.ceil(value)
}

export function assertWebhookOptions(options: PaymentWebhookBaseOptions): void {
  if (typeof options.onPayment !== 'function') {
    throw new TypeError('Add meg az onPayment függvényt, ez kapja meg az ellenőrzött fizetést.')
  }
  if (options.method !== undefined && !isOneOf(PAYMENT_METHODS, options.method)) {
    throw new TypeError(`Ismeretlen Billingo fizetési mód (method): ${String(options.method)}`)
  }
  resolveMaxBodyBytes(options.maxBodyBytes)
  resolveDedupeTtl(options.dedupeTtlSeconds)
}

function safeSummary(error: unknown): Record<string, unknown> {
  if (error instanceof WebhookVerificationError || error instanceof PaymentProviderError) {
    return { name: error.name, provider: error.provider, message: error.message }
  }
  if (isBillingoError(error)) {
    return {
      name: error.name,
      category: error.category,
      status: error.status,
      operation: error.operation,
    }
  }
  return { name: error instanceof Error ? error.name : typeof error }
}

function reportError(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    if (!onError) {
      console.error(
        '[tarca] A fizetési webhook feldolgozása nem sikerült (a részletekhez add meg az onError opciót).',
        safeSummary(error),
      )
      return
    }
    const result: unknown = onError(error)
    if (result instanceof Promise) result.catch(() => undefined)
  } catch {
    return
  }
}

export async function respondToWebhook(
  options: Pick<PaymentWebhookBaseOptions, 'onError'>,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof WebhookVerificationError) return plainResponse(400, error.message)
    reportError(options.onError, error)
    return plainResponse(500, 'A webhook feldolgozása nem sikerült.')
  }
}

export function webhookDedupeKey(payment: Pick<PaymentEvent, 'provider' | 'eventId'>): string {
  return `${WEBHOOK_DEDUPE_KEY_PREFIX}${payment.provider}:${payment.eventId ?? ''}`
}

function warn(options: DedupeOptions, warning: PaymentWarning): void {
  try {
    if (!options.onWarning) {
      console.warn(`[tarca] ${warning.message}`)
      return
    }
    const result: unknown = options.onWarning(warning)
    if (result instanceof Promise) result.catch(() => undefined)
  } catch {
    return
  }
}

function dedupeWarning(
  options: DedupeOptions,
  operation: DedupeStoreOperation,
  key: string,
  error: unknown,
): void {
  const message =
    operation === 'get'
      ? `A webhook ismétlés-szűrő tárolója nem olvasható (${key}), a tárca feldolgozza az eseményt; a createOnce így is megakadályozza a dupla bizonylatot.`
      : `A webhook ismétlés-szűrő nem tudta megjelölni a feldolgozott eseményt (${key}); egy újraküldés ismét feldolgozásra kerül, de a createOnce nem állít ki duplát.`
  warn(options, { kind: 'dedupe', operation, message, error })
}

export async function deliverPayment(
  options: DedupeOptions,
  payment: PaymentEvent,
  prepare: (payment: PaymentEvent) => PaymentEvent | Promise<PaymentEvent> = (value) => value,
): Promise<boolean> {
  const ttlSeconds = resolveDedupeTtl(options.dedupeTtlSeconds)
  const store = options.dedupe
  if (!store || !payment.eventId) {
    await options.onPayment(await prepare(payment))
    return true
  }
  const key = webhookDedupeKey(payment)
  let seen = false
  try {
    seen = Boolean(await store.get(key))
  } catch (error) {
    dedupeWarning(options, 'get', key, error)
  }
  if (seen) return false
  await options.onPayment(await prepare(payment))
  try {
    await store.set(key, '1', ttlSeconds)
  } catch (error) {
    dedupeWarning(options, 'set', key, error)
  }
  return true
}
