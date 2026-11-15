import type { DocumentAction } from '../core/document-events'
import type { Currency, DocumentType, PaymentStatus } from '../generated/billingo'

export type JournalEntrySource = 'hook' | 'track' | 'settle' | 'reconcile' | 'manual'

export interface JournalEntry {
  readonly id: number
  readonly vendorId?: string | undefined
  readonly number: string
  readonly type: DocumentType
  readonly action: DocumentAction
  readonly date: string
  readonly relatedIds: readonly number[]
  readonly grossTotal: number
  readonly netTotal: number
  readonly currency: Currency
  readonly conversionRate?: number | undefined
  readonly paymentStatus?: PaymentStatus | undefined
  readonly recordedAt: string
  readonly source: JournalEntrySource
}

export interface JournalReservation {
  readonly vendorId: string
  readonly date: string
  readonly reservedAt: string
}

export interface JournalRange {
  readonly from: string
  readonly to: string
}

export interface JournalStorage {
  getEntry(id: number): Promise<JournalEntry | undefined>
  putEntry(entry: JournalEntry): Promise<boolean>
  indexEntry?(entry: JournalEntry): Promise<void>
  listEntries(range: JournalRange): Promise<JournalEntry[]>
  putReservation(reservation: JournalReservation): Promise<boolean>
  deleteReservation(vendorId: string): Promise<void>
  listReservations(range: JournalRange): Promise<JournalReservation[]>
}
