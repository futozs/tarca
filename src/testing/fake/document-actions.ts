import { documentTotals, negatedAmounts } from '../../core/money'
import { isOneOf, PAYMENT_METHODS } from '../../documents/enums'
import type { DocumentAncestor, DocumentType, OnlineSzamlaStatus } from '../../generated/billingo'
import { fakeDocumentNumber, readItems, withDocument } from './documents'
import {
  bodyFields,
  clientError,
  type FakeFieldError,
  type FakeFile,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  fileResponse,
  isCalendarDate,
  LARAVEL_MESSAGES,
  noContent,
  ok,
  validationFailed,
} from './http'
import {
  type FakeBillingoState,
  type FakeDocument,
  type FakeDocumentRecord,
  type FakePayment,
  nextId,
  today,
} from './state'

export const NAV_RECORD_NOT_FOUND = 'NavOnlineSzamla is not found.'

export const NAV_SETTINGS_MISSING = 'NAV Online Számla összeköttetés nincs beállítva.'

export const ONLY_PROFORMA_ARCHIVABLE = 'Only proforma documents can be archived.'

export const ONLY_PROFORMA_CONVERTIBLE = 'Only proforma documents can be converted to invoice.'

export function cannotCancelMessage(id: number): string {
  return `Cannot cancel the document (id:${id}).`
}

