import {
  BILLINGO_API_URL,
  type BillingoOptions,
  type HookWarning,
  resolveApiKey,
  sleep,
} from './context'
import { BillingoError, type BillingoErrorCategory, configurationError } from './errors'
import type { OperationId } from './operations'
import type { KeyValueStore } from './store'

export const ONCE_LOCK_KEY_PREFIX = 'tarca:once:'
export const DEFAULT_LOCK_TTL_SECONDS = 600
export const DEFAULT_LOCK_WAIT_MS = 10_000
export const LOCK_POLL_MS = 500

export type LockFailureMode = 'throw' | 'proceed'

export interface OnceLockOptions {
  readonly lock?: KeyValueStore | false | undefined
  readonly lockTtlSeconds?: number | undefined
  readonly lockWaitMs?: number | undefined
  readonly lockFailure?: LockFailureMode | undefined
  readonly signal?: AbortSignal | undefined
}

export interface OnceGuard {
  readonly scope: string
  readonly transport?: number | undefined
  readonly lock?: KeyValueStore | undefined
  readonly warn?: ((warning: HookWarning) => void) | undefined
}

const UNCERTAIN_CATEGORIES: ReadonlySet<BillingoErrorCategory> = new Set([
  'network',
  'timeout',
  'server',
  'unexpected_response',
])

export function isUncertainOutcome(error: unknown): error is BillingoError {
  return error instanceof BillingoError && UNCERTAIN_CATEGORIES.has(error.category)
}

const inflight = new Map<string, Promise<unknown>>()

export function inflightOnceCount(): number {
  return inflight.size
}

const transports = new WeakMap<object, number>()
let transportCount = 0

export function transportIdentity(fetch: typeof globalThis.fetch | undefined): number {
  const target: object = fetch ?? globalThis.fetch
  const known = transports.get(target)
  if (known !== undefined) return known
  transportCount += 1
  transports.set(target, transportCount)
  return transportCount
}

export function onceScopeOf(options: BillingoOptions): string {
  return `${(options.baseUrl ?? BILLINGO_API_URL).replace(/\/+$/, '')}\n${resolveApiKey(options)}`
}

function resolveTtl(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LOCK_TTL_SECONDS
  if (!Number.isFinite(value) || value < 1) {
    throw configurationError(
      `A lockTtlSeconds értéke legalább 1 másodperc legyen, kapott: ${String(value)}`,
    )
  }
  return Math.ceil(value)
}

function resolveWait(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LOCK_WAIT_MS
  if (!Number.isFinite(value) || value < 0) {
    throw configurationError(`A lockWaitMs értéke nemnegatív szám legyen, kapott: ${String(value)}`)
  }
  return value
}

function resolveFailureMode(value: LockFailureMode | undefined): LockFailureMode {
  if (value === undefined) return 'throw'
  if (value === 'throw' || value === 'proceed') return value
  throw configurationError(
    `A lockFailure értéke 'throw' vagy 'proceed' lehet, kapott: ${String(value)}`,
  )
}

const encoder = new TextEncoder()

