import { fromApiCase } from '../../core/case'
import { toBillingoDate, toBudapestTimestamp } from '../../core/dates'
import {
  DOCUMENT_LANGUAGES,
  isOneOf,
  PAYMENT_METHODS,
  RECEIPT_VATS,
  VATS,
} from '../../documents/enums'
import type {
  Currency,
  Discount,
  DocumentAncestor,
  DocumentBlockType,
  DocumentLanguage,
  DocumentOrganization,
  DocumentPartner,
  DocumentSettings,
  DocumentType,
  Entitlement,
  PaymentMethod,
  Vat,
} from '../../generated/billingo'
import { isCurrency } from './enums'
import {
  bodyFields,
  clientError,
  type FakeFieldError,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  forbidden,
  isBlank,
  isRecord,
  LARAVEL_MESSAGES,
  noContent,
  ok,
  paginate,
  positiveIntegerParam,
  serverError,
  validationFailed,
} from './http'
import { documentTotals, type LineAmounts, lineAmounts, negatedAmounts } from './money'
import {
  type FakeBillingoState,
  type FakeDocument,
  type FakeDocumentItem,
  type FakeDocumentRecord,
  type FakePartner,
  nextId,
  today,
} from './state'

export const DOCUMENT_NOT_FOUND = 'Document is not found.'

export const ONLY_DRAFT_DELETABLE = 'Only draft documents can be deleted.'

export const ONLY_DRAFT_FINALIZABLE = 'Only draft documents can be finalized.'

export const CONVERSION_RATE_REQUIRED =
  'The conversion rate field is required unless currency is in HUF.'

export const PRIVATE_PERSON_NAME = 'Magánszemély'

export const FAKE_ORGANIZATION_NAME = 'Hamis Billingo teszt szervezet'

export function duplicateVendorIdMessage(vendorId: string): string {
  return `Duplicate vendor id. (id:${vendorId})`
}

export type FakeIssueKind = 'document' | 'receipt'

type FakeItem = FakeDocumentItem

interface ParsedDocument {
  readonly vendorId: string | undefined
  readonly partner: FakePartner | undefined
  readonly blockId: number
  readonly bankAccountId: number | undefined
  readonly type: DocumentType
  readonly fulfillmentDate: string
  readonly dueDate: string
  readonly paymentMethod: PaymentMethod
  readonly language: DocumentLanguage
  readonly currency: Currency
  readonly conversionRate: number
  readonly electronic: boolean
  readonly comment: string
  readonly settings: Readonly<Record<string, unknown>>
  readonly items: readonly FakeItem[]
  readonly related: readonly Required<DocumentAncestor>[]
  readonly discount: Discount | null
}

const DOCUMENT_INSERT_TYPES: readonly DocumentType[] = ['advance', 'draft', 'invoice', 'proforma']

const RECEIPT_INSERT_TYPES: readonly DocumentType[] = ['receipt', 'draft']

const SETTINGS_DEFAULTS: Required<DocumentSettings> = {
  mediatedService: false,
  withoutFinancialFulfillment: false,
  onlinePayment: 'no',
  shouldSendEmail: false,
  round: 'none',
  noSendOnlineszamlaByUser: false,
  dontSendToNavReason: null,
  orderNumber: '',
  placeId: null,
  instantPayment: true,
  selectedType: null,
  instantPaymentRequest: null,
  isWaybillHidePrices: false,
}

function present(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): boolean {
  if (!isBlank(fields[field])) return true
  errors.push({ field, message: LARAVEL_MESSAGES.required(field) })
  return false
}

function idField(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): number | undefined {
  const value = fields[field]
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  errors.push({ field, message: LARAVEL_MESSAGES.integer(field) })
  return undefined
}

function dateField(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): string | undefined {
  if (!present(fields, field, errors)) return undefined
  const value = fields[field]
  try {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return toBillingoDate(value)
  } catch {
    errors.push({ field, message: LARAVEL_MESSAGES.dateFormat(field) })
    return undefined
  }
  errors.push({ field, message: LARAVEL_MESSAGES.dateFormat(field) })
  return undefined
}

