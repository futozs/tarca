import { fromApiCase } from '../../core/case'
import { isOneOf } from '../../documents/enums'
import type { Address, PartnerShowType, PartnerTaxType } from '../../generated/billingo'
import { isCountry } from './enums'
import {
  bodyFields,
  clientError,
  type FakeFieldError,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  isBlank,
  isRecord,
  LARAVEL_MESSAGES,
  noContent,
  ok,
  paginate,
  positiveIntegerParam,
  validationFailed,
} from './http'
import { type FakeBillingoState, type FakePartner, nextId } from './state'

const PARTNER_NOT_FOUND = 'Partner is not found.'

const TAX_TYPES: readonly PartnerTaxType[] = ['', 'FOREIGN', 'HAS_TAX_NUMBER', 'NO_TAX_NUMBER']

const SHOW_TYPES: readonly PartnerShowType[] = ['show_all', 'show_incoming', 'show_outgoing']

const STRING_FIELDS = [
  ['taxcode', 'taxcode'],
  ['iban', 'iban'],
  ['swift', 'swift'],
  ['account_number', 'accountNumber'],
  ['phone', 'phone'],
  ['general_ledger_number', 'generalLedgerNumber'],
  ['group_member_tax_number', 'groupMemberTaxNumber'],
  ['internal_comment', 'internalComment'],
] as const

const ADDRESS_FIELDS = [
  ['post_code', 'postCode'],
  ['city', 'city'],
  ['address', 'address'],
] as const

type PartnerFields = Omit<FakePartner, 'id'>

type PartnerSettings = { -readonly [K in keyof PartnerFields]?: PartnerFields[K] }

function defaults(): PartnerFields {
  return {
    name: '',
    address: { countryCode: 'HU', postCode: '', city: '', address: '' },
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
    partnerShowType: 'show_all',
  }
}

function readAddress(value: unknown, errors: FakeFieldError[]): Address {
  const input = isRecord(value) ? value : {}
  if (!isRecord(value)) {
    errors.push({ field: 'address', message: LARAVEL_MESSAGES.required('address') })
  }
  const address: { -readonly [K in keyof Address]: Address[K] } = {
    countryCode: 'HU',
    postCode: '',
    city: '',
    address: '',
  }
  for (const [field, key] of ADDRESS_FIELDS) {
    const item = input[field]
    const path = `address.${field}`
    if (isBlank(item)) errors.push({ field: path, message: LARAVEL_MESSAGES.required(path) })
    else if (typeof item === 'string') address[key] = item.trim()
    else errors.push({ field: path, message: LARAVEL_MESSAGES.string(path) })
  }
  const country = input.country_code
  if (isCountry(country)) address.countryCode = country
  else if (!isBlank(country)) {
    errors.push({
      field: 'address.country_code',
      message: LARAVEL_MESSAGES.selected('address.country_code'),
    })
  }
  return address
}

function readPartner(
  body: unknown,
): { readonly fields: PartnerFields } | { readonly errors: FakeFieldError[] } {
  const input = bodyFields(body)
  const errors: FakeFieldError[] = []
  const base = defaults()
  const settings: PartnerSettings = {}
  if (isBlank(input.name))
    errors.push({ field: 'name', message: LARAVEL_MESSAGES.required('name') })
  else if (typeof input.name !== 'string') {
    errors.push({ field: 'name', message: LARAVEL_MESSAGES.string('name') })
  }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const address = readAddress(input.address, errors)
  const emails = input.emails
  if (emails !== undefined && emails !== null) {
    if (Array.isArray(emails) && emails.every((email) => typeof email === 'string')) {
      settings.emails = emails.map((email: string) => email.trim())
    } else {
      errors.push({ field: 'emails', message: 'The emails must be an array.' })
    }
  }
  for (const [field, key] of STRING_FIELDS) {
    const value = input[field]
    if (value === undefined || value === null) continue
    if (typeof value === 'string') settings[key] = value.trim()
    else errors.push({ field, message: LARAVEL_MESSAGES.string(field) })
  }
  if (input.tax_type !== undefined && input.tax_type !== null) {
    settings.taxType = isOneOf(TAX_TYPES, input.tax_type) ? input.tax_type : ''
  }
  if (input.partner_show_type !== undefined && input.partner_show_type !== null) {
    if (isOneOf(SHOW_TYPES, input.partner_show_type))
      settings.partnerShowType = input.partner_show_type
    else {
      errors.push({
        field: 'partner_show_type',
        message: LARAVEL_MESSAGES.selected('partner_show_type'),
      })
    }
  }
  const nested = [
    ['custom_billing_settings', 'customBillingSettings'],
    ['giro_settings', 'giroSettings'],
    ['partner_shipping', 'partnerShipping'],
  ] as const
  for (const [field, key] of nested) {
    const value = input[field]
    if (value === undefined || value === null) continue
    if (!isRecord(value)) {
      errors.push({ field, message: `The ${field.replace(/_/g, ' ')} must be an array.` })
      continue
    }
    const given = fromApiCase(value)
    if (isRecord(given)) settings[key] = { ...base[key], ...given }
  }
  if (errors.length > 0) return { errors }
  return { fields: { ...base, ...settings, name, address } }
}

function stored(id: number, fields: PartnerFields): FakePartner {
  return { id, ...fields }
}

function nameWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word !== '')
}

function matchesPartnerQuery(name: string, query: string): boolean {
  const words = nameWords(name)
  return nameWords(query).every((wanted) => words.some((word) => word.startsWith(wanted)))
}

function byName(state: FakeBillingoState): FakePartner[] {
  return [...state.partners.values()].sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.id - b.id,
  )
}

function notFound(): FakeResponse {
  return clientError(404, PARTNER_NOT_FOUND)
}

function withExisting(
  state: FakeBillingoState,
  request: FakeRequest,
  respond: (partner: FakePartner) => FakeResponse,
): FakeResponse {
  const id = positiveIntegerParam(request, 'id')
  const partner = id === undefined ? undefined : state.partners.get(id)
  return partner ? respond(partner) : notFound()
}

function insert(state: FakeBillingoState, fields: PartnerFields): FakePartner {
  const partner = stored(nextId(state, 'partners'), fields)
  state.partners.set(partner.id, partner)
  return partner
}

export const partnerRoutes: FakeRoutes = {
  ListPartner: (state, request) => {
    const query = request.query.get('query') ?? ''
    return paginate(
      request,
      byName(state).filter((partner) => matchesPartnerQuery(partner.name, query)),
    )
  },
  CreatePartner: (state, request) => {
    const input = readPartner(request.body)
    if ('errors' in input) return validationFailed(input.errors)
    return ok(insert(state, input.fields), 201)
  },
  PartnerGuess: (state, request) => {
    const input = readPartner(request.body)
    if ('errors' in input) return validationFailed(input.errors)
    const existing = byName(state).find((partner) => partner.name === input.fields.name)
    const partner = existing ?? insert(state, input.fields)
    return ok({ ...partner, taxType: '' }, 201)
  },
  GetPartner: (state, request) => withExisting(state, request, (partner) => ok(partner)),
  UpdatePartner: (state, request) =>
    withExisting(state, request, (existing) => {
      const input = readPartner(request.body)
      if ('errors' in input) return validationFailed(input.errors)
      const partner = stored(existing.id, input.fields)
      state.partners.set(partner.id, partner)
      return ok(partner)
    }),
  DeletePartner: (state, request) =>
    withExisting(state, request, (partner) => {
      state.partners.delete(partner.id)
      return noContent()
    }),
}
