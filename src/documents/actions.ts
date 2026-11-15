import type { RequestOptions, TarcaContext } from '../core/context'
import { type DateInput, toBillingoDate, toOptionalBillingoDate } from '../core/dates'
import type { DocumentAction } from '../core/document-events'
import { isBillingoError, withHint } from '../core/errors'
import type { OperationId } from '../core/operations'
import type {
  Document,
  DocumentCancellation,
  DocumentReminderEventList,
  InvoiceSettings,
  ModificationDocumentInsert,
  OnlineSzamlaStatus,
  PaymentMethod,
  SendDocument,
} from '../generated/billingo'
import { assertValid, createInputCheck, describeValue, type InputCheck, type Wire } from './check'
import type { ResolvedDefaults } from './defaults'
import { PAYMENT_METHODS } from './enums'
import {
  checkItem,
  type DocumentItemInput,
  dueDateOf,
  toItem,
  type WireDocumentItem,
} from './input'

export interface SendInput {
  readonly emails: readonly string[]
}

export interface CancelInput {
  readonly reason?: string
  readonly recipients?: readonly string[]
}

export interface ProformaConversionInput
  extends Omit<InvoiceSettings, 'fulfillmentDate' | 'dueDate'> {
  readonly fulfillmentDate?: DateInput
  readonly dueDate?: DateInput
  readonly dueInDays?: number
}

export interface ModificationInput {
  readonly items: readonly DocumentItemInput[]
  readonly comment?: string
  readonly dueDate?: DateInput
  readonly paymentMethod?: PaymentMethod
  readonly withoutFinancialFulfillment?: boolean
}

