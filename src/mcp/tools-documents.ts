import type { Tarca } from '../client'
import type { ErrorEvent } from '../core/context'
import { todayInBudapest } from '../core/dates'
import { nullIfNotFound } from '../core/errors'
import { documentTotals, type LineAmounts, lineAmounts } from '../core/money'
import { isUncertainOutcome } from '../core/once-guard'
import type { OperationId } from '../core/operations'
import type { BlockKind } from '../documents/defaults'
import { toVatCode, VATS } from '../documents/enums'
import {
  type DocumentBody,
  type DocumentInput,
  type DocumentOnceInput,
  prepareDocument,
} from '../documents/input'
import { isDuplicateVendorId } from '../documents/once'
import type { Document, DocumentBlock, Product, Vat } from '../generated/billingo'
import { matchesPartner, type PartnerInput } from '../partners/partners'
import { ToolInputError } from './arguments'
import { idempotencyKey } from './confirmation'
import { documentInputOf } from './inputs'
import type { JsonObject } from './protocol'
import { CREATE_DOCUMENT_SCHEMA, DOCUMENT_SCHEMA } from './schemas'
import {
  confirmationLine,
  describeDocument,
  documentLabel,
  documentSummary,
  lines,
  type McpTool,
  type McpToolContext,
  type McpToolOutput,
  money,
  plainJson,
  REMOTE_CREATE,
  REMOTE_READ,
  splitConfirmation,
} from './tool-kit'

export const PREVIEW_DOCUMENT = 'preview_document'
export const CREATE_DOCUMENT = 'create_document'

export const ESTIMATE_NOTE = 'becslés: a végleges összeget a Billingo számolja'

export interface BlockChoice {
  readonly id: number
  readonly name: string
  readonly prefix: string
}

export async function chooseBlock(
  tarca: Tarca,
  kind: BlockKind,
  configured: number | undefined,
): Promise<BlockChoice> {
  const blocks = (await tarca.documentBlocks.list({ perPage: 100 })).data
  const found: DocumentBlock | undefined =
    configured === undefined
      ? blocks.find((block) => block.type === kind)
      : blocks.find((block) => block.id === configured)
  const label = kind === 'invoice' ? 'számla' : 'nyugta'
  if (found?.id === undefined) {
    throw new ToolInputError(
      configured === undefined
        ? `Nincs ${label} típusú („${kind}”) bizonylattömb a Billingo fiókban. Hozz létre egyet a Billingo felületén.`
        : `Nincs ${configured} azonosítójú bizonylattömb a fiókban. A get_profile eszköz listázza a tömböket.`,
      { fields: ['blockId'] },
    )
  }
  if (found.type !== kind) {
    throw new ToolInputError(
      `A(z) ${found.id} azonosítójú tömb („${found.name ?? ''}”) ${found.type ?? '?'} típusú, ide ${label} típusú („${kind}”) tömb kell.`,
      { fields: ['blockId'] },
    )
  }
  return { id: found.id, name: found.name ?? '', prefix: found.prefix ?? '' }
}

export type PartnerAction = 'existing' | 'reuse' | 'create'

export interface PartnerPlan {
  readonly action: PartnerAction
  readonly id: number | undefined
  readonly name: string
}

export async function planPartner(
  tarca: Tarca,
  partner: number | PartnerInput,
): Promise<PartnerPlan> {
  if (typeof partner === 'number') {
    const found = await nullIfNotFound(tarca.partners.get(partner))
    if (!found) {
      throw new ToolInputError(
        `Nincs ${partner} azonosítójú partner. A list_partners eszközzel keresheted meg.`,
        { fields: ['partnerId'] },
      )
    }
    return { action: 'existing', id: partner, name: found.name }
  }
  const candidates = await tarca.partners.list({ query: partner.name, perPage: 100 })
  const match = candidates.data.find((candidate) => matchesPartner(partner, candidate))
  return match?.id === undefined
    ? { action: 'create', id: undefined, name: partner.name }
    : { action: 'reuse', id: match.id, name: match.name }
}

