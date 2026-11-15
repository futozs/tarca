import { describe, expect, test } from 'vitest'
import type { KeyValueStore } from '../core/store'
import { diagnoseStore } from './diagnose'
import { cloudflareKvStore, memoryStore, resilientStore } from './index'

describe('diagnoseStore', () => {
  test('a teljes képességű tároló mindenre alkalmas, és nem hagy szemetet', async () => {
    const inner = memoryStore()
    const keys: string[] = []
    const store: KeyValueStore = {
      ...inner,
      set: (key, value, ttl) => {
        keys.push(key)
        return inner.set(key, value, ttl)
      },
    }

    const diagnosis = await diagnoseStore(store)

    expect(diagnosis).toMatchObject({
      ok: true,
      problems: [],
      capabilities: { setIfAbsent: true, increment: true, deleteIfEquals: true },
      suitableFor: {
        createOnceLock: true,
        journal: true,
        webhookDedupe: true,
        refundLedger: true,
      },
    })
    expect(keys[0]).toMatch(/^tarca:diagnose:[0-9a-f]{16}$/)
    expect(await inner.get(keys[0] ?? '')).toBeUndefined()
  })

  test('a Cloudflare KV-t zárnak, naplónak és főkönyvnek alkalmatlannak jelzi', async () => {
    const data = new Map<string, string>()
    const kv = cloudflareKvStore({
      get: async (key) => data.get(key) ?? null,
      put: async (key, value) => {
        data.set(key, value)
      },
      delete: async (key) => {
        data.delete(key)
      },
    })

    const diagnosis = await diagnoseStore(kv)

    expect(diagnosis.ok).toBe(false)
    expect(diagnosis.suitableFor).toEqual({
      createOnceLock: false,
      journal: false,
      webhookDedupe: true,
      refundLedger: false,
    })
    expect(diagnosis.problems.join(' ')).toContain('Cloudflare KV')
    expect(diagnosis.problems.join(' ')).toContain('naplónak')
  })

  test('az elnyelt hibájú (hibatűrő) tároló hibáját a visszaolvasás felfedi', async () => {
    const broken = resilientStore(
      {
        get: () => Promise.reject(new Error('le')),
        set: () => Promise.reject(new Error('le')),
        delete: () => Promise.reject(new Error('le')),
      },
      { onError: () => undefined },
    )

    const diagnosis = await diagnoseStore(broken)

    expect(diagnosis.suitableFor.webhookDedupe).toBe(false)
    expect(diagnosis.problems[0]).toContain('írás és olvasás')
  })

  test('a hibásan működő atomikus műveleteket kiszűri', async () => {
    const inner = memoryStore()
    const wrong: KeyValueStore = {
      ...inner,
      setIfAbsent: async () => true,
      increment: async () => 5,
      deleteIfEquals: async () => true,
    }

    const diagnosis = await diagnoseStore(wrong, { keyPrefix: 'teszt:', now: () => 0 })

    expect(diagnosis.suitableFor).toMatchObject({
      createOnceLock: false,
      journal: false,
      refundLedger: false,
    })
    expect(diagnosis.latencyMs).toBe(0)
    expect(diagnosis.problems).toHaveLength(2)
  })

  test('a foglalt kulcsot is felülíró setIfAbsent-et kiszűri', async () => {
    const inner = memoryStore()
    const diagnosis = await diagnoseStore({
      ...inner,
      setIfAbsent: async (key, value, ttl) => {
        await inner.set(key, value, ttl)
        return true
      },
    })

    expect(diagnosis.suitableFor).toMatchObject({ createOnceLock: false, refundLedger: false })
    expect(diagnosis.problems[0]).toContain('a foglalt kulcsra true')
  })

  test('az idegen tokent törlő deleteIfEquals-t is kiszűri', async () => {
    const inner = memoryStore()
    const diagnosis = await diagnoseStore({ ...inner, deleteIfEquals: async () => true })

    expect(diagnosis.suitableFor.createOnceLock).toBe(false)
    expect(diagnosis.problems[0]).toContain('idegen tokenre')
  })

  test('deleteIfEquals nélkül is ellenőrzi a setIfAbsent-et', async () => {
    const { deleteIfEquals: _unused, ...rest } = memoryStore()
    expect((await diagnoseStore(rest)).suitableFor.createOnceLock).toBe(true)
  })

  test('increment nélkül zárnak jó, de naplónak nem, ezért összességében nem ok', async () => {
    const { increment: _unused, ...rest } = memoryStore()

    const diagnosis = await diagnoseStore(rest)

    expect(diagnosis.ok).toBe(false)
    expect(diagnosis.suitableFor).toEqual({
      createOnceLock: true,
      journal: false,
      webhookDedupe: true,
      refundLedger: true,
    })
  })

  test('a szinkron dobó delete sem szakítja meg a takarítást', async () => {
    const inner = memoryStore()
    let deletes = 0
    const store: KeyValueStore = {
      ...inner,
      delete: (key) => {
        deletes += 1
        if (deletes === 3) throw new Error('takarítás nem megy')
        return inner.delete(key)
      },
    }

    await expect(diagnoseStore(store)).resolves.toMatchObject({ ok: true })
  })
})
