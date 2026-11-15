import type { RequestOptions } from '../core/context'
import { BillingoError } from '../core/errors'
import { lineAmounts } from '../core/money'
import { toVatCode, VATS } from '../documents/enums'
import type { GrossPricedItemInput } from '../documents/input'
import type { Document, Vat } from '../generated/billingo'
import { currencyExponent, decimalToMinor, normalizeCurrency } from './amounts'
import type {
  IssueForPaymentOptions,
  PaymentDocumentItem,
  PaymentTarca,
  SkippedPayment,
} from './issue'
import { createModificationOnce, readRefundLedger, relatedModifications } from './modification'
import { allocateRefund, type RefundAllocation, type RefundableItem } from './refund'
import type { PaymentAmount, PaymentEvent, PaymentRefund } from './types'

export type PartialRefundMode = 'auto' | 'proportional' | 'skip'

export type RefundTarget = () => Promise<Document | SkippedPayment>

export interface RefundItemsContext {
  readonly refund: PaymentRefund
  readonly document: Document
  readonly items: readonly RefundableItem<Vat>[]
}

export type RefundItemsResolver = (
  context: RefundItemsContext,
) =>
  | readonly PaymentDocumentItem[]
  | undefined
  | Promise<readonly PaymentDocumentItem[] | undefined>

export interface IssuedRefundModification {
  readonly refundId: string
  readonly modificationId: number
  readonly created: boolean
  readonly amount: PaymentAmount | undefined
  readonly grossTotal: number | undefined
}

export interface IssuedModification {
  readonly kind: 'modification'
  readonly vendorId: string
  readonly originalId: number
  readonly created: boolean
  readonly modifications: readonly IssuedRefundModification[]
}

export interface RefundProposalLine {
  readonly refundId: string
  readonly amount: PaymentAmount
  readonly items: readonly RefundAllocation<Vat>[]
}

export interface IssuedRefundProposal {
  readonly kind: 'refund-proposal'
  readonly vendorId: string
  readonly document: 'receipt' | 'invoice'
  readonly documentId: number
  readonly refunds: readonly RefundProposalLine[]
  readonly reason: string
}

interface RefundContext {
  readonly document: Document
  readonly documentId: number
  readonly kind: 'receipt' | 'invoice'
  readonly currency: string
  readonly exponent: number
  readonly items: readonly RefundableItem<Vat>[]
}

const FULL_REFUND_ID = 'teljes'

const REFUND_ITEMS_HINT =
  'A refundItems a visszatérített tételeket pozitív bruttó egységárral (grossUnitPrice) adja vissza; a tárca fordítja negatívba.'

const RECEIPT_PROPOSAL_REASON =
  'A Billingo nyugtához nem ad módosító bizonylatot (nyugtát csak sztornózni lehet), ezért részleges visszatérítésnél a tárca nem állít ki automatikusan bizonylatot. A javasolt tételbontást egyeztesd a könyvelőddel (például sztornó és új nyugta a megmaradó tételekről).'

const NO_LEDGER_REASON =
  'A Billingo módosító számlájának nincs vendorId-ja, és a bizonylatlista 15-30 másodpercet késik, ezért tartós ledger tároló nélkül egy újraküldött webhook második módosító számlát állítana ki. Add meg a ledger opciót (setIfAbsent műveletet ismerő KeyValueStore), vagy állítsd ki a módosító számlát kézzel a javasolt tételekkel.'

function validation(message: string, hint?: string): BillingoError {
  return new BillingoError(message, { category: 'validation', hint })
}

function skipped(vendorId: string, reason: string): SkippedPayment {
  return { kind: 'skipped', vendorId, reason }
}

export function refundBeforeDocumentError(payment: PaymentEvent, vendorId: string): BillingoError {
  return new BillingoError(
    `A(z) ${payment.provider} visszatérítéshez (${payment.id}) még nincs kiállított bizonylat (vendorId: ${vendorId}): a fizetés eseménye valószínűleg még nem futott le, például egy korábbi hiba után újraküldésre vár.`,
    {
      category: 'in_progress',
      hint: 'A webhook 500-at ad, így a szolgáltató később újraküldi a visszatérítést; addigra a fizetés bizonylata elkészül, és a visszatérítés sztornózza vagy módosítja. Ha ehhez a fizetéshez soha nem készül bizonylat (például a tárca bevezetése előtti fizetés), kezeld kézzel, és az onPayment-ben nyugtázd ezt az in_progress hibát.',
    },
  )
}

