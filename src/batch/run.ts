import { isPlainObject } from '../core/case'
import { sleep } from '../core/context'
import { isDocumentHookError } from '../core/document-events'
import {
  BillingoError,
  type BillingoErrorCategory,
  configurationError,
  isBillingoError,
} from '../core/errors'
import { roundHalfUp } from '../core/money'
import type { OnceLockOptions } from '../core/once-guard'
import { type ResolvedDefaults, resolveDefaults, type TarcaDefaults } from '../documents/defaults'
import type { DocumentsApi } from '../documents/documents'
import type { DocumentInput } from '../documents/input'
import type { CreateOnceOptions, DocumentOnceResult } from '../documents/once'
import type { Currency, Document } from '../generated/billingo'
import type { PartnerInput } from '../partners/partners'
import type { ReceiptInput, ReceiptsApi } from '../receipts/receipts'
import { checkDocument, checkReceipt, type DryRunEstimate } from './dry-run'

export const MAX_BATCH_CONCURRENCY = 4
export const DEFAULT_BATCH_RATE_PER_MINUTE = 30
export const MAX_BATCH_RATE_PER_MINUTE = 60

export type BatchKind = 'invoice' | 'receipt'

export type BatchDocument =
  | { readonly kind: 'invoice'; readonly input: DocumentInput }
  | { readonly kind: 'receipt'; readonly input: ReceiptInput }

export interface BatchItem {
  readonly key: string
  readonly document: () => BatchDocument | Promise<BatchDocument>
}

export type BatchItemStatus = 'created' | 'existing' | 'validated' | 'failed' | 'skipped'

export interface BatchItemResult {
  readonly key: string
  readonly status: BatchItemStatus
  readonly kind?: BatchKind | undefined
  readonly document?: Document | undefined
  readonly number?: string | undefined
  readonly grossTotal?: number | undefined
  readonly currency?: Currency | undefined
  readonly error?: unknown
  readonly reason?: string | undefined
}

export interface BatchProgress {
  readonly total: number
  readonly done: number
  readonly created: number
  readonly existing: number
  readonly validated: number
  readonly failed: number
  readonly skipped: number
  readonly key: string
  readonly status: BatchItemStatus
}

export interface BatchStop {
  readonly reason: string
  readonly error?: unknown
}

export type BatchGrossTotals = Readonly<Partial<Record<Currency, number>>>

export interface BatchResult {
  readonly dryRun: boolean
  readonly items: readonly BatchItemResult[]
  readonly created: readonly BatchItemResult[]
  readonly existing: readonly BatchItemResult[]
  readonly validated: readonly BatchItemResult[]
  readonly failed: readonly BatchItemResult[]
  readonly skipped: readonly BatchItemResult[]
  readonly stopped?: BatchStop | undefined
  readonly grossTotals: BatchGrossTotals
}

export interface BatchApi {
  readonly documents: Pick<DocumentsApi, 'createOnce' | 'findByVendorId'>
  readonly receipts: Pick<ReceiptsApi, 'createOnce'>
}

export interface BatchJournal {
  track(vendorId: string, run: () => Promise<DocumentOnceResult>): Promise<DocumentOnceResult>
}

export type BatchOnceOptions = Omit<OnceLockOptions, 'signal'>

export interface RunBatchOptions {
  readonly items: readonly BatchItem[]
  readonly concurrency?: number | undefined
  readonly ratePerMinute?: number | undefined
  readonly dryRun?: boolean | undefined
  readonly defaults?: TarcaDefaults | undefined
  readonly journal?: BatchJournal | undefined
  readonly once?: BatchOnceOptions | undefined
  readonly signal?: AbortSignal | undefined
  readonly onProgress?: ((progress: BatchProgress) => void) | undefined
  readonly recoveryDelayMs?: number | undefined
  readonly now?: (() => Date) | undefined
}

