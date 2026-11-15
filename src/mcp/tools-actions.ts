import type { Tarca } from '../client'
import { sleep } from '../core/context'
import { todayInBudapest } from '../core/dates'
import { isBillingoError, withHint } from '../core/errors'
import { roundHalfUp } from '../core/money'
import { isUncertainOutcome } from '../core/once-guard'
import { PAYMENT_METHODS } from '../documents/enums'
import type { PaymentInput } from '../documents/payments'
import type { Document, DocumentType, PaymentHistory } from '../generated/billingo'
import {
  assertKnownKeys,
  optionalDate,
  optionalEnum,
  optionalString,
  requiredId,
  stringList,
  ToolInputError,
} from './arguments'
import { MAX_EMAILS } from './inputs'
import type { JsonObject } from './protocol'
import {
  CONFIRMATION_PROPERTY,
  DATE_PROPERTY,
  EMAILS_PROPERTY,
  ID_PROPERTY,
  objectSchema,
  PAYMENT_METHOD_PROPERTY,
  TEXT_PROPERTY,
} from './schemas'
import {
  confirmationLine,
  describeDocument,
  documentSummary,
  documentTitle,
  lines,
  type McpTool,
  type McpToolContext,
  type McpToolOutput,
  money,
  plainJson,
  REMOTE_CANCEL,
  REMOTE_CREATE,
  REMOTE_READ,
  REMOTE_SEND,
  splitConfirmation,
} from './tool-kit'

export const PREVIEW_CANCELLATION = 'preview_cancellation'
export const CANCEL_DOCUMENT = 'cancel_document'
export const PREVIEW_PAYMENT = 'preview_payment'
export const MARK_DOCUMENT_PAID = 'mark_document_paid'
export const PREVIEW_SEND = 'preview_send'
export const SEND_DOCUMENT = 'send_document'

const CANCELLABLE: readonly DocumentType[] = ['invoice', 'advance', 'receipt']
const PAYABLE: readonly DocumentType[] = ['invoice', 'advance', 'modification']
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export function unknownDocumentMessage(id: number): string {
  return `Nincs ${id} azonosítójú bizonylat, vagy nem ehhez a céghez tartozik (a Billingo ilyenkor 403-at ad, nem 404-et).`
}

export async function documentById(tarca: Tarca, id: number): Promise<Document> {
  try {
    return await tarca.documents.get(id)
  } catch (error) {
    if (isBillingoError(error) && error.category === 'forbidden') {
      throw new ToolInputError(unknownDocumentMessage(id), { fields: ['id'] })
    }
    throw error
  }
}

function refused(message: string): ToolInputError {
  return new ToolInputError(message, { category: 'refused', fields: ['id'] })
}

function cancelRefusal(document: Document): string | undefined {
  const title = documentTitle(document)
  switch (document.type) {
    case 'cancellation':
    case 'receipt_cancellation':
      return `${title} maga is sztornó bizonylat, nem sztornózható.`
    case 'modification':
      return `${title} módosító számla: a Billingo sem ezt, sem az eredeti számlát nem engedi sztornózni (400). Helyesbíteni újabb módosító számlával lehet (a Billingo felületén vagy a tárca documents.createModification függvényével).`
    case 'draft':
      return `${title} piszkozat: nem sztornózható, hanem törölhető (a Billingo felületén vagy a tárca documents.deleteDraft függvényével).`
    case 'proforma':
      return `${title} díjbekérő: nem sztornózható, hanem archiválható (a Billingo felületén vagy a tárca documents.archive függvényével).`
  }
  if (document.correctionType === 'modified') {
    return `${title}-hoz módosító számla készült, ezért a Billingo nem engedi sztornózni (400 Cannot cancel the document). Helyesbíteni újabb módosító számlával lehet.`
  }
  if (document.type === undefined || !CANCELLABLE.includes(document.type)) {
    return `${title} (${document.type ?? 'ismeretlen típus'}) ezzel az eszközzel nem sztornózható: csak számla, előlegszámla és nyugta.`
  }
  return undefined
}

function cancelWarnings(document: Document): string[] {
  const related = (document.relatedDocuments ?? [])
    .map((entry) => entry.invoiceNumber || `#${entry.id ?? '?'}`)
    .join(', ')
  return [
    ...(document.type === 'advance'
      ? [
          'Előlegszámla: ha már készült hozzá végszámla, előbb a végszámlát sztornózd. Mindig a legújabb bizonylattal kezdd.',
        ]
      : []),
    ...(document.type === 'invoice' && related !== ''
      ? [
          `Kapcsolódó bizonylatok: ${related}. Ha ez végszámla, az előlegszámla előtt kell sztornózni.`,
        ]
      : []),
    ...(document.paymentStatus === 'paid' || document.paymentStatus === 'partially_paid'
      ? ['A sztornó után a Billingo az eredeti bizonylat befizetéseit törli.']
      : []),
  ]
}

