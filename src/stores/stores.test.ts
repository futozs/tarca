import { afterEach, describe, expect, test, vi } from 'vitest'
import type { KeyValueStore } from '../core/store'
import {
  CLOUDFLARE_KV_MIN_TTL_SECONDS,
  cloudflareKvStore,
  customStore,
  type DurableObjectStorageLike,
  type DurableObjectStoreEntry,
  durableObjectStore,
  handleDurableObjectStoreRequest,
  ioredisStore,
  memoryStore,
  nodeRedisStore,
  resilientStore,
  storeCapabilities,
  upstashRedisStore,
} from './index'
import {
  DELETE_IF_EQUALS_SCRIPT,
  INCREMENT_SCRIPT,
  SET_IF_ABSENT_SCRIPT,
  scriptNumber,
} from './scripts'
import { readStoreValue } from './shared'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const TOKEN = 'b1946ac9-2cba-4c0a-9f0e-2f5c1c7a0d11'
const TTL = 600

class FakeRedisScripts {
  readonly data = new Map<string, unknown>()
  readonly ttls = new Map<string, number>()
  readonly calls: unknown[][] = []

  run(script: string, key: string, args: readonly string[]): number {
    if (script === SET_IF_ABSENT_SCRIPT) {
      if (this.data.has(key)) return 0
      this.data.set(key, args[0] ?? '')
      this.ttls.set(key, Number(args[1]))
      return 1
    }
    if (script === INCREMENT_SCRIPT) {
      const next = Number(this.data.get(key) ?? '0') + 1
      this.data.set(key, String(next))
      this.ttls.set(key, Number(args[0]))
      return next
    }
    if (script === DELETE_IF_EQUALS_SCRIPT) {
      if (this.data.get(key) !== args[0]) return 0
      this.data.delete(key)
      return 1
    }
    throw new Error('ismeretlen szkript')
  }
}

class FakeUpstash extends FakeRedisScripts {
  async get(key: string) {
    this.calls.push(['get', key])
    return this.data.get(key) ?? null
  }
  async set(key: string, value: string, options: { ex: number }) {
    this.calls.push(['set', key, value, options])
    this.data.set(key, value)
    this.ttls.set(key, options.ex)
    return 'OK'
  }
  async del(key: string) {
    this.calls.push(['del', key])
    return this.data.delete(key) ? 1 : 0
  }
  async eval(script: string, keys: string[], args: string[]) {
    this.calls.push(['eval', script, keys, args])
    return this.run(script, keys[0] ?? '', args)
  }
}

class FakeIoRedis extends FakeRedisScripts {
  async get(key: string) {
    this.calls.push(['get', key])
    return this.data.get(key) ?? null
  }
  async set(key: string, value: string, mode: 'EX', seconds: number) {
    this.calls.push(['set', key, value, mode, seconds])
    this.data.set(key, value)
    this.ttls.set(key, seconds)
    return 'OK'
  }
  async del(key: string) {
    this.calls.push(['del', key])
    return this.data.delete(key) ? 1 : 0
  }
  async eval(script: string, numKeys: number, ...args: string[]) {
    this.calls.push(['eval', script, numKeys, ...args])
    return this.run(script, args[0] ?? '', args.slice(numKeys))
  }
}

class FakeNodeRedis extends FakeRedisScripts {
  async get(key: string) {
    this.calls.push(['get', key])
    return this.data.get(key) ?? null
  }
  async set(key: string, value: string, options: { EX: number }) {
    this.calls.push(['set', key, value, options])
    this.data.set(key, value)
    this.ttls.set(key, options.EX)
    return 'OK'
  }
  async del(key: string) {
    this.calls.push(['del', key])
    return this.data.delete(key) ? 1 : 0
  }
  async eval(script: string, options: { keys: string[]; arguments: string[] }) {
    this.calls.push(['eval', script, options])
    return String(this.run(script, options.keys[0] ?? '', options.arguments))
  }
}

