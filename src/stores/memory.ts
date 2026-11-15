import type { KeyValueStore } from '../core/store'

interface MemoryEntry {
  readonly value: string
  readonly expiresAt: number
}

function expiryOf(ttlSeconds: number): number {
  if (ttlSeconds === Number.POSITIVE_INFINITY) return ttlSeconds
  if (Number.isNaN(ttlSeconds)) return Date.now() + 1000
  return Date.now() + ttlSeconds * 1000
}

function parseCounter(value: string | undefined): number {
  if (value === undefined) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : 0
}

export function memoryStore(): KeyValueStore {
  const entries = new Map<string, MemoryEntry>()
  const read = (key: string): string | undefined => {
    const entry = entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key)
      return undefined
    }
    return entry.value
  }
  return {
    get: read,
    set(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: expiryOf(ttlSeconds) })
    },
    delete(key) {
      entries.delete(key)
    },
    setIfAbsent(key, value, ttlSeconds) {
      if (read(key) !== undefined) return false
      entries.set(key, { value, expiresAt: expiryOf(ttlSeconds) })
      return true
    },
    increment(key, ttlSeconds) {
      const next = parseCounter(read(key)) + 1
      entries.set(key, { value: String(next), expiresAt: expiryOf(ttlSeconds) })
      return next
    },
    deleteIfEquals(key, value) {
      if (read(key) !== value) return false
      entries.delete(key)
      return true
    },
  }
}
