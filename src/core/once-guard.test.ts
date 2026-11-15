import { describe, expect, test } from 'vitest'
import type { HookWarning } from './context'
import { BillingoError, type BillingoErrorCategory } from './errors'
import {
  guardOnce,
  inflightOnceCount,
  isUncertainOutcome,
  ONCE_LOCK_KEY_PREFIX,
  type OnceGuard,
  onceLockKey,
  onceScopeOf,
  transportIdentity,
} from './once-guard'
import type { KeyValueStore } from './store'

interface Result {
  readonly created: boolean
  readonly run: number
}

const joined = (result: Result): Result => ({ ...result, created: false })

function memoryLock(): KeyValueStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value)
    },
    delete: (key) => {
      values.delete(key)
    },
    setIfAbsent: (key, value) => {
      if (values.has(key)) return false
      values.set(key, value)
      return true
    },
    deleteIfEquals: (key, value) => {
      if (values.get(key) !== value) return false
      values.delete(key)
      return true
    },
  }
}

function counter() {
  let runs = 0
  return {
    get runs() {
      return runs
    },
    run: async (): Promise<Result> => {
      runs += 1
      const run = runs
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { created: true, run }
    },
  }
}

function error(category: BillingoErrorCategory): BillingoError {
  return new BillingoError(category, { category })
}

describe('guardOnce: folyamaton belüli singleflight', () => {
  test('ugyanarra a kulcsra párhuzamosan egy futás, a csatlakozó created: false-t kap', async () => {
    const guard: OnceGuard = { scope: 'fiók', transport: 1 }
    const work = counter()

    const results = await Promise.all([
      guardOnce(guard, 'R-1', 'CreateDocument', {}, work.run, joined),
      guardOnce(guard, 'R-1', 'CreateDocument', {}, work.run, joined),
    ])

    expect(results).toEqual([
      { created: true, run: 1 },
      { created: false, run: 1 },
    ])
    expect(work.runs).toBe(1)
    expect(inflightOnceCount()).toBe(0)
  })

  test('más kulcs, más fiók vagy más szállítás nem csatlakozik', async () => {
    const work = counter()

    await Promise.all([
      guardOnce({ scope: 'fiók', transport: 1 }, 'R-1', 'CreateDocument', {}, work.run, joined),
      guardOnce({ scope: 'fiók', transport: 1 }, 'R-2', 'CreateDocument', {}, work.run, joined),
      guardOnce({ scope: 'másik', transport: 1 }, 'R-1', 'CreateDocument', {}, work.run, joined),
      guardOnce({ scope: 'fiók', transport: 2 }, 'R-1', 'CreateDocument', {}, work.run, joined),
    ])

    expect(work.runs).toBe(4)
  })

  test('a vezető biztos hibáját a csatlakozó is megkapja, újra nem futtat', async () => {
    const guard: OnceGuard = { scope: 'fiók' }
    let runs = 0
    const failing = async (): Promise<Result> => {
      runs += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      throw error('validation')
    }

    const settled = await Promise.allSettled([
      guardOnce(guard, 'R-1', 'CreateDocument', {}, failing, joined),
      guardOnce(guard, 'R-1', 'CreateDocument', {}, failing, joined),
    ])

    expect(settled.map((item) => item.status)).toEqual(['rejected', 'rejected'])
    expect(runs).toBe(1)
  })

  test.each([
    ['bizonytalan BillingoError', () => error('network')],
    [
      'nem BillingoError (például a vezető megszakítása)',
      () => new DOMException('stop', 'AbortError'),
    ],
  ])('a vezető %s hibája után a csatlakozó maga futtat', async (_, makeError) => {
    const guard: OnceGuard = { scope: 'fiók' }
    let runs = 0
    const run = async (): Promise<Result> => {
      runs += 1
      const current = runs
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (current === 1) throw makeError()
      return { created: true, run: current }
    }

    const settled = await Promise.allSettled([
      guardOnce(guard, 'R-1', 'CreateDocument', {}, run, joined),
      guardOnce(guard, 'R-1', 'CreateDocument', {}, run, joined),
    ])

    expect(settled[0]?.status).toBe('rejected')
    expect(settled[1]).toEqual({ status: 'fulfilled', value: { created: true, run: 2 } })
  })

  test('a csatlakozó megszakítása a vezető bizonytalan hibája után érvényesül', async () => {
    const guard: OnceGuard = { scope: 'fiók' }
    const controller = new AbortController()
    let runs = 0
    const run = async (): Promise<Result> => {
      runs += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      controller.abort(new Error('megszakítva'))
      throw error('timeout')
    }

    const settled = await Promise.allSettled([
      guardOnce(guard, 'R-1', 'CreateDocument', {}, run, joined),
      guardOnce(guard, 'R-1', 'CreateDocument', { signal: controller.signal }, run, joined),
    ])

    expect(settled[1]).toMatchObject({ status: 'rejected', reason: { message: 'megszakítva' } })
    expect(runs).toBe(1)
  })

  test('csak a network, timeout, server és unexpected_response bizonytalan', () => {
    const uncertain = (
      [
        'network',
        'timeout',
        'server',
        'unexpected_response',
        'validation',
        'not_found',
        'rate_limit',
        'not_ready',
        'auth',
      ] as const
    ).filter((category) => isUncertainOutcome(error(category)))

    expect(uncertain).toEqual(['network', 'timeout', 'server', 'unexpected_response'])
    expect(isUncertainOutcome(new Error('network'))).toBe(false)
  })
})