const STOP_REASONS: Readonly<Partial<Record<BillingoErrorCategory, string>>> = {
  rate_limit:
    'A Billingo 429-cel válaszolt (túl sok kérés). Írást a tárca nem ismétel: várj legalább egy percet, és futtasd újra ugyanazokkal a kulcsokkal, a már kiállított tételeket nem állítja ki újra.',
  auth: 'A Billingo nem fogadta el az API kulcsot (401).',
  forbidden:
    'A Billingo megtagadta a műveletet (403): a kulcs csak olvasásra jogosult, vagy egy másik céghez tartozik.',
  subscription:
    'Az előfizetés nem engedi a kiállítást (402): hiányzik az „API + Tömeges” kiegészítő, vagy elfogyott a havi írási keret.',
  configuration: 'Hibás beállítás, a többi tétel is ugyanígy bukna.',
  store_unavailable: 'A createOnce zár tárolója nem érhető el, zár nélkül a tárca nem állít ki.',
}

const ABORTED = 'A batch futását megszakították.'
const IN_PROGRESS =
  'Egy másik folyamat éppen kiállítja ezt a tételt. Futtasd újra később: a kész bizonylatot a vendorId alapján megtalálja.'
const NOT_RUN = 'Nem futott le.'

function invalid(message: string, field: string): BillingoError {
  return new BillingoError(message, {
    category: 'validation',
    fieldErrors: [{ field, message }],
    hint: 'A batch egyetlen kérést sem küldött.',
  })
}

function resolveConcurrency(value: number | undefined): number {
  if (value === undefined) return 1
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_CONCURRENCY) {
    throw configurationError(
      `A concurrency 1 és ${MAX_BATCH_CONCURRENCY} közötti egész legyen, kapott: ${String(value)}. A Billingo kulcsonként 300 kérést enged percenként, ezen a webhookok is osztoznak.`,
    )
  }
  return value
}

function resolveRate(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BATCH_RATE_PER_MINUTE
  if (!Number.isFinite(value) || value <= 0 || value > MAX_BATCH_RATE_PER_MINUTE) {
    throw configurationError(
      `A ratePerMinute 0-nál nagyobb, legfeljebb ${MAX_BATCH_RATE_PER_MINUTE} legyen, kapott: ${String(value)}. Egy tétel 2–6 kérés a 300/perc keretből.`,
    )
  }
  return value
}

function resolveRecoveryDelay(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0) {
    throw configurationError(`A recoveryDelayMs nemnegatív szám legyen, kapott: ${String(value)}`)
  }
  return value
}

function resolveKeys(items: readonly BatchItem[]): string[] {
  const seen = new Set<string>()
  return items.map((item, index) => {
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const field = `items.${index}.key`
    if (!key) throw invalid('Minden tételhez adj meg kulcsot (key), ez lesz a vendorId.', field)
    if (seen.has(key)) throw invalid(`A(z) ${key} kulcs kétszer szerepel a listában.`, field)
    seen.add(key)
    return key
  })
}

function checkedDocument(document: BatchDocument, key: string): BatchDocument {
  if (document?.kind !== 'invoice' && document?.kind !== 'receipt') {
    throw invalid(
      `A(z) ${key} tétel document() függvénye { kind: 'invoice' | 'receipt', input } alakú objektumot adjon.`,
      'kind',
    )
  }
  const own = document.input.vendorId?.trim()
  if (own && own !== key) {
    throw invalid(
      `A(z) ${key} tétel vendorId-ja (${own}) eltér a kulcstól. A batch a kulcsot használja vendorId-ként, hogy az újrafuttatás ne állítson ki duplát.`,
      'vendorId',
    )
  }
  return document
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((name) => value[name] !== undefined)
      .map((name) => [name, canonical(value[name])]),
  )
}

function partnerKey(partner: PartnerInput): string {
  const address: unknown = partner.address
  return JSON.stringify(
    canonical({
      ...partner,
      address: isPlainObject(address)
        ? { ...address, countryCode: address.countryCode ?? 'HU' }
        : address,
    }),
  )
}

interface IssueOutcome {
  readonly result: DocumentOnceResult
  readonly error?: unknown
}

interface PartnerClaim {
  readonly id: number | undefined
  settle(id: number | undefined): void
}