function choiceField<T extends string>(
  fields: Record<string, unknown>,
  field: string,
  values: readonly T[],
  errors: FakeFieldError[],
): T | undefined {
  if (!present(fields, field, errors)) return undefined
  const value = fields[field]
  if (isOneOf(values, value)) return value
  errors.push({ field, message: LARAVEL_MESSAGES.selected(field) })
  return undefined
}

function numberField(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): number | undefined {
  const value = fields[field]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  errors.push({
    field,
    message: isBlank(value)
      ? LARAVEL_MESSAGES.required(field)
      : `The ${field.replace(/[._]/g, ' ')} must be a number.`,
  })
  return undefined
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function lineItem(
  name: string,
  unit: string,
  vat: Vat,
  amounts: LineAmounts,
  extra: Partial<FakeItem>,
): FakeItem {
  return {
    productId: null,
    name,
    netUnitAmount: amounts.netUnitAmount,
    quantity: 0,
    unit,
    netAmount: amounts.netAmount,
    grossAmount: amounts.grossAmount,
    vat,
    vatAmount: amounts.vatAmount,
    entitlement: null,
    comment: '',
    sku: null,
    dataEraserCodes: null,
    isDepositFee: false,
    ean: null,
    isConnectProduct: false,
    connectedItem: null,
    connectDocumentItemSetting: null,
    ...extra,
  }
}

function productLine(
  state: FakeBillingoState,
  input: Record<string, unknown>,
  field: string,
  kind: FakeIssueKind,
  errors: FakeFieldError[],
): FakeItem | undefined {
  const productId = input.product_id
  const product = typeof productId === 'number' ? state.products.get(productId) : undefined
  const quantity =
    kind === 'receipt' && input.quantity === undefined
      ? 1
      : numberField({ [`${field}.quantity`]: input.quantity }, `${field}.quantity`, errors)
  if (!product) {
    errors.push({
      field: `${field}.product_id`,
      message: LARAVEL_MESSAGES.selected(`${field}.product_id`),
    })
    return undefined
  }
  if (quantity === undefined) return undefined
  const gross = kind === 'receipt'
  const amounts = lineAmounts({
    unitPrice: gross ? product.grossUnitPrice : product.netUnitPrice,
    unitPriceType: gross ? 'gross' : 'net',
    quantity,
    vat: product.vat,
  })
  return lineItem(product.name, product.unit, product.vat, amounts, {
    productId: product.id,
    quantity,
    comment: textOr(input.comment, ''),
    entitlement: product.entitlement,
    sku: product.sku === '' ? null : product.sku,
    ean: product.ean === '' ? null : product.ean,
  })
}

function pricedLine(
  input: Record<string, unknown>,
  field: string,
  kind: FakeIssueKind,
  errors: FakeFieldError[],
): FakeItem | FakeResponse | undefined {
  const own: FakeFieldError[] = []
  const at = (name: string): string => `${field}.${name}`
  const scoped = Object.fromEntries(Object.entries(input).map(([key, value]) => [at(key), value]))
  const document = kind === 'document'
  const name = document
    ? present(scoped, at('name'), own)
      ? textOr(input.name, '')
      : ''
    : textOr(input.name, '')
  const unitPrice = numberField(scoped, at('unit_price'), own)
  const unitPriceType = document
    ? choiceField(scoped, at('unit_price_type'), ['net', 'gross'] as const, own)
    : 'gross'
  const quantity =
    !document && input.quantity === undefined ? 1 : numberField(scoped, at('quantity'), own)
  const unit = document
    ? present(scoped, at('unit'), own)
      ? textOr(input.unit, '')
      : ''
    : textOr(input.unit, 'db')
  if (!document && input.vat === 'none') {
    return serverError(
      501,
      "A hamis Billingo a 'none' áfájú nyugtatételt nem ismeri: élőben nem mértük, mit tárol helyette.",
    )
  }
  const vat = choiceField(scoped, at('vat'), document ? VATS : RECEIPT_VATS, own)
  errors.push(...own)
  if (
    own.length > 0 ||
    unitPrice === undefined ||
    unitPriceType === undefined ||
    quantity === undefined ||
    vat === undefined ||
    vat === 'none'
  ) {
    return undefined
  }
  const amounts = lineAmounts({ unitPrice, unitPriceType, quantity, vat })
  return lineItem(name, unit, vat, amounts, {
    quantity,
    comment: textOr(input.comment, ''),
    entitlement: isOneOf(ENTITLEMENT_VALUES, input.entitlement) ? input.entitlement : null,
    sku: typeof input.sku === 'string' && input.sku !== '' ? input.sku : null,
  })
}

const ENTITLEMENT_VALUES: readonly Entitlement[] = [
  'AAM',
  'ANTIQUES',
  'ARTWORK',
  'ATK',
  'EAM',
  'EUE',
  'EUFAD37',
  'EUFADE',
  'HO',
  'KBAET',
  'NAM_1',
  'NAM_2',
  'SECOND_HAND',
  'TAM',
  'TRAVEL_AGENCY',
  'WITHOUT_ENTITLEMENT',
]

export function readItems(
  state: FakeBillingoState,
  value: unknown,
  kind: FakeIssueKind,
  errors: FakeFieldError[],
): FakeItem[] | FakeResponse {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ field: 'items', message: LARAVEL_MESSAGES.required('items') })
    return []
  }
  const items: FakeItem[] = []
  for (const [index, raw] of value.entries()) {
    const field = `items.${index}`
    if (!isRecord(raw)) {
      errors.push({ field, message: `The ${field} must be an array.` })
      continue
    }
    const line =
      raw.product_id === undefined || raw.product_id === null
        ? pricedLine(raw, field, kind, errors)
        : productLine(state, raw, field, kind, errors)
    if (line && 'status' in line) return line
    if (line) items.push(line)
  }
  return items
}

