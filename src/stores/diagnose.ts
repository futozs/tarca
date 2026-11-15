import type { KeyValueStore } from '../core/store'
import { type StoreCapabilities, storeCapabilities } from './capabilities'

export interface StoreSuitability {
  readonly createOnceLock: boolean
  readonly journal: boolean
  readonly webhookDedupe: boolean
  readonly refundLedger: boolean
}

export interface StoreDiagnosis {
  readonly ok: boolean
  readonly capabilities: StoreCapabilities
  readonly suitableFor: StoreSuitability
  readonly latencyMs: number
  readonly problems: readonly string[]
}

export interface DiagnoseStoreOptions {
  readonly keyPrefix?: string | undefined
  readonly now?: (() => number) | undefined
}

export const DIAGNOSE_KEY_PREFIX = 'tarca:diagnose:'

const PROBE_TTL_SECONDS = 60

function randomSuffix(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function diagnoseStore(
  store: KeyValueStore,
  options: DiagnoseStoreOptions = {},
): Promise<StoreDiagnosis> {
  const now = options.now ?? (() => Date.now())
  const key = `${options.keyPrefix ?? DIAGNOSE_KEY_PREFIX}${randomSuffix()}`
  const capabilities = storeCapabilities(store)
  const problems: string[] = []
  const started = now()
  const step = async (label: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      await run()
      return true
    } catch (error) {
      problems.push(`${label}: ${messageOf(error)}`)
      return false
    }
  }
  const basic = await step('írás és olvasás', async () => {
    await store.set(key, 'tarca', PROBE_TTL_SECONDS)
    const read = await store.get(key)
    if (read !== 'tarca') throw new Error(`a visszaolvasott érték: ${String(read)}`)
    await store.delete(key)
    const deleted = await store.get(key)
    if (deleted !== undefined && deleted !== null) throw new Error('a törölt kulcs még olvasható')
  })
  const lock =
    capabilities.setIfAbsent &&
    (await step('setIfAbsent', async () => {
      if ((await store.setIfAbsent?.(key, 'a', PROBE_TTL_SECONDS)) !== true) {
        throw new Error('az üres kulcsra false')
      }
      if ((await store.setIfAbsent?.(key, 'b', PROBE_TTL_SECONDS)) !== false) {
        throw new Error('a foglalt kulcsra true')
      }
      if (capabilities.deleteIfEquals) {
        if ((await store.deleteIfEquals?.(key, 'b')) !== false) {
          throw new Error('deleteIfEquals idegen tokenre törölt')
        }
        if ((await store.deleteIfEquals?.(key, 'a')) !== true) {
          throw new Error('deleteIfEquals a saját tokenre nem törölt')
        }
      } else {
        await store.delete(key)
      }
    }))
  const counter =
    capabilities.increment &&
    (await step('increment', async () => {
      const first = await store.increment?.(key, PROBE_TTL_SECONDS)
      const second = await store.increment?.(key, PROBE_TTL_SECONDS)
      if (first !== 1 || second !== 2) throw new Error(`a számláló értékei: ${first}, ${second}`)
      await store.delete(key)
    }))
  await Promise.resolve()
    .then(() => store.delete(key))
    .catch(() => undefined)
  if (!capabilities.setIfAbsent) {
    problems.push(
      'Nincs setIfAbsent: a createOnce zárnak és a visszatérítési főkönyvnek nem alkalmas (például Cloudflare KV).',
    )
  }
  if (!capabilities.increment) {
    problems.push('Nincs increment: naplónak nem alkalmas, a napi index nem lenne atomikus.')
  }
  const locks = basic && lock === true
  return {
    ok: locks && counter === true,
    capabilities,
    suitableFor: {
      createOnceLock: locks,
      journal: basic && counter === true,
      webhookDedupe: basic,
      refundLedger: locks,
    },
    latencyMs: Math.max(0, now() - started),
    problems,
  }
}
