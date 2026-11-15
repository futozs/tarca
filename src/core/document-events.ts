import type { Document } from '../generated/billingo'
import type { HookWarning } from './context'
import { configurationError } from './errors'
import type { OperationId } from './operations'

export type DocumentAction =
  | 'created'
  | 'finalized'
  | 'converted'
  | 'copied'
  | 'cancelled'
  | 'modified'

export interface DocumentEvent {
  readonly action: DocumentAction
  readonly operation: OperationId
  readonly document: Document
  readonly vendorId?: string | undefined
  readonly sourceId?: number | undefined
}

export type DocumentHook = (event: DocumentEvent) => void | Promise<void>

export type DocumentErrorHandler = (error: unknown, event: DocumentEvent) => void | Promise<void>

export type DocumentErrorMode = 'warn' | 'throw' | DocumentErrorHandler

export interface DocumentEventOptions {
  readonly mode?: DocumentErrorMode | undefined
  readonly warn?: ((warning: HookWarning) => void) | undefined
}

export interface DocumentEmitter {
  emit(event: DocumentEvent): Promise<void>
}

export function documentLabel(document: Document): string {
  if (document.invoiceNumber) return document.invoiceNumber
  return `id: ${document.id ?? 'ismeretlen'}`
}

export class DocumentHookError extends Error {
  override readonly name: string = 'DocumentHookError'
  readonly event: DocumentEvent

  constructor(event: DocumentEvent, cause: unknown) {
    super(
      `Az onDocument hook hibát dobott a(z) ${documentLabel(event.document)} bizonylatnál. A bizonylat elkészült a Billingóban, csak a hook (például a napló mentése) maradt el: pótold az error.event alapján, és ne állítsd ki újra a bizonylatot.`,
      { cause },
    )
    this.event = event
  }

  get number(): string | undefined {
    return this.event.document.invoiceNumber || undefined
  }

  get document(): Document {
    return this.event.document
  }
}

export function isDocumentHookError(error: unknown): error is DocumentHookError {
  return error instanceof DocumentHookError
}

function warnDocumentHook(
  warn: ((warning: HookWarning) => void) | undefined,
  event: DocumentEvent,
  error: unknown,
): void {
  const message = `Az onDocument hook hibát dobott a(z) ${documentLabel(event.document)} bizonylatnál. A bizonylat elkészült, a hiba nem érinti.`
  if (!warn) {
    console.warn(`[tarca] ${message}`, error)
    return
  }
  warn({ hook: 'onDocument', operation: event.operation, error, message })
}

export async function emitDocumentEvent(
  hook: DocumentHook | undefined,
  event: DocumentEvent,
  options: DocumentEventOptions = {},
): Promise<void> {
  if (!hook) return
  try {
    await hook(event)
  } catch (error) {
    const mode = options.mode ?? 'warn'
    if (mode === 'warn') {
      warnDocumentHook(options.warn, event, error)
      return
    }
    if (mode === 'throw') throw new DocumentHookError(event, error)
    try {
      await mode(error, event)
    } catch (handlerError) {
      throw new DocumentHookError(event, handlerError)
    }
  }
}

export function createDocumentEmitter(
  hook: DocumentHook | undefined,
  options: DocumentEventOptions = {},
): DocumentEmitter {
  const { mode } = options
  if (mode !== undefined && mode !== 'warn' && mode !== 'throw' && typeof mode !== 'function') {
    throw configurationError(
      `Az onDocumentError értéke 'warn', 'throw' vagy függvény lehet, kapott: ${String(mode)}`,
    )
  }
  return { emit: (event) => emitDocumentEvent(hook, event, options) }
}
