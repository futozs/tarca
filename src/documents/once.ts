import { type RequestOptions, sleep } from '../core/context'
import { BillingoError, isBillingoError, withHint } from '../core/errors'
import {
  guardOnce,
  isUncertainOutcome,
  type OnceGuard,
  type OnceLockOptions,
} from '../core/once-guard'
import type { OperationId } from '../core/operations'
import type { Document } from '../generated/billingo'

export interface CreateOnceOptions extends RequestOptions, OnceLockOptions {
  readonly recoveryDelayMs?: number | undefined
}

export interface DocumentOnceResult {
  readonly document: Document
  readonly created: boolean
}

export interface OnceIssue<T> {
  readonly vendorId: string
  readonly operation: OperationId
  readonly find: () => Promise<Document | null>
  readonly target: () => Promise<T>
  readonly issue: (target: T) => Promise<Document>
}

export const DEFAULT_RECOVERY_DELAY_MS = 1_000
export const RECOVERY_LOOKUPS = 2
export const DUPLICATE_VENDOR_ID_PREFIX = 'Duplicate vendor id.'

export function isDuplicateVendorId(error: unknown): error is BillingoError {
  return (
    isBillingoError(error) &&
    error.status === 400 &&
    (error.apiMessage?.startsWith(DUPLICATE_VENDOR_ID_PREFIX) ?? false)
  )
}

function resolveRecoveryDelay(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RECOVERY_DELAY_MS
  if (!Number.isFinite(value) || value < 0) {
    throw new BillingoError(
      `A recoveryDelayMs értéke nemnegatív szám legyen, kapott: ${String(value)}`,
      { category: 'configuration' },
    )
  }
  return value
}

interface Recovery {
  readonly document: Document | null
  readonly lookupError: BillingoError | undefined
}

async function recover(
  find: () => Promise<Document | null>,
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<Recovery> {
  let lookupError: BillingoError | undefined
  for (let attempt = 1; attempt <= RECOVERY_LOOKUPS; attempt++) {
    await sleep(delayMs * attempt, signal)
    try {
      const found = await find()
      if (found) return { document: found, lookupError: undefined }
    } catch (error) {
      if (!isBillingoError(error)) throw error
      lookupError = error
      if (!error.retryable) break
    }
  }
  return { document: null, lookupError }
}

function existingButUnreadable(vendorId: string, lookupError: BillingoError): BillingoError {
  return withHint(
    lookupError,
    'Ne állítsd ki újra, és ne adj neki új vendorId-t: a bizonylat már létezik. Hívd meg később ugyanígy a createOnce-t, az visszakeresi, és created: false eredménnyel adja vissza.',
    `A bizonylat (vendorId: ${vendorId}) már létezik a Billingóban (400 Duplicate vendor id.), de a visszakeresése nem sikerült: ${lookupError.message}`,
  )
}

export async function issueOnce<T>(
  guard: OnceGuard,
  issue: OnceIssue<T>,
  options: CreateOnceOptions = {},
): Promise<DocumentOnceResult> {
  const delayMs = resolveRecoveryDelay(options.recoveryDelayMs)
  const run = async (): Promise<DocumentOnceResult> => {
    const existing = await issue.find()
    if (existing) return { document: existing, created: false }
    const target = await issue.target()
    try {
      return { document: await issue.issue(target), created: true }
    } catch (error) {
      const duplicate = isDuplicateVendorId(error)
      if (!duplicate && !isUncertainOutcome(error)) throw error
      const { document, lookupError } = await recover(issue.find, delayMs, options.signal)
      if (document) return { document, created: !duplicate }
      if (duplicate && lookupError) throw existingButUnreadable(issue.vendorId, lookupError)
      throw error
    }
  }
  return guardOnce(guard, issue.vendorId, issue.operation, options, run, (result) => ({
    ...result,
    created: false,
  }))
}
