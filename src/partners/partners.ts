import { isPlainObject } from '../core/case'
import type { RequestOptions, TarcaContext } from '../core/context'
import { BillingoError } from '../core/errors'
import {
  assertPageQuery,
  iteratePages,
  MAX_PER_PAGE,
  type Page,
  type PageQuery,
  type RawPage,
  toPage,
} from '../core/pagination'
import type { Address, Country, Partner } from '../generated/billingo'

export interface PartnerAddressInput extends Omit<Address, 'countryCode'> {
  readonly countryCode?: Country
}

export interface PartnerInput extends Omit<Partner, 'id' | 'address'> {
  readonly address: PartnerAddressInput
}

export type PartnerReplacement = PartnerInput

export interface PartnerListQuery extends PageQuery {
  readonly query?: string
}

export interface FoundOrCreatedPartner {
  readonly partner: Partner
  readonly created: boolean
}

export interface PartnersApi {
  list(query?: PartnerListQuery, options?: RequestOptions): Promise<Page<Partner>>
  all(query?: Omit<PartnerListQuery, 'page'>, options?: RequestOptions): AsyncGenerator<Partner>
  get(id: number, options?: RequestOptions): Promise<Partner>
  create(input: PartnerInput, options?: RequestOptions): Promise<Partner>
  update(id: number, replacement: PartnerReplacement, options?: RequestOptions): Promise<Partner>
  delete(id: number, options?: RequestOptions): Promise<void>
  guess(input: PartnerInput, options?: RequestOptions): Promise<Partner>
  findOrCreate(input: PartnerInput, options?: RequestOptions): Promise<FoundOrCreatedPartner>
}

const DEFAULT_PARTNER_COUNTRY: Country = 'HU'

const FIND_OR_CREATE_MAX_PAGES = 3

function withDefaultCountry(input: PartnerInput): PartnerInput {
  const { countryCode = DEFAULT_PARTNER_COUNTRY, ...address } = input.address
  return { ...input, address: { countryCode, ...address } }
}

function normalized(value: string, field: string): string {
  const text = value.trim().replace(/\s+/g, ' ')
  return field === 'emails' ? text.toLowerCase() : text
}

function sameAsStored(given: unknown, stored: unknown, field: string): boolean {
  if (given === undefined) return true
  if (typeof given === 'string') {
    return typeof stored === 'string' && normalized(given, field) === normalized(stored, field)
  }
  if (Array.isArray(given)) {
    return (
      Array.isArray(stored) &&
      given.length === stored.length &&
      given.every((item, index) => sameAsStored(item, stored[index], field))
    )
  }
  if (isPlainObject(given)) {
    return (
      isPlainObject(stored) &&
      Object.entries(given).every(([key, value]) => sameAsStored(value, stored[key], key))
    )
  }
  return given === stored
}

export function matchesPartner(input: PartnerInput, stored: Partner): boolean {
  return sameAsStored(withDefaultCountry(input), stored, '')
}

function blankNameError(): BillingoError {
  const message = 'A partner neve nem lehet üres.'
  return new BillingoError(message, {
    category: 'validation',
    operation: 'CreatePartner',
    fieldErrors: [{ field: 'name', message }],
    hint: 'A findOrCreate a név alapján keres, és a Billingo név nélkül 422-t ad, ezért a tárca kérést sem küld.',
  })
}

export function createPartnersApi(context: TarcaContext): PartnersApi {
  const list = async (query: PartnerListQuery = {}, options?: RequestOptions) => {
    assertPageQuery(query)
    const raw = await context.json<RawPage<Partner>>({
      operation: 'ListPartner',
      query: { page: query.page, perPage: query.perPage, query: query.query },
      signal: options?.signal,
    })
    return toPage(raw, query)
  }
  const create = (input: PartnerInput, options?: RequestOptions) =>
    context.json<Partner>({
      operation: 'CreatePartner',
      body: withDefaultCountry(input),
      signal: options?.signal,
    })
  return {
    list,
    all: (query = {}, options) => iteratePages(list, query, options),
    get: (id, options) =>
      context.json<Partner>({
        operation: 'GetPartner',
        pathParams: { id },
        signal: options?.signal,
      }),
    create,
    update: (id, replacement, options) =>
      context.json<Partner>({
        operation: 'UpdatePartner',
        pathParams: { id },
        body: withDefaultCountry(replacement),
        signal: options?.signal,
      }),
    delete: (id, options) =>
      context.empty({
        operation: 'DeletePartner',
        pathParams: { id },
        signal: options?.signal,
      }),
    guess: (input, options) =>
      context.json<Partner>({
        operation: 'PartnerGuess',
        body: withDefaultCountry(input),
        signal: options?.signal,
      }),
    async findOrCreate(input, options) {
      const wanted = withDefaultCountry(input)
      const name = normalized(wanted.name, 'name')
      if (name === '') throw blankNameError()
      for (let page = 1; page <= FIND_OR_CREATE_MAX_PAGES; page++) {
        const candidates = await list({ query: name, page, perPage: MAX_PER_PAGE }, options)
        const match = candidates.data.find((candidate) => matchesPartner(wanted, candidate))
        if (match) return { partner: match, created: false }
        if (candidates.data.length === 0 || page >= candidates.lastPage) break
      }
      return { partner: await create(wanted, options), created: true }
    },
  }
}