export function partnerLine(plan: PartnerPlan): string {
  if (plan.action === 'existing') return `Partner: ${plan.name} (#${plan.id ?? '?'}).`
  if (plan.action === 'reuse') {
    return `Partner: ${plan.name}. Minden megadott adatában egyező partner már van (#${plan.id ?? '?'}), azt használja.`
  }
  return `Partner: ${plan.name}. Egyező meglévő partner nincs, ezért a kiállításkor új partner jön létre. (A Billingo keresője kb. egy percig nem látja a frissen létrehozott partnert.)`
}

export type ProductLookup = (id: number) => Promise<Product>

export function productLookup(tarca: Tarca): ProductLookup {
  const cache = new Map<number, Promise<Product>>()
  return (id) => {
    let pending = cache.get(id)
    if (!pending) {
      pending = nullIfNotFound(tarca.products.get(id)).then((product) => {
        if (product) return product
        throw new ToolInputError(
          `Nincs ${id} azonosítójú termék. A list_products eszköz listázza a termékeket.`,
          { fields: ['productId'] },
        )
      })
      cache.set(id, pending)
    }
    return pending
  }
}

export interface EstimatedLine extends LineAmounts {
  readonly name: string
  readonly quantity: number
  readonly vat: Vat
}

export interface Estimate {
  readonly lines: readonly EstimatedLine[]
  readonly netAmount: number
  readonly vatAmount: number
  readonly grossAmount: number
}

export function estimate(lineList: readonly EstimatedLine[], conversionRate: number): Estimate {
  const totals = documentTotals(lineList, conversionRate)
  return {
    lines: lineList,
    netAmount: totals.summary.netAmount,
    vatAmount: totals.summary.vatAmount,
    grossAmount: totals.grossTotal,
  }
}

export function estimateData(result: Estimate): JsonObject {
  return {
    items: result.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      vat: line.vat,
      netUnitAmount: line.netUnitAmount,
      netAmount: line.netAmount,
      vatAmount: line.vatAmount,
      grossAmount: line.grossAmount,
    })),
    totals: {
      netAmount: result.netAmount,
      vatAmount: result.vatAmount,
      grossAmount: result.grossAmount,
      estimate: true,
    },
  }
}

export function productLine(
  product: Product,
  quantity: number,
  unitPriceType: 'net' | 'gross',
): EstimatedLine {
  const unitPrice = unitPriceType === 'net' ? product.netUnitPrice : product.grossUnitPrice
  if (unitPrice === undefined) {
    throw new ToolInputError(
      `A(z) „${product.name}” terméknek nincs ${unitPriceType === 'net' ? 'nettó' : 'bruttó'} ára a Billingóban, így az összeg nem becsülhető.`,
      { fields: ['productId'] },
    )
  }
  return {
    name: product.name,
    quantity,
    vat: product.vat,
    ...lineAmounts({ unitPrice, unitPriceType, quantity, vat: product.vat }),
  }
}

async function documentLines(
  input: DocumentInput,
  product: ProductLookup,
): Promise<EstimatedLine[]> {
  const result: EstimatedLine[] = []
  for (const item of input.items) {
    if ('productId' in item) {
      result.push(productLine(await product(item.productId), item.quantity, 'net'))
      continue
    }
    const vat = toVatCode(VATS, item.vat)
    const price =
      item.netUnitPrice === undefined
        ? { unitPrice: item.grossUnitPrice, unitPriceType: 'gross' as const }
        : { unitPrice: item.netUnitPrice, unitPriceType: 'net' as const }
    result.push({
      name: item.name,
      quantity: item.quantity,
      vat,
      ...lineAmounts({ ...price, quantity: item.quantity, vat }),
    })
  }
  return result
}

export async function automaticVendorId(
  action: string,
  payload: JsonObject,
  context: McpToolContext,
): Promise<string> {
  return `MCP-${await idempotencyKey(action, todayInBudapest(context.now()), payload)}`
}

export function existingLine(document: Document, vendorId: string): string {
  const cancelled = document.cancelled
    ? ' Ez a bizonylat már sztornózva van; újra kiállítani csak új vendorId-val lehet.'
    : ''
  return `Ezzel a vendorId-val (${vendorId}) már létezik bizonylat: ${describeDocument(document)} A kiállító eszköz nem állít ki újat, ezt adja vissza.${cancelled}`
}

