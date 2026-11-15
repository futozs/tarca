import type {
  Category,
  DateType,
  PaymentStatusSpending,
  Source,
  SpendingPartner,
  SpendingPaymentMethod,
} from '../../generated/billingo'
import { isCurrency } from './enums'
import {
  bodyFields,
  clientError,
  type FakeFieldError,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  isCalendarDate,
  LARAVEL_MESSAGES,
  noContent,
  ok,
  optionalString,
  paginate,
  positiveIntegerParam,
  requiredEnum,
  requiredString,
  validationFailed,
} from './http'
import { integerField, numberField } from './products'
import { type FakeBillingoState, type FakePartner, type FakeSpending, nextId, today } from './state'

export const FAKE_ORGANIZATION_ID = 1

export const SPENDING_NOT_FOUND = 'Spending is not found.'

const CATEGORY_FLAGS: Readonly<Record<Category, true>> = {
  accounting_and_auditing: true,
  advertisement: true,
  bonus: true,
  business_insurance: true,
  cleaning: true,
  construction_and_repair: true,
  consulting: true,
  consumer_goods: true,
  contractors: true,
  development: true,
  dividends: true,
  donations: true,
  duty_taxes: true,
  education_and_trainings: true,
  electricity: true,
  electronics: true,
  employee_benefits: true,
  entertainment: true,
  equipment_insurance: true,
  federal_taxes: true,
  fees: true,
  financials: true,
  fines: true,
  gas: true,
  gas_and_fuel: true,
  health_insurance: true,
  human_resources: true,
  income: true,
  income_taxes: true,
  insurance: true,
  interest: true,
  internet: true,
  investments: true,
  leasing: true,
  legal: true,
  liability_insurance: true,
  loans: true,
  meals: true,
  mortgage: true,
  office_rent: true,
  online_subscriptions: true,
  other: true,
  overheads: true,
  payroll_taxes: true,
  phone: true,
  prepayments: true,
  professional_insurance: true,
  property_taxes: true,
  real_estate: true,
  returns: true,
  sales: true,
  service: true,
  service_and_parts: true,
  shipping: true,
  software: true,
  staff_outsourcing: true,
  stock: true,
  storage: true,
  supplies_and_furniture: true,
  tangible_assets: true,
  tax_return: true,
  taxes: true,
  taxi: true,
  transport: true,
  travel: true,
  utilities: true,
  vat: true,
  vehicle_insurance: true,
  wages: true,
  water: true,
}

const PAYMENT_METHOD_FLAGS: Readonly<Record<SpendingPaymentMethod, true>> = {
  aruhitel: true,
  bankcard: true,
  barion: true,
  barter: true,
  cash: true,
  cash_on_delivery: true,
  cod_balance: true,
  combined: true,
  coupon: true,
  credit: true,
  ebay: true,
  elore_utalas: true,
  ep_kartya: true,
  kompenzacio: true,
  levonas: true,
  online_bankcard: true,
  other: true,
  paylike: true,
  payoneer: true,
  paypal: true,
  paypal_utolag: true,
  payu: true,
  pick_pack_pont: true,
  postai_csekk: true,
  postautalvany: true,
  revolut: true,
  simple_pay: true,
  skrill: true,
  stripe: true,
  szep_card: true,
  transferwise: true,
  upwork: true,
  utalvany: true,
  valto: true,
  wire_transfer: true,
}

const DATE_TYPE_FLAGS: Readonly<Record<DateType, true>> = {
  due_date: true,
  fulfillment_date: true,
  invoice_date: true,
}

const PAYMENT_STATUS_FLAGS: Readonly<Record<PaymentStatusSpending, true>> = {
  all: true,
  expired: true,
  paid: true,
  unpaid: true,
}

const SOURCE_FLAGS: Readonly<Record<Source, true>> = { all: true, manual: true, nav: true }

export const SPENDING_CATEGORIES: readonly string[] = Object.keys(CATEGORY_FLAGS)

export const SPENDING_PAYMENT_METHODS: readonly string[] = Object.keys(PAYMENT_METHOD_FLAGS)

function flagged<T extends string>(flags: Readonly<Record<T, true>>) {
  return (value: unknown): value is T => typeof value === 'string' && Object.hasOwn(flags, value)
}

