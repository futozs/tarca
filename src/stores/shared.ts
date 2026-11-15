import type { KeyValueStore } from '../core/store'
import { type ResilientStoreOptions, resilientStore, strictStore } from './resilient'

export interface StoreAdapterOptions extends ResilientStoreOptions {
  readonly prefix?: string | undefined
  readonly resilient?: boolean | undefined
}

const utf8 = new TextDecoder()

export function prefixKey(options: StoreAdapterOptions | undefined, key: string): string {
  const prefix = options?.prefix
  return prefix ? `${prefix}${key}` : key
}

export function finalizeStore(
  store: KeyValueStore,
  options: StoreAdapterOptions | undefined,
): KeyValueStore {
  const guard = { onError: options?.onError, timeoutMs: options?.timeoutMs }
  if (options?.resilient === true) return resilientStore(store, guard)
  if (guard.onError === undefined && guard.timeoutMs === undefined) return store
  return strictStore(store, guard)
}

export function readStoreValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value
  if (value instanceof Uint8Array) return readStoreValue(utf8.decode(value))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return undefined
}

export function wholeSeconds(ttlSeconds: number, minimum: number): number {
  if (!Number.isFinite(ttlSeconds)) return minimum
  return Math.max(minimum, Math.ceil(ttlSeconds))
}
