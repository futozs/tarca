import { configurationError } from '../core/errors'
import type { KeyValueStore } from '../core/store'
import { daysOf, inRange, normalizeRange } from './dates'
import type { JournalEntry, JournalRange, JournalReservation, JournalStorage } from './types'

export const JOURNAL_KEY_PREFIX = 'tarca:journal:'
export const DEFAULT_JOURNAL_RETENTION_DAYS = 400
export const DEFAULT_RESERVATION_TTL_DAYS = 30
const DAY_IN_SECONDS = 86_400
const READ_BATCH = 50
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ENTRY_SLOT = 'e:'
const RESERVATION_SLOT = 'v:'

export interface KvJournalOptions {
  readonly prefix?: string | undefined
  readonly retentionDays?: number | undefined
  readonly reservationTtlDays?: number | undefined
}

function positiveDays(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 1) {
    throw configurationError(`A(z) ${field} legalább 1 nap legyen, kapott: ${String(value)}`)
  }
  return Math.ceil(value)
}

function parseJson<T>(
  value: string | undefined | null,
  guard: (parsed: Record<string, unknown>) => boolean,
): T | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return guard(parsed as Record<string, unknown>) ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

function isEntry(entry: Record<string, unknown>): boolean {
  return (
    Number.isInteger(entry.id) &&
    typeof entry.number === 'string' &&
    typeof entry.type === 'string' &&
    typeof entry.date === 'string' &&
    DAY_PATTERN.test(entry.date)
  )
}

function isReservation(reservation: Record<string, unknown>): boolean {
  return (
    typeof reservation.vendorId === 'string' &&
    reservation.vendorId !== '' &&
    typeof reservation.date === 'string' &&
    DAY_PATTERN.test(reservation.date)
  )
}

function slotValue(value: string | undefined | null, marker: string): string | undefined {
  if (typeof value !== 'string' || !value.startsWith(marker)) return undefined
  const target = value.slice(marker.length)
  return target === '' ? undefined : target
}

async function inBatches<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let index = 0; index < items.length; index += READ_BATCH) {
    results.push(...(await Promise.all(items.slice(index, index + READ_BATCH).map(run))))
  }
  return results
}

function defined<T>(value: T | undefined): value is T {
  return value !== undefined
}

export function kvJournal(store: KeyValueStore, options: KvJournalOptions = {}): JournalStorage {
  const increment = store.increment?.bind(store)
  if (!increment) {
    throw configurationError(
      'A naplóhoz olyan tároló kell, amely atomikusan tud számlálót növelni (increment), különben párhuzamos írásnál bejegyzés veszhet el. Használd a tarca/stores Redis, Upstash vagy Durable Object tárolóját. A Cloudflare KV erre nem alkalmas.',
    )
  }
  const prefix = options.prefix ?? JOURNAL_KEY_PREFIX
  const retention =
    positiveDays(options.retentionDays, DEFAULT_JOURNAL_RETENTION_DAYS, 'retentionDays') *
    DAY_IN_SECONDS
  const reservationTtl =
    positiveDays(options.reservationTtlDays, DEFAULT_RESERVATION_TTL_DAYS, 'reservationTtlDays') *
    DAY_IN_SECONDS
  const entryKey = (id: number): string => `${prefix}entry:${id}`
  const reservationKey = (vendorId: string): string => `${prefix}reservation:${vendorId}`

  async function appendToDay(index: 'day' | 'rday', day: string, target: string, ttl: number) {
    const slot = await increment?.(`${prefix}${index}:${day}:count`, ttl)
    await store.set(`${prefix}${index}:${day}:${slot}`, target, ttl)
  }

  async function slotsOf(index: 'day' | 'rday', range: JournalRange, marker: string) {
    const targets: string[] = []
    for (const day of daysOf(range)) {
      const count = Number.parseInt((await store.get(`${prefix}${index}:${day}:count`)) ?? '0', 10)
      if (!Number.isInteger(count) || count < 1) continue
      const slots = Array.from(
        { length: count },
        (_, slot) => `${prefix}${index}:${day}:${slot + 1}`,
      )
      for (const value of await inBatches(slots, async (key) => store.get(key))) {
        const target = slotValue(value, marker)
        if (target !== undefined) targets.push(target)
      }
    }
    return [...new Set(targets)]
  }

  async function readEntry(id: number): Promise<JournalEntry | undefined> {
    const entry = parseJson<JournalEntry>(await store.get(entryKey(id)), isEntry)
    return entry?.id === id ? entry : undefined
  }

  return {
    getEntry: readEntry,
    async putEntry(entry) {
      const key = entryKey(entry.id)
      const existing = await store.get(key)
      if (existing !== undefined && existing !== null) return false
      await appendToDay('day', entry.date, `${ENTRY_SLOT}${entry.id}`, retention)
      const value = JSON.stringify(entry)
      if (store.setIfAbsent) return store.setIfAbsent(key, value, retention)
      await store.set(key, value, retention)
      return true
    },
    async listEntries(range) {
      const normalized = normalizeRange(range)
      const ids = (await slotsOf('day', normalized, ENTRY_SLOT))
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
      const entries = await inBatches(ids, readEntry)
      return entries.filter(defined).filter((entry) => inRange(entry.date, normalized))
    },
    async putReservation(reservation) {
      const key = reservationKey(reservation.vendorId)
      const value = JSON.stringify(reservation)
      await appendToDay(
        'rday',
        reservation.date,
        `${RESERVATION_SLOT}${reservation.vendorId}`,
        reservationTtl,
      )
      if (store.setIfAbsent) return store.setIfAbsent(key, value, reservationTtl)
      const existing = await store.get(key)
      if (existing !== undefined && existing !== null) return false
      await store.set(key, value, reservationTtl)
      return true
    },
    async deleteReservation(vendorId) {
      await store.delete(reservationKey(vendorId))
    },
    async listReservations(range) {
      const normalized = normalizeRange(range)
      const vendorIds = await slotsOf('rday', normalized, RESERVATION_SLOT)
      const reservations = await inBatches(vendorIds, async (vendorId) => {
        const reservation = parseJson<JournalReservation>(
          await store.get(reservationKey(vendorId)),
          isReservation,
        )
        return reservation?.vendorId === vendorId ? reservation : undefined
      })
      return reservations.filter(defined)
    },
  }
}

export function memoryJournal(): JournalStorage {
  const entries = new Map<number, JournalEntry>()
  const reservations = new Map<string, JournalReservation>()
  return {
    async getEntry(id) {
      return entries.get(id)
    },
    async putEntry(entry) {
      if (entries.has(entry.id)) return false
      entries.set(entry.id, entry)
      return true
    },
    async listEntries(range) {
      const normalized = normalizeRange(range)
      return [...entries.values()].filter((entry) => inRange(entry.date, normalized))
    },
    async putReservation(reservation) {
      if (reservations.has(reservation.vendorId)) return false
      reservations.set(reservation.vendorId, reservation)
      return true
    },
    async deleteReservation(vendorId) {
      reservations.delete(vendorId)
    },
    async listReservations(range) {
      const normalized = normalizeRange(range)
      return [...reservations.values()].filter((reservation) =>
        inRange(reservation.date, normalized),
      )
    },
  }
}
