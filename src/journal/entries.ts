import { toBillingoDate, toBudapestTimestamp } from '../core/dates'
import type { DocumentAction, DocumentEvent } from '../core/document-events'
import type { Document, DocumentType } from '../generated/billingo'
import type { JournalEntry, JournalEntrySource } from './types'

const DRAFT_TYPES: ReadonlySet<DocumentType> = new Set([
  'draft',
  'draft_offer',
  'draft_order_form',
  'draft_waybill',
])

export interface EntryContext {
  readonly source: JournalEntrySource
  readonly now: Date
  readonly vendorId?: string | undefined
  readonly action?: DocumentAction | undefined
  readonly sourceId?: number | undefined
}

export function isRecordable(document: Document): boolean {
  return document.type !== undefined && !DRAFT_TYPES.has(document.type)
}

export function actionOf(type: DocumentType): DocumentAction {
  if (type === 'cancellation' || type === 'receipt_cancellation') return 'cancelled'
  if (type === 'modification') return 'modified'
  return 'created'
}

function missingField(document: Document, field: string): TypeError {
  return new TypeError(
    `A bizonylatból (id: ${document.id ?? 'ismeretlen'}) hiányzik a(z) ${field} mező, ezért nem naplózható.`,
  )
}

function required<T>(document: Document, field: string, value: T | undefined | null): T {
  if (value === undefined || value === null || value === '') throw missingField(document, field)
  return value
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

function relatedIdsOf(document: Document, sourceId: number | undefined): number[] {
  const ids = (document.relatedDocuments ?? [])
    .map((related) => related.id)
    .filter((id): id is number => typeof id === 'number')
  if (sourceId !== undefined) ids.push(sourceId)
  return [...new Set(ids)]
}

export function documentEntry(document: Document, context: EntryContext): JournalEntry {
  const type = required(document, 'type', document.type)
  const netTotal = document.summary?.netAmount
  return compact<JournalEntry>({
    id: required(document, 'id', document.id),
    vendorId: context.vendorId,
    number: required(document, 'invoiceNumber', document.invoiceNumber),
    type,
    action: context.action ?? actionOf(type),
    date: toBillingoDate(required(document, 'invoiceDate', document.invoiceDate)),
    relatedIds: relatedIdsOf(document, context.sourceId),
    grossTotal: required(document, 'grossTotal', document.grossTotal),
    netTotal: required(document, 'summary.netAmount', netTotal),
    currency: required(document, 'currency', document.currency),
    conversionRate: document.conversionRate,
    paymentStatus: document.paymentStatus,
    recordedAt: toBudapestTimestamp(context.now),
    source: context.source,
  })
}

export function eventEntry(event: DocumentEvent, now: Date): JournalEntry | undefined {
  if (!isRecordable(event.document)) return undefined
  return documentEntry(event.document, {
    source: 'hook',
    now,
    vendorId: event.vendorId,
    action: event.action,
    sourceId: event.sourceId,
  })
}

export function isDocumentEvent(value: DocumentEvent | Document): value is DocumentEvent {
  return 'action' in value && 'document' in value && typeof value.document === 'object'
}