interface CancelRequest {
  readonly id: number
  readonly reason: string | undefined
}

function cancelRequestOf(args: JsonObject, extraKeys: readonly string[] = []): CancelRequest {
  assertKnownKeys(args, ['id', 'reason', ...extraKeys], '')
  return { id: requiredId(args, 'id', ''), reason: optionalString(args, 'reason', '') }
}

async function previewCancellation(
  args: JsonObject,
  context: McpToolContext,
): Promise<McpToolOutput> {
  const request = cancelRequestOf(args)
  const document = await documentById(context.client(), request.id)
  if (document.cancelled === true) {
    throw refused(`${documentTitle(document)} már sztornózva van, nincs teendő.`)
  }
  const refusal = cancelRefusal(document)
  if (refusal !== undefined) throw refused(refusal)
  const warnings = cancelWarnings(document)
  const confirmation = await context.confirmations.issue(CANCEL_DOCUMENT, args)
  return {
    summary: lines(
      `Sztornó előnézete (még NEM készült el): ${describeDocument(document)}`,
      'A sztornó új bizonylat negatív összegekkel ugyanabban a tömbben; éles profilon a Billingo ezt is jelenti a NAV-nak, és nem vonható vissza.',
      ...warnings,
      confirmationLine(CANCEL_DOCUMENT, confirmation.token, confirmation.expiresAt),
    ),
    data: {
      document: documentSummary(document),
      reason: request.reason ?? null,
      warnings,
      confirmation: confirmation.token,
      confirmationExpiresAt: confirmation.expiresAt,
    },
  }
}

async function recheck(tarca: Tarca, id: number, delayMs: number): Promise<Document> {
  await sleep(delayMs, undefined)
  return tarca.documents.get(id)
}

const UNCERTAIN_HINT =
  'A művelet kimenetele bizonytalan, és az ellenőrzés sem sikerült. Ne próbáld újra vakon: előbb nézd meg a get_document eszközzel a bizonylat állapotát.'

async function cancelDocument(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const request = cancelRequestOf(args, ['confirmation'])
  const { payload, confirmation } = splitConfirmation(args)
  await context.confirmations.verify(CANCEL_DOCUMENT, payload, confirmation, PREVIEW_CANCELLATION)
  const tarca = context.client()
  const original = await documentById(tarca, request.id)
  if (original.cancelled === true) {
    return {
      summary: `${documentTitle(original)} már sztornózva volt, nem sztornóztam újra.`,
      data: { cancelled: false, original: documentSummary(original), cancellation: null },
    }
  }
  const refusal = cancelRefusal(original)
  if (refusal !== undefined) throw refused(refusal)
  try {
    const cancellation = await tarca.documents.cancel(
      request.id,
      request.reason === undefined ? {} : { reason: request.reason },
    )
    return {
      summary: `${documentTitle(original)} sztornózva. Sztornó bizonylat: ${describeDocument(cancellation)}`,
      data: {
        cancelled: true,
        original: documentSummary(original),
        cancellation: documentSummary(cancellation),
      },
    }
  } catch (error) {
    const uncertain = isUncertainOutcome(error)
    if (!uncertain && !(isBillingoError(error) && error.status === 400)) throw error
    let current: Document
    try {
      current = await recheck(tarca, request.id, context.recoveryDelayMs)
    } catch {
      throw uncertain ? withHint(error, UNCERTAIN_HINT) : error
    }
    if (current.cancelled !== true) throw error
    return {
      summary: uncertain
        ? `${documentTitle(original)} sztornózva: a Billingo válasza elveszett, de az újraolvasott bizonylat már sztornózott. A sztornó bizonylatot a list_documents eszközzel találod. Nem küldtem második kérést.`
        : `${documentTitle(original)} közben máshonnan sztornózták, nem sztornóztam újra.`,
      data: {
        cancelled: uncertain,
        recovered: uncertain,
        original: documentSummary(current),
        cancellation: null,
      },
    }
  }
}

interface PaymentRequest {
  readonly id: number
  readonly date: string | undefined
  readonly paymentMethod: PaymentInput['paymentMethod'] | undefined
  readonly voucherNumber: string | undefined
}

