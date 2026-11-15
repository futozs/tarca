export type Awaitable<T> = T | Promise<T>

export interface KeyValueStore {
  get(key: string): Awaitable<string | undefined | null>
  set(key: string, value: string, ttlSeconds: number): Awaitable<void>
  delete(key: string): Awaitable<void>
  setIfAbsent?(key: string, value: string, ttlSeconds: number): Awaitable<boolean>
  increment?(key: string, ttlSeconds: number): Awaitable<number>
  deleteIfEquals?(key: string, value: string): Awaitable<boolean>
}