describe('guardOnce: folyamatok közötti zár', () => {
  test('felveszi, lefuttat, a saját tokenjével elengedi', async () => {
    const lock = memoryLock()
    const ttls: number[] = []
    const watched: KeyValueStore = {
      ...lock,
      setIfAbsent: (key, value, ttl) => {
        ttls.push(ttl)
        return lock.setIfAbsent?.(key, value, ttl) ?? false
      },
    }
    let heldDuringRun = false
    const run = async (): Promise<Result> => {
      heldDuringRun = lock.values.size === 1
      return { created: true, run: 1 }
    }

    await guardOnce(
      { scope: 's', lock: watched },
      'k',
      'CreateDocument',
      { lockTtlSeconds: 30.2 },
      run,
      joined,
    )

    expect([heldDuringRun, lock.values.size, ttls]).toEqual([true, 0, [31]])
  })

  test('deleteIfEquals nélkül csak a saját tokenjét törli', async () => {
    const lock = memoryLock()
    const { deleteIfEquals: _, ...plain } = lock
    const key = await onceLockKey('s', 'k')

    await guardOnce(
      { scope: 's', lock: plain },
      'k',
      'CreateDocument',
      {},
      async () => {
        lock.values.set(key, 'masik-folyamat')
        return { created: true, run: 1 }
      },
      joined,
    )

    expect(lock.values.get(key)).toBe('masik-folyamat')
  })

  test('foglalt zárnál kivárja a felszabadulást', async () => {
    const lock = memoryLock()
    const key = await onceLockKey('s', 'k')
    lock.values.set(key, 'masik')
    setTimeout(() => lock.values.delete(key), 30)
    const work = counter()

    const result = await guardOnce(
      { scope: 's', lock },
      'k',
      'CreateDocument',
      {},
      work.run,
      joined,
    )

    expect(result).toEqual({ created: true, run: 1 })
  })

  test('ha a várakozási idő alatt nem szabadul fel, in_progress hiba, futtatás nélkül', async () => {
    const lock = memoryLock()
    lock.values.set(await onceLockKey('s', 'k'), 'masik')
    const work = counter()
    const began = Date.now()

    const waited = await guardOnce(
      { scope: 's', lock },
      'k',
      'CreateReceipt',
      { lockWaitMs: 20 },
      work.run,
      joined,
    ).catch((caught: unknown) => caught)
    const immediate = await guardOnce(
      { scope: 's', lock },
      'k',
      'CreateReceipt',
      { lockWaitMs: 0 },
      work.run,
      joined,
    ).catch((caught: unknown) => caught)

    expect(Date.now() - began).toBeLessThan(400)
    for (const failure of [waited, immediate]) {
      expect(failure).toBeInstanceOf(BillingoError)
      expect(failure).toMatchObject({ category: 'in_progress', operation: 'CreateReceipt' })
    }
    expect((waited as BillingoError).message).toContain('vendorId: k')
    expect((waited as BillingoError).hint).toContain('hívd újra')
    expect(work.runs).toBe(0)
  })

  test('elérhetetlen tárolónál alapból store_unavailable, futtatás nélkül', async () => {
    const broken: KeyValueStore = {
      ...memoryLock(),
      setIfAbsent: () => Promise.reject(new Error('redis leállt')),
    }
    const work = counter()

    const failure = await guardOnce(
      { scope: 's', lock: broken },
      'k',
      'CreateDocument',
      {},
      work.run,
      joined,
    ).catch((caught: unknown) => caught)

    expect(failure).toMatchObject({ category: 'store_unavailable', operation: 'CreateDocument' })
    expect((failure as BillingoError).cause).toMatchObject({ message: 'redis leállt' })
    expect(work.runs).toBe(0)
  })

  test("lockFailure: 'proceed' zár nélkül fut, és figyelmeztet; a dobó figyelmeztető kezelő nem zavar", async () => {
    const warnings: HookWarning[] = []
    const broken: KeyValueStore = {
      ...memoryLock(),
      setIfAbsent: () => {
        throw new Error('redis leállt')
      },
    }
    const work = counter()

    const result = await guardOnce(
      { scope: 's', lock: broken, warn: (warning) => warnings.push(warning) },
      'k',
      'CreateDocument',
      { lockFailure: 'proceed' },
      work.run,
      joined,
    )
    const quiet = await guardOnce(
      {
        scope: 's',
        lock: broken,
        warn: () => {
          throw new Error('rossz kezelő')
        },
      },
      'k2',
      'CreateDocument',
      { lockFailure: 'proceed' },
      work.run,
      joined,
    )

    expect([result.created, quiet.created]).toEqual([true, true])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ hook: 'createOnceLock', operation: 'CreateDocument' })
    expect(warnings[0]?.message).toContain('zár nélkül folytatja')
  })

  test('a zár elengedésének hibája figyelmeztetés, az eredmény megmarad', async () => {
    const warnings: HookWarning[] = []
    const lock: KeyValueStore = {
      ...memoryLock(),
      deleteIfEquals: () => {
        throw new Error('nem érhető el')
      },
    }
    const work = counter()

    const result = await guardOnce(
      { scope: 's', lock, warn: (warning) => warnings.push(warning) },
      'k',
      'CreateDocument',
      {},
      work.run,
      joined,
    )

    expect(result.created).toBe(true)
    expect(warnings[0]?.message).toContain('nem sikerült felszabadítani')
  })

  test('a hívás szintű lock felülírja, a lock: false kikapcsolja a guard zárát', async () => {
    const own = memoryLock()
    const other = memoryLock()
    const used: string[] = []
    const spy = (name: string, store: KeyValueStore): KeyValueStore => ({
      ...store,
      setIfAbsent: (key, value, ttl) => {
        used.push(name)
        return store.setIfAbsent?.(key, value, ttl) ?? false
      },
    })
    const guard: OnceGuard = { scope: 's', lock: spy('saját', own) }
    const work = counter()

    await guardOnce(guard, 'a', 'CreateDocument', { lock: spy('hívás', other) }, work.run, joined)
    await guardOnce(guard, 'b', 'CreateDocument', { lock: false }, work.run, joined)
    await guardOnce(guard, 'c', 'CreateDocument', {}, work.run, joined)

    expect(used).toEqual(['hívás', 'saját'])
  })

  test('setIfAbsent nélküli tároló és hibás beállítások configuration hibát adnak', async () => {
    const { setIfAbsent: _, ...noAtomic } = memoryLock()
    const work = counter()
    const attempt = (options: object, lock: KeyValueStore = memoryLock()) =>
      guardOnce({ scope: 's', lock }, 'k', 'CreateDocument', options, work.run, joined).catch(
        (caught: unknown) => caught,
      )

    const failures = [
      await attempt({}, noAtomic),
      await attempt({ lockTtlSeconds: 0 }),
      await attempt({ lockWaitMs: -1 }),
      await attempt({ lockFailure: 'ignore' }),
    ]

    expect(failures.map((failure) => (failure as BillingoError).category)).toEqual([
      'configuration',
      'configuration',
      'configuration',
      'configuration',
    ])
    expect((failures[0] as BillingoError).message).toContain('setIfAbsent')
    expect(work.runs).toBe(0)
  })
})