function requestOptions(options: IssueForPaymentOptions): RequestOptions {
  return options.signal === undefined ? {} : { signal: options.signal }
}

function amountOf(minor: number, context: RefundContext): PaymentAmount {
  return {
    value: minor === 0 ? 0 : minor / 10 ** context.exponent,
    minor,
    currency: context.currency,
  }
}

function labelOf(document: Document): string {
  return document.invoiceNumber ?? String(document.id)
}

function refundableItems(document: Document, exponent: number): RefundableItem<Vat>[] | undefined {
  const items: RefundableItem<Vat>[] = []
  for (const item of document.items ?? []) {
    const grossMinor =
      item.grossAmount === undefined ? undefined : decimalToMinor(item.grossAmount, exponent)
    if (item.vat === undefined || grossMinor === undefined || grossMinor < 0) return undefined
    items.push({
      name: item.name ?? 'Tétel',
      vat: item.vat,
      grossMinor,
      ...(item.unit === undefined ? {} : { unit: item.unit }),
      ...(typeof item.sku === 'string' ? { sku: item.sku } : {}),
    })
  }
  return items.length > 0 ? items : undefined
}

function contextOf(document: Document): RefundContext {
  if (document.id === undefined) {
    throw new BillingoError('A Billingo a bizonylatot azonosító nélkül adta vissza.', {
      category: 'unexpected_response',
    })
  }
  const currency = normalizeCurrency(document.currency ?? 'HUF')
  const exponent = currencyExponent(currency)
  const items = refundableItems(document, exponent)
  if (!items) {
    throw validation(
      `A(z) ${labelOf(document)} bizonylat tételei nem olvashatók ki egyértelműen (áfakulcs, negatív vagy hiányzó összeg), így a visszatérítés nem osztható szét.`,
      'Állítsd ki a módosító számlát kézzel, vagy add meg a tételeket a refundItems opcióban.',
    )
  }
  return {
    document,
    documentId: document.id,
    kind: document.type === 'receipt' ? 'receipt' : 'invoice',
    currency,
    exponent,
    items,
  }
}

function assertRefunds(refunds: readonly PaymentRefund[], context: RefundContext): void {
  for (const refund of refunds) {
    if (typeof refund.id !== 'string' || refund.id.trim() === '') {
      throw validation('A visszatérítés azonosítója (id) üres.')
    }
    if (normalizeCurrency(refund.amount.currency) !== context.currency) {
      throw validation(
        `A(z) ${refund.id} visszatérítés pénzneme (${refund.amount.currency}) eltér a(z) ${labelOf(context.document)} bizonylatétól (${context.currency}).`,
      )
    }
  }
}

function allocationOf(refund: PaymentRefund, context: RefundContext): RefundAllocation<Vat>[] {
  return allocateRefund(context.items, refund.amount.minor, {
    refundedBeforeMinor: refund.refundedBefore?.minor,
  })
}

function proposal(
  vendorId: string,
  context: RefundContext,
  refunds: readonly PaymentRefund[],
  reason: string,
): IssuedRefundProposal {
  return {
    kind: 'refund-proposal',
    vendorId,
    document: context.kind,
    documentId: context.documentId,
    refunds: refunds.map((refund) => ({
      refundId: refund.id,
      amount: amountOf(refund.amount.minor, context),
      items: allocationOf(refund, context),
    })),
    reason,
  }
}

function mixedVatReason(rates: ReadonlySet<string>): string {
  return `Az eredeti számlán több áfakulcs van (${[...rates].join(', ')}), ezért a tárca nem tudja, melyik tétel került visszatérítésre. Add meg a refundItems opciót, vagy ha arányos szétosztás a helyes (például százalékos kedvezmény), a partialRefund: 'proportional' beállítást.`
}

function groupedLines(
  allocations: readonly RefundAllocation<Vat>[],
  context: RefundContext,
): GrossPricedItemInput[] {
  const groups = new Map<Vat, RefundAllocation<Vat>[]>()
  for (const allocation of allocations) {
    groups.set(allocation.vat, [...(groups.get(allocation.vat) ?? []), allocation])
  }
  return [...groups].map(([vat, list]) => {
    const minor = list.reduce((sum, allocation) => sum + allocation.grossMinor, 0)
    const single = list.length === 1 ? list[0] : undefined
    return {
      name: single?.name ?? `Visszatérítés (${vat})`,
      quantity: 1,
      unit: single?.unit ?? 'db',
      vat,
      grossUnitPrice: -amountOf(minor, context).value,
    }
  })
}