function advanceLines(
  state: FakeBillingoState,
  value: unknown,
  errors: FakeFieldError[],
): { readonly items: FakeItem[]; readonly related: Required<DocumentAncestor>[] } {
  const items: FakeItem[] = []
  const related: Required<DocumentAncestor>[] = []
  if (value === undefined || value === null) return { items, related }
  if (!Array.isArray(value)) {
    errors.push({ field: 'advance_invoice', message: 'The advance invoice must be an array.' })
    return { items, related }
  }
  for (const [index, id] of value.entries()) {
    const advance = typeof id === 'number' ? state.documents.get(id)?.document : undefined
    if (advance?.type !== 'advance') {
      const field = `advance_invoice.${index}`
      errors.push({ field, message: LARAVEL_MESSAGES.selected(field) })
      continue
    }
    related.push({ id: advance.id, invoiceNumber: advance.invoiceNumber })
    for (const item of advance.items) {
      items.push({ ...item, ...negatedAmounts(item), comment: `(${advance.invoiceNumber})` })
    }
  }
  return { items, related }
}

function blockOf(
  state: FakeBillingoState,
  id: number | undefined,
  type: DocumentBlockType,
  errors: FakeFieldError[],
): number | undefined {
  if (id === undefined) return undefined
  if (state.documentBlocks.get(id)?.type === type) return id
  errors.push({ field: 'block_id', message: LARAVEL_MESSAGES.selected('block_id') })
  return undefined
}