interface DocumentPlan {
  readonly input: DocumentInput
  readonly invoiceDate: string
  readonly body: DocumentBody
  readonly vendorId: string
}

async function planDocument(args: JsonObject, context: McpToolContext): Promise<DocumentPlan> {
  const input = documentInputOf(args)
  const now = context.now()
  const { body } = prepareDocument(input, context.defaults, 'CreateDocument', { now })
  return {
    input,
    invoiceDate: todayInBudapest(now),
    body,
    vendorId: input.vendorId ?? (await automaticVendorId(CREATE_DOCUMENT, args, context)),
  }
}

function signedDocument(args: JsonObject, plan: DocumentPlan, context: McpToolContext): JsonObject {
  return {
    ...args,
    resolved: plainJson({
      invoiceDate: plan.invoiceDate,
      blockId: plan.input.blockId ?? context.defaults.blockId,
      body: plan.body,
    }),
  }
}

async function previewDocument(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const plan = await planDocument(args, context)
  const { input, body, vendorId } = plan
  const tarca = context.client()
  const block = await chooseBlock(tarca, 'invoice', input.blockId ?? context.defaults.blockId)
  const partner = await planPartner(tarca, input.partner)
  const result = estimate(
    await documentLines(input, productLookup(tarca)),
    body.conversionRate ?? 1,
  )
  const existing = await tarca.documents.findByVendorId(vendorId)
  const currency = body.currency ?? 'HUF'
  const warnings = [
    ...(input.advanceInvoiceIds === undefined
      ? []
      : [
          'Végszámla: az előlegszámlák levonását a Billingo teszi hozzá, a becslés ezt nem tartalmazza.',
        ]),
    ...(input.type === 'proforma'
      ? [
          'Díjbekérő: a díjcsomagtól függően a Billingo 402-es hibát adhat (díjbekérőhöz Basic csomag kell).',
        ]
      : []),
  ]
  const confirmation = await context.confirmations.issue(
    CREATE_DOCUMENT,
    signedDocument(args, plan, context),
  )
  const label = documentLabel(input.type ?? 'invoice')
  return {
    summary: lines(
      `${label} előnézete (még NEM készült el): ${partner.name}, nettó ${money(result.netAmount, currency)}, bruttó ${money(result.grossAmount, currency)} (${ESTIMATE_NOTE}).`,
      `Kelte: ${plan.invoiceDate} (a kiállítás napja), teljesítés: ${body.fulfillmentDate}, fizetési határidő: ${body.dueDate}, fizetési mód: ${body.paymentMethod}, tömb: ${block.name} (#${block.id}).`,
      partnerLine(partner),
      body.settings?.shouldSendEmail === true
        ? 'A Billingo e-mailben elküldi a vevőnek.'
        : 'A vevő nem kap e-mailt a Billingótól.',
      `vendorId: ${vendorId}${input.vendorId === undefined ? ' (automatikus: ugyanez a bemenet ma csak egyszer állít ki bizonylatot)' : ''}.`,
      existing && existingLine(existing, vendorId),
      ...warnings,
      confirmationLine(CREATE_DOCUMENT, confirmation.token, confirmation.expiresAt),
    ),
    data: {
      document: input.type ?? 'invoice',
      invoiceDate: plan.invoiceDate,
      fulfillmentDate: body.fulfillmentDate,
      dueDate: body.dueDate,
      paymentMethod: body.paymentMethod,
      currency,
      conversionRate: body.conversionRate ?? null,
      language: body.language,
      electronic: body.electronic,
      sendEmail: body.settings?.shouldSendEmail === true,
      orderNumber: input.orderNumber ?? null,
      comment: input.comment ?? null,
      bankAccountId: body.bankAccountId ?? null,
      block,
      partner: { action: partner.action, id: partner.id ?? null, name: partner.name },
      vendorId,
      vendorIdSource: input.vendorId === undefined ? 'automatic' : 'given',
      existingDocument: existing ? documentSummary(existing) : null,
      ...estimateData(result),
      warnings,
      confirmation: confirmation.token,
      confirmationExpiresAt: confirmation.expiresAt,
    },
  }
}