function customLines(
  custom: readonly PaymentDocumentItem[],
  refund: PaymentRefund,
  context: RefundContext,
): GrossPricedItemInput[] {
  let total = 0
  const lines = custom.map((item) => {
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const price = item.grossUnitPrice
    const quantity = item.quantity ?? 1
    if (name === '') throw validation('A refundItems tételének neve nem lehet üres.')
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      throw validation(
        `A refundItems „${name}” tételének nincs pozitív bruttó egységára (grossUnitPrice) a(z) ${refund.id} visszatérítésnél.`,
        REFUND_ITEMS_HINT,
      )
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw validation(
        `A refundItems „${name}” tételének mennyisége érvénytelen (${quantity}) a(z) ${refund.id} visszatérítésnél.`,
        REFUND_ITEMS_HINT,
      )
    }
    let vat: Vat
    try {
      vat = toVatCode(VATS, item.vat)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      throw validation(`A refundItems „${name}” tételének áfakulcsa hibás: ${error.message}`)
    }
    const gross = lineAmounts({ unitPrice: price, unitPriceType: 'gross', quantity, vat })
    const minor = decimalToMinor(gross.grossAmount, context.exponent)
    if (minor === undefined) {
      throw validation(
        `A refundItems „${name}” tételének összege nem írható le ${context.currency} pénznemben.`,
      )
    }
    total += minor
    return {
      name,
      quantity,
      vat,
      grossUnitPrice: -price,
      ...(item.unit === undefined ? {} : { unit: item.unit }),
    }
  })
  if (total !== refund.amount.minor) {
    throw validation(
      `A refundItems tételeinek bruttó összege (${amountOf(total, context).value}) eltér a(z) ${refund.id} visszatérítés összegétől (${refund.amount.value}).`,
      REFUND_ITEMS_HINT,
    )
  }
  return lines
}

async function refundLines(
  refund: PaymentRefund,
  context: RefundContext,
  options: IssueForPaymentOptions,
): Promise<GrossPricedItemInput[]> {
  const custom = await options.refundItems?.({
    refund,
    document: context.document,
    items: context.items,
  })
  if (custom && custom.length > 0) return customLines(custom, refund, context)
  return groupedLines(allocationOf(refund, context), context)
}

async function modifyForRefunds(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  context: RefundContext,
  refunds: readonly PaymentRefund[],
  options: IssueForPaymentOptions,
): Promise<IssuedModification | IssuedRefundProposal> {
  assertRefunds(refunds, context)
  if (context.kind === 'receipt') {
    return proposal(vendorId, context, refunds, RECEIPT_PROPOSAL_REASON)
  }
  const rates = new Set(context.items.map((item) => item.vat))
  const mode = options.partialRefund ?? 'auto'
  if (rates.size > 1 && mode === 'auto' && !options.refundItems) {
    return proposal(vendorId, context, refunds, mixedVatReason(rates))
  }
  const ledger = options.ledger
  if (!ledger) return proposal(vendorId, context, refunds, NO_LEDGER_REASON)
  const planned: { readonly refund: PaymentRefund; readonly lines: GrossPricedItemInput[] }[] = []
  for (const refund of refunds)
    planned.push({ refund, lines: await refundLines(refund, context, options) })
  const modifications: IssuedRefundModification[] = []
  for (const { refund, lines } of planned) {
    const result = await createModificationOnce(
      tarca,
      {
        documentId: context.documentId,
        vendorId,
        refundId: refund.id,
        items: lines,
        ledger,
        paymentMethod: options.method ?? payment.method,
      },
      requestOptions(options),
    )
    modifications.push({
      refundId: refund.id,
      modificationId: result.modificationId,
      created: result.created,
      amount: amountOf(-refund.amount.minor, context),
      grossTotal: result.grossTotal,
    })
  }
  return {
    kind: 'modification',
    vendorId,
    originalId: context.documentId,
    created: modifications.some((modification) => modification.created),
    modifications,
  }
}