function parseDocument(
  state: FakeBillingoState,
  body: unknown,
  kind: FakeIssueKind,
): ParsedDocument | FakeResponse {
  const input = bodyFields(body)
  const errors: FakeFieldError[] = []
  const document = kind === 'document'
  const partnerId =
    document || !isBlank(input.partner_id)
      ? present(input, 'partner_id', errors)
        ? idField(input, 'partner_id', errors)
        : undefined
      : undefined
  const rawBlockId = present(input, 'block_id', errors)
    ? idField(input, 'block_id', errors)
    : undefined
  const type = choiceField(
    input,
    'type',
    document ? DOCUMENT_INSERT_TYPES : RECEIPT_INSERT_TYPES,
    errors,
  )
  const day = today(state)
  const fulfillmentDate = document ? dateField(input, 'fulfillment_date', errors) : day
  const dueDate = document ? dateField(input, 'due_date', errors) : day
  const paymentMethod = choiceField(input, 'payment_method', PAYMENT_METHODS, errors)
  const language = document ? choiceField(input, 'language', DOCUMENT_LANGUAGES, errors) : 'hu'
  const currencyValue = input.currency
  const currency = isCurrency(currencyValue) ? currencyValue : undefined
  if (currency === undefined) {
    errors.push({
      field: 'currency',
      message: isBlank(currencyValue)
        ? LARAVEL_MESSAGES.required('currency')
        : LARAVEL_MESSAGES.selected('currency'),
    })
  }
  let conversionRate = 1
  if (currency !== undefined && currency !== 'HUF') {
    const rate = input.conversion_rate
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) conversionRate = rate
    else errors.push({ field: 'conversion_rate', message: CONVERSION_RATE_REQUIRED })
  }
  if (!document && input.electronic === undefined) {
    errors.push({ field: 'electronic', message: LARAVEL_MESSAGES.required('electronic') })
  }
  const items = readItems(state, input.items, kind, errors)
  if (!Array.isArray(items)) return items
  if (errors.length > 0) return validationFailed(errors)
  const blockId = blockOf(state, rawBlockId, document ? 'invoice' : 'receipt', errors)
  const partner = partnerId === undefined ? undefined : state.partners.get(partnerId)
  if (partnerId !== undefined && !partner) {
    errors.push({ field: 'partner_id', message: LARAVEL_MESSAGES.selected('partner_id') })
  }
  const bankAccountId = isBlank(input.bank_account_id)
    ? undefined
    : idField(input, 'bank_account_id', errors)
  if (bankAccountId !== undefined && !state.bankAccounts.has(bankAccountId)) {
    errors.push({ field: 'bank_account_id', message: LARAVEL_MESSAGES.selected('bank_account_id') })
  }
  const advances = document ? advanceLines(state, input.advance_invoice, errors) : undefined
  const discountValue = fromApiCase(input.discount)
  if (
    errors.length > 0 ||
    blockId === undefined ||
    type === undefined ||
    fulfillmentDate === undefined ||
    dueDate === undefined ||
    paymentMethod === undefined ||
    language === undefined ||
    currency === undefined
  ) {
    return validationFailed(errors)
  }
  return {
    vendorId: isBlank(input.vendor_id) ? undefined : textOr(input.vendor_id, ''),
    partner,
    blockId,
    bankAccountId,
    type,
    fulfillmentDate,
    dueDate,
    paymentMethod,
    language,
    currency,
    conversionRate,
    electronic: input.electronic === true,
    comment: textOr(input.comment, ''),
    settings: isRecord(input.settings) ? bodyFields(fromApiCase(input.settings)) : {},
    items: [...items, ...(advances?.items ?? [])],
    related: advances?.related ?? [],
    discount: isRecord(discountValue)
      ? { type: 'percent', value: Number(discountValue.value) }
      : null,
  }
}

function privatePerson(state: FakeBillingoState): FakePartner {
  const existing = [...state.partners.values()].find(
    (partner) => partner.name === PRIVATE_PERSON_NAME && partner.address.postCode === '',
  )
  if (existing) return existing
  const empty = { countryCode: '', postCode: '', city: '', address: '' } as const
  const partner: FakePartner = {
    id: nextId(state, 'partners'),
    name: PRIVATE_PERSON_NAME,
    address: empty,
    emails: [],
    taxcode: '',
    iban: '',
    swift: '',
    accountNumber: '',
    phone: '',
    generalLedgerNumber: '',
    taxType: '',
    customBillingSettings: {
      paymentMethod: null,
      documentForm: null,
      dueDays: null,
      documentCurrency: null,
      templateLanguageCode: null,
      discount: null,
      customLabel: null,
    },
    groupMemberTaxNumber: '',
    giroSettings: {
      giroDefaultSettings: true,
      giroPaymentRequestEnabled: false,
      giroDifferentAmountAllowed: false,
    },
    partnerShipping: {
      match: true,
      name: '',
      mode: 'none',
      address: { countryCode: 'HU', postCode: '', city: '', address: '' },
    },
    internalComment: '',
    partnerShowType: null,
  }
  state.partners.set(partner.id, partner)
  return partner
}