class FakeKvNamespace {
  readonly data = new Map<string, string>()
  readonly calls: unknown[][] = []

  async get(key: string, options?: { cacheTtl?: number }): Promise<string | null> {
    this.calls.push(['get', key, options])
    return this.data.get(key) ?? null
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void> {
    this.calls.push(['put', key, value, options])
    this.data.set(key, String(value))
  }

  async delete(key: string): Promise<void> {
    this.calls.push(['delete', key])
    this.data.delete(key)
  }
}

const down = () => Promise.reject(new Error('down'))

async function exerciseAtomic(store: KeyValueStore, fake: FakeRedisScripts, prefix: string) {
  expect(storeCapabilities(store)).toEqual({
    setIfAbsent: true,
    increment: true,
    deleteIfEquals: true,
  })
  expect(await store.setIfAbsent?.('lock', 'token-1', 0.4)).toBe(true)
  expect(await store.setIfAbsent?.('lock', 'token-2', 60)).toBe(false)
  expect(fake.data.get(`${prefix}lock`)).toBe('token-1')
  expect(fake.ttls.get(`${prefix}lock`)).toBe(1)
  expect(await store.deleteIfEquals?.('lock', 'token-2')).toBe(false)
  expect(await store.deleteIfEquals?.('lock', 'token-1')).toBe(true)
  expect(fake.data.has(`${prefix}lock`)).toBe(false)
  expect(await store.increment?.('count', 86_400)).toBe(1)
  expect(await store.increment?.('count', 86_400)).toBe(2)
  expect(await store.get('count')).toBe('2')
  expect(fake.ttls.get(`${prefix}count`)).toBe(86_400)
}

describe('upstashRedisStore', () => {
  test('set(key, value, { ex }) hívással ír, get/del a pontos kulccsal', async () => {
    const redis = new FakeUpstash()
    const store = upstashRedisStore(redis)

    await store.set('tarca:once:1', TOKEN, TTL)
    expect(await store.get('tarca:once:1')).toBe(TOKEN)
    await store.delete('tarca:once:1')

    expect(redis.calls).toEqual([
      ['set', 'tarca:once:1', TOKEN, { ex: TTL }],
      ['get', 'tarca:once:1'],
      ['del', 'tarca:once:1'],
    ])
    expect(await store.get('tarca:once:1')).toBeUndefined()
  })

  test('a prefixet a kulcs elé teszi, a tört TTL-t felfelé kerekíti', async () => {
    const redis = new FakeUpstash()
    const store = upstashRedisStore(redis, { prefix: 'app1:' })

    await store.set('k', TOKEN, 0.2)
    await store.set('k', TOKEN, 60.2)
    await store.set('k', TOKEN, Number.NaN)

    expect(redis.calls).toEqual([
      ['set', 'app1:k', TOKEN, { ex: 1 }],
      ['set', 'app1:k', TOKEN, { ex: 61 }],
      ['set', 'app1:k', TOKEN, { ex: 1 }],
    ])
  })

  test('az automatikusan deszerializált értéket visszaalakítja: a JSON objektumot is', async () => {
    const redis = new FakeUpstash()
    redis.data.set('szam', 12345)
    redis.data.set('bool', true)
    redis.data.set('obj', { id: 1, number: 'E-1', relatedIds: [2] })
    redis.data.set('ures', '')
    const store = upstashRedisStore(redis)

    expect(await store.get('szam')).toBe('12345')
    expect(await store.get('bool')).toBe('true')
    expect(await store.get('obj')).toBe('{"id":1,"number":"E-1","relatedIds":[2]}')
    expect(await store.get('ures')).toBeUndefined()
  })

  test('alapból minden hibát továbbdob, resilient: true esetén a get/set/delete hibát elnyeli', async () => {
    const broken = { get: down, set: down, del: down }
    const onError = vi.fn()

    const strict = upstashRedisStore(broken)
    await expect(strict.get('k')).rejects.toThrow('down')
    await expect(strict.set('k', 'v', 1)).rejects.toThrow('down')

    const tolerant = upstashRedisStore(broken, { resilient: true, onError })
    await expect(tolerant.get('k')).resolves.toBeUndefined()
    await expect(tolerant.set('k', 'v', 1)).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(2)
  })

  test('onError resilient nélkül is jelent, de a hibát továbbdobja', async () => {
    const onError = vi.fn()
    const store = upstashRedisStore({ get: down, set: down, del: down }, { onError })

    await expect(store.delete('k')).rejects.toThrow('down')

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ operation: 'delete', key: 'k' }))
  })

  test('eval(script, keys, args) az atomikus műveletekhez', async () => {
    const redis = new FakeUpstash()
    await exerciseAtomic(upstashRedisStore(redis), redis, '')
    expect(redis.calls[0]).toEqual(['eval', SET_IF_ABSENT_SCRIPT, ['lock'], ['token-1', '1']])

    const prefixed = new FakeUpstash()
    await exerciseAtomic(upstashRedisStore(prefixed, { prefix: 'u:' }), prefixed, 'u:')
    expect(prefixed.calls[0]).toEqual(['eval', SET_IF_ABSENT_SCRIPT, ['u:lock'], ['token-1', '1']])
  })
})

