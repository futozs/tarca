import { isOneOf } from '../../documents/enums'
import type {
  DocumentBlock,
  DocumentBlockType,
  FinancialFulfillmentHighlight,
  InvoiceNumberFormat,
} from '../../generated/billingo'
import {
  bodyFields,
  type FakeFieldError,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  forbidden,
  LARAVEL_MESSAGES,
  noContent,
  ok,
  paginate,
  positiveIntegerParam,
  validationFailed,
} from './http'
import {
  DOCUMENT_BLOCK_DEFAULTS,
  type FakeBillingoState,
  type FakeDocumentBlock,
  nextId,
} from './state'

const DOCUMENT_BLOCK_MESSAGES: {
  readonly nameRequired: string
  readonly nameCharacters: string
  readonly prefixPresent: string
  readonly senderEmail: string
  readonly bccEmail: string
} = {
  nameRequired: 'The Invoice pad name field is required.',
  nameCharacters: 'The Invoice pad name may only contain letters and numbers and space.',
  prefixPresent: 'The Invoice pad prefix field must be present.',
  senderEmail: 'The Sender email must be a valid email address.',
  bccEmail: 'The Bcc email must be a valid email address.',
}

const BLOCK_TYPES: readonly DocumentBlockType[] = [
  'certificate_of_completion',
  'dossier',
  'invoice',
  'offer',
  'order_form',
  'receipt',
  'waybill',
]

const INVOICE_NUMBER_FORMATS: readonly InvoiceNumberFormat[] = ['default', 'short_with_hyphen']

const HIGHLIGHTS: readonly FinancialFulfillmentHighlight[] = ['basic', 'highlighted', 'paid_stamp']

const BOOLEAN_FIELDS = [
  ['generated', 'generated'],
  ['create_invoice_from_paid_proforma', 'createInvoiceFromPaidProforma'],
  ['fulfillment_date_from_proforma_payment_date', 'fulfillmentDateFromProformaPaymentDate'],
  ['attach_xml_to_invoice_pdf', 'attachXmlToInvoicePdf'],
  ['advance_paid_instant', 'advancePaidInstant'],
  ['entitlements_in_document_comment', 'entitlementsInDocumentComment'],
] as const

const INTEGER_FIELDS = [
  ['template_id', 'templateId'],
  ['normal_notification_id', 'normalNotificationId'],
  ['proforma_notification_id', 'proformaNotificationId'],
] as const

const STRING_FIELDS = [
  ['custom_field1', 'customField1'],
  ['custom_field2', 'customField2'],
  ['sender_name', 'senderName'],
] as const

const BLOCK_NAME = /^[\p{L}\p{M}\p{N} ]+$/u

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type BlockFields = Omit<FakeDocumentBlock, 'id'>

type BlockSettings = { -readonly [K in keyof BlockFields]?: BlockFields[K] }

