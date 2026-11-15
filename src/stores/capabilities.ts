import type { KeyValueStore } from '../core/store'

export interface StoreCapabilities {
  readonly setIfAbsent: boolean
  readonly increment: boolean
  readonly deleteIfEquals: boolean
}

export function storeCapabilities(store: KeyValueStore): StoreCapabilities {
  return {
    setIfAbsent: typeof store.setIfAbsent === 'function',
    increment: typeof store.increment === 'function',
    deleteIfEquals: typeof store.deleteIfEquals === 'function',
  }
}