function createPartnerCache(): (partner: PartnerInput) => Promise<PartnerClaim> {
  const slots = new Map<string, Promise<number | undefined>>()
  return async (partner) => {
    const key = partnerKey(partner)
    for (;;) {
      const pending = slots.get(key)
      if (!pending) break
      const id = await pending
      if (id !== undefined) return { id, settle: () => undefined }
    }
    let resolve: (id: number | undefined) => void = () => undefined
    const slot = new Promise<number | undefined>((settle) => {
      resolve = settle
    })
    slots.set(key, slot)
    return {
      id: undefined,
      settle(id) {
        if (id === undefined && slots.get(key) === slot) slots.delete(key)
        resolve(id)
      },
    }
  }
}

function stopOf(error: unknown): BatchStop | undefined {
  if (!isBillingoError(error)) return undefined
  const text = STOP_REASONS[error.category]
  if (text === undefined) return undefined
  return {
    reason: `A batch leállt (${error.category}): ${text} A hátralévő tételek nem futottak le.`,
    error,
  }
}

function issuedResult(
  key: string,
  kind: BatchKind,
  status: BatchItemStatus,
  document: Document,
): BatchItemResult {
  return {
    key,
    status,
    kind,
    document,
    number: document.invoiceNumber || undefined,
    grossTotal: document.grossTotal,
    currency: document.currency,
  }
}

function totalsOf(results: readonly BatchItemResult[]): BatchGrossTotals {
  const sums = new Map<Currency, number>()
  for (const result of results) {
    if (result.status === 'failed' || result.status === 'skipped') continue
    if (result.grossTotal === undefined || result.currency === undefined) continue
    sums.set(result.currency, (sums.get(result.currency) ?? 0) + result.grossTotal)
  }
  return Object.fromEntries([...sums].map(([currency, sum]) => [currency, roundHalfUp(sum, 2)]))
}