function paymentRequestOf(args: JsonObject, extraKeys: readonly string[] = []): PaymentRequest {
  assertKnownKeys(args, ['id', 'date', 'paymentMethod', 'voucherNumber', ...extraKeys], '')
  return {
    id: requiredId(args, 'id', ''),
    date: optionalDate(args, 'date', ''),
    paymentMethod: optionalEnum(args, 'paymentMethod', '', PAYMENT_METHODS),
    voucherNumber: optionalString(args, 'voucherNumber', ''),
  }
}

interface PaymentState {
  readonly document: Document
  readonly existing: readonly PaymentHistory[]
  readonly paid: number
  readonly outstanding: number
}

async function paymentState(tarca: Tarca, id: number): Promise<PaymentState> {
  const document = await documentById(tarca, id)
  if (document.cancelled === true) {
    throw refused(`${documentTitle(document)} sztornózva van, befizetés nem rögzíthető rá.`)
  }
  if (document.type === 'receipt') {
    throw refused(`${documentTitle(document)} nyugta: a nyugta mindig fizetett, nincs teendő.`)
  }
  if (document.type === undefined || !PAYABLE.includes(document.type)) {
    throw refused(
      `${documentTitle(document)} (${document.type ?? 'ismeretlen típus'}): befizetést csak számlán, előlegszámlán és módosító számlán rögzítek.`,
    )
  }
  const existing = await tarca.documents.payments.list(id)
  const paid = roundHalfUp(
    existing.reduce((sum, payment) => sum + payment.price, 0),
    2,
  )
  return {
    document,
    existing,
    paid,
    outstanding: roundHalfUp((document.grossTotal ?? 0) - paid, 2),
  }
}

interface NewPayment extends PaymentInput {
  readonly date: string
}

function newPayment(request: PaymentRequest, state: PaymentState, now: Date): NewPayment {
  const { document } = state
  return {
    date: request.date ?? todayInBudapest(now),
    price: state.outstanding,
    paymentMethod: request.paymentMethod ?? document.paymentMethod ?? 'wire_transfer',
    ...(request.voucherNumber === undefined ? {} : { voucherNumber: request.voucherNumber }),
    ...(document.currency !== undefined &&
    document.currency !== 'HUF' &&
    document.conversionRate !== undefined
      ? { conversionRate: document.conversionRate }
      : {}),
  }
}

function settledOutput(state: PaymentState): McpToolOutput {
  const currency = state.document.currency ?? 'HUF'
  return {
    summary: `${documentTitle(state.document)}: nincs hátralék (bruttó ${money(state.document.grossTotal ?? 0, currency)}, befizetve ${money(state.paid, currency)}), nincs teendő.`,
    data: {
      recorded: false,
      document: documentSummary(state.document),
      paid: state.paid,
      outstanding: state.outstanding,
    },
  }
}

function signedPayment(args: JsonObject, payment: PaymentInput): JsonObject {
  return { ...args, payment: plainJson(payment) }
}

async function previewPayment(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const request = paymentRequestOf(args)
  const state = await paymentState(context.client(), request.id)
  if (state.outstanding <= 0) return settledOutput(state)
  const payment = newPayment(request, state, context.now())
  const currency = state.document.currency ?? 'HUF'
  const confirmation = await context.confirmations.issue(
    MARK_DOCUMENT_PAID,
    signedPayment(args, payment),
  )
  return {
    summary: lines(
      `Befizetés előnézete (még NEM rögzítettem): ${describeDocument(state.document)}`,
      `Hátralék: ${money(state.outstanding, currency)} (bruttó ${money(state.document.grossTotal ?? 0, currency)}, eddig befizetve ${money(state.paid, currency)}). Új befizetés: ${money(payment.price, currency)}, ${payment.date}, ${payment.paymentMethod}. A meglévő ${state.existing.length} befizetés megmarad.`,
      confirmationLine(MARK_DOCUMENT_PAID, confirmation.token, confirmation.expiresAt),
    ),
    data: {
      document: documentSummary(state.document),
      paid: state.paid,
      outstanding: state.outstanding,
      existingPayments: state.existing.length,
      payment: plainJson(payment),
      confirmation: confirmation.token,
      confirmationExpiresAt: confirmation.expiresAt,
    },
  }
}

function fromHistory(payment: PaymentHistory): PaymentInput {
  return {
    date: payment.date,
    price: payment.price,
    paymentMethod: payment.paymentMethod,
    ...(payment.voucherNumber == null ? {} : { voucherNumber: payment.voucherNumber }),
    ...(payment.conversionRate == null ? {} : { conversionRate: payment.conversionRate }),
  }
}

function recorded(list: readonly PaymentHistory[], payment: PaymentInput, before: number): boolean {
  return (
    list.length === before + 1 &&
    list.some(
      (entry) =>
        entry.date === payment.date &&
        entry.price === payment.price &&
        entry.paymentMethod === payment.paymentMethod,
    )
  )
}

