import type { Tarca } from '../client'
import type { ErrorEvent } from '../core/context'
import type { ResolvedDefaults } from '../documents/defaults'
import type { Document, DocumentType } from '../generated/billingo'
import type { Confirmations } from './confirmation'
import type { JsonObject } from './protocol'

export interface ObservedClient {
  readonly tarca: Tarca
  readonly errors: readonly ErrorEvent[]
}

export interface McpToolContext {
  readonly client: () => Tarca
  readonly observedClient: () => ObservedClient
  readonly defaults: ResolvedDefaults
  readonly confirmations: Confirmations
  readonly now: () => Date
  readonly recoveryDelayMs: number
}

export interface McpToolOutput {
  readonly summary: string
  readonly data: JsonObject
}

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean
  readonly destructiveHint: boolean
  readonly idempotentHint: boolean
  readonly openWorldHint: boolean
}

export interface McpTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: JsonObject
  readonly annotations: McpToolAnnotations
  readonly write: boolean
  run(args: JsonObject, context: McpToolContext): Promise<McpToolOutput>
}

export const REMOTE_READ: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

export const REMOTE_CREATE: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

export const REMOTE_CANCEL: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
}

export const REMOTE_SEND: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
}

const amountFormat = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 2 })

export function money(value: number, currency: string): string {
  return `${amountFormat.format(value)} ${currency}`
}

export function plainJson(value: unknown): JsonObject {
  return JSON.parse(
    JSON.stringify(value, (_key, entry: unknown) =>
      entry instanceof Uint8Array ? undefined : entry,
    ),
  )
}

export function lines(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join('\n')
}

export interface SplitConfirmation {
  readonly payload: JsonObject
  readonly confirmation: unknown
}

export function splitConfirmation(args: JsonObject): SplitConfirmation {
  const { confirmation, ...payload } = args
  return { payload, confirmation }
}

export function confirmationLine(tool: string, token: string, expiresAt: string): string {
  return `Mutasd meg az előnézetet a felhasználónak. Ha jóváhagyja, hívd meg a ${tool} eszközt pontosan ugyanezekkel az adatokkal, a confirmation mezőben ezzel a kóddal: ${token} (lejár: ${expiresAt}).`
}

const DOCUMENT_LABELS: Readonly<Partial<Record<DocumentType, string>>> = {
  invoice: 'Számla',
  proforma: 'Díjbekérő',
  advance: 'Előlegszámla',
  cancellation: 'Sztornó számla',
  modification: 'Módosító számla',
  receipt: 'Nyugta',
  receipt_cancellation: 'Sztornó nyugta',
  draft: 'Piszkozat',
}

export function documentLabel(type: DocumentType | undefined): string {
  return (type === undefined ? undefined : DOCUMENT_LABELS[type]) ?? 'Bizonylat'
}

export function documentTitle(document: Document): string {
  const number = document.invoiceNumber ? document.invoiceNumber : `#${document.id ?? '?'}`
  return `${documentLabel(document.type)} ${number}`
}

export function documentSummary(document: Document): JsonObject {
  return plainJson({
    id: document.id,
    invoiceNumber: document.invoiceNumber,
    type: document.type,
    cancelled: document.cancelled,
    correctionType: document.correctionType,
    partner: document.partner?.name,
    partnerId: document.partner?.id,
    blockId: document.blockId,
    invoiceDate: document.invoiceDate,
    fulfillmentDate: document.fulfillmentDate,
    dueDate: document.dueDate,
    paymentStatus: document.paymentStatus,
    paymentMethod: document.paymentMethod,
    grossTotal: document.grossTotal,
    currency: document.currency,
  })
}

export function describeDocument(document: Document): string {
  const currency = document.currency ?? 'HUF'
  return `${documentTitle(document)}: ${document.partner?.name ?? 'ismeretlen partner'}, bruttó ${money(document.grossTotal ?? 0, currency)}, kelte: ${document.invoiceDate ?? '?'}, fizetési állapot: ${document.paymentStatus ?? '?'}.`
}