describe('a zár kulcsa és a hatókör', () => {
  test('sha256 a hatókörből és a kulcsból, előtaggal; a hatókör számít', async () => {
    const key = await onceLockKey('https://api.billingo.hu/v3\ntitkos', 'R-1')

    expect(key).toMatch(new RegExp(`^${ONCE_LOCK_KEY_PREFIX}[0-9a-f]{64}$`))
    expect(key).not.toContain('titkos')
    expect(await onceLockKey('https://api.billingo.hu/v3\ntitkos', 'R-1')).toBe(key)
    expect(await onceLockKey('https://api.billingo.hu/v3\nmasik', 'R-1')).not.toBe(key)
    expect(await onceLockKey('https://api.billingo.hu/v3\ntitkos', 'R-2')).not.toBe(key)
  })

  test('a hatókör az alap URL (perjel nélkül) és az API kulcs; a szállítás azonosítója függvényenként állandó', () => {
    const fetchOne = (async () => new Response()) as typeof fetch
    const fetchTwo = (async () => new Response()) as typeof fetch

    expect(onceScopeOf({ apiKey: 'kulcs' })).toBe('https://api.billingo.hu/v3\nkulcs')
    expect(onceScopeOf({ apiKey: ' kulcs ', baseUrl: 'https://teszt.example/v3//' })).toBe(
      'https://teszt.example/v3\nkulcs',
    )
    expect(transportIdentity(fetchOne)).toBe(transportIdentity(fetchOne))
    expect(transportIdentity(fetchOne)).not.toBe(transportIdentity(fetchTwo))
    expect(transportIdentity(undefined)).toBe(transportIdentity(globalThis.fetch))
  })
})