export async function onceLockKey(scope: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${scope}\n${key}`))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
  return `${ONCE_LOCK_KEY_PREFIX}${hex.join('')}`
}

function inProgressError(key: string, waitMs: number, operation: OperationId): BillingoError {
  return new BillingoError(
    `Egy másik folyamat éppen kiállítja ezt a bizonylatot (vendorId: ${key}), ${Math.ceil(waitMs / 1000)} másodperc várakozás után sem végzett.`,
    {
      category: 'in_progress',
      operation,
      hint: 'Ne állítsd ki kézzel. Néhány másodperc múlva hívd újra ugyanígy a createOnce-t: a zár felszabadulása után a vendorId alapján visszakeresi a bizonylatot. Webhookban adj vissza 5xx választ, hogy a küldő később újrapróbálja.',
    },
  )
}

function lockUnavailableError(key: string, operation: OperationId, error: unknown): BillingoError {
  return new BillingoError(
    `A createOnce zár tárolója nem érhető el, ezért a tárca nem állította ki a bizonylatot (vendorId: ${key}).`,
    {
      category: 'store_unavailable',
      operation,
      cause: error,
      hint: "Állítsd helyre a tárolót (például a Redist), és hívd újra. Ha zár nélkül is ki akarod állítani, add meg a lockFailure: 'proceed' beállítást.",
    },
  )
}

function emitWarning(guard: OnceGuard, warning: HookWarning): void {
  try {
    guard.warn?.(warning)
  } catch {
    return
  }
}

async function releaseLock(
  guard: OnceGuard,
  store: KeyValueStore,
  lockKey: string,
  token: string,
  operation: OperationId,
): Promise<void> {
  try {
    if (store.deleteIfEquals) {
      await store.deleteIfEquals(lockKey, token)
      return
    }
    if ((await store.get(lockKey)) === token) await store.delete(lockKey)
  } catch (error) {
    emitWarning(guard, {
      hook: 'createOnceLock',
      operation,
      error,
      message:
        'A createOnce zárat nem sikerült felszabadítani. A zár a lejárati ideje végén magától megszűnik, addig az azonos vendorId-ra érkező hívások in_progress hibát kapnak.',
    })
  }
}

async function runLocked<T>(
  guard: OnceGuard,
  key: string,
  operation: OperationId,
  options: OnceLockOptions,
  run: () => Promise<T>,
): Promise<T> {
  const store = options.lock === false ? undefined : (options.lock ?? guard.lock)
  if (!store) return run()
  const setIfAbsent = store.setIfAbsent?.bind(store)
  if (!setIfAbsent) {
    throw configurationError(
      'A createOnce zárához olyan tároló kell, amely támogatja a setIfAbsent műveletet (például Redis SET NX). A Cloudflare KV erre nem alkalmas.',
    )
  }
  const ttlSeconds = resolveTtl(options.lockTtlSeconds)
  const waitMs = resolveWait(options.lockWaitMs)
  const failureMode = resolveFailureMode(options.lockFailure)
  const lockKey = await onceLockKey(guard.scope, key)
  const token = crypto.randomUUID()
  const deadline = Date.now() + waitMs
  for (;;) {
    let acquired: boolean
    try {
      acquired = await setIfAbsent(lockKey, token, ttlSeconds)
    } catch (error) {
      if (failureMode === 'throw') throw lockUnavailableError(key, operation, error)
      emitWarning(guard, {
        hook: 'createOnceLock',
        operation,
        error,
        message:
          'A createOnce zár tárolója nem érhető el, a tárca zár nélkül folytatja (lockFailure: proceed). A folyamatok közötti dupla kiállítás elleni védelem most nem él.',
      })
      return run()
    }
    if (acquired) break
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw inProgressError(key, waitMs, operation)
    await sleep(Math.min(LOCK_POLL_MS, remaining), options.signal)
  }
  try {
    return await run()
  } finally {
    await releaseLock(guard, store, lockKey, token, operation)
  }
}

export async function guardOnce<T>(
  guard: OnceGuard,
  key: string,
  operation: OperationId,
  options: OnceLockOptions,
  run: () => Promise<T>,
  joined: (result: T) => T,
): Promise<T> {
  const id = `${guard.scope}\n${guard.transport ?? 0}\n${key}`
  for (;;) {
    const pending = inflight.get(id) as Promise<T> | undefined
    if (!pending) break
    try {
      return joined(await pending)
    } catch (error) {
      if (error instanceof BillingoError && !isUncertainOutcome(error)) throw error
    }
    options.signal?.throwIfAborted()
  }
  const leader = runLocked(guard, key, operation, options, run)
  inflight.set(id, leader)
  try {
    return await leader
  } finally {
    if (inflight.get(id) === leader) inflight.delete(id)
  }
}