export async function runBatch(api: BatchApi, options: RunBatchOptions): Promise<BatchResult> {
  const concurrency = resolveConcurrency(options.concurrency)
  const intervalMs = 60_000 / resolveRate(options.ratePerMinute)
  const recoveryDelayMs = resolveRecoveryDelay(options.recoveryDelayMs)
  const defaults: ResolvedDefaults = resolveDefaults(options.defaults)
  const keys = resolveKeys(options.items)
  const dryRun = options.dryRun === true
  const { signal, journal } = options
  const clock = options.now ?? ((): Date => new Date())
  const onceOptions: CreateOnceOptions = {
    lock: options.once?.lock,
    lockTtlSeconds: options.once?.lockTtlSeconds,
    lockWaitMs: options.once?.lockWaitMs,
    lockFailure: options.once?.lockFailure,
    recoveryDelayMs,
  }
  const claimPartner = createPartnerCache()
  const total = options.items.length
  const results: (BatchItemResult | undefined)[] = new Array(total)
  const counts: Record<BatchItemStatus, number> = {
    created: 0,
    existing: 0,
    validated: 0,
    failed: 0,
    skipped: 0,
  }
  const control: { stopped: BatchStop | undefined } = { stopped: undefined }
  const currentStop = (): BatchStop | undefined => control.stopped
  let done = 0
  let cursor = 0
  let nextStart = clock().getTime()

  const record = (index: number, result: BatchItemResult): void => {
    results[index] = result
    counts[result.status] += 1
    done += 1
    try {
      const pending: unknown = options.onProgress?.({
        total,
        done,
        ...counts,
        key: result.key,
        status: result.status,
      })
      if (pending instanceof Promise) pending.catch(() => undefined)
    } catch {
      return
    }
  }

  const validate = async (document: BatchDocument, key: string): Promise<BatchItemResult> => {
    const estimate: DryRunEstimate =
      document.kind === 'invoice'
        ? checkDocument({ ...document.input, vendorId: key }, defaults)
        : checkReceipt({ ...document.input, vendorId: key }, defaults)
    const existing = await api.documents.findByVendorId(key)
    if (existing) return issuedResult(key, document.kind, 'existing', existing)
    return { key, status: 'validated', kind: document.kind, ...estimate }
  }

  const createOnce = (
    document: BatchDocument,
    key: string,
    partner: { readonly partner?: number },
  ): Promise<DocumentOnceResult> =>
    document.kind === 'invoice'
      ? api.documents.createOnce({ ...document.input, ...partner, vendorId: key }, onceOptions)
      : api.receipts.createOnce({ ...document.input, ...partner, vendorId: key }, onceOptions)

  const issueTracked = async (
    document: BatchDocument,
    key: string,
    partner: { readonly partner?: number },
  ): Promise<IssueOutcome> => {
    const issued: { result?: DocumentOnceResult } = {}
    const run = async (): Promise<DocumentOnceResult> => {
      issued.result = await createOnce(document, key, partner)
      return issued.result
    }
    try {
      return { result: journal ? await journal.track(key, run) : await run() }
    } catch (error) {
      if (issued.result) return { result: issued.result, error }
      if (isDocumentHookError(error)) {
        return { result: { document: error.document, created: true }, error }
      }
      throw error
    }
  }

  const issue = async (document: BatchDocument, key: string): Promise<BatchItemResult> => {
    const inline = document.input.partner
    const claim =
      typeof inline === 'object' && inline !== null ? await claimPartner(inline) : undefined
    let partnerId: number | undefined
    try {
      const partner = claim?.id === undefined ? {} : { partner: claim.id }
      const { result, error } = await issueTracked(document, key, partner)
      if (result.created) partnerId = result.document.partner?.id
      const issued = issuedResult(
        key,
        document.kind,
        result.created ? 'created' : 'existing',
        result.document,
      )
      return error === undefined ? issued : { ...issued, error }
    } finally {
      claim?.settle(partnerId)
    }
  }

  const processItem = async (index: number, item: BatchItem, key: string): Promise<void> => {
    let kind: BatchKind | undefined
    try {
      const document = checkedDocument(await item.document(), key)
      kind = document.kind
      record(index, dryRun ? await validate(document, key) : await issue(document, key))
    } catch (error) {
      if (signal?.aborted && error === signal.reason) {
        control.stopped ??= { reason: ABORTED, error }
        record(index, { key, status: 'skipped', kind, reason: ABORTED })
        return
      }
      if (isBillingoError(error) && error.category === 'in_progress') {
        record(index, { key, status: 'skipped', kind, error, reason: IN_PROGRESS })
        return
      }
      const stop = stopOf(error)
      if (stop) control.stopped ??= stop
      record(index, { key, status: 'failed', kind, error })
    }
  }

  const worker = async (): Promise<void> => {
    for (;;) {
      if (control.stopped || signal?.aborted) return
      const index = cursor
      cursor += 1
      const item = options.items[index]
      const key = keys[index]
      if (!item || key === undefined) return
      const current = clock().getTime()
      const delay = nextStart - current
      nextStart = Math.max(nextStart, current) + intervalMs
      if (delay > 0) {
        try {
          await sleep(delay, signal)
        } catch (error) {
          control.stopped ??= { reason: ABORTED, error }
          record(index, { key, status: 'skipped', reason: ABORTED })
          return
        }
      }
      const stop = currentStop()
      if (stop) {
        record(index, { key, status: 'skipped', reason: stop.reason })
        return
      }
      await processItem(index, item, key)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
  if (signal?.aborted) control.stopped ??= { reason: ABORTED, error: signal.reason }
  keys.forEach((key, index) => {
    if (results[index]) return
    record(index, { key, status: 'skipped', reason: control.stopped?.reason ?? NOT_RUN })
  })
  const items = results.filter((result): result is BatchItemResult => result !== undefined)
  const by = (status: BatchItemStatus): BatchItemResult[] =>
    items.filter((result) => result.status === status)
  return {
    dryRun,
    items,
    created: by('created'),
    existing: by('existing'),
    validated: by('validated'),
    failed: by('failed'),
    skipped: by('skipped'),
    stopped: control.stopped,
    grossTotals: totalsOf(items),
  }
}