describe('ioredisStore', () => {
  test("set(key, value, 'EX', ttl) hívással ír", async () => {
    const redis = new FakeIoRedis()
    const store = ioredisStore(redis, { prefix: 'p:' })

    await store.set('k', TOKEN, TTL)
    expect(await store.get('k')).toBe(TOKEN)
    await store.delete('k')
    expect(await store.get('k')).toBeUndefined()

    expect(redis.calls.slice(0, 3)).toEqual([
      ['set', 'p:k', TOKEN, 'EX', TTL],
      ['get', 'p:k'],
      ['del', 'p:k'],
    ])
  })

  test('nem véges TTL esetén 1 másodperc a minimum', async () => {
    const redis = new FakeIoRedis()
    await ioredisStore(redis).set('k', TOKEN, Number.NaN)

    expect(redis.calls[0]).toEqual(['set', 'k', TOKEN, 'EX', 1])
  })

  test('eval(script, 1, key, ...args) az atomikus műveletekhez', async () => {
    const redis = new FakeIoRedis()
    await exerciseAtomic(ioredisStore(redis, { prefix: 'p:' }), redis, 'p:')
    expect(redis.calls[0]).toEqual(['eval', SET_IF_ABSENT_SCRIPT, 1, 'p:lock', 'token-1', '1'])
  })
})

describe('nodeRedisStore', () => {
  test('set(key, value, { EX: ttl }) és del(key) hívással dolgozik', async () => {
    const client = new FakeNodeRedis()
    const store = nodeRedisStore(client, { prefix: 'szamla:' })

    await store.set('k', TOKEN, TTL)
    expect(await store.get('k')).toBe(TOKEN)
    await store.delete('k')

    expect(client.calls).toEqual([
      ['set', 'szamla:k', TOKEN, { EX: TTL }],
      ['get', 'szamla:k'],
      ['del', 'szamla:k'],
    ])
  })

  test('a tört TTL-t felfelé kerekíti, a nem véges vagy nulla TTL 1 másodperc', async () => {
    const client = new FakeNodeRedis()
    const store = nodeRedisStore(client)

    await store.set('a', TOKEN, 60.2)
    await store.set('b', TOKEN, Number.NaN)
    await store.set('c', TOKEN, 0)

    expect(client.calls.map((call) => call[3])).toEqual([{ EX: 61 }, { EX: 1 }, { EX: 1 }])
  })

  test('Buffer típusleképezésnél a bájtokat UTF-8 stringként olvassa', async () => {
    const client = new FakeNodeRedis()
    client.data.set('k', new TextEncoder().encode('árvíztűrő'))

    expect(await nodeRedisStore(client).get('k')).toBe('árvíztűrő')
  })

  test('eval(script, { keys, arguments }), string eredménnyel is', async () => {
    const client = new FakeNodeRedis()
    await exerciseAtomic(nodeRedisStore(client, { prefix: 'n:' }), client, 'n:')
    expect(client.calls[0]).toEqual([
      'eval',
      SET_IF_ABSENT_SCRIPT,
      { keys: ['n:lock'], arguments: ['token-1', '1'] },
    ])
  })
})