function readBlock(
  body: unknown,
): { readonly fields: BlockFields } | { readonly errors: FakeFieldError[] } {
  const input = bodyFields(body)
  const errors: FakeFieldError[] = []
  const settings: BlockSettings = {}
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name === '') errors.push({ field: 'name', message: DOCUMENT_BLOCK_MESSAGES.nameRequired })
  else if (!BLOCK_NAME.test(name)) {
    errors.push({ field: 'name', message: DOCUMENT_BLOCK_MESSAGES.nameCharacters })
  }
  if (!Object.hasOwn(input, 'prefix')) {
    errors.push({ field: 'prefix', message: DOCUMENT_BLOCK_MESSAGES.prefixPresent })
  } else if (input.prefix !== null && typeof input.prefix !== 'string') {
    errors.push({ field: 'prefix', message: LARAVEL_MESSAGES.string('prefix') })
  }
  const prefix = typeof input.prefix === 'string' ? input.prefix.trim() : ''
  const type = input.type
  if (type === undefined || type === null || type === '') {
    errors.push({ field: 'type', message: LARAVEL_MESSAGES.required('type') })
  } else if (!isOneOf(BLOCK_TYPES, type)) {
    errors.push({ field: 'type', message: LARAVEL_MESSAGES.selected('type') })
  }
  for (const [field, key] of STRING_FIELDS) {
    const value = input[field]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') settings[key] = value
    else errors.push({ field, message: LARAVEL_MESSAGES.string(field) })
  }
  for (const [field, key] of BOOLEAN_FIELDS) {
    const value = input[field]
    if (value === undefined) continue
    if (typeof value === 'boolean') settings[key] = value
    else errors.push({ field, message: LARAVEL_MESSAGES.boolean(field) })
  }
  for (const [field, key] of INTEGER_FIELDS) {
    const value = input[field]
    if (value === undefined) continue
    if (typeof value === 'number' && Number.isInteger(value)) settings[key] = value
    else errors.push({ field, message: LARAVEL_MESSAGES.integer(field) })
  }
  for (const [field, key, message] of [
    ['sender_email', 'senderEmail', DOCUMENT_BLOCK_MESSAGES.senderEmail],
    ['bcc_email', 'bccEmail', DOCUMENT_BLOCK_MESSAGES.bccEmail],
  ] as const) {
    if (!Object.hasOwn(input, field)) continue
    const value = input[field]
    if (typeof value === 'string' && EMAIL.test(value.trim())) settings[key] = value.trim()
    else errors.push({ field, message })
  }
  if (input.invoice_number_format !== undefined) {
    if (isOneOf(INVOICE_NUMBER_FORMATS, input.invoice_number_format)) {
      settings.invoiceNumberFormat = input.invoice_number_format
    } else {
      errors.push({
        field: 'invoice_number_format',
        message: LARAVEL_MESSAGES.selected('invoice_number_format'),
      })
    }
  }
  if (input.financial_fulfillment_highlight !== undefined) {
    if (isOneOf(HIGHLIGHTS, input.financial_fulfillment_highlight)) {
      settings.financialFulfillmentHighlight = input.financial_fulfillment_highlight
    } else {
      errors.push({
        field: 'financial_fulfillment_highlight',
        message: LARAVEL_MESSAGES.selected('financial_fulfillment_highlight'),
      })
    }
  }
  const bankAccountId = input.bank_account_id
  if (bankAccountId !== undefined && bankAccountId !== null) {
    if (typeof bankAccountId === 'number' && Number.isInteger(bankAccountId)) {
      settings.bankAccountId = bankAccountId
    } else {
      errors.push({
        field: 'bank_account_id',
        message: LARAVEL_MESSAGES.integer('bank_account_id'),
      })
    }
  }
  if (errors.length > 0 || !isOneOf(BLOCK_TYPES, type)) return { errors }
  return { fields: { ...DOCUMENT_BLOCK_DEFAULTS, ...settings, name, prefix, type } }
}

function stored(id: number, fields: BlockFields): FakeDocumentBlock {
  const { name, prefix, type, ...settings } = fields
  return { id, name, prefix, type, ...settings }
}

function listItem(block: FakeDocumentBlock): Required<DocumentBlock> {
  return {
    id: block.id,
    name: block.name,
    prefix: block.prefix,
    customField1: block.customField1 ?? '',
    customField2: block.customField2 ?? '',
    type: block.type,
  }
}

function withExisting(
  state: FakeBillingoState,
  request: FakeRequest,
  respond: (block: FakeDocumentBlock) => FakeResponse,
): FakeResponse {
  const id = positiveIntegerParam(request, 'id')
  const block = id === undefined ? undefined : state.documentBlocks.get(id)
  return block ? respond(block) : forbidden()
}

export const documentBlockRoutes: FakeRoutes = {
  ListDocumentBlock: (state, request) => {
    const type = request.query.get('type')
    if (type !== null && !isOneOf(BLOCK_TYPES, type)) {
      return validationFailed([{ field: 'type', message: LARAVEL_MESSAGES.selected('type') }])
    }
    const blocks = [...state.documentBlocks.values()]
      .filter((block) => type === null || block.type === type)
      .sort((a, b) => a.id - b.id)
    return paginate(request, blocks.map(listItem))
  },
  CreateDocumentBlock: (state, request) => {
    const input = readBlock(request.body)
    if ('errors' in input) return validationFailed(input.errors)
    const block = stored(nextId(state, 'documentBlocks'), input.fields)
    state.documentBlocks.set(block.id, block)
    return ok(block, 201)
  },
  GetDocumentBlock: (state, request) => withExisting(state, request, (block) => ok(block)),
  UpdateDocumentBlock: (state, request) =>
    withExisting(state, request, (existing) => {
      const input = readBlock(request.body)
      if ('errors' in input) return validationFailed(input.errors)
      const block = stored(existing.id, input.fields)
      state.documentBlocks.set(block.id, block)
      return ok(block)
    }),
  DeleteDocumentBlock: (state, request) =>
    withExisting(state, request, (block) => {
      state.documentBlocks.delete(block.id)
      return noContent()
    }),
}
