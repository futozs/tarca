import type { RequestOptions } from '../core/context'
import { digestHex } from '../core/crypto'
import { isDocumentHookError } from '../core/document-events'
import { BillingoError, configurationError, isBillingoError } from '../core/errors'
import { isUncertainOutcome } from '../core/once-guard'
import type { KeyValueStore } from '../core/store'
import type { DocumentsApi } from '../documents/documents'
import type { DocumentItemInput } from '../documents/input'
import type { Document, PaymentMethod } from '../generated/billingo'

export const REFUND_LEDGER_KEY_PREFIX = 'tarca:refund:'
export const REFUND_LEDGER_TTL_SECONDS: number = 30 * 86_400

const RECOVERY_MAX_PAGES = 5
const RECOVERY_PER_PAGE = 100
const PLAIN_REFUND_KEY = /^[A-Za-z0-9_.:-]{1,40}$/

export interface ModificationTarca {
  readonly documents: Pick<DocumentsApi, 'createModification' | 'get' | 'list'>
}

export interface ModificationOnceInput {
  readonly documentId: number
  readonly vendorId: string
  readonly refundId: string
  readonly items: readonly DocumentItemInput[]
  readonly ledger: KeyValueStore
  readonly comment?: string | undefined
  readonly paymentMethod?: PaymentMethod | undefined
}

export interface ModificationOnceResult {
  readonly modificationId: number
  readonly grossTotal: number | undefined
  readonly document: Document | undefined
  readonly created: boolean
  readonly marker: string
}

export interface RecordedModification {
  readonly modificationId: number
  readonly grossTotal: number | undefined
}

interface LedgerEntry {
  readonly state: 'pending' | 'done'
  readonly modificationId?: number
  readonly grossTotal?: number | undefined
}

function parseEntry(value: string | null | undefined): LedgerEntry | undefined {
  if (value === null || value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'state' in parsed &&
      parsed.state === 'done' &&
      'modificationId' in parsed &&
      typeof parsed.modificationId === 'number' &&
      Number.isSafeInteger(parsed.modificationId)
    ) {
      const grossTotal =
        'grossTotal' in parsed && typeof parsed.grossTotal === 'number'
          ? parsed.grossTotal
          : undefined
      return { state: 'done', modificationId: parsed.modificationId, grossTotal }
    }
  } catch {
    return { state: 'pending' }
  }
  return { state: 'pending' }
}

function doneValue(modificationId: number, grossTotal: number | undefined): string {
  return JSON.stringify({ state: 'done', modificationId, grossTotal })
}

async function ledgerCall<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new BillingoError(
      'A visszatérítési főkönyv (ledger) nem érhető el, ezért a tárca nem tudja biztosan eldönteni, hogy a módosító számla elkészült-e. Új módosító számlát nem állít ki.',
      {
        category: 'store_unavailable',
        hint: 'Ellenőrizd a ledger tároló elérhetőségét; a webhook újraküldésekor a tárca folytatja.',
        cause: error,
      },
    )
  }
}

async function markDone(
  ledger: KeyValueStore,
  key: string,
  modificationId: number,
  grossTotal: number | undefined,
): Promise<void> {
  try {
    await ledger.set(key, doneValue(modificationId, grossTotal), REFUND_LEDGER_TTL_SECONDS)
  } catch (error) {
    throw new BillingoError(
      `A módosító számla elkészült (azonosító: ${modificationId}), de a visszatérítési főkönyvbe nem sikerült beírni.`,
      {
        category: 'store_unavailable',
        hint: 'Ne állítsd ki újra: a következő próbálkozás a Billingo listájából megtalálja a módosító számlát, és nem állít ki újat.',
        cause: error,
      },
    )
  }
}

export async function refundLedgerKey(
  vendorId: string,
  documentId: number,
  refundId: string,
): Promise<string> {
  const digest = await digestHex('SHA-256', `${vendorId}\n${documentId}\n${refundId}`)
  return `${REFUND_LEDGER_KEY_PREFIX}${digest}`
}

export async function refundMarker(vendorId: string, refundId: string): Promise<string> {
  const key = PLAIN_REFUND_KEY.test(refundId)
    ? refundId
    : `h${(await digestHex('SHA-256', refundId)).slice(0, 16)}`
  return `Visszatérítés ${vendorId} ${key}`
}

function assertInput(input: ModificationOnceInput): void {
  if (typeof input.ledger?.setIfAbsent !== 'function') {
    throw configurationError(
      'A módosító számla pontosan egyszeri kiállításához setIfAbsent műveletet ismerő ledger tároló kell (például Redis, Upstash, Cloudflare KV helyett Durable Object, vagy SQL tábla egyedi kulccsal). A Billingo módosító számlájának nincs vendorId-ja, és a lista 15-30 másodpercet késik, ezért tároló nélkül egy újraküldött webhook második módosító számlát állítana ki.',
    )
  }
  if (!Number.isSafeInteger(input.documentId) || input.documentId < 1) {
    throw new RangeError(`A documentId pozitív egész legyen, kapott: ${String(input.documentId)}`)
  }
  if (typeof input.vendorId !== 'string' || input.vendorId.trim() === '') {
    throw new RangeError('A vendorId nem lehet üres.')
  }
  if (typeof input.refundId !== 'string' || input.refundId.trim() === '') {
    throw new RangeError('A refundId nem lehet üres.')
  }
}