export function cannotModifyMessage(id: number): string {
  return `Cannot create modification document (id:${id}).`
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

const POS_SIZES = ['58', '80']

const CANCELLABLE: readonly DocumentType[] = ['invoice', 'advance', 'receipt']

const MODIFIABLE: readonly DocumentType[] = ['invoice', 'advance']

const PUBLIC_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function save(
  state: FakeBillingoState,
  record: FakeDocumentRecord,
  changes: Partial<FakeDocumentRecord>,
): void {
  state.documents.set(record.document.id, {
    ...record,
    ...changes,
    modifiedAt: state.config.now(),
  })
}

function store(state: FakeBillingoState, document: FakeDocument): FakeDocument {
  state.documents.set(document.id, {
    document,
    vendorId: undefined,
    issuedAt: state.config.now(),
    modifiedAt: state.config.now(),
  })
  return document
}

function ancestor(document: FakeDocument): Required<DocumentAncestor> {
  return { id: document.id, invoiceNumber: document.invoiceNumber }
}

function derived(
  state: FakeBillingoState,
  source: FakeDocument,
  type: DocumentType,
  items: FakeDocument['items'],
): FakeDocument {
  const totals = documentTotals(items, source.conversionRate)
  const day = today(state)
  return {
    ...source,
    id: nextId(state, 'documents'),
    invoiceNumber: fakeDocumentNumber(state, source.blockId, type),
    type,
    correctionType: type,
    cancelled: false,
    items,
    grossTotal: totals.grossTotal,
    summary: totals.summary,
    invoiceDate: day,
    paidDate: day,
    notificationStatus: 'none',
    onlineSzamlaStatus: type === 'draft' ? 'not_checked' : 'processing',
    kobakReceiptStatus: null,
    kobakReceiptMessage: null,
    relatedDocuments: [],
  }
}

function fileName(document: FakeDocument): string {
  const name = `${document.invoiceNumber === '' ? document.id : document.invoiceNumber}.pdf`
  return /^[\w.-]+$/.test(name) ? name : `"${name.replace(/["\\]/g, '\\$&')}"`
}

function pdfFile(document: FakeDocument, contentType: string, layout: string): FakeFile {
  const text = `%PDF-1.4\n% tarca hamis Billingo ${layout}: ${document.invoiceNumber}\n%%EOF\n`
  return {
    bytes: new TextEncoder().encode(text),
    contentType,
    disposition: `attachment; filename=${fileName(document)}`,
  }
}

function publicToken(id: number): string {
  let seed = id >>> 0
  let token = ''
  for (let index = 0; index < 32; index++) {
    seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5
    seed >>>= 0
    token += PUBLIC_URL_ALPHABET[seed % PUBLIC_URL_ALPHABET.length]
  }
  return token
}

function hasModification(state: FakeBillingoState, id: number): boolean {
  return [...state.documents.values()].some(
    (record) =>
      record.document.type === 'modification' &&
      record.document.relatedDocuments.some((related) => related.id === id),
  )
}

function optionalDate(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): string | undefined {
  const value = fields[field]
  if (value === undefined || value === null) return undefined
  if (isCalendarDate(value)) return value
  errors.push({ field, message: LARAVEL_MESSAGES.dateFormat(field) })
  return undefined
}

function optionalText(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): string | undefined {
  const value = fields[field]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim()
  errors.push({ field, message: LARAVEL_MESSAGES.string(field) })
  return undefined
}

function emailList(value: unknown, field: string, errors: FakeFieldError[]): string[] {
  if (!Array.isArray(value)) {
    errors.push({ field, message: `The ${field} must be an array.` })
    return []
  }
  return value.flatMap((email, index) => {
    if (typeof email === 'string' && EMAIL.test(email.trim())) return [email.trim()]
    errors.push({
      field: `${field}.${index}`,
      message: `The ${field}.${index} must be a valid email address.`,
    })
    return []
  })
}

function paymentStatusAfter(
  document: FakeDocument,
  payments: readonly FakePayment[],
): FakeDocument['paymentStatus'] {
  const paid = payments.reduce((sum, payment) => sum + payment.price, 0)
  if (paid <= 0) return 'outstanding'
  return paid >= document.grossTotal ? 'paid' : 'partially_paid'
}

function readPayment(
  raw: unknown,
  index: number,
  errors: FakeFieldError[],
): FakePayment | undefined {
  const fields = bodyFields(raw)
  const own: FakeFieldError[] = []
  const field = (name: string): string => `${index}.${name}`
  const { date, price, payment_method: method, voucher_number: voucher } = fields
  const rate = fields.conversion_rate
  if (date === undefined || date === null) {
    own.push({ field: field('date'), message: LARAVEL_MESSAGES.required(field('date')) })
  } else if (!isCalendarDate(date)) {
    own.push({ field: field('date'), message: LARAVEL_MESSAGES.dateFormat(field('date')) })
  }
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    own.push({ field: field('price'), message: LARAVEL_MESSAGES.required(field('price')) })
  }
  if (!isOneOf(PAYMENT_METHODS, method)) {
    own.push({
      field: field('payment_method'),
      message: LARAVEL_MESSAGES.selected(field('payment_method')),
    })
  }
  if (voucher !== undefined && voucher !== null && typeof voucher !== 'string') {
    own.push({
      field: field('voucher_number'),
      message: LARAVEL_MESSAGES.string(field('voucher_number')),
    })
  }
  if (rate !== undefined && rate !== null && !(typeof rate === 'number' && rate > 0)) {
    own.push({
      field: field('conversion_rate'),
      message: `The ${field('conversion_rate')} must be a number.`,
    })
  }
  errors.push(...own)
  const valid =
    own.length === 0 &&
    isCalendarDate(date) &&
    typeof price === 'number' &&
    isOneOf(PAYMENT_METHODS, method)
  if (!valid) return undefined
  return {
    date,
    price,
    paymentMethod: method,
    voucherNumber: typeof voucher === 'string' ? voucher.trim() : '',
    conversionRate: typeof rate === 'number' ? rate : 1,
  }
}

function readPayments(body: unknown): FakePayment[] | FakeResponse {
  if (!Array.isArray(body)) {
    return validationFailed([{ field: 'payments', message: 'The payments must be an array.' }])
  }
  const errors: FakeFieldError[] = []
  const payments = body.flatMap((raw, index) => readPayment(raw, index, errors) ?? [])
  return errors.length > 0 ? validationFailed(errors) : payments
}