const isCategory = flagged(CATEGORY_FLAGS)
const isPaymentMethod = flagged(PAYMENT_METHOD_FLAGS)
const isDateType = flagged(DATE_TYPE_FLAGS)
const isPaymentStatus = flagged(PAYMENT_STATUS_FLAGS)
const isSource = flagged(SOURCE_FLAGS)

export function dateField(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
  required: boolean,
): string | null {
  const value = fields[field]
  if (value === undefined || value === null || value === '') {
    if (required) errors.push({ field, message: LARAVEL_MESSAGES.required(field) })
    return null
  }
  if (isCalendarDate(value)) return value
  errors.push({ field, message: LARAVEL_MESSAGES.dateFormat(field) })
  return null
}

function requiredNumber(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): number {
  if (fields[field] === undefined || fields[field] === null) {
    errors.push({ field, message: LARAVEL_MESSAGES.required(field) })
    return 0
  }
  return numberField(fields, field, errors) ?? 0
}

function spendingPartner(partner: FakePartner): Required<SpendingPartner> {
  return {
    id: partner.id,
    name: partner.name,
    taxCode: partner.taxcode,
    address: partner.address,
    iban: partner.iban,
    swift: partner.swift,
    accountNumber: partner.accountNumber,
    phone: partner.phone,
    internalComment: partner.internalComment ?? '',
    groupMemberTaxNumber: partner.groupMemberTaxNumber ?? '',
  }
}

type SpendingFields = Omit<FakeSpending, 'id' | 'organizationId' | 'items'>

function readSpending(
  state: FakeBillingoState,
  body: unknown,
): { readonly fields: SpendingFields } | { readonly errors: FakeFieldError[] } {
  const input = bodyFields(body)
  const errors: FakeFieldError[] = []
  const currency = requiredEnum(input, 'currency', isCurrency, errors)
  const conversionRate = requiredNumber(input, 'conversion_rate', errors)
  const totalGross = requiredNumber(input, 'total_gross', errors)
  const totalGrossLocal = requiredNumber(input, 'total_gross_huf', errors)
  const totalVatAmount = requiredNumber(input, 'total_vat_amount', errors)
  const totalVatAmountLocal = requiredNumber(input, 'total_vat_amount_huf', errors)
  const fulfillmentDate = dateField(input, 'fulfillment_date', errors, true)
  const paidAt = dateField(input, 'paid_at', errors, false)
  const category = requiredEnum(input, 'category', isCategory, errors)
  const comment = optionalString(input, 'comment', errors)
  const invoiceNumber = requiredString(input, 'invoice_number', errors)
  const invoiceDate = dateField(input, 'invoice_date', errors, true)
  const dueDate = dateField(input, 'due_date', errors, true)
  const paymentMethod = requiredEnum(input, 'payment_method', isPaymentMethod, errors)
  const partnerId = integerField(input, 'partner_id', errors)
  const partner = partnerId === null ? undefined : state.partners.get(partnerId)
  if (partnerId !== null && partner === undefined) {
    errors.push({ field: 'partner_id', message: LARAVEL_MESSAGES.selected('partner_id') })
  }
  if (
    errors.length > 0 ||
    currency === undefined ||
    category === undefined ||
    paymentMethod === undefined ||
    fulfillmentDate === null ||
    invoiceDate === null ||
    dueDate === null
  ) {
    return { errors }
  }
  return {
    fields: {
      category,
      paidAt,
      fulfillmentDate,
      partner: partner === undefined ? null : spendingPartner(partner),
      invoiceNumber,
      currency,
      conversionRate,
      totalGross,
      totalGrossLocal,
      totalVatAmount,
      totalVatAmountLocal,
      invoiceDate,
      dueDate,
      paymentMethod,
      comment,
    },
  }
}

function stored(id: number, fields: SpendingFields): FakeSpending {
  return { id, organizationId: FAKE_ORGANIZATION_ID, ...fields, items: [] }
}

function withExisting(
  state: FakeBillingoState,
  request: FakeRequest,
  respond: (spending: FakeSpending) => FakeResponse,
): FakeResponse {
  const id = positiveIntegerParam(request, 'id')
  const spending = id === undefined ? undefined : state.spendings.get(id)
  return spending ? respond(spending) : clientError(404, SPENDING_NOT_FOUND)
}

