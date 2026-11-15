import { toBudapestDate, toBudapestTimestamp } from '../core/dates'
import type { DocumentEvent } from '../core/document-events'
import { type BillingoErrorCategory, isBillingoError } from '../core/errors'
import type { DocumentQueryApi } from '../documents/query'
import type { Document, DocumentType } from '../generated/billingo'
import { normalizeRange, recentRange } from './dates'
import { documentEntry, eventEntry, isDocumentEvent, isRecordable } from './entries'
import {
  type JournalReconcileApi,
  type JournalReconcileOptions,
  type JournalReconciliation,
  reconcileJournal,
} from './reconcile'
import type { JournalEntry, JournalRange, JournalReservation, JournalStorage } from './types'

export const DEFAULT_PENDING_DAYS = 30

export class JournalWriteError extends Error {
  override readonly name: string = 'JournalWriteError'
  readonly vendorId: string
  readonly result: unknown

  constructor(vendorId: string, result: unknown, cause: unknown) {
    super(
      `A(z) ${vendorId} vendorId bizonylata elkészült, de a naplóba írás nem sikerült. A tétel befejezetlenként a naplóban maradt: a journal.settle() később pótolja. Ne állítsd ki újra a bizonylatot.`,
      { cause },
    )
    this.vendorId = vendorId
    this.result = result
  }
}

export function isJournalWriteError(error: unknown): error is JournalWriteError {
  return error instanceof JournalWriteError
}

export interface JournalOptions {
  readonly now?: (() => Date) | undefined
}

export interface JournalEntryQuery extends JournalRange {
  readonly type?: DocumentType | undefined
}

export interface JournalSettleApi {
  readonly documents: Pick<DocumentQueryApi, 'findByVendorId'>
}

export interface JournalSettleOptions {
  readonly range?: JournalRange | undefined
  readonly releaseNotFound?: boolean | undefined
}

export interface JournalSettleFailure {
  readonly reservation: JournalReservation
  readonly error: unknown
}

export interface JournalSettlement {
  readonly recorded: readonly JournalReservation[]
  readonly notFound: readonly JournalReservation[]
  readonly failed: readonly JournalSettleFailure[]
}

export interface Journal {
  readonly storage: JournalStorage
  record(input: DocumentEvent | Document): Promise<void>
  reserve(vendorId: string): Promise<boolean>
  release(vendorId: string): Promise<void>
  track<T>(vendorId: string, run: () => Promise<T>): Promise<T>
  entries(query: JournalEntryQuery): Promise<JournalEntry[]>
  pending(range?: JournalRange): Promise<JournalReservation[]>
  settle(tarca: JournalSettleApi, options?: JournalSettleOptions): Promise<JournalSettlement>
  reconcile(
    tarca: JournalReconcileApi,
    options: JournalReconcileOptions,
  ): Promise<JournalReconciliation>
}

const UNSETTLED_CATEGORIES: ReadonlySet<BillingoErrorCategory> = new Set([
  'network',
  'timeout',
  'server',
  'unexpected_response',
  'in_progress',
  'store_unavailable',
])

function isDefinitelyNotCreated(error: unknown): boolean {
  if (!isBillingoError(error) || UNSETTLED_CATEGORIES.has(error.category)) return false
  return error.operation !== 'GetDocumentByVendorId'
}

function requireVendorId(vendorId: string): string {
  const trimmed = typeof vendorId === 'string' ? vendorId.trim() : ''
  if (trimmed === '') throw new RangeError('A naplóhoz add meg a vendorId-t, nem lehet üres.')
  return trimmed
}

function trackedDocument(result: unknown): Document {
  if (typeof result === 'object' && result !== null) {
    if ('document' in result && typeof result.document === 'object' && result.document !== null) {
      return result.document as Document
    }
    if ('id' in result && 'type' in result) return result as Document
  }
  throw new TypeError(
    'A track() futtatott függvénye nem bizonylatot adott vissza (sem Document-et, sem createOnce eredményt), ezért nem naplózható.',
  )
}

export function createJournal(storage: JournalStorage, options: JournalOptions = {}): Journal {
  const now = options.now ?? (() => new Date())

  async function reserve(vendorId: string): Promise<boolean> {
    const current = now()
    return storage.putReservation({
      vendorId: requireVendorId(vendorId),
      date: toBudapestDate(current),
      reservedAt: toBudapestTimestamp(current),
    })
  }

  async function recordTracked(vendorId: string, document: Document, source: 'track' | 'settle') {
    if (!isRecordable(document)) return
    await storage.putEntry(documentEntry(document, { source, now: now(), vendorId }))
  }

  const journal: Journal = {
    storage,
    async record(input) {
      const entry = isDocumentEvent(input)
        ? eventEntry(input, now())
        : isRecordable(input)
          ? documentEntry(input, { source: 'manual', now: now() })
          : undefined
      if (entry) await storage.putEntry(entry)
    },
    reserve,
    async release(vendorId) {
      await storage.deleteReservation(requireVendorId(vendorId))
    },
    async track(vendorId, run) {
      const vendor = requireVendorId(vendorId)
      const ownsReservation = await reserve(vendor)
      let result: Awaited<ReturnType<typeof run>>
      try {
        result = await run()
      } catch (error) {
        if (ownsReservation && isDefinitelyNotCreated(error)) {
          await storage.deleteReservation(vendor).catch(() => undefined)
        }
        throw error
      }
      try {
        await recordTracked(vendor, trackedDocument(result), 'track')
        await storage.deleteReservation(vendor)
      } catch (error) {
        throw new JournalWriteError(vendor, result, error)
      }
      return result
    },
    async entries(query) {
      const entries = await storage.listEntries(normalizeRange(query))
      return entries
        .filter((entry) => query.type === undefined || entry.type === query.type)
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            a.number.localeCompare(b.number, 'hu', { numeric: true }) ||
            a.id - b.id,
        )
    },
    async pending(range) {
      return storage.listReservations(range ?? recentRange(now(), DEFAULT_PENDING_DAYS))
    },
    async settle(tarca, settleOptions = {}) {
      const reservations = await journal.pending(settleOptions.range)
      const recorded: JournalReservation[] = []
      const notFound: JournalReservation[] = []
      const failed: JournalSettleFailure[] = []
      for (const reservation of reservations) {
        try {
          const document = await tarca.documents.findByVendorId(reservation.vendorId)
          if (document) await recordTracked(reservation.vendorId, document, 'settle')
          if (document || settleOptions.releaseNotFound === true) {
            await storage.deleteReservation(reservation.vendorId)
          }
          if (document) recorded.push(reservation)
          else notFound.push(reservation)
        } catch (error) {
          failed.push({ reservation, error })
        }
      }
      return { recorded, notFound, failed }
    },
    reconcile: (tarca, reconcileOptions) =>
      reconcileJournal(storage, tarca, reconcileOptions, now()),
  }
  return journal
}