describe('cloudflareKvStore', () => {
  test('put(key, value, { expirationTtl }) hívással ír', async () => {
    const kv = new FakeKvNamespace()
    const store = cloudflareKvStore(kv, { prefix: 'sz:' })

    await store.set('k', TOKEN, TTL)
    expect(await store.get('k')).toBe(TOKEN)
    await store.delete('k')

    expect(kv.calls).toEqual([
      ['put', 'sz:k', TOKEN, { expirationTtl: TTL }],
      ['get', 'sz:k', undefined],
      ['delete', 'sz:k'],
    ])
  })

  test('a KV minimum 60 mp-es TTL-jére emeli a rövidebb lejáratot, atomikus művelete nincs', async () => {
    const kv = new FakeKvNamespace()
    const store = cloudflareKvStore(kv)
    await store.set('k', TOKEN, 5)

    expect(CLOUDFLARE_KV_MIN_TTL_SECONDS).toBe(60)
    expect(kv.calls[0]).toEqual(['put', 'k', TOKEN, { expirationTtl: 60 }])
    expect(storeCapabilities(store)).toEqual({
      setIfAbsent: false,
      increment: false,
      deleteIfEquals: false,
    })
  })

  test('resilient: true esetén a KV hibája után a get undefined', async () => {
    const onError = vi.fn()
    const store = cloudflareKvStore(
      {
        get: () => Promise.reject(new Error('KV GET failed: 429')),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      { resilient: true, onError },
    )

    expect(await store.get('k')).toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
  })
})

describe('Redis adapterek közös viselkedése', () => {
  test('eval nélküli klienssel nincsenek atomikus műveletek', () => {
    const minimal = {
      get: async () => null,
      set: async () => 'OK',
      del: async () => 0,
    }
    for (const store of [
      ioredisStore(minimal),
      nodeRedisStore(minimal),
      upstashRedisStore(minimal),
    ]) {
      expect(storeCapabilities(store)).toEqual({
        setIfAbsent: false,
        increment: false,
        deleteIfEquals: false,
      })
    }
  })

  test('az atomikus műveletek hibáját resilient módban is jelenti és továbbdobja', async () => {
    const onError = vi.fn()
    const store = upstashRedisStore(
      {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 0,
        eval: () => Promise.reject(new Error('NOSCRIPT')),
      },
      { resilient: true, onError },
    )
    await expect(store.setIfAbsent?.('k', 'v', 1)).rejects.toThrow('NOSCRIPT')
    await expect(store.increment?.('k', 1)).rejects.toThrow('NOSCRIPT')
    await expect(store.deleteIfEquals?.('k', 'v')).rejects.toThrow('NOSCRIPT')
    expect(onError.mock.calls.map(([event]) => event.operation)).toEqual([
      'setIfAbsent',
      'increment',
      'deleteIfEquals',
    ])
  })

  test('onError nélkül a resilient tároló atomikus hibája console.warn-t is ad', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = resilientStore({
      ...memoryStore(),
      increment: () => Promise.reject(new Error('x')),
    })
    await expect(store.increment?.('k', 1)).rejects.toThrow('x')
    expect(String(warn.mock.calls[0]?.[0])).toContain('a hibát a hívó')
  })

  test('a Lua szkriptek a Redis atomikus parancsaira épülnek', () => {
    expect(SET_IF_ABSENT_SCRIPT).toBe(
      "if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then return 1 else return 0 end",
    )
    expect(INCREMENT_SCRIPT).toBe(
      "local value = redis.call('INCR', KEYS[1]) redis.call('EXPIRE', KEYS[1], ARGV[1]) return value",
    )
    expect(DELETE_IF_EQUALS_SCRIPT).toBe(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    )
  })

  test('a nem szám szkript-eredmény hibát dob', () => {
    expect(scriptNumber('3')).toBe(3)
    expect(() => scriptNumber('OK')).toThrow(TypeError)
    expect(() => scriptNumber(null)).not.toThrow()
  })

  test('readStoreValue: üres és ismeretlen értékre undefined', () => {
    expect(readStoreValue(null)).toBeUndefined()
    expect(readStoreValue(undefined)).toBeUndefined()
    expect(readStoreValue('')).toBeUndefined()
    expect(readStoreValue(['a'])).toBe('["a"]')
  })
})