export function observedFailure(
  errors: readonly ErrorEvent[],
  operation: OperationId,
): { readonly uncertain: boolean; readonly duplicate: boolean } {
  const own = errors.filter((event) => event.operation === operation)
  return {
    uncertain: own.some((event) => isUncertainOutcome(event.error)),
    duplicate: own.some((event) => isDuplicateVendorId(event.error)),
  }
}

export function issuedOutput(
  document: Document,
  vendorId: string,
  created: boolean,
  failure: { readonly uncertain: boolean; readonly duplicate: boolean },
): McpToolOutput {
  const description = describeDocument(document)
  const summary = created
    ? lines(
        `Kiállítva: ${description}`,
        failure.uncertain &&
          'A Billingo válasza elveszett vagy bizonytalan volt, de a tárca a vendorId alapján visszakereste: a bizonylat létrejött, pontosan egyszer.',
      )
    : lines(
        `Ezzel a vendorId-val (${vendorId}) már létezik bizonylat: ${description} Nem állítottam ki újra.`,
        failure.duplicate && 'Egy párhuzamos hívás közben kiállította, a tárca azt adja vissza.',
        document.cancelled &&
          'A bizonylat sztornózva van. Ha valóban újra ki kell állítani, adj meg új vendorId-t.',
        'Ha valóban még egy ugyanilyen bizonylat kell, adj meg eltérő vendorId-t.',
      )
  return {
    summary,
    data: {
      created,
      recovered: created && failure.uncertain,
      vendorId,
      document: documentSummary(document),
    },
  }
}

async function createDocument(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const { payload, confirmation } = splitConfirmation(args)
  const plan = await planDocument(payload, context)
  await context.confirmations.verify(
    CREATE_DOCUMENT,
    signedDocument(payload, plan, context),
    confirmation,
    PREVIEW_DOCUMENT,
  )
  const { vendorId } = plan
  const { dueInDays, ...rest } = plan.input
  const input: DocumentOnceInput = {
    ...rest,
    vendorId,
    fulfillmentDate: plan.body.fulfillmentDate,
    dueDate: plan.body.dueDate,
  }
  const { tarca, errors } = context.observedClient()
  const result = await tarca.documents.createOnce(input, {
    recoveryDelayMs: context.recoveryDelayMs,
  })
  return issuedOutput(
    result.document,
    vendorId,
    result.created,
    observedFailure(errors, 'CreateDocument'),
  )
}

export const DOCUMENT_TOOLS: readonly McpTool[] = [
  {
    name: PREVIEW_DOCUMENT,
    title: 'Számla előnézete',
    description:
      'Ellenőrzi egy számla, díjbekérő vagy előlegszámla adatait (a tárca saját ellenőrzésével, magyar mezőhibákkal), kiválasztja a számlatömböt, megnézi, hogy a partner meglévő vagy új lesz-e, és hogy a vendorId-val van-e már bizonylat, kiszámolja a tételek és a végösszeg becslését, és ad egy megerősítő kódot a create_document eszközhöz. Csak olvas, semmit nem állít ki.',
    inputSchema: DOCUMENT_SCHEMA,
    annotations: REMOTE_READ,
    write: false,
    run: previewDocument,
  },
  {
    name: CREATE_DOCUMENT,
    title: 'Számla kiállítása',
    description:
      'Kiállítja a számlát, díjbekérőt vagy előlegszámlát a Billingóban. Csak a preview_document megerősítő kódjával működik, pontosan ugyanazokkal az adatokkal, és csak a felhasználó jóváhagyása után hívd. Egy vendorId-val (vagy vendorId nélkül ugyanazzal a bemenettel ugyanazon a napon) csak egy bizonylat készül; a kiállított számlát a Billingo jelenti a NAV-nak, törölni nem, csak sztornózni lehet.',
    inputSchema: CREATE_DOCUMENT_SCHEMA,
    annotations: REMOTE_CREATE,
    write: true,
    run: createDocument,
  },
]