async function markDocumentPaid(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const request = paymentRequestOf(args, ['confirmation'])
  const { payload, confirmation } = splitConfirmation(args)
  const tarca = context.client()
  const state = await paymentState(tarca, request.id)
  if (state.outstanding <= 0) return settledOutput(state)
  const payment = newPayment(request, state, context.now())
  await context.confirmations.verify(
    MARK_DOCUMENT_PAID,
    signedPayment(payload, payment),
    confirmation,
    PREVIEW_PAYMENT,
  )
  const currency = state.document.currency ?? 'HUF'
  const summary = `Befizetés rögzítve: ${money(payment.price, currency)} a(z) ${documentTitle(state.document)} bizonylaton (${payment.date}, ${payment.paymentMethod}).`
  try {
    const list = await tarca.documents.payments.replace(request.id, [
      ...state.existing.map(fromHistory),
      payment,
    ])
    return {
      summary,
      data: {
        recorded: true,
        document: documentSummary(state.document),
        payments: plainJson(list),
      },
    }
  } catch (error) {
    if (!isUncertainOutcome(error)) throw error
    await sleep(context.recoveryDelayMs, undefined)
    let list: PaymentHistory[]
    try {
      list = await tarca.documents.payments.list(request.id)
    } catch {
      throw withHint(error, UNCERTAIN_HINT)
    }
    if (!recorded(list, payment, state.existing.length)) throw error
    return {
      summary: `${summary} A Billingo válasza elveszett, de az újraolvasott befizetések között szerepel.`,
      data: {
        recorded: true,
        recovered: true,
        document: documentSummary(state.document),
        payments: plainJson(list),
      },
    }
  }
}

interface SendRequest {
  readonly id: number
  readonly emails: readonly string[]
}

function sendRequestOf(args: JsonObject, extraKeys: readonly string[] = []): SendRequest {
  assertKnownKeys(args, ['id', 'emails', ...extraKeys], '')
  const emails = stringList(args, 'emails', '', { min: 1, max: MAX_EMAILS })
  emails.forEach((email, index) => {
    if (!EMAIL.test(email)) {
      throw new ToolInputError(`Az emails.${index} nem érvényes e-mail cím.`, {
        fields: [`emails.${index}`],
      })
    }
  })
  return { id: requiredId(args, 'id', ''), emails }
}

async function previewSend(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const request = sendRequestOf(args)
  const document = await documentById(context.client(), request.id)
  if (document.type === 'draft') {
    throw refused(`${documentTitle(document)} piszkozat, nem küldhető ki.`)
  }
  const confirmation = await context.confirmations.issue(SEND_DOCUMENT, args)
  return {
    summary: lines(
      `Kiküldés előnézete (még NEM ment el): ${describeDocument(document)}`,
      `Címzettek: ${request.emails.join(', ')}. A Billingo e-mailben elküldi nekik a bizonylatot.`,
      document.cancelled === true && 'Figyelem: ez a bizonylat sztornózva van.',
      confirmationLine(SEND_DOCUMENT, confirmation.token, confirmation.expiresAt),
    ),
    data: {
      document: documentSummary(document),
      emails: [...request.emails],
      confirmation: confirmation.token,
      confirmationExpiresAt: confirmation.expiresAt,
    },
  }
}

async function sendDocument(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  const request = sendRequestOf(args, ['confirmation'])
  const { payload, confirmation } = splitConfirmation(args)
  const token = await context.confirmations.verify(
    SEND_DOCUMENT,
    payload,
    confirmation,
    PREVIEW_SEND,
  )
  if (!context.confirmations.spend(token)) {
    return {
      summary:
        'Ezzel a megerősítő kóddal már elküldtem a bizonylatot, ugyanaz a kód kétszer nem küld. Ha valóban újra kell küldeni, kérj új előnézetet.',
      data: { sent: false, id: request.id },
    }
  }
  try {
    const result = await context.client().documents.send(request.id, { emails: request.emails })
    return {
      summary: `A Billingo elküldte a bizonylatot (#${request.id}) ${request.emails.length} címre.`,
      data: { sent: true, id: request.id, emails: [...(result.emails ?? request.emails)] },
    }
  } catch (error) {
    if (!isUncertainOutcome(error)) context.confirmations.release(token)
    throw error
  }
}

const ID_SCHEMA: JsonObject = { ...ID_PROPERTY, description: 'A bizonylat azonosítója (id).' }

