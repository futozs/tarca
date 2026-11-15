import { isBillingoError } from '../core/errors'
import type { DocumentQueryApi } from '../documents/query'
import type { Document, PaymentStatus } from '../generated/billingo'
import { inRange, normalizeRange } from './dates'
import { documentEntry, isRecordable } from './entries'
import type { JournalEntry, JournalRange, JournalStorage } from './types'

export const DEFAULT_RECONCILE_GRACE_SECONDS = 120
const LIST_PAGE_SIZE = 100

export interface JournalReconcileApi {
  readonly documents: Pick<DocumentQueryApi, 'all' | 'get'>
}

export interface JournalReconcileOptions extends JournalRange {
  readonly dryRun?: boolean | undefined
  readonly graceSeconds?: number | undefined
  readonly signal?: AbortSignal | undefined
}

export type JournalMismatchField = 'number' | 'type' | 'grossTotal' | 'currency'

export interface JournalMismatch {
  readonly id: number
  readonly fields: readonly JournalMismatchField[]
  readonly journal: JournalEntry
  readonly billingo: JournalEntry
}

export interface JournalStateChange {
  readonly id: number
  readonly number: string
  readonly cancelled: boolean
  readonly recordedPaymentStatus: PaymentStatus | undefined
  readonly paymentStatus: PaymentStatus | undefined
}

export interface JournalReconciliation {
  readonly range: JournalRange
  readonly added: readonly JournalEntry[]
  readonly missing: readonly JournalEntry[]
  readonly mismatched: readonly JournalMismatch[]
  readonly changed: readonly JournalStateChange[]
  readonly matched: number
}

const COMPARED_FIELDS: readonly JournalMismatchField[] = [
  'number',
  'type',
  'grossTotal',
  'currency',
]

function resolveGrace(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RECONCILE_GRACE_SECONDS
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`A graceSeconds nemnegatív szám legyen, kapott: ${String(value)}`)
  }
  return value
}

function isGone(error: unknown): boolean {
  return (
    isBillingoError(error) && (error.category === 'forbidden' || error.category === 'not_found')
  )
}

export async function reconcileJournal(
  storage: JournalStorage,
  api: JournalReconcileApi,
  options: JournalReconcileOptions,
  now: Date,
): Promise<JournalReconciliation> {
  const range = normalizeRange(options)
  const graceMs = resolveGrace(options.graceSeconds) * 1000
  const signal = options.signal
  const journaled = new Map((await storage.listEntries(range)).map((entry) => [entry.id, entry]))
  const listed = new Map<number, Document>()
  for await (const document of api.documents.all(
    { startDate: range.from, endDate: range.to, perPage: LIST_PAGE_SIZE },
    { signal },
  )) {
    if (document.id === undefined || !isRecordable(document)) continue
    if (document.invoiceDate === undefined || !inRange(document.invoiceDate, range)) continue
    listed.set(document.id, document)
  }
  for (const entry of journaled.values()) {
    if (listed.has(entry.id) || entry.type !== 'proforma') continue
    try {
      listed.set(entry.id, await api.documents.get(entry.id, { signal }))
    } catch (error) {
      if (!isGone(error)) throw error
    }
  }

  const added: JournalEntry[] = []
  const mismatched: JournalMismatch[] = []
  const changed: JournalStateChange[] = []
  let matched = 0
  const documents = [...listed.values()].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
  for (const document of documents) {
    const billingo = documentEntry(document, { source: 'reconcile', now })
    const entry = journaled.get(billingo.id)
    if (!entry) {
      if (options.dryRun !== true) await storage.putEntry(billingo)
      added.push(billingo)
      continue
    }
    const fields = COMPARED_FIELDS.filter((field) => entry[field] !== billingo[field])
    if (fields.length > 0) mismatched.push({ id: entry.id, fields, journal: entry, billingo })
    else matched += 1
    if (document.cancelled === true || document.paymentStatus !== entry.paymentStatus) {
      changed.push({
        id: entry.id,
        number: entry.number,
        cancelled: document.cancelled === true,
        recordedPaymentStatus: entry.paymentStatus,
        paymentStatus: document.paymentStatus,
      })
    }
  }
  const cutoff = now.getTime() - graceMs
  const missing = [...journaled.values()]
    .filter((entry) => !listed.has(entry.id) && Date.parse(entry.recordedAt) <= cutoff)
    .sort((a, b) => a.id - b.id)
  return { range, added, missing, mismatched, changed, matched }
}