describe('customStore', () => {
  test('prefixszel továbbít, az atomikus műveletekre is', async () => {
    const inner = memoryStore()
    const store = customStore(inner, { prefix: 'app:' })

    await store.set('s', 'v', 60)
    expect(await inner.get('app:s')).toBe('v')
    expect(await store.get('s')).toBe('v')
    await store.delete('s')
    expect(await inner.get('app:s')).toBeUndefined()
    expect(await store.setIfAbsent?.('k', 'v', 60)).toBe(true)
    expect(await inner.get('app:k')).toBe('v')
    expect(await store.increment?.('n', 60)).toBe(1)
    expect(await inner.get('app:n')).toBe('1')
    expect(await store.deleteIfEquals?.('k', 'v')).toBe(true)
    expect(await inner.get('app:k')).toBeUndefined()
  })

  test('atomikus műveletek nélküli tárolónál nem talál ki ilyet, prefix nélkül a kulcs változatlan', async () => {
    const store = customStore({
      get: (key) => (key === 'k' ? 'v' : undefined),
      set: () => {},
      delete: () => {},
    })
    expect(storeCapabilities(store).setIfAbsent).toBe(false)
    expect(await store.get('k')).toBe('v')
  })

  test('a szinkron dobást resilient módban elnyeli és jelenti', async () => {
    const onError = vi.fn()
    const store = customStore(
      {
        get: () => undefined,
        set: () => {
          throw new Error('írás tiltva')
        },
        delete: () => undefined,
      },
      { resilient: true, onError },
    )

    await expect(store.set('k', 'v', 60)).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledOnce()
  })
})

class FakeDurableStorage implements DurableObjectStorageLike {
  readonly entries = new Map<string, DurableObjectStoreEntry | string>()
  async get(key: string) {
    return this.entries.get(key)
  }
  async put(key: string, value: DurableObjectStoreEntry) {
    this.entries.set(key, value)
  }
  async delete(key: string) {
    return this.entries.delete(key)
  }
}

function durableStore() {
  const storage = new FakeDurableStorage()
  const calls: unknown[] = []
  const store = durableObjectStore({
    fetch: async (input, init) => {
      calls.push(JSON.parse(String(init.body)))
      return handleDurableObjectStoreRequest(storage, new Request(input, init))
    },
  })
  return { storage, store, calls }
}