const CANCEL_PROPERTIES: Readonly<Record<string, JsonObject>> = {
  id: ID_SCHEMA,
  reason: { ...TEXT_PROPERTY, description: 'A sztornó oka (a sztornó bizonylatra kerül).' },
}

const PAYMENT_PROPERTIES: Readonly<Record<string, JsonObject>> = {
  id: ID_SCHEMA,
  date: { ...DATE_PROPERTY, description: 'A befizetés dátuma, alapértelmezés: ma.' },
  paymentMethod: {
    ...PAYMENT_METHOD_PROPERTY,
    description: 'Fizetési mód, alapértelmezés: a bizonylaté.',
  },
  voucherNumber: { ...TEXT_PROPERTY, description: 'Bizonylatszám, például a banki tranzakcióé.' },
}

const SEND_PROPERTIES: Readonly<Record<string, JsonObject>> = {
  id: ID_SCHEMA,
  emails: { ...EMAILS_PROPERTY, description: 'A címzettek e-mail címei.' },
}

export const ACTION_TOOLS: readonly McpTool[] = [
  {
    name: PREVIEW_CANCELLATION,
    title: 'Sztornó előnézete',
    description:
      'Lekéri a bizonylatot, és ellenőrzi, hogy sztornózható-e: nem sztornózott, nem sztornó vagy módosító számla, nincs hozzá módosító számla, nem piszkozat vagy díjbekérő. Előleg- és végszámlánál figyelmeztet a sorrendre. Ad egy megerősítő kódot a cancel_document eszközhöz. Semmit nem sztornóz.',
    inputSchema: objectSchema(CANCEL_PROPERTIES, ['id']),
    annotations: REMOTE_READ,
    write: false,
    run: previewCancellation,
  },
  {
    name: CANCEL_DOCUMENT,
    title: 'Bizonylat sztornózása',
    description:
      'Sztornózza a számlát, előlegszámlát vagy nyugtát. Csak a preview_cancellation megerősítő kódjával működik, és csak a felhasználó jóváhagyása után hívd. Előtte újra lekéri a bizonylatot: ha már sztornózott, nem ír. Bizonytalan hiba után újraolvassa, és soha nem küld második sztornó kérést.',
    inputSchema: objectSchema({ ...CANCEL_PROPERTIES, confirmation: CONFIRMATION_PROPERTY }, [
      'id',
      'confirmation',
    ]),
    annotations: REMOTE_CANCEL,
    write: true,
    run: cancelDocument,
  },
  {
    name: PREVIEW_PAYMENT,
    title: 'Befizetés előnézete',
    description:
      'Kiszámolja a bizonylat hátralékát (bruttó végösszeg mínusz az eddigi befizetések), és ad egy megerősítő kódot a mark_document_paid eszközhöz, amely pontosan ezt az összeget rögzíti. Ha nincs hátralék, nincs teendő. Semmit nem ír.',
    inputSchema: objectSchema(PAYMENT_PROPERTIES, ['id']),
    annotations: REMOTE_READ,
    write: false,
    run: previewPayment,
  },
  {
    name: MARK_DOCUMENT_PAID,
    title: 'Befizetés rögzítése',
    description:
      'Rögzíti a hátralékot befizetésként: a meglévő befizetések megmaradnak, egy új tétel kerül melléjük. Csak a preview_payment megerősítő kódjával működik; ha azóta változott a hátralék, új előnézet kell. Fizetett bizonylaton nem ír.',
    inputSchema: objectSchema({ ...PAYMENT_PROPERTIES, confirmation: CONFIRMATION_PROPERTY }, [
      'id',
      'confirmation',
    ]),
    annotations: REMOTE_CREATE,
    write: true,
    run: markDocumentPaid,
  },
  {
    name: PREVIEW_SEND,
    title: 'Kiküldés előnézete',
    description:
      'Megmutatja, melyik bizonylat melyik címekre menne ki e-mailben, és ad egy megerősítő kódot a send_document eszközhöz. Semmit nem küld.',
    inputSchema: objectSchema(SEND_PROPERTIES, ['id', 'emails']),
    annotations: REMOTE_READ,
    write: false,
    run: previewSend,
  },
  {
    name: SEND_DOCUMENT,
    title: 'Bizonylat kiküldése',
    description:
      'A Billingo e-mailben elküldi a bizonylatot a megadott címekre. Csak a preview_send megerősítő kódjával működik, és ugyanaz a kód kétszer nem küld.',
    inputSchema: objectSchema({ ...SEND_PROPERTIES, confirmation: CONFIRMATION_PROPERTY }, [
      'id',
      'emails',
      'confirmation',
    ]),
    annotations: REMOTE_SEND,
    write: true,
    run: sendDocument,
  },
]
