import { lineAmounts } from '../core/money'
import { assertValid, createInputCheck } from '../documents/check'
import { RECEIPT_VATS, toVatCode } from '../documents/enums'
import type { Currency, PaymentMethod, ReceiptVat, Vat } from '../generated/billingo'
import { DEFAULT_RECEIPT_PAYMENT_METHOD, type ReceiptInput } from '../receipts/receipts'
import { receiptInputOf } from './inputs'
import type { JsonObject } from './protocol'
import { CREATE_RECEIPT_SCHEMA, RECEIPT_SCHEMA } from './schemas'
import {
  confirmationLine,
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
import {
  automaticVendorId,
  chooseBlock,
  ESTIMATE_NOTE,
  type EstimatedLine,
  estimate,
  estimateData,
  existingLine,
  issuedOutput,
  observedFailure,
  type PartnerPlan,
  type ProductLookup,
  partnerLine,
  planPartner,
  productLine,
  productLookup,
} from './tools-documents'

export const PREVIEW_RECEIPT = 'preview_receipt'
export const CREATE_RECEIPT = 'create_receipt'

interface ReceiptPlan {
  readonly input: ReceiptInput
  readonly vendorId: string
  readonly blockId: number | undefined
  readonly currency: Currency
  readonly paymentMethod: PaymentMethod
}

async function planReceipt(args: JsonObject, context: McpToolContext): Promise<ReceiptPlan> {
  const input = receiptInputOf(args)
  const currency = input.currency ?? context.defaults.currency
  const check = createInputCheck()
  check.currency(currency, input.conversionRate)
  assertValid(check, 'CreateReceipt', 'nyugtaadatok')
  return {
    input,
    vendorId: input.vendorId ?? (await automaticVendorId(CREATE_RECEIPT, args, context)),
    blockId: input.blockId ?? context.defaults.receiptBlockId,
    currency,
    paymentMethod:
      input.paymentMethod ?? context.defaults.paymentMethod ?? DEFAULT_RECEIPT_PAYMENT_METHOD,
  }
}

function signedReceipt(args: JsonObject, plan: ReceiptPlan): JsonObject {
  const { input, ...resolved } = plan
  return { ...args, resolved: plainJson(resolved) }
}

function amountVat(vat: ReceiptVat): Vat {
  return vat === 'none' ? '0%' : vat
}

async function receiptLines(input: ReceiptInput, product: ProductLookup): Promise<EstimatedLine[]> {
  const result: EstimatedLine[] = []
  for (const item of input.items) {
    const quantity = item.quantity ?? 1
    if ('productId' in item) {
      result.push(productLine(await product(item.productId), quantity, 'gross'))
      continue
    }
    const vat = amountVat(toVatCode(RECEIPT_VATS, item.vat))
    result.push({
      name: item.name,
      quantity,
      vat,
      ...lineAmounts({ unitPrice: item.grossUnitPrice, unitPriceType: 'gross', quantity, vat }),
    })
  }
  return result
}

function receiptPartnerLine(plan: PartnerPlan | undefined, name: string | undefined): string {
  if (plan) return partnerLine(plan)
  return name === undefined
    ? 'Partner nélkül: a Billingo a közös „Magánszemély” partnert teszi a nyugtára.'
    : `Partner nélkül, a nyugtán szereplő név: ${name}.`
}

async function previewReceipt(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const plan = await planReceipt(args, context)
  const { input, vendorId, currency, paymentMethod } = plan
  const tarca = context.client()
  const block = await chooseBlock(tarca, 'receipt', plan.blockId)
  const partner = input.partner === undefined ? undefined : await planPartner(tarca, input.partner)
  const result = estimate(
    await receiptLines(input, productLookup(tarca)),
    input.conversionRate ?? 1,
  )
  const existing = await tarca.documents.findByVendorId(vendorId)
  const confirmation = await context.confirmations.issue(CREATE_RECEIPT, signedReceipt(args, plan))
  return {
    summary: lines(
      `Nyugta előnézete (még NEM készült el): bruttó ${money(result.grossAmount, currency)} (${ESTIMATE_NOTE}).`,
      `Fizetési mód: ${paymentMethod}, ${input.electronic ? 'elektronikus nyugta' : 'papíron átadott nyugta'}, tömb: ${block.name} (#${block.id}). A nyugta kiállításkor fizetett.`,
      receiptPartnerLine(partner, input.name),
      `vendorId: ${vendorId}${input.vendorId === undefined ? ' (automatikus: ugyanez a bemenet ma csak egyszer állít ki nyugtát)' : ''}.`,
      existing && existingLine(existing, vendorId),
      confirmationLine(CREATE_RECEIPT, confirmation.token, confirmation.expiresAt),
    ),
    data: {
      document: 'receipt',
      paymentMethod,
      currency,
      conversionRate: input.conversionRate ?? null,
      electronic: input.electronic ?? false,
      block,
      partner: partner
        ? { action: partner.action, id: partner.id ?? null, name: partner.name }
        : null,
      name: input.name ?? null,
      vendorId,
      vendorIdSource: input.vendorId === undefined ? 'automatic' : 'given',
      existingDocument: existing ? documentSummary(existing) : null,
      ...estimateData(result),
      confirmation: confirmation.token,
      confirmationExpiresAt: confirmation.expiresAt,
    },
  }
}

async function createReceipt(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const { payload, confirmation } = splitConfirmation(args)
  const plan = await planReceipt(payload, context)
  await context.confirmations.verify(
    CREATE_RECEIPT,
    signedReceipt(payload, plan),
    confirmation,
    PREVIEW_RECEIPT,
  )
  const { tarca, errors } = context.observedClient()
  const result = await tarca.receipts.createOnce(
    { ...plan.input, vendorId: plan.vendorId },
    { recoveryDelayMs: context.recoveryDelayMs },
  )
  return issuedOutput(
    result.document,
    plan.vendorId,
    result.created,
    observedFailure(errors, 'CreateReceipt'),
  )
}

export const RECEIPT_TOOLS: readonly McpTool[] = [
  {
    name: PREVIEW_RECEIPT,
    title: 'Nyugta előnézete',
    description:
      'Ellenőrzi egy nyugta adatait, kiválasztja a nyugtatömböt, megnézi a partnert és a vendorId-t, kiszámolja a végösszeg becslését, és ad egy megerősítő kódot a create_receipt eszközhöz. Nyugtán bruttó egységár szerepel, az áfa 5, 18, 27, none, AAM vagy TAM. Csak olvas, semmit nem állít ki.',
    inputSchema: RECEIPT_SCHEMA,
    annotations: REMOTE_READ,
    write: false,
    run: previewReceipt,
  },
  {
    name: CREATE_RECEIPT,
    title: 'Nyugta kiállítása',
    description:
      'Kiállítja a nyugtát a Billingóban. Csak a preview_receipt megerősítő kódjával működik, pontosan ugyanazokkal az adatokkal, és csak a felhasználó jóváhagyása után hívd. Egy vendorId-val (vagy vendorId nélkül ugyanazzal a bemenettel ugyanazon a napon) csak egy nyugta készül.',
    inputSchema: CREATE_RECEIPT_SCHEMA,
    annotations: REMOTE_CREATE,
    write: true,
    run: createReceipt,
  },
]