export async function relatedModifications(
  tarca: { readonly documents: Pick<DocumentsApi, 'list'> },
  original: Document,
  options: RequestOptions = {},
): Promise<Document[]> {
  const found: Document[] = []
  for (let page = 1; page <= RECOVERY_MAX_PAGES; page++) {
    const result = await tarca.documents.list(
      {
        page,
        perPage: RECOVERY_PER_PAGE,
        ...(original.partner?.id === undefined ? {} : { partnerId: original.partner.id }),
        ...(original.invoiceDate === undefined ? {} : { startDate: original.invoiceDate }),
      },
      options,
    )
    for (const document of result.data) {
      if (
        document.type === 'modification' &&
        (document.relatedDocuments ?? []).some((related) => related.id === original.id)
      ) {
        found.push(document)
      }
    }
    if (page >= result.lastPage) break
  }
  return found
}

async function findModification(
  tarca: ModificationTarca,
  documentId: number,
  marker: string,
  options: RequestOptions,
): Promise<Document | undefined> {
  const original = await tarca.documents.get(documentId, options)
  const tag = `(${marker})`
  const modifications = await relatedModifications(tarca, original, options)
  return modifications.find((document) => (document.comment ?? '').includes(tag))
}

async function recover(
  tarca: ModificationTarca,
  input: ModificationOnceInput,
  key: string,
  marker: string,
  options: RequestOptions,
  cause?: unknown,
): Promise<ModificationOnceResult> {
  const found = await findModification(tarca, input.documentId, marker, options)
  if (found?.id !== undefined) {
    await markDone(input.ledger, key, found.id, found.grossTotal)
    return {
      modificationId: found.id,
      grossTotal: found.grossTotal,
      document: found,
      created: true,
      marker,
    }
  }
  throw new BillingoError(
    `A(z) ${input.refundId} visszatérítés módosító számlájának kiállítása folyamatban van, vagy egy korábbi kísérlet kimenetele bizonytalan, és a Billingo listájában még nem látszik.`,
    {
      category: 'in_progress',
      hint: `Ne állítsd ki kézzel, és ne töröld a főkönyvi bejegyzést: a Billingo listája 15-30 másodpercet késik, a következő próbálkozás (például a webhook újraküldése) megkeresi a „${marker}” megjegyzésű módosító számlát. Ha órák múlva sincs ilyen a Billingóban, töröld a ${key} kulcsot, és az újraküldés kiállítja.`,
      cause,
    },
  )
}

function recorded(
  modificationId: number,
  grossTotal: number | undefined,
  marker: string,
): ModificationOnceResult {
  return { modificationId, grossTotal, document: undefined, created: false, marker }
}

export async function readRefundLedger(
  ledger: KeyValueStore,
  vendorId: string,
  documentId: number,
  refundId: string,
): Promise<RecordedModification | undefined> {
  const key = await refundLedgerKey(vendorId.trim(), documentId, refundId)
  const entry = parseEntry(await ledgerCall(() => ledger.get(key)))
  if (entry?.state !== 'done' || entry.modificationId === undefined) return undefined
  return { modificationId: entry.modificationId, grossTotal: entry.grossTotal }
}

async function release(ledger: KeyValueStore, key: string, value: string): Promise<void> {
  try {
    if (ledger.deleteIfEquals) await ledger.deleteIfEquals(key, value)
    else await ledger.delete(key)
  } catch {
    return
  }
}

export async function createModificationOnce(
  tarca: ModificationTarca,
  input: ModificationOnceInput,
  options: RequestOptions = {},
): Promise<ModificationOnceResult> {
  assertInput(input)
  const { ledger } = input
  const vendorId = input.vendorId.trim()
  const key = await refundLedgerKey(vendorId, input.documentId, input.refundId)
  const marker = await refundMarker(vendorId, input.refundId)
  const existing = parseEntry(await ledgerCall(() => ledger.get(key)))
  if (existing?.state === 'done' && existing.modificationId !== undefined) {
    return recorded(existing.modificationId, existing.grossTotal, marker)
  }
  if (existing) return recover(tarca, input, key, marker, options)
  const pending = JSON.stringify({ state: 'pending', at: new Date().toISOString() })
  const reserved = await ledgerCall(
    () => ledger.setIfAbsent?.(key, pending, REFUND_LEDGER_TTL_SECONDS) ?? false,
  )
  if (!reserved) {
    const current = parseEntry(await ledgerCall(() => ledger.get(key)))
    if (current?.state === 'done' && current.modificationId !== undefined) {
      return recorded(current.modificationId, current.grossTotal, marker)
    }
    return recover(tarca, input, key, marker, options)
  }
  let earlier: Document | undefined
  try {
    earlier = await findModification(tarca, input.documentId, marker, options)
  } catch (error) {
    await release(ledger, key, pending)
    throw error
  }
  if (earlier?.id !== undefined) {
    await markDone(ledger, key, earlier.id, earlier.grossTotal)
    return recorded(earlier.id, earlier.grossTotal, marker)
  }
  const comment = input.comment?.trim()
  let document: Document
  try {
    document = await tarca.documents.createModification(
      input.documentId,
      {
        items: input.items,
        comment: comment ? `${comment} (${marker})` : `(${marker})`,
        ...(input.paymentMethod === undefined ? {} : { paymentMethod: input.paymentMethod }),
      },
      options,
    )
  } catch (error) {
    if (isDocumentHookError(error) && error.document.id !== undefined) {
      await markDone(ledger, key, error.document.id, error.document.grossTotal)
      throw error
    }
    if (isBillingoError(error) && !isUncertainOutcome(error)) {
      await release(ledger, key, pending)
      throw error
    }
    return recover(tarca, input, key, marker, options, error)
  }
  if (document.id === undefined) {
    throw new BillingoError('A Billingo a módosító számlát azonosító nélkül adta vissza.', {
      category: 'unexpected_response',
      operation: 'CreateModificationDocument',
    })
  }
  await markDone(ledger, key, document.id, document.grossTotal)
  return {
    modificationId: document.id,
    grossTotal: document.grossTotal,
    document,
    created: true,
    marker,
  }
}