function documentPartnerOf(partner: FakePartner): Required<DocumentPartner> {
  return {
    id: partner.id,
    name: partner.name,
    address: partner.address,
    emails: partner.emails,
    taxcode: partner.taxcode,
    iban: partner.iban,
    swift: partner.swift,
    accountNumber: partner.accountNumber,
    phone: partner.phone,
    taxType: partner.taxType,
    partnerShipping: partner.partnerShipping,
  }
}

function organizationOf(
  state: FakeBillingoState,
  bankAccountId: number | undefined,
): Required<DocumentOrganization> {
  const account = bankAccountId === undefined ? undefined : state.bankAccounts.get(bankAccountId)
  return {
    name: FAKE_ORGANIZATION_NAME,
    taxNumber: state.config.taxCode,
    bankAccount: account
      ? {
          id: account.id,
          name: account.name,
          accountNumber: account.accountNumber,
          accountNumberIban: account.accountNumberIban,
          swift: account.swift,
        }
      : { id: null, name: '', accountNumber: '', accountNumberIban: '', swift: '' },
    address: { countryCode: 'HU', postCode: '1011', city: 'Budapest', address: 'Fő utca 1.' },
    smallTaxpayer: false,
    evNumber: '',
    euTaxNumber: '',
    cashSettled: false,
  }
}

function settingsOf(
  given: Readonly<Record<string, unknown>>,
  kind: FakeIssueKind,
): DocumentSettings {
  const known = Object.fromEntries(
    Object.entries(given).filter(([key]) => Object.hasOwn(SETTINGS_DEFAULTS, key)),
  )
  return {
    ...SETTINGS_DEFAULTS,
    ...known,
    ...(kind === 'receipt' ? { selectedType: 'receipt' } : {}),
  }
}

function pad6(serial: number): string {
  return String(serial).padStart(6, '0')
}

export function fakeDocumentNumber(
  state: FakeBillingoState,
  blockId: number,
  type: DocumentType,
): string {
  const block = state.documentBlocks.get(blockId)
  if (!block || type === 'draft') return ''
  const year = today(state).slice(0, 4)
  const series = type === 'proforma' ? 'proforma' : 'main'
  const serial = nextId(state, `document-number:${blockId}:${series}:${year}`)
  if (type === 'proforma')
    return block.prefix === '' ? pad6(serial) : `${block.prefix} / ${pad6(serial)}`
  if (block.type === 'receipt') {
    return block.prefix === '' ? `${year}-${serial}` : `${block.prefix}-${year}-${serial}`
  }
  return block.prefix === '' ? `${year}-${serial}` : `${block.prefix} / ${year}-${pad6(serial)}`
}

function paymentStatusOf(type: DocumentType): FakeDocument['paymentStatus'] {
  if (type === 'draft') return 'none'
  return type === 'receipt' ? 'paid' : 'outstanding'
}

function storeDocument(
  state: FakeBillingoState,
  parsed: ParsedDocument,
  kind: FakeIssueKind,
  id: number,
): FakeDocument {
  const partner = parsed.partner ?? privatePerson(state)
  const totals = documentTotals(parsed.items, parsed.conversionRate)
  const day = today(state)
  const receipt = kind === 'receipt' && parsed.type === 'receipt'
  const document: FakeDocument = {
    id,
    invoiceNumber: fakeDocumentNumber(state, parsed.blockId, parsed.type),
    type: parsed.type,
    cancelled: false,
    blockId: parsed.blockId,
    paymentStatus: paymentStatusOf(parsed.type),
    paymentMethod: parsed.paymentMethod,
    grossTotal: totals.grossTotal,
    currency: parsed.currency,
    conversionRate: parsed.conversionRate,
    invoiceDate: day,
    fulfillmentDate: parsed.fulfillmentDate,
    dueDate: parsed.dueDate,
    paidDate: day,
    organization: organizationOf(state, parsed.bankAccountId),
    partner,
    documentPartner: documentPartnerOf(partner),
    electronic: parsed.electronic,
    comment: parsed.comment,
    tags: [],
    notificationStatus: 'none',
    language: parsed.language,
    items: parsed.items,
    summary: totals.summary,
    settings: settingsOf(parsed.settings, kind),
    onlineSzamlaStatus: parsed.type === 'draft' ? 'not_checked' : 'processing',
    kobakReceiptStatus: receipt ? 'pending' : null,
    kobakReceiptMessage: null,
    relatedDocuments: parsed.related,
    discount: parsed.discount,
    correctionType: parsed.type,
    recurringId: null,
  }
  state.documents.set(id, {
    document,
    vendorId: parsed.vendorId,
    issuedAt: state.config.now(),
    modifiedAt: state.config.now(),
  })
  return document
}