export async function issueForPartialRefund(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  options: IssueForPaymentOptions,
  target: RefundTarget,
): Promise<IssuedModification | IssuedRefundProposal | SkippedPayment> {
  const refunds = payment.refunds ?? []
  const reason =
    options.partialRefund === 'skip'
      ? 'Részleges visszatérítés: a partialRefund: skip beállítás miatt nem készül bizonylat.'
      : refunds.length === 0
        ? `Részleges visszatérítés: a(z) ${payment.provider} esemény nem adta át tételesen a visszatérítéseket (azonosító és összeg), ezért a tárca nem tud pontosan egyszeri módosító számlát kiállítani. Állítsd ki kézzel, vagy kapcsold be a szolgáltató részletes lekérdezését.`
        : undefined
  if (reason !== undefined) {
    if (payment.includesPayment === true) await target()
    return skipped(vendorId, reason)
  }
  const document = await target()
  if ('kind' in document) return document
  if (document.cancelled === true) {
    return skipped(
      vendorId,
      `A(z) ${labelOf(document)} bizonylatot már sztornózták, ezért nem készül módosító számla.`,
    )
  }
  return modifyForRefunds(tarca, payment, vendorId, contextOf(document), refunds, options)
}

export async function issueForRemainder(
  tarca: PaymentTarca,
  payment: PaymentEvent,
  vendorId: string,
  document: Document,
  options: IssueForPaymentOptions,
): Promise<IssuedModification | IssuedRefundProposal | SkippedPayment> {
  const context = contextOf(document)
  const recorded =
    options.ledger === undefined
      ? undefined
      : await readRefundLedger(options.ledger, vendorId, context.documentId, FULL_REFUND_ID)
  if (recorded) {
    const minor =
      recorded.grossTotal === undefined
        ? undefined
        : decimalToMinor(recorded.grossTotal, context.exponent)
    return {
      kind: 'modification',
      vendorId,
      originalId: context.documentId,
      created: false,
      modifications: [
        {
          refundId: FULL_REFUND_ID,
          modificationId: recorded.modificationId,
          created: false,
          amount: minor === undefined ? undefined : amountOf(minor, context),
          grossTotal: recorded.grossTotal,
        },
      ],
    }
  }
  const total = context.items.reduce((sum, item) => sum + item.grossMinor, 0)
  const related = await relatedModifications(tarca, document, requestOptions(options))
  if (!related.complete) {
    throw validation(
      `A(z) ${labelOf(document)} számla módosító számláit a tárca nem tudta mind végignézni (a partnernek a számla kelte óta több mint 500 bizonylata van), így a teljes visszatérítés maradéka nem számolható biztosan.`,
      'Állítsd ki a módosító számlát kézzel a ténylegesen még vissza nem térített összegre.',
    )
  }
  if (related.documents.length === 0 && document.correctionType === 'modified') {
    throw new BillingoError(
      `A(z) ${labelOf(document)} számlát már módosították, de a módosító számla még nem látszik a Billingo bizonylatlistájában, így a teljes visszatérítés maradéka nem számolható.`,
      {
        category: 'in_progress',
        hint: 'A Billingo listája 15-30 másodpercet késik. A webhook 500-at ad, a szolgáltató újraküldi a visszatérítést, és akkor a tárca a már látható módosító számlával számol. Ne állíts ki kézzel módosító számlát.',
      },
    )
  }
  let modified = 0
  for (const modification of related.documents) {
    const minor =
      modification.grossTotal === undefined
        ? undefined
        : decimalToMinor(modification.grossTotal, context.exponent)
    if (minor === undefined) {
      throw validation(
        `A(z) ${labelOf(document)} számla egyik módosító számlájának végösszege nem olvasható ki, így a maradék nem számolható.`,
      )
    }
    modified += minor
  }
  const remaining = total + modified
  if (remaining <= 0) {
    return skipped(
      vendorId,
      `A(z) ${labelOf(document)} számla teljes összegét a hozzá tartozó módosító számlák már visszatérítették, ezért nem készül új bizonylat.`,
    )
  }
  if (remaining > total) {
    throw validation(
      `A(z) ${labelOf(document)} számlához összeget növelő módosító számla is tartozik, ezért a teljes visszatérítés maradéka nem osztható szét automatikusan.`,
      'Állítsd ki a módosító számlát kézzel.',
    )
  }
  const refund: PaymentRefund = {
    id: FULL_REFUND_ID,
    amount: amountOf(remaining, context),
    refundedBefore: amountOf(total - remaining, context),
  }
  return modifyForRefunds(tarca, payment, vendorId, context, [refund], options)
}
