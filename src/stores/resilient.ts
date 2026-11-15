import { configurationError } from '../core/errors'
import type { KeyValueStore } from '../core/store'

export type StoreOperation =
  | 'get'
  | 'set'
  | 'delete'
  | 'setIfAbsent'
  | 'increment'
  | 'deleteIfEquals'

export interface StoreErrorEvent {
  readonly operation: StoreOperation
  readonly key: string
  readonly error: unknown
}

export interface ResilientStoreOptions {
  readonly onError?: ((event: StoreErrorEvent) => void) | undefined
  readonly timeoutMs?: number | undefined
}

const MAX_TIMEOUT_MS = 2_147_483_647

const ATOMIC_OPERATIONS: ReadonlySet<StoreOperation> = new Set([
  'setIfAbsent',
  'increment',
  'deleteIfEquals',
])

function warnStoreError(event: StoreErrorEvent): void {
  const continuation = ATOMIC_OPERATIONS.has(event.operation)
    ? 'a hibát a hívó (például a createOnce zár vagy a napló) kapja meg.'
    : 'a resilientStore elnyelte a hibát: a get üres értéket ad, a set és a delete elmarad.'
  console.warn(
    `[tarca] A tároló "${event.operation}" művelete sikertelen, ${continuation}`,
    event.error,
  )
}

function resolveTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw configurationError(
      `A tároló timeoutMs értéke 1 és ${MAX_TIMEOUT_MS} közötti egész szám (ezredmásodperc) legyen, kapott: ${String(value)}`,
    )
  }
  return value
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  operation: StoreOperation,
): Promise<T> {
  if (timeoutMs === undefined) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`A tároló "${operation}" művelete nem fejeződött be ${timeoutMs} ms alatt.`))
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function guardStore(
  store: KeyValueStore,
  options: ResilientStoreOptions,
  swallow: boolean,
): KeyValueStore {
  const onError = options.onError ?? (swallow ? warnStoreError : undefined)
  const timeoutMs = resolveTimeout(options.timeoutMs)

  function report(operation: StoreOperation, key: string, error: unknown): void {
    try {
      onError?.({ operation, key, error })
    } catch {
      return
    }
  }

  async function strict<T>(
    operation: StoreOperation,
    key: string,
    call: () => T | Promise<T>,
  ): Promise<T> {
    try {
      return await withTimeout(Promise.resolve().then(call), timeoutMs, operation)
    } catch (error) {
      report(operation, key, error)
      throw error
    }
  }

  async function lenient<T>(
    operation: StoreOperation,
    key: string,
    call: () => T | Promise<T>,
  ): Promise<T | undefined> {
    if (!swallow) return strict(operation, key, call)
    try {
      return await strict(operation, key, call)
    } catch {
      return undefined
    }
  }

  const setIfAbsent = store.setIfAbsent?.bind(store)
  const increment = store.increment?.bind(store)
  const deleteIfEquals = store.deleteIfEquals?.bind(store)

  return {
    async get(key) {
      return (await lenient('get', key, () => store.get(key))) ?? undefined
    },
    async set(key, value, ttlSeconds) {
      await lenient('set', key, () => store.set(key, value, ttlSeconds))
    },
    async delete(key) {
      await lenient('delete', key, () => store.delete(key))
    },
    ...(setIfAbsent && {
      setIfAbsent: (key: string, value: string, ttlSeconds: number) =>
        strict('setIfAbsent', key, () => setIfAbsent(key, value, ttlSeconds)),
    }),
    ...(increment && {
      increment: (key: string, ttlSeconds: number) =>
        strict('increment', key, () => increment(key, ttlSeconds)),
    }),
    ...(deleteIfEquals && {
      deleteIfEquals: (key: string, value: string) =>
        strict('deleteIfEquals', key, () => deleteIfEquals(key, value)),
    }),
  }
}

export function resilientStore(
  store: KeyValueStore,
  options: ResilientStoreOptions = {},
): KeyValueStore {
  return guardStore(store, options, true)
}

export function strictStore(
  store: KeyValueStore,
  options: ResilientStoreOptions = {},
): KeyValueStore {
  return guardStore(store, options, false)
}
