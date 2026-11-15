import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTarca } from '../client'
import { createFakeBillingoFetch } from '../testing'
import { storeCapabilities } from './capabilities'
import { memoryStore } from './memory'

afterEach(() => {
  vi.useRealTimers()
})

describe('memoryStore', () => {
  test('mind a hat műveletet tudja', () => {
    expect(storeCapabilities(memoryStore())).toEqual({
      setIfAbsent: true,
      increment: true,
      deleteIfEquals: true,
    })
    expect(storeCapabilities({ get: () => undefined, set: () => {}, delete: () => {} })).toEqual({
      setIfAbsent: false,
      increment: false,
      deleteIfEquals: false,
    })
  })

  test('a lejárt kulcsot üresnek látja, a setIfAbsent újra foglalhatja', async () => {
    vi.useFakeTimers()
    const store = memoryStore()
    await store.set('k', 'v', 1)
    expect(await store.setIfAbsent?.('k', 'x', 60)).toBe(false)

    vi.advanceTimersByTime(1_000)

    expect(await store.setIfAbsent?.('k', 'x', 60)).toBe(true)
    expect(await store.get('k')).toBe('x')
    await store.set('zar', 'token', 1)
    vi.advanceTimersByTime(1_000)
    expect(await store.deleteIfEquals?.('zar', 'token')).toBe(false)
    expect(await store.get('k')).toBe('x')
  })

  test('végtelen TTL nem jár le, a NaN TTL egy másodperc', async () => {
    vi.useFakeTimers()
    const store = memoryStore()
    await store.set('orok', 'v', Number.POSITIVE_INFINITY)
    await store.set('hibas', 'v', Number.NaN)

    vi.advanceTimersByTime(1_000)

    expect(await store.get('orok')).toBe('v')
    expect(await store.get('hibas')).toBeUndefined()
  })

  test('increment egytől számol, a nem szám értéket nulláról kezdi', async () => {
    const store = memoryStore()
    await store.set('szoveg', 'abc', 60)

    expect(await store.increment?.('n', 60)).toBe(1)
    expect(await store.increment?.('n', 60)).toBe(2)
    expect(await store.increment?.('szoveg', 60)).toBe(1)
  })

  test('increment minden növeléskor megújítja a lejáratot', async () => {
    vi.useFakeTimers()
    const store = memoryStore()

    expect(await store.increment?.('n', 1)).toBe(1)
    vi.advanceTimersByTime(800)
    expect(await store.increment?.('n', 1)).toBe(2)
    vi.advanceTimersByTime(800)

    expect(await store.get('n')).toBe('2')
    vi.advanceTimersByTime(200)
    expect(await store.get('n')).toBeUndefined()
    expect(await store.increment?.('n', 1)).toBe(1)
  })

  test('deleteIfEquals csak a saját tokent törli', async () => {
    const store = memoryStore()
    await store.set('zar', 'token-1', 60)

    expect(await store.deleteIfEquals?.('zar', 'token-2')).toBe(false)
    expect(await store.get('zar')).toBe('token-1')
    expect(await store.deleteIfEquals?.('zar', 'token-1')).toBe(true)
    expect(await store.get('zar')).toBeUndefined()
  })

  test('createOnce zárként két külön kliens párhuzamos hívásából is egy számla lesz', async () => {
    const billingo = createFakeBillingoFetch()
    const lock = memoryStore()
    const client = () =>
      createTarca({
        apiKey: 'teszt-kulcs',
        fetch: (input, init) => billingo.fetch(input, init),
        retryDelayMs: 0,
        createOnceLock: lock,
      })
    const input = {
      vendorId: 'RENDELES-1',
      partner: {
        name: 'Vevő Kft.',
        address: {
          countryCode: 'HU' as const,
          postCode: '1011',
          city: 'Budapest',
          address: 'Fő u. 1.',
        },
      },
      items: [{ name: 'Tétel', quantity: 1, netUnitPrice: 1_000, vat: 27 }],
    }

    const results = await Promise.all([
      client().documents.createOnce(input, { lockWaitMs: 5_000 }),
      client().documents.createOnce(input, { lockWaitMs: 5_000 }),
    ])

    expect(results.map((result) => result.created).sort()).toEqual([false, true])
    expect(billingo.count('CreateDocument')).toBe(1)
  })
})