export interface DocumentActionsApi {
  send(id: number, input: SendInput, options?: RequestOptions): Promise<SendDocument>
  reminders(id: number, options?: RequestOptions): Promise<DocumentReminderEventList>
  navStatus(id: number, options?: RequestOptions): Promise<OnlineSzamlaStatus | null>
  cancel(id: number, input?: CancelInput, options?: RequestOptions): Promise<Document>
  copy(id: number, options?: RequestOptions): Promise<Document>
  archive(id: number, options?: RequestOptions): Promise<void>
  createFromProforma(
    id: number,
    input?: ProformaConversionInput,
    options?: RequestOptions,
  ): Promise<Document>
  createModification(
    id: number,
    input: ModificationInput,
    options?: RequestOptions,
  ): Promise<Document>
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

const NAV_RECORD_MISSING = /NavOnlineSzamla is not found/i

const CANNOT_CANCEL = /^Cannot cancel the document/

const CANCEL_REFUSED_HINT =
  'A Billingo módosító számla után sem az eredeti számlát, sem a módosító számlát nem engedi sztornózni. Ilyenkor újabb módosító számlával (documents.createModification) lehet helyesbíteni. Ha nincs módosító, a documents.get(id) válaszában nézd meg a cancelled és a correctionType mezőt: lehet, hogy a bizonylat már sztornózva van, vagy nem sztornózható típusú.'

function checkEmails(
  check: InputCheck,
  emails: readonly string[] | undefined,
  field: string,
): void {
  if (!Array.isArray(emails) || emails.length === 0) {
    check.fail(field, 'Legalább egy e-mail cím kell.')
    return
  }
  emails.forEach((email, index) => {
    if (EMAIL.test(email)) return
    check.fail(`${field}.${index}`, `Érvénytelen e-mail cím: ${describeValue(email)}.`)
  })
}

function explainCancelRefusal(error: unknown): unknown {
  if (!isBillingoError(error) || error.status !== 400) return error
  if (!CANNOT_CANCEL.test(error.apiMessage ?? '')) return error
  return withHint(error, CANCEL_REFUSED_HINT)
}

function conversionBody(
  input: ProformaConversionInput,
  defaults: ResolvedDefaults,
  now: Date,
): Wire<InvoiceSettings> {
  const check = createInputCheck()
  const fulfillmentDate = input.fulfillmentDate
  if (fulfillmentDate !== undefined) {
    check.convert('fulfillmentDate', () => toBillingoDate(fulfillmentDate))
  }
  check.convert(input.dueDate === undefined ? 'dueInDays' : 'dueDate', () =>
    dueDateOf(input, defaults, now),
  )
  assertValid(check, 'CreateDocumentFromProforma', 'számla adatok')
  return {
    documentType: input.documentType,
    documentFormat: input.documentFormat,
    comment: input.comment,
    fulfillmentDate: toBillingoDate(fulfillmentDate ?? now),
    dueDate: dueDateOf(input, defaults, now),
  }
}

type ModificationBody = Wire<Omit<ModificationDocumentInsert, 'items'>> & {
  readonly items: readonly WireDocumentItem[]
}

function modificationBody(input: ModificationInput): ModificationBody {
  const check = createInputCheck()
  if (!Array.isArray(input.items) || input.items.length === 0) {
    check.fail('items', 'Legalább egy különbözeti tétel kell.')
  } else {
    input.items.forEach((item, index) => {
      checkItem(check, item, `items.${index}`)
    })
  }
  const dueDate = input.dueDate
  if (dueDate !== undefined) check.convert('dueDate', () => toBillingoDate(dueDate))
  if (input.paymentMethod !== undefined) {
    check.choice(PAYMENT_METHODS, input.paymentMethod, 'paymentMethod', 'fizetési mód')
  }
  check.flag(input.withoutFinancialFulfillment, 'withoutFinancialFulfillment')
  assertValid(check, 'CreateModificationDocument', 'módosító számla adatok')
  return {
    dueDate: toOptionalBillingoDate(dueDate),
    comment: input.comment,
    paymentMethod: input.paymentMethod,
    withoutFinancialFulfillment: input.withoutFinancialFulfillment,
    items: input.items.map(toItem),
  }
}

function cancelBody(input: CancelInput): Wire<DocumentCancellation> | undefined {
  const check = createInputCheck()
  if (input.reason !== undefined) check.text(input.reason, 'reason')
  if (input.recipients !== undefined) checkEmails(check, input.recipients, 'recipients')
  assertValid(check, 'CancelDocument', 'sztornó adatok')
  if (input.reason === undefined && input.recipients === undefined) return undefined
  return {
    cancellationReason: input.reason,
    cancellationRecipients: input.recipients?.join(','),
  }
}

export function createDocumentActionsApi(
  context: TarcaContext,
  defaults: ResolvedDefaults,
): DocumentActionsApi {
  const derived = (
    action: DocumentAction,
    operation: OperationId,
    sourceId: number,
    document: Document,
  ): Promise<void> => context.emitDocument({ action, operation, document, sourceId })
  return {
    async send(id, input, options) {
      const check = createInputCheck()
      checkEmails(check, input.emails, 'emails')
      assertValid(check, 'SendDocument', 'címzettlista')
      return context.json<SendDocument>({
        operation: 'SendDocument',
        pathParams: { id },
        body: { emails: input.emails },
        signal: options?.signal,
      })
    },
    reminders: (id, options) =>
      context.json<DocumentReminderEventList>({
        operation: 'GetDocumentReminderEventList',
        pathParams: { id },
        signal: options?.signal,
      }),
    async navStatus(id, options) {
      try {
        return await context.json<OnlineSzamlaStatus>({
          operation: 'GetOnlineSzamlaStatus',
          pathParams: { id },
          signal: options?.signal,
        })
      } catch (error) {
        if (isBillingoError(error) && NAV_RECORD_MISSING.test(error.apiMessage ?? '')) return null
        throw error
      }
    },
    async cancel(id, input = {}, options) {
      const body = cancelBody(input)
      let document: Document
      try {
        document = await context.json<Document>({
          operation: 'CancelDocument',
          pathParams: { id },
          body,
          signal: options?.signal,
        })
      } catch (error) {
        throw explainCancelRefusal(error)
      }
      await derived('cancelled', 'CancelDocument', id, document)
      return document
    },
    async copy(id, options) {
      const document = await context.json<Document>({
        operation: 'DocumentCopy',
        pathParams: { id },
        signal: options?.signal,
      })
      await derived('copied', 'DocumentCopy', id, document)
      return document
    },
    archive: (id, options) =>
      context.empty({ operation: 'ArchiveDocument', pathParams: { id }, signal: options?.signal }),
    async createFromProforma(id, input = {}, options) {
      const document = await context.json<Document>({
        operation: 'CreateDocumentFromProforma',
        pathParams: { id },
        body: conversionBody(input, defaults, new Date()),
        signal: options?.signal,
      })
      await derived('converted', 'CreateDocumentFromProforma', id, document)
      return document
    },
    async createModification(id, input, options) {
      const document = await context.json<Document>({
        operation: 'CreateModificationDocument',
        pathParams: { id },
        body: modificationBody(input),
        signal: options?.signal,
      })
      await derived('modified', 'CreateModificationDocument', id, document)
      return document
    },
  }
}