describe('durableObjectStore', () => {
  test('minden műveletet a Durable Objecten keresztül végez', async () => {
    const { store, calls } = durableStore()

    await store.set('k', 'v', 60)
    expect(await store.get('k')).toBe('v')
    expect(await store.get('nincs')).toBeUndefined()
    expect(await store.setIfAbsent?.('k', 'x', 60)).toBe(false)
    expect(await store.setIfAbsent?.('uj', 'x', 60)).toBe(true)
    expect(await store.increment?.('n', 60)).toBe(1)
    expect(await store.increment?.('n', 60)).toBe(2)
    expect(await store.deleteIfEquals?.('uj', 'y')).toBe(false)
    expect(await store.deleteIfEquals?.('uj', 'x')).toBe(true)
    await store.delete('k')
    expect(await store.get('k')).toBeUndefined()
    expect(calls[0]).toEqual({ op: 'set', key: 'k', value: 'v', ttlSeconds: 60 })
  })

  test('a lejárt bejegyzést törli és üresnek tekinti', async () => {
    vi.useFakeTimers()
    const { store, storage } = durableStore()
    await store.set('k', 'v', 1)

    vi.advanceTimersByTime(1_001)

    expect(await store.get('k')).toBeUndefined()
    expect(storage.entries.has('k')).toBe(false)
    expect(await store.setIfAbsent?.('k', 'uj', 1)).toBe(true)
  })

  test('a lejárt zárat olvasás nélkül is újra lehet foglalni, idegen tokennel nem törölhető', async () => {
    vi.useFakeTimers()
    const { store } = durableStore()
    await store.set('zar', 'regi', 1)
    await store.set('n', '5', 1)

    vi.advanceTimersByTime(1_001)

    expect(await store.setIfAbsent?.('zar', 'uj', 60)).toBe(true)
    expect(await store.get('zar')).toBe('uj')
    expect(await store.increment?.('n', 60)).toBe(1)
    await store.set('masik', 'token', 1)
    vi.advanceTimersByTime(1_001)
    expect(await store.deleteIfEquals?.('masik', 'token')).toBe(false)
  })

  test('a sérült tárolt értéket hiányzónak veszi, a nem szám számlálót nulláról kezdi', async () => {
    const { store, storage } = durableStore()
    storage.entries.set('rossz', 'nem bejegyzés')
    storage.entries.set('n', { value: 'abc', expiresAt: Date.now() + 60_000 })

    expect(await store.get('rossz')).toBeUndefined()
    expect(await store.increment?.('n', 60)).toBe(1)
  })

  test('a kezelő a hibás kérést elutasítja', async () => {
    const storage = new FakeDurableStorage()
    const post = (body: string) =>
      handleDurableObjectStoreRequest(storage, new Request('https://x/', { method: 'POST', body }))

    expect((await handleDurableObjectStoreRequest(storage, new Request('https://x/'))).status).toBe(
      405,
    )
    expect((await post('nem json')).status).toBe(400)
    expect((await post(JSON.stringify({ op: 'drop', key: 'k' }))).status).toBe(400)
    expect((await post(JSON.stringify({ op: 'get', key: '' }))).status).toBe(400)
    expect((await post(JSON.stringify({ op: 'set', key: 'k', value: 1 }))).status).toBe(400)
    expect((await post(JSON.stringify({ op: 'set', key: 'k', ttlSeconds: 'x' }))).status).toBe(400)
    const missingValue = await post(JSON.stringify({ op: 'set', key: 'k' }))
    expect(missingValue.status).toBe(400)
    expect(await missingValue.json()).toMatchObject({ error: expect.stringContaining('érték') })
  })

  test('a kliens a HTTP hibát magyar üzenettel dobja tovább', async () => {
    const store = durableObjectStore({
      fetch: async () => new Response(JSON.stringify({ error: 'túlterhelt' }), { status: 503 }),
    })
    await expect(store.get('k')).rejects.toThrow('HTTP 503')
    const broken = durableObjectStore({
      fetch: async () => new Response('nem json', { status: 500 }),
    })
    await expect(broken.delete('k')).rejects.toThrow('ismeretlen hiba')
    const wrong = durableObjectStore({
      fetch: async () => new Response(JSON.stringify({ result: 'egy' })),
    })
    await expect(wrong.increment?.('k', 1)).rejects.toThrow(TypeError)
  })
})