function vendorIdTaken(
  state: FakeBillingoState,
  vendorId: string | undefined,
  except?: number,
): boolean {
  if (vendorId === undefined) return false
  return [...state.documents.entries()].some(
    ([id, record]) => id !== except && record.vendorId === vendorId,
  )
}

export function issueFakeDocument(
  state: FakeBillingoState,
  body: unknown,
  kind: FakeIssueKind,
): FakeResponse {
  const parsed = parseDocument(state, body, kind)
  if ('status' in parsed) return parsed
  if (vendorIdTaken(state, parsed.vendorId)) {
    return clientError(400, duplicateVendorIdMessage(parsed.vendorId ?? ''))
  }
  return ok(storeDocument(state, parsed, kind, nextId(state, 'documents')), 201)
}

export function finalizeFakeDraft(
  state: FakeBillingoState,
  request: FakeRequest,
  kind: FakeIssueKind,
): FakeResponse {
  return withDocument(state, request, (record) => {
    const draftBlock = state.documentBlocks.get(record.document.blockId)?.type
    if (
      record.document.type !== 'draft' ||
      draftBlock !== (kind === 'receipt' ? 'receipt' : 'invoice')
    ) {
      return clientError(400, ONLY_DRAFT_FINALIZABLE)
    }
    const parsed = parseDocument(state, request.body, kind)
    if ('status' in parsed) return parsed
    const vendorId = parsed.vendorId ?? record.vendorId
    if (vendorIdTaken(state, vendorId, record.document.id)) {
      return clientError(400, duplicateVendorIdMessage(vendorId ?? ''))
    }
    return ok(storeDocument(state, { ...parsed, vendorId }, kind, record.document.id), 201)
  })
}

export function withDocument(
  state: FakeBillingoState,
  request: FakeRequest,
  respond: (record: FakeDocumentRecord) => FakeResponse,
): FakeResponse {
  const id = positiveIntegerParam(request, 'id')
  const record = id === undefined ? undefined : state.documents.get(id)
  return record ? respond(record) : forbidden()
}

function listType(
  state: FakeBillingoState,
  record: FakeDocumentRecord,
): DocumentBlockType | undefined {
  return state.documentBlocks.get(record.document.blockId)?.type
}

const MODIFIED_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function budapestSeconds(date: Date): string {
  return toBudapestTimestamp(date).slice(0, 19).replace('T', ' ')
}

interface ListFilter {
  readonly errors: FakeFieldError[]
  readonly matches: (record: FakeDocumentRecord) => boolean
}

