import { type RequestOptions, sleep } from '../core/context'
import { BillingoError, isBillingoError } from '../core/errors'
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

export interface OnceIssue {
  readonly vendorId: string
  readonly operation: OperationId
  readonly find: () => Promise<Document | null>
  readonly issue: () => Promise<Document>
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

async function recover(
  find: () => Promise<Document | null>,
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<Document | null> {
  for (let attempt = 1; attempt <= RECOVERY_LOOKUPS; attempt++) {
    await sleep(delayMs * attempt, signal)
    try {
      const found = await find()
      if (found) return found
    } catch (error) {
      if (!isBillingoError(error)) throw error
      if (!error.retryable) return null
    }
  }
  return null
}

export async function issueOnce(
  guard: OnceGuard,
  issue: OnceIssue,
  options: CreateOnceOptions = {},
): Promise<DocumentOnceResult> {
  const delayMs = resolveRecoveryDelay(options.recoveryDelayMs)
  const run = async (): Promise<DocumentOnceResult> => {
    const existing = await issue.find()
    if (existing) return { document: existing, created: false }
    try {
      return { document: await issue.issue(), created: true }
    } catch (error) {
      const duplicate = isDuplicateVendorId(error)
      if (!duplicate && !isUncertainOutcome(error)) throw error
      const recovered = await recover(issue.find, delayMs, options.signal)
      if (recovered) return { document: recovered, created: !duplicate }
      throw error
    }
  }
  return guardOnce(guard, issue.vendorId, issue.operation, options, run, (result) => ({
    ...result,
    created: false,
  }))
}