interface SpendingFilter {
  readonly q: string
  readonly dateType: DateType
  readonly startDate: string | null
  readonly endDate: string | null
  readonly paymentStatus: PaymentStatusSpending
  readonly spendingType: Source
  readonly category: Category | undefined
  readonly currency: string | undefined
  readonly paymentMethod: SpendingPaymentMethod | undefined
}

function queryEnum<T extends string>(
  query: URLSearchParams,
  field: string,
  isAllowed: (value: unknown) => value is T,
  errors: FakeFieldError[],
): T | undefined {
  const value = query.get(field)
  if (value === null || value === '') return undefined
  if (isAllowed(value)) return value
  errors.push({ field, message: LARAVEL_MESSAGES.selected(field) })
  return undefined
}

function readFilter(
  request: FakeRequest,
): { readonly filter: SpendingFilter } | { readonly errors: FakeFieldError[] } {
  const errors: FakeFieldError[] = []
  const query = Object.fromEntries(request.query)
  const filter: SpendingFilter = {
    q: (request.query.get('q') ?? '').trim().toLowerCase(),
    dateType: queryEnum(request.query, 'spending_date', isDateType, errors) ?? 'invoice_date',
    startDate: dateField(query, 'start_date', errors, false),
    endDate: dateField(query, 'end_date', errors, false),
    paymentStatus: queryEnum(request.query, 'payment_status', isPaymentStatus, errors) ?? 'all',
    spendingType: queryEnum(request.query, 'spending_type', isSource, errors) ?? 'all',
    category: queryEnum(request.query, 'categories', isCategory, errors),
    currency: queryEnum(request.query, 'currencies', isCurrency, errors),
    paymentMethod: queryEnum(request.query, 'payment_methods', isPaymentMethod, errors),
  }
  return errors.length > 0 ? { errors } : { filter }
}

const DATE_OF: Readonly<Record<DateType, (spending: FakeSpending) => string>> = {
  due_date: (spending) => spending.dueDate,
  fulfillment_date: (spending) => spending.fulfillmentDate,
  invoice_date: (spending) => spending.invoiceDate,
}

function matches(filter: SpendingFilter, spending: FakeSpending, now: string): boolean {
  const date = DATE_OF[filter.dateType](spending)
  const paid = spending.paidAt !== null
  const status: Readonly<Record<PaymentStatusSpending, boolean>> = {
    all: true,
    paid,
    unpaid: !paid,
    expired: !paid && spending.dueDate < now,
  }
  return (
    (filter.q === '' || (spending.partner?.name ?? '').toLowerCase().includes(filter.q)) &&
    (filter.startDate === null || date >= filter.startDate) &&
    (filter.endDate === null || date <= filter.endDate) &&
    status[filter.paymentStatus] &&
    filter.spendingType !== 'nav' &&
    (filter.category === undefined || spending.category === filter.category) &&
    (filter.currency === undefined || spending.currency === filter.currency) &&
    (filter.paymentMethod === undefined || spending.paymentMethod === filter.paymentMethod)
  )
}

function listItem({ items: _items, ...spending }: FakeSpending) {
  return { ...spending, createdByNav: false }
}

export const spendingRoutes: FakeRoutes = {
  SpendingList: (state, request) => {
    const input = readFilter(request)
    if ('errors' in input) return validationFailed(input.errors)
    const now = today(state)
    return paginate(
      request,
      [...state.spendings.values()]
        .filter((spending) => matches(input.filter, spending, now))
        .sort((a, b) => b.id - a.id)
        .map(listItem),
    )
  },
  SpendingSave: (state, request) => {
    const input = readSpending(state, request.body)
    if ('errors' in input) return validationFailed(input.errors)
    const spending = stored(nextId(state, 'spendings'), input.fields)
    state.spendings.set(spending.id, spending)
    return ok(spending, 201)
  },
  SpendingShow: (state, request) =>
    withExisting(state, request, (spending) => ok({ ...spending, createdByNav: false })),
  SpendingUpdate: (state, request) =>
    withExisting(state, request, (existing) => {
      const input = readSpending(state, request.body)
      if ('errors' in input) return validationFailed(input.errors)
      const spending = stored(existing.id, input.fields)
      state.spendings.set(spending.id, spending)
      return ok(spending)
    }),
  SpendingDelete: (state, request) =>
    withExisting(state, request, (spending) => {
      state.spendings.delete(spending.id)
      return noContent()
    }),
}
