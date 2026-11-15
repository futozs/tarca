import type { KeyValueStore } from '../core/store'
import { finalizeStore, prefixKey, type StoreAdapterOptions } from './shared'

export function customStore(store: KeyValueStore, options?: StoreAdapterOptions): KeyValueStore {
  const prefixed = (key: string): string => prefixKey(options, key)
  const setIfAbsent = store.setIfAbsent?.bind(store)
  const increment = store.increment?.bind(store)
  const deleteIfEquals = store.deleteIfEquals?.bind(store)
  return finalizeStore(
    {
      get: (key) => store.get(prefixed(key)),
      set: (key, value, ttlSeconds) => store.set(prefixed(key), value, ttlSeconds),
      delete: (key) => store.delete(prefixed(key)),
      ...(setIfAbsent && {
        setIfAbsent: (key: string, value: string, ttlSeconds: number) =>
          setIfAbsent(prefixed(key), value, ttlSeconds),
      }),
      ...(increment && {
        increment: (key: string, ttlSeconds: number) => increment(prefixed(key), ttlSeconds),
      }),
      ...(deleteIfEquals && {
        deleteIfEquals: (key: string, value: string) => deleteIfEquals(prefixed(key), value),
      }),
    },
    options,
  )
}