function cancel(state: FakeBillingoState, request: FakeRequest, record: FakeDocumentRecord) {
  const original = record.document
  if (
    !CANCELLABLE.includes(original.type) ||
    original.cancelled ||
    hasModification(state, original.id)
  ) {
    return clientError(400, cannotCancelMessage(original.id))
  }
  const fields = bodyFields(request.body)
  const errors: FakeFieldError[] = []
  optionalText(fields, 'cancellation_reason', errors)
  const recipients = optionalText(fields, 'cancellation_recipients', errors)
  if (recipients !== undefined && recipients !== '') {
    const invalid = recipients.split(',').some((email) => !EMAIL.test(email.trim()))
    if (invalid) {
      errors.push({
        field: 'cancellation_recipients',
        message: 'The cancellation recipients must be a valid email address.',
      })
    }
  }
  if (errors.length > 0) return validationFailed(errors)
  const receipt = original.type === 'receipt'
  const type: DocumentType = receipt ? 'receipt_cancellation' : 'cancellation'
  const items = original.items.map((item) => ({ ...item, ...negatedAmounts(item) }))
  const cancellation = store(state, {
    ...derived(state, original, type, items),
    paymentStatus: 'none',
    kobakReceiptStatus: receipt ? 'pending' : null,
    relatedDocuments: [...original.relatedDocuments, ancestor(original)],
  })
  save(state, record, {
    payments: [],
    document: {
      ...original,
      cancelled: true,
      correctionType: 'canceled',
      paymentStatus: 'none',
      onlineSzamlaStatus: 'no_online_szamla_settings',
    },
  })
  return ok(cancellation)
}

function fromProforma(state: FakeBillingoState, request: FakeRequest, record: FakeDocumentRecord) {
  const proforma = record.document
  if (proforma.type !== 'proforma') return clientError(400, ONLY_PROFORMA_CONVERTIBLE)
  const fields = bodyFields(request.body)
  const errors: FakeFieldError[] = []
  const fulfillmentDate = optionalDate(fields, 'fulfillment_date', errors)
  const dueDate = optionalDate(fields, 'due_date', errors)
  const comment = optionalText(fields, 'comment', errors)
  if (errors.length > 0) return validationFailed(errors)
  const invoice = store(state, {
    ...derived(state, proforma, 'invoice', proforma.items),
    paymentStatus: 'paid',
    fulfillmentDate: fulfillmentDate ?? today(state),
    dueDate: dueDate ?? proforma.dueDate,
    comment: comment ?? proforma.comment,
    relatedDocuments: [ancestor(proforma)],
  })
  return ok(invoice, 201)
}

function modification(state: FakeBillingoState, request: FakeRequest, record: FakeDocumentRecord) {
  const original = record.document
  if (!MODIFIABLE.includes(original.type) || original.cancelled) {
    return clientError(400, cannotModifyMessage(original.id))
  }
  const fields = bodyFields(request.body)
  const errors: FakeFieldError[] = []
  const items = readItems(state, fields.items, 'document', errors)
  if (!Array.isArray(items)) return items
  const dueDate = optionalDate(fields, 'due_date', errors)
  const comment = optionalText(fields, 'comment', errors)
  const method = fields.payment_method
  if (method !== undefined && method !== null && !isOneOf(PAYMENT_METHODS, method)) {
    errors.push({ field: 'payment_method', message: LARAVEL_MESSAGES.selected('payment_method') })
  }
  const without = fields.without_financial_fulfillment
  if (without !== undefined && without !== null && typeof without !== 'boolean') {
    errors.push({
      field: 'without_financial_fulfillment',
      message: LARAVEL_MESSAGES.boolean('without_financial_fulfillment'),
    })
  }
  if (errors.length > 0) return validationFailed(errors)
  save(state, record, { document: { ...original, correctionType: 'modified' } })
  const document = store(state, {
    ...derived(state, original, 'modification', items),
    paymentStatus: 'outstanding',
    dueDate: dueDate ?? original.dueDate,
    paymentMethod: isOneOf(PAYMENT_METHODS, method) ? method : original.paymentMethod,
    comment: comment ?? original.comment,
    settings: {
      ...original.settings,
      withoutFinancialFulfillment:
        typeof without === 'boolean'
          ? without
          : (original.settings.withoutFinancialFulfillment ?? false),
    },
    relatedDocuments: [ancestor(original)],
  })
  return ok(document, 201)
}