function listFilter(state: FakeBillingoState, query: URLSearchParams): ListFilter {
  const errors: FakeFieldError[] = []
  const checks: ((record: FakeDocumentRecord) => boolean)[] = []
  const text = (name: string): string | undefined => {
    const value = query.get(name)
    return value === null || value.trim() === '' ? undefined : value.trim()
  }
  const integer = (name: string, pick: (record: FakeDocumentRecord) => number | undefined) => {
    const value = text(name)
    if (value === undefined) return
    if (!/^\d+$/.test(value)) {
      errors.push({ field: name, message: LARAVEL_MESSAGES.integer(name) })
      return
    }
    checks.push((record) => pick(record) === Number(value))
  }
  const range = (
    name: string,
    pick: (record: FakeDocumentRecord) => string | number | undefined,
    compare: 'from' | 'to',
    parse: (raw: string) => string | number | undefined,
  ) => {
    const raw = text(name)
    if (raw === undefined) return
    const limit = parse(raw)
    if (limit === undefined) {
      errors.push({ field: name, message: LARAVEL_MESSAGES.dateFormat(name) })
      return
    }
    checks.push((record) => {
      const value = pick(record)
      if (value === undefined) return false
      return compare === 'from' ? value >= limit : value <= limit
    })
  }
  const date = (raw: string): string | undefined => {
    try {
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? toBillingoDate(raw) : undefined
    } catch {
      return undefined
    }
  }
  const whole = (raw: string): number | undefined => (/^\d+$/.test(raw) ? Number(raw) : undefined)
  const serial = (record: FakeDocumentRecord): number | undefined => {
    const match = /(\d+)$/.exec(record.document.invoiceNumber)
    return match?.[1] === undefined ? undefined : Number(match[1])
  }
  const year = (record: FakeDocumentRecord): number =>
    Number(record.document.invoiceDate.slice(0, 4))
  integer('block_id', (record) => record.document.blockId)
  integer('partner_id', (record) => record.document.partner.id)
  const paymentMethod = text('payment_method')
  if (paymentMethod !== undefined) {
    if (!isOneOf(PAYMENT_METHODS, paymentMethod)) {
      errors.push({ field: 'payment_method', message: LARAVEL_MESSAGES.selected('payment_method') })
    }
    checks.push((record) => record.document.paymentMethod === paymentMethod)
  }
  const paymentStatus = text('payment_status')
  if (paymentStatus !== undefined) {
    checks.push((record) => record.document.paymentStatus === paymentStatus)
  }
  const type = text('type')
  if (type !== undefined) {
    if (type !== 'invoice' && type !== 'receipt') {
      errors.push({ field: 'type', message: LARAVEL_MESSAGES.selected('type') })
    }
    checks.push((record) => listType(state, record) === type)
  }
  const search = text('query')?.toLowerCase()
  if (search !== undefined) {
    checks.push(
      (record) =>
        record.document.invoiceNumber.toLowerCase().includes(search) ||
        record.document.partner.name.toLowerCase().includes(search),
    )
  }
  range('start_date', (record) => record.document.invoiceDate, 'from', date)
  range('end_date', (record) => record.document.invoiceDate, 'to', date)
  range('paid_start_date', (record) => record.document.paidDate, 'from', date)
  range('paid_end_date', (record) => record.document.paidDate, 'to', date)
  range('fulfillment_start_date', (record) => record.document.fulfillmentDate, 'from', date)
  range('fulfillment_end_date', (record) => record.document.fulfillmentDate, 'to', date)
  range('start_number', serial, 'from', whole)
  range('end_number', serial, 'to', whole)
  range('start_year', year, 'from', whole)
  range('end_year', year, 'to', whole)
  const modified = text('last_modified_date')
  if (modified !== undefined) {
    if (!MODIFIED_FORMAT.test(modified)) {
      errors.push({
        field: 'last_modified_date',
        message: 'The last modified date does not match the format Y-m-d H:i:s.',
      })
    }
    checks.push((record) => budapestSeconds(record.modifiedAt) >= modified)
  }
  return { errors, matches: (record) => checks.every((check) => check(record)) }
}

export const documentRoutes: FakeRoutes = {
  ListDocument: (state, request) => {
    const filter = listFilter(state, request.query)
    if (filter.errors.length > 0) return validationFailed(filter.errors)
    const documents = [...state.documents.values()]
      .filter((record) => record.archived !== true && filter.matches(record))
      .sort((a, b) => b.document.id - a.document.id)
      .map((record) => record.document)
    return paginate(request, documents)
  },
  CreateDocument: (state, request) => issueFakeDocument(state, request.body, 'document'),
  GetDocument: (state, request) => withDocument(state, request, (record) => ok(record.document)),
  GetDocumentByVendorId: (state, request) => {
    const vendorId = request.params.vendor_id ?? ''
    const record = [...state.documents.values()].find((item) => item.vendorId === vendorId)
    return record ? ok(record.document) : clientError(404, DOCUMENT_NOT_FOUND)
  },
  CreateDocumentFromDraft: (state, request) => finalizeFakeDraft(state, request, 'document'),
  DeleteDocument: (state, request) =>
    withDocument(state, request, (record) => {
      if (record.document.type !== 'draft') return clientError(400, ONLY_DRAFT_DELETABLE)
      state.documents.delete(record.document.id)
      return noContent()
    }),
}
