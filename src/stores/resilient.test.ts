import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTarca } from '../client'
import { BillingoError } from '../core/errors'
import type { KeyValueStore } from '../core/store'
import { createFakeBillingoFetch } from '../testing'
import { customStore } from './custom'
import { memoryStore } from './memory'
import { resilientStore, type StoreErrorEvent, strictStore } from './resilient'

function failingStore(error: unknown = new Error('Redis nem elérhető')): KeyValueStore {
  return {
    get: () => Promise.reject(error),
    set: () => {
      throw error
    },
    delete: () => Promise.reject(error),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('resilientStore', () => {
  test('sikeres műveleteket változatlanul továbbít, a null-t undefined-ra alakítja', async () => {
    const calls: unknown[][] = []
    const store = resilientStore({
      get: (key) => (key === 'van' ? 'token' : null),
      set: (...args) => {
        calls.push(['set', ...args])
      },
      delete: async (key) => {
        calls.push(['delete', key])
      },
    })

    expect(await store.get('van')).toBe('token')
    expect(await store.get('nincs')).toBeUndefined()
    await store.set('k', 'v', 60)
    await store.delete('k')
    expect(calls).toEqual([
      ['set', 'k', 'v', 60],
      ['delete', 'k'],
    ])
  })

  test('szinkron és aszinkron hibát is elnyel, és jelenti az onError-nak', async () => {
    const events: StoreErrorEvent[] = []
    const error = new Error('boom')
    const store = resilientStore(failingStore(error), { onError: (e) => events.push(e) })

    await expect(store.get('a')).resolves.toBeUndefined()
    await expect(store.set('b', 'v', 10)).resolves.toBeUndefined()
    await expect(store.delete('c')).resolves.toBeUndefined()
    expect(events).toEqual([
      { operation: 'get', key: 'a', error },
      { operation: 'set', key: 'b', error },
      { operation: 'delete', key: 'c', error },
    ])
  })

  test('onError nélkül console.warn-nal figyelmeztet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = resilientStore(failingStore())

    await store.get('a')

    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('"get" művelete sikertelen')
  })

  test('ha az onError maga dob, az sem jut ki', async () => {
    const store = resilientStore(failingStore(), {
      onError: () => {
        throw new Error('rossz logger')
      },
    })

    await expect(store.get('a')).resolves.toBeUndefined()
  })

  test('timeoutMs után feladja a lassú tárolót', async () => {
    vi.useFakeTimers()
    const events: StoreErrorEvent[] = []
    const store = resilientStore(
      { get: () => new Promise(() => undefined), set: () => undefined, delete: () => undefined },
      { timeoutMs: 50, onError: (e) => events.push(e) },
    )

    const pending = store.get('lassu')
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBeUndefined()
    expect(events[0]?.operation).toBe('get')
    expect(String(events[0]?.error)).toContain('50 ms')
  })

  test('a timeout nem szól bele a gyors válaszba', async () => {
    const store = resilientStore(
      { get: async () => 'ok', set: () => undefined, delete: () => undefined },
      { timeoutMs: 1000 },
    )

    expect(await store.get('x')).toBe('ok')
  })

  test('érvénytelen timeoutMs configuration hiba, a 2^31 ms fölötti is', () => {
    for (const timeoutMs of [0, Number.NaN, 1.5, 2_147_483_648, Number.POSITIVE_INFINITY]) {
      expect(() => resilientStore(failingStore(), { timeoutMs })).toThrow(BillingoError)
    }
    expect(() => resilientStore(failingStore(), { timeoutMs: 2_147_483_647 })).not.toThrow()
  })
})

describe('strictStore', () => {
  test('minden hibát továbbdob, és az onError-nak is jelenti', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const onError = vi.fn()
    const store = strictStore(failingStore(), { onError })

    await expect(store.get('a')).rejects.toThrow('Redis nem elérhető')
    await expect(store.set('b', 'v', 1)).rejects.toThrow('Redis nem elérhető')

    expect(onError).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
  })

  test('a lassú tárolót a timeoutMs után hibával adja fel', async () => {
    vi.useFakeTimers()
    const store = strictStore(
      { ...memoryStore(), setIfAbsent: () => new Promise<boolean>(() => undefined) },
      { timeoutMs: 20 },
    )

    const caught = Promise.resolve(store.setIfAbsent?.('zar', 'token', 60)).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(20)

    expect(String(await caught)).toContain('"setIfAbsent" művelete nem fejeződött be 20 ms alatt')
  })

  test('az adapter onError nélkül, csak timeoutMs-sel is feladja a lassú tárolót', async () => {
    vi.useFakeTimers()
    const store = customStore(
      { ...memoryStore(), get: () => new Promise<string | undefined>(() => undefined) },
      { timeoutMs: 20 },
    )

    const caught = Promise.resolve(store.get('k')).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(20)

    expect(String(await caught)).toContain('"get" művelete nem fejeződött be 20 ms alatt')
  })

  test('a lefagyott zártárolóval a createOnce store_unavailable hibát ad, és nem állít ki', async () => {
    const billingo = createFakeBillingoFetch()
    const lock = strictStore(
      { ...memoryStore(), setIfAbsent: () => new Promise<boolean>(() => undefined) },
      { timeoutMs: 10 },
    )
    const tarca = createTarca({
      apiKey: 'teszt-kulcs',
      fetch: billingo.fetch,
      retryDelayMs: 0,
      createOnceLock: lock,
    })

    const error = await tarca.documents
      .createOnce({
        vendorId: 'LASSU-1',
        partner: {
          name: 'Vevő Kft.',
          address: { countryCode: 'HU', postCode: '1011', city: 'Budapest', address: 'Fő u. 1.' },
        },
        items: [{ name: 'Tétel', quantity: 1, netUnitPrice: 1_000, vat: 27 }],
      })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ category: 'store_unavailable' })
    expect(billingo.count('CreateDocument')).toBe(0)
  })
})