function navStatus(state: FakeBillingoState, record: FakeDocumentRecord): FakeResponse {
  const age = state.config.now().getTime() - record.issuedAt.getTime()
  if (record.document.type === 'draft' || age < state.config.navRecordDelayMs) {
    return clientError(404, NAV_RECORD_NOT_FOUND)
  }
  const status: Required<OnlineSzamlaStatus> = state.config.hasNavConnection
    ? { transactionId: '', status: record.document.onlineSzamlaStatus, messages: [] }
    : {
        transactionId: '',
        status: 'no_online_szamla_settings',
        messages: [
          {
            validationResultCode: '',
            validationErrorCode: '',
            humanReadableMessage: NAV_SETTINGS_MISSING,
          },
        ],
      }
  return ok(status)
}

export const documentActionRoutes: FakeRoutes = {
  DownloadDocument: (state, request) =>
    withDocument(state, request, (record) =>
      fileResponse(pdfFile(record.document, 'application/pdf', 'A4')),
    ),
  PosPrint: (state, request) =>
    withDocument(state, request, (record) => {
      const size = request.query.get('size')
      if (size === null || size.trim() === '') {
        return validationFailed([{ field: 'size', message: LARAVEL_MESSAGES.required('size') }])
      }
      if (!POS_SIZES.includes(size.trim())) {
        return validationFailed([{ field: 'size', message: LARAVEL_MESSAGES.selected('size') }])
      }
      return fileResponse(pdfFile(record.document, 'application/octet-stream', `POS ${size} mm`))
    }),
  GetPublicUrl: (state, request) =>
    withDocument(state, request, (record) =>
      ok({
        publicUrl: `${new URL(request.apiUrl).origin}/document-access/${publicToken(record.document.id)}`,
      }),
    ),
  GetOnlineSzamlaStatus: (state, request) =>
    withDocument(state, request, (record) => navStatus(state, record)),
  GetDocumentReminderEventList: (state, request) =>
    withDocument(state, request, () =>
      ok({ sentReminders: [], upcomingReminders: [], sentPostalMail: [] }),
    ),
  SendDocument: (state, request) =>
    withDocument(state, request, (record) => {
      const fields = bodyFields(request.body)
      const errors: FakeFieldError[] = []
      const emails =
        fields.emails === undefined || fields.emails === null
          ? [...(record.document.partner.emails ?? [])]
          : emailList(fields.emails, 'emails', errors)
      if (errors.length === 0 && emails.length === 0) {
        errors.push({ field: 'emails', message: LARAVEL_MESSAGES.required('emails') })
      }
      return errors.length > 0 ? validationFailed(errors) : ok({ emails })
    }),
  CancelDocument: (state, request) =>
    withDocument(state, request, (record) => cancel(state, request, record)),
  DocumentCopy: (state, request) =>
    withDocument(state, request, (record) => {
      const source = record.document
      const copy = store(state, {
        ...derived(state, source, 'draft', source.items),
        paymentStatus: 'none',
      })
      return ok(copy)
    }),
  ArchiveDocument: (state, request) =>
    withDocument(state, request, (record) => {
      if (record.document.type !== 'proforma') return clientError(400, ONLY_PROFORMA_ARCHIVABLE)
      save(state, record, { archived: true })
      return noContent()
    }),
  CreateDocumentFromProforma: (state, request) =>
    withDocument(state, request, (record) => fromProforma(state, request, record)),
  CreateModificationDocument: (state, request) =>
    withDocument(state, request, (record) => modification(state, request, record)),
  GetPayment: (state, request) =>
    withDocument(state, request, (record) => ok(record.payments ?? [])),
  UpdatePayment: (state, request) =>
    withDocument(state, request, (record) => {
      const payments = readPayments(request.body)
      if (!Array.isArray(payments)) return payments
      save(state, record, {
        payments,
        document: {
          ...record.document,
          paymentStatus: paymentStatusAfter(record.document, payments),
        },
      })
      return ok(payments)
    }),
  DeletePayment: (state, request) =>
    withDocument(state, request, (record) => {
      save(state, record, {
        payments: [],
        document: { ...record.document, paymentStatus: paymentStatusAfter(record.document, []) },
      })
      return ok([])
    }),
}
