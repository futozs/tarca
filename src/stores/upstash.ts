import type { KeyValueStore } from '../core/store'
import { atomicOperations } from './scripts'
import {
  finalizeStore,
  prefixKey,
  readStoreValue,
  type StoreAdapterOptions,
  wholeSeconds,
} from './shared'

export interface UpstashRedisLike {
  get(key: string): Promise<unknown>
  set(key: string, value: string, options: { ex: number }): Promise<unknown>
  del(key: string): Promise<unknown>
  eval?(script: string, keys: string[], args: string[]): Promise<unknown>
}

export function upstashRedisStore(
  redis: UpstashRedisLike,
  options?: StoreAdapterOptions,
): KeyValueStore {
  const base: KeyValueStore = {
    async get(key) {
      return readStoreValue(await redis.get(prefixKey(options, key)))
    },
    async set(key, value, ttlSeconds) {
      await redis.set(prefixKey(options, key), value, { ex: wholeSeconds(ttlSeconds, 1) })
    },
    async delete(key) {
      await redis.del(prefixKey(options, key))
    },
  }
  const evaluate = redis.eval?.bind(redis)
  if (!evaluate) return finalizeStore(base, options)
  const atomic = atomicOperations(
    (script, key, args) => evaluate(script, [key], args),
    (key) => prefixKey(options, key),
    (ttlSeconds) => wholeSeconds(ttlSeconds, 1),
  )
  return finalizeStore({ ...base, ...atomic }, options)
}
