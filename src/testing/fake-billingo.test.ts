import { describe, expect, test } from 'vitest'
import {
  createValidator,
  loadMergedSpec,
  responseErrors,
  SPEC_AVAILABLE,
} from '../../tests/openapi'
import { createTarca } from '../client'
import { BillingoError } from '../core/errors'
import type { OperationId } from '../core/operations'
import { missingRateMessage } from './fake/currencies'
import { CURRENCIES } from './fake/enums'
import { FAKE_ROUTES } from './fake/registry'
import { LEGACY_ID_NOT_FOUND } from './fake/utils'
import { createFakeBillingoFetch, FAKE_BILLINGO_MESSAGES, type FakeBillingoOptions } from './index'

const API = 'https://api.billingo.hu/v3'
const KEY = 'tarca-fake-teszt-kulcs'
const WINTER = new Date('2026-11-15T13:50:07Z')
const SUMMER = new Date('2026-07-14T22:30:00Z')
const HEX_TRACE_ID = /^[0-9a-f]{32}$/

interface Exchange {
  readonly label: string
  readonly operation: OperationId | undefined
  readonly status: number
  readonly body: unknown
  readonly contentType: string | undefined
  readonly faulted: boolean
}

const exchanges: Exchange[] = []

interface CallInit {
  readonly key?: string | null
  readonly body?: unknown
  readonly rawBody?: string
}

interface CallResult {
  readonly status: number
  readonly body: unknown
  readonly contentType: string | null
}

function decode(text: string): unknown {
  return text === '' ? undefined : JSON.parse(text)
}

function setup(options: FakeBillingoOptions = {}) {
  const billingo = createFakeBillingoFetch({ now: () => WINTER, ...options })
  const capture = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await billingo.fetch(input, init)
    const record = billingo.requests.at(-1)
    if (!record) throw new Error('A hamis Billingo nem naplózta a kérést.')
    exchanges.push({
      label: `${record.method} ${record.path}`,
      operation: record.operation,
      status: response.status,
      body: decode(await response.clone().text()),
      contentType: response.headers.get('content-type') ?? undefined,
      faulted: record.faulted,
    })
    return response
  }
  const fetch = capture as typeof globalThis.fetch
  const tarca = createTarca({ apiKey: KEY, fetch, retryDelayMs: 0 })
  const call = async (method: string, path: string, init: CallInit = {}): Promise<CallResult> => {
    const headers = new Headers({ accept: 'application/json' })
    if (init.key !== null) headers.set('X-API-KEY', init.key ?? KEY)
    const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body))
    if (body !== undefined) headers.set('content-type', 'application/json')
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    })
    return {
      status: response.status,
      body: decode(await response.text()),
      contentType: response.headers.get('content-type'),
    }
  }
  return { billingo, tarca, call }
}

const ACCOUNT_INPUT = {
  name: 'Fő számla',
  account_number: '11773016-11111018-00000000',
  currency: 'HUF',
}

describe('hitelesítés és útvonalak', () => {
  test('X-API-KEY nélkül 401 a Billingo valódi üzenetével', async () => {
    const { call, billingo } = setup()

    const response = await call('GET', '/organization', { key: null })

    expect(response).toEqual({
      status: 401,
      body: { error: { message: FAKE_BILLINGO_MESSAGES.unauthorized } },
      contentType: 'application/json',
    })
    expect(FAKE_BILLINGO_MESSAGES.unauthorized).toBe(
      'Authorization information (Header: X-API-KEY or X-TOKEN) is missing or invalid.',
    )
    expect(billingo.requests[0]).toMatchObject({ operation: 'GetOrganizationData', status: 401 })
  })

  test('az apiKeys opcióval csak a felsorolt kulcs érvényes', async () => {
    const { call } = setup({ apiKeys: ['jo-kulcs'] })

    const wrong = await call('GET', '/organization', { key: 'rossz-kulcs' })
    const blank = await call('GET', '/organization', { key: '   ' })
    const right = await call('GET', '/organization', { key: 'jo-kulcs' })

    expect(wrong.status).toBe(401)
    expect(blank.status).toBe(401)
    expect(right.status).toBe(200)
  })

  test('ismeretlen útvonal: 404 üres üzenettel, kulcs nélkül is (élőben mérve)', async () => {
    const { call, billingo } = setup()

    const response = await call('GET', '/nincs-ilyen-utvonal', { key: null })

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: { message: '' } })
    expect(billingo.requests[0]?.operation).toBeUndefined()
  })

  test('rossz metódus: 405 a Laravel üzenetével, kulcs nélkül is (élőben mérve)', async () => {
    const { call } = setup()

    const account = await call('PATCH', '/bank-accounts/1', { key: null })
    const organization = await call('POST', '/organization')

    expect(account).toMatchObject({
      status: 405,
      body: {
        error: {
          message:
            'The PATCH method is not supported for this route. Supported methods: GET, HEAD, PUT, DELETE.',
        },
      },
    })
    expect(organization.body).toEqual({
      error: {
        message: 'The POST method is not supported for this route. Supported methods: GET, HEAD.',
      },
    })
  })

  test('a még meg nem valósított művelet 501-et ad a művelet nevével', async () => {
    const { call, billingo } = setup()

    const response = await call('GET', '/documents')

    expect(response.status).toBe(501)
    expect(response.body).toEqual({
      error: {
        message:
          'A hamis Billingo még nem valósítja meg ezt a műveletet: ListDocument (GET /documents).',
        trace_id: expect.stringMatching(HEX_TRACE_ID),
      },
    })
    expect(billingo.requests[0]?.operation).toBe('ListDocument')
  })

  test('HEAD a GET útvonalon törzs nélkül válaszol', async () => {
    const { billingo } = setup()

    const response = await billingo.fetch(`${API}/organization`, {
      method: 'HEAD',
      headers: { 'X-API-KEY': KEY },
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(billingo.requests[0]).toMatchObject({ operation: 'GetOrganizationData', method: 'HEAD' })
  })

  test('Request objektumot is elfogad, és a GET törzset a fetch-hez hasonlóan elutasítja', async () => {
    const { billingo } = setup()

    const response = await billingo.fetch(
      new Request(`${API}/organization`, { headers: { 'X-API-KEY': KEY } }),
    )

    expect(response.status).toBe(200)
    await expect(
      billingo.fetch(`${API}/organization`, {
        method: 'GET',
        headers: { 'X-API-KEY': KEY },
        body: '{}',
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(billingo.requests).toHaveLength(1)
  })

  test('a már megszakított kérést nem dolgozza fel', async () => {
    const { billingo } = setup()
    const controller = new AbortController()
    controller.abort(new Error('megszakítva'))

    await expect(
      billingo.fetch(`${API}/organization`, {
        headers: { 'X-API-KEY': KEY },
        signal: controller.signal,
      }),
    ).rejects.toThrow('megszakítva')
    await expect(
      billingo.fetch(
        new Request(`${API}/organization`, {
          headers: { 'X-API-KEY': KEY },
          signal: controller.signal,
        }),
      ),
    ).rejects.toThrow('megszakítva')
    expect(billingo.requests).toHaveLength(0)
  })

  test('a /v3 előtag nélküli címen is működik, a puszta /v3 404', async () => {
    const billingo = createFakeBillingoFetch()
    const headers = { 'X-API-KEY': KEY }

    const plain = await billingo.fetch('http://localhost:8787/bank-accounts?per_page=1', {
      headers,
    })
    const bare = await billingo.fetch(API, { headers })

    expect(plain.status).toBe(200)
    expect(await plain.json()).toMatchObject({ total: 0, per_page: 1 })
    expect(bare.status).toBe(404)
    expect(billingo.requests.map((request) => request.path)).toEqual(['/bank-accounts', '/'])
  })

  test('egyedi baseUrl mögött is működik, a lapozó URL-ek azt használják', async () => {
    const billingo = createFakeBillingoFetch()
    const tarca = createTarca({
      apiKey: KEY,
      fetch: billingo.fetch,
      baseUrl: 'http://localhost:8787/billingo/v3',
      retryDelayMs: 0,
    })
    await tarca.bankAccounts.create({ name: 'A', accountNumber: '1', currency: 'HUF' })
    await tarca.bankAccounts.create({ name: 'B', accountNumber: '2', currency: 'HUF' })

    const response = await billingo.fetch(
      'http://localhost:8787/billingo/v3/bank-accounts?per_page=1',
      { headers: { 'X-API-KEY': KEY } },
    )

    expect(await response.json()).toMatchObject({
      next_page_url: 'http://localhost:8787/billingo/v3/bank-accounts?page=2',
    })
    expect(billingo.requests.map((request) => request.path)).toEqual([
      '/bank-accounts',
      '/bank-accounts',
      '/bank-accounts',
    ])
  })
})

describe('szervezet', () => {
  test('friss teszt profil: NAV kapcsolat nélkül, a teszt profil adószámával, a valódi mezősorrenddel', async () => {
    const { call } = setup()

    const response = await call('GET', '/organization')

    expect(response).toEqual({
      status: 200,
      contentType: 'application/json',
      body: {
        tax_code: '00000000-0-00',
        subscription: { expiration_date: '2026-11-16', features: [] },
        has_nav_connection: false,
        kobak_receipt_fs_enabled: true,
        has_successful_nav_receipt_submission: false,
      },
    })
    expect(Object.keys(response.body as object)).toEqual([
      'tax_code',
      'subscription',
      'has_nav_connection',
      'kobak_receipt_fs_enabled',
      'has_successful_nav_receipt_submission',
    ])
  })

  test('az adószám, a NAV kapcsolat és az előfizetés az opciókból jön, camelCase a kliensben', async () => {
    const { tarca } = setup({
      taxCode: '12345676-2-42',
      hasNavConnection: true,
      subscription: { expirationDate: '2027-01-31', features: ['api_limit_basic'] },
    })

    const organization = await tarca.organization.get()

    expect(organization).toEqual({
      taxCode: '12345676-2-42',
      subscription: { expirationDate: '2027-01-31', features: ['api_limit_basic'] },
      hasNavConnection: true,
      kobakReceiptFsEnabled: true,
      hasSuccessfulNavReceiptSubmission: false,
    })
  })

  test('az előfizetés alapból a budapesti holnapig él, éjfél után is', async () => {
    const { tarca } = setup({ now: () => new Date('2026-11-15T23:30:00Z') })

    const organization = await tarca.organization.get()

    expect(organization.subscription?.expirationDate).toBe('2026-11-17')
  })
})

describe('segédfüggvények', () => {
  test('szerveridő budapesti időzónában, téli és nyári időszámítással', async () => {
    const winter = await setup().call('GET', '/utils/time')
    const summer = await setup({ now: () => SUMMER }).call('GET', '/utils/time')

    expect(winter.body).toEqual({
      epoch: Math.floor(WINTER.getTime() / 1000),
      formatted: '2026-11-15 14:50:07',
      w3c: '2026-11-15T14:50:07+01:00',
      timezone: 'Europe/Budapest',
    })
    expect(summer.body).toEqual({
      epoch: Math.floor(SUMMER.getTime() / 1000),
      formatted: '2026-07-15 00:30:00',
      w3c: '2026-07-15T00:30:00+02:00',
      timezone: 'Europe/Budapest',
    })
  })

  test('adószám-ellenőrzés: a hibás formátum 422, élőben mért törzzsel', async () => {
    const { call } = setup()

    const short = await call('GET', '/utils/check-tax-number/12345678')
    const zero = await call('GET', '/utils/check-tax-number/00000000-0-00')

    const expected = {
      status: 422,
      contentType: 'application/json',
      body: {
        message: 'Validation Failed',
        errors: [{ field: 'taxNumber', message: 'The tax number format is invalid.' }],
      },
    }
    expect(short).toEqual(expected)
    expect(zero).toEqual(expected)
  })

  test('adószám-ellenőrzés NAV kapcsolat nélkül: 401 a sandbox üzenettel, nem kulcshiba', async () => {
    const { call, tarca } = setup()

    const response = await call('GET', '/utils/check-tax-number/13421739-2-41')
    const error = await tarca.utils.checkTaxNumber('13421739-2-41').catch((caught) => caught)

    expect(response.body).toEqual({
      error: {
        message:
          'To use this feature, please ensure you have a live connection to NAV (not available in sandbox mode)',
      },
    })
    expect(response.status).toBe(401)
    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      status: 401,
      apiMessage: FAKE_BILLINGO_MESSAGES.navConnectionRequired,
    })
  })

  test('adószám-ellenőrzés NAV kapcsolattal: ismert és ismeretlen adózó', async () => {
    const { tarca } = setup({
      hasNavConnection: true,
      taxpayers: {
        '13421739': {
          name: 'KBOSS.HU KFT.',
          shortName: 'KBOSS.HU',
          addresses: [
            {
              type: 'HQ',
              countryCode: 'HU',
              postalCode: '1031',
              city: 'Budapest',
              streetName: 'Záhony',
              publicPlaceCategory: 'utca',
              number: '7',
            },
          ],
        },
        '12345676-2-42': { name: 'Rövid Kft.' },
      },
    })

    const known = await tarca.utils.checkTaxNumber('13421739-2-41')
    const short = await tarca.utils.checkTaxNumber('12345676-2-42')
    const unknown = await tarca.utils.checkTaxNumber('11111111-2-41')

    expect(known).toEqual({
      taxNumber: '13421739-2-41',
      result: 'validation_ok',
      taxpayerName: 'KBOSS.HU KFT.',
      taxpayerShortName: 'KBOSS.HU',
      addresses: [
        {
          type: 'HQ',
          countryCode: 'HU',
          postalCode: '1031',
          city: 'Budapest',
          streetName: 'Záhony',
          publicPlaceCategory: 'utca',
          number: '7',
        },
      ],
    })
    expect(short).toMatchObject({ taxpayerShortName: null, addresses: [] })
    expect(unknown).toEqual({
      taxNumber: '11111111-2-41',
      result: 'non_exist_tax_number',
      taxpayerName: null,
      taxpayerShortName: null,
      addresses: null,
    })
  })

  test('régi azonosító átváltása: ismert, ismeretlen és nem szám', async () => {
    const { call, tarca } = setup({ legacyIds: { 12345: 987654321 } })

    const known = await tarca.utils.convertLegacyId(12345)
    const unknown = await call('GET', '/utils/convert-legacy-id/1')
    const text = await call('GET', '/utils/convert-legacy-id/abc')

    expect(known).toEqual({ id: 987654321, legacyId: 12345 })
    expect(unknown).toMatchObject({
      status: 404,
      body: { error: { message: LEGACY_ID_NOT_FOUND } },
    })
    expect(text.status).toBe(404)
  })

  test('a legacyIds és a hufRates hibás értékeit már létrehozáskor elutasítja', () => {
    expect(() => createFakeBillingoFetch({ legacyIds: { 0: 5 } })).toThrow(TypeError)
    expect(() => createFakeBillingoFetch({ legacyIds: { 5: 1.5 } })).toThrow(TypeError)
    expect(() => createFakeBillingoFetch({ hufRates: { EUR: 0 } })).toThrow(TypeError)
    expect(() => createFakeBillingoFetch({ hufRates: { EUR: Number.NaN } })).toThrow(
      'A hufRates.EUR értéke pozitív szám legyen',
    )
  })
})

describe('árfolyam', () => {
  test('EUR → HUF dátum nélkül a mai budapesti dátummal', async () => {
    const { call, tarca } = setup()

    const response = await call('GET', '/currencies?from=EUR&to=HUF')
    const rate = await tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: '2026-01-02' })

    expect(response.body).toEqual({
      from_currency: 'EUR',
      to_currency: 'HUF',
      conversation_rate: 390,
      date: '2026-11-15',
    })
    expect(rate).toEqual({ from: 'EUR', to: 'HUF', rate: 390, date: '2026-01-02' })
  })

  test('keresztárfolyam, fordított irány és azonos pénznem', async () => {
    const { tarca } = setup()

    const inverse = await tarca.currencies.rate({ from: 'HUF', to: 'EUR' })
    const cross = await tarca.currencies.rate({ from: 'EUR', to: 'USD' })
    const same = await tarca.currencies.rate({ from: 'JPY', to: 'JPY' })

    expect(inverse.rate).toBe(0.002564)
    expect(cross.rate).toBe(1.083333)
    expect(same.rate).toBe(1)
  })

  test('a hufRates felülírja az alapértelmezett árfolyamokat', async () => {
    const { tarca } = setup({ hufRates: { EUR: 400.5, JPY: 2.4 } })

    const eur = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' })
    const jpy = await tarca.currencies.rate({ from: 'EUR', to: 'JPY' })
    const usd = await tarca.currencies.rate({ from: 'USD', to: 'HUF' }).catch((error) => error)

    expect(eur.rate).toBe(400.5)
    expect(jpy.rate).toBe(166.875)
    expect(usd).toMatchObject({
      status: 422,
      fieldErrors: [{ field: 'from', message: missingRateMessage('USD') }],
    })
  })

  test('validáció: hiányzó és ismeretlen pénznem, hibás dátum, hiányzó árfolyam', async () => {
    const { call } = setup()

    const missing = await call('GET', '/currencies?to=HUF')
    const unknown = await call('GET', '/currencies?from=XXX&to=HUF&date=2026-02-30')
    const impossible = await call('GET', '/currencies?from=EUR&to=HUF&date=2026-13-01')
    const dotted = await call('GET', '/currencies?from=EUR&to=HUF&date=2026.01.02')
    const noRate = await call('GET', '/currencies?from=EUR&to=JPY')

    expect(missing).toMatchObject({
      status: 422,
      body: {
        message: 'Validation Failed',
        errors: [{ field: 'from', message: 'The from field is required.' }],
      },
    })
    expect(unknown.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'from', message: 'The selected from is invalid.' },
        { field: 'date', message: 'The date does not match the format Y-m-d.' },
      ],
    })
    for (const response of [impossible, dotted]) {
      expect(response.body).toEqual({
        message: 'Validation Failed',
        errors: [{ field: 'date', message: 'The date does not match the format Y-m-d.' }],
      })
    }
    expect(noRate.body).toEqual({
      message: 'Validation Failed',
      errors: [{ field: 'to', message: missingRateMessage('JPY') }],
    })
  })
})

describe('bankszámlák', () => {
  test('létrehozás: 201, teljes objektum az élő alapértékekkel', async () => {
    const { call, billingo } = setup()

    const first = await call('POST', '/bank-accounts', { body: ACCOUNT_INPUT })
    const second = await call('POST', '/bank-accounts', {
      body: {
        ...ACCOUNT_INPUT,
        name: '  EUR számla  ',
        currency: 'EUR',
        account_number_iban: 'HU42117730161111101800000000',
        swift: 'OTPVHUHB',
        need_qr: true,
        id: 999,
      },
    })

    expect(first).toEqual({
      status: 201,
      contentType: 'application/json',
      body: {
        id: 1,
        name: 'Fő számla',
        account_number: '11773016-11111018-00000000',
        account_number_iban: '',
        swift: '',
        currency: 'HUF',
        need_qr: false,
      },
    })
    expect(second.body).toEqual({
      id: 2,
      name: 'EUR számla',
      account_number: '11773016-11111018-00000000',
      account_number_iban: 'HU42117730161111101800000000',
      swift: 'OTPVHUHB',
      currency: 'EUR',
      need_qr: true,
    })
    expect(billingo.data.bankAccounts.get(2)).toMatchObject({ id: 2, currency: 'EUR' })
  })

  test('létrehozás validációja Laravel üzenetekkel', async () => {
    const { call, billingo } = setup()

    const empty = await call('POST', '/bank-accounts', { body: {} })
    const wrongTypes = await call('POST', '/bank-accounts', {
      body: { name: 12, account_number: ' ', currency: 'XXX', swift: 5, need_qr: 'igen' },
    })
    const notJson = await call('POST', '/bank-accounts', { rawBody: 'nem json' })

    expect(empty).toEqual({
      status: 422,
      contentType: 'application/json',
      body: {
        message: 'Validation Failed',
        errors: [
          { field: 'name', message: 'The name field is required.' },
          { field: 'account_number', message: 'The account number field is required.' },
          { field: 'currency', message: 'The currency field is required.' },
        ],
      },
    })
    expect(wrongTypes.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'name', message: 'The name must be a string.' },
        { field: 'account_number', message: 'The account number field is required.' },
        { field: 'currency', message: 'The selected currency is invalid.' },
        { field: 'swift', message: 'The swift must be a string.' },
        { field: 'need_qr', message: 'The need qr field must be true or false.' },
      ],
    })
    expect(notJson.body).toEqual(empty.body)
    expect(billingo.data.bankAccounts.size).toBe(0)
  })

  test('lista: a legújabb elöl, Laravel lapozással és az élő URL-alakkal', async () => {
    const { call } = setup()
    for (const name of ['A', 'B', 'C']) {
      await call('POST', '/bank-accounts', { body: { ...ACCOUNT_INPUT, name } })
    }

    const defaults = await call('GET', '/bank-accounts')
    const first = await call('GET', '/bank-accounts?per_page=2')
    const second = await call('GET', '/bank-accounts?per_page=2&page=2')
    const beyond = await call('GET', '/bank-accounts?per_page=2&page=5')

    expect(defaults.body).toMatchObject({
      total: 3,
      per_page: 25,
      current_page: 1,
      last_page: 1,
      prev_page_url: null,
      next_page_url: null,
    })
    expect(Object.keys(defaults.body as object)).toEqual([
      'total',
      'per_page',
      'current_page',
      'last_page',
      'prev_page_url',
      'next_page_url',
      'data',
    ])
    expect(first.body).toMatchObject({
      total: 3,
      per_page: 2,
      current_page: 1,
      last_page: 2,
      prev_page_url: null,
      next_page_url: `${API}/bank-accounts?page=2`,
      data: [
        { id: 3, name: 'C' },
        { id: 2, name: 'B' },
      ],
    })
    expect(second.body).toMatchObject({
      current_page: 2,
      prev_page_url: `${API}/bank-accounts?page=1`,
      next_page_url: null,
      data: [{ id: 1, name: 'A' }],
    })
    expect(beyond.body).toMatchObject({
      current_page: 5,
      last_page: 2,
      prev_page_url: `${API}/bank-accounts?page=4`,
      next_page_url: null,
      data: [],
    })
  })

  test('lista üres profilon: total 0, last_page 1, null URL-ek', async () => {
    const { call } = setup()

    const response = await call('GET', '/bank-accounts')

    expect(response.body).toEqual({
      total: 0,
      per_page: 25,
      current_page: 1,
      last_page: 1,
      prev_page_url: null,
      next_page_url: null,
      data: [],
    })
  })

  test('lapozás validációja: per_page legfeljebb 100, page és per_page legalább 1, egész', async () => {
    const { call } = setup()

    const tooMany = await call('GET', '/bank-accounts?per_page=101')
    const zero = await call('GET', '/bank-accounts?per_page=0&page=0')
    const text = await call('GET', '/bank-accounts?page=abc&per_page=1.5')
    const max = await call('GET', '/bank-accounts?per_page=100')

    expect(tooMany.body).toEqual({
      message: 'Validation Failed',
      errors: [{ field: 'per_page', message: 'The per page must not be greater than 100.' }],
    })
    expect(zero.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'page', message: 'The page must be at least 1.' },
        { field: 'per_page', message: 'The per page must be at least 1.' },
      ],
    })
    expect(text.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'page', message: 'The page must be an integer.' },
        { field: 'per_page', message: 'The per page must be an integer.' },
      ],
    })
    expect(max).toMatchObject({ status: 200, body: { per_page: 100 } })
  })

  test('a kliens all() metódusa minden oldalt bejár', async () => {
    const { tarca, billingo } = setup()
    for (const name of ['A', 'B', 'C']) {
      await tarca.bankAccounts.create({ name, accountNumber: '1', currency: 'HUF' })
    }

    const names: string[] = []
    for await (const account of tarca.bankAccounts.all({ perPage: 2 })) names.push(account.name)

    expect(names).toEqual(['C', 'B', 'A'])
    expect(billingo.count('ListBankAccount')).toBe(2)
  })

  test('lekérés, teljes cserés módosítás és törlés', async () => {
    const { call, tarca } = setup()
    const created = await tarca.bankAccounts.create({
      name: 'Régi',
      accountNumber: '11773016-11111018',
      accountNumberIban: 'HU42117730161111101800000000',
      swift: 'OTPVHUHB',
      currency: 'HUF',
    })
    const id = created.id ?? Number.NaN

    const fetched = await tarca.bankAccounts.get(id)
    const updated = await tarca.bankAccounts.update(id, {
      name: 'Új',
      accountNumber: '11773016-22222222',
      currency: 'EUR',
    })
    const invalid = await call('PUT', `/bank-accounts/${id}`, { body: { name: 'Hiányos' } })
    const deleted = await call('DELETE', `/bank-accounts/${id}`)
    const afterDelete = await call('GET', `/bank-accounts/${id}`)

    expect(fetched).toEqual(created)
    expect(updated).toEqual({
      id,
      name: 'Új',
      accountNumber: '11773016-22222222',
      accountNumberIban: '',
      swift: '',
      currency: 'EUR',
      needQr: false,
    })
    expect(invalid.status).toBe(422)
    expect(deleted).toEqual({ status: 204, body: undefined, contentType: null })
    expect(afterDelete.status).toBe(403)
  })

  test('ismeretlen azonosító: 403 a valódi jogosultsági üzenettel (élő MCP fixture)', async () => {
    const { call, tarca } = setup()

    const get = await call('GET', '/bank-accounts/424242')
    const put = await call('PUT', '/bank-accounts/424242', { body: ACCOUNT_INPUT })
    const remove = await call('DELETE', '/bank-accounts/424242')
    const text = await call('GET', '/bank-accounts/abc')
    const zero = await call('GET', '/bank-accounts/0')
    const huge = await call('GET', '/bank-accounts/99999999999999999999')
    const error = await tarca.bankAccounts.get(424242).catch((caught) => caught)

    for (const response of [get, put, remove, text, zero, huge]) {
      expect(response).toEqual({
        status: 403,
        contentType: 'application/json',
        body: {
          error: {
            message:
              'You do not have permission for this operation. Or any ID in request is invalid or you do not have permission.',
          },
        },
      })
    }
    expect(error).toMatchObject({ category: 'forbidden', status: 403, isNotFound: false })
  })
})

describe('hibainjektálás', () => {
  test('státuszhiba egy műveletre: 500 trace_id-val, a GET-et a kliens újrapróbálja', async () => {
    const { call, tarca, billingo } = setup()
    billingo.fail({ status: 500 }, { operation: 'GetOrganizationData' })

    const raw = await call('GET', '/organization')
    billingo.fail({ status: 500 }, { operation: 'GetOrganizationData' })
    const organization = await tarca.organization.get()

    expect(raw.status).toBe(500)
    expect(raw.body).toEqual({
      error: { message: 'Internal Server Error.', trace_id: expect.stringMatching(HEX_TRACE_ID) },
    })
    expect(organization.taxCode).toBe('00000000-0-00')
    expect(billingo.requests.map((request) => [request.status, request.faulted])).toEqual([
      [500, true],
      [500, true],
      [200, false],
    ])
  })

  test('times: egymás utáni hibák, utána újra rendben', async () => {
    const { tarca, billingo } = setup()
    billingo.fail(
      { status: 503, message: 'Karbantartás' },
      { operation: 'GetServerTime', times: 3 },
    )

    const error = await tarca.utils.serverTime().catch((caught) => caught)
    const time = await tarca.utils.serverTime()

    expect(error).toMatchObject({ category: 'server', status: 503, apiMessage: 'Karbantartás' })
    expect(time.timezone).toBe('Europe/Budapest')
    expect(billingo.count('GetServerTime')).toBe(4)
  })

  test('hálózati hiba írásnál: nincs újrapróbálás, nincs létrehozott bankszámla', async () => {
    const { tarca, billingo } = setup()
    billingo.fail('network', { operation: 'CreateBankAccount' })

    const error = await tarca.bankAccounts
      .create({ name: 'A', accountNumber: '1', currency: 'HUF' })
      .catch((caught) => caught)

    expect(error).toMatchObject({ category: 'network' })
    expect(billingo.data.bankAccounts.size).toBe(0)
    expect(billingo.requests).toEqual([
      {
        operation: 'CreateBankAccount',
        method: 'POST',
        path: '/bank-accounts',
        query: {},
        body: { name: 'A', account_number: '1', currency: 'HUF' },
        status: 'network',
        faulted: true,
      },
    ])
  })

  test('afterSuccess: a bankszámla létrejön, de a kliens hálózati hibát vagy 500-at kap', async () => {
    const { tarca, billingo } = setup()
    billingo.fail('network', { operation: 'CreateBankAccount', afterSuccess: true })
    billingo.fail({ status: 500 }, { operation: 'CreateBankAccount', afterSuccess: true })

    const lost = await tarca.bankAccounts
      .create({ name: 'Elveszett válasz', accountNumber: '1', currency: 'HUF' })
      .catch((caught) => caught)
    const failed = await tarca.bankAccounts
      .create({ name: 'Szerverhiba után', accountNumber: '2', currency: 'HUF' })
      .catch((caught) => caught)

    expect(lost).toMatchObject({ category: 'network' })
    expect(failed).toMatchObject({ category: 'server', status: 500 })
    expect([...billingo.data.bankAccounts.values()].map((account) => account.name)).toEqual([
      'Elveszett válasz',
      'Szerverhiba után',
    ])
    expect(billingo.requests.map((request) => request.status)).toEqual(['network', 500])
  })

  test('afterSuccess hibás kérésnél: a 422 megy ki, a hiba elfogy', async () => {
    const { call, billingo } = setup()
    billingo.fail('network', { operation: 'CreateBankAccount', afterSuccess: true })

    const invalid = await call('POST', '/bank-accounts', { body: {} })
    const valid = await call('POST', '/bank-accounts', { body: ACCOUNT_INPUT })

    expect(invalid.status).toBe(422)
    expect(valid.status).toBe(201)
  })

  test('időtúllépés: a kliens timeout kategóriát kap', async () => {
    const { tarca, billingo } = setup()
    billingo.fail('timeout', { operation: 'GetConversionRate', times: 3 })

    const error = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' }).catch((caught) => caught)

    expect(error).toMatchObject({ category: 'timeout' })
    expect(billingo.requests.map((request) => request.status)).toEqual([
      'timeout',
      'timeout',
      'timeout',
    ])
  })

  test('notReady: N egymás utáni 202, a GET kivárja', async () => {
    const { call, tarca, billingo } = setup()
    billingo.fail('notReady', { operation: 'GetOrganizationData' })

    const raw = await call('GET', '/organization')
    billingo.fail('notReady', { operation: 'GetOrganizationData', times: 2 })
    const organization = await tarca.organization.get()

    expect(raw).toEqual({
      status: 202,
      contentType: 'application/json',
      body: { error: { message: 'Document PDF has not generated yet.' } },
    })
    expect(organization.hasNavConnection).toBe(false)
    expect(billingo.requests.map((request) => request.status)).toEqual([202, 202, 202, 200])
  })

  test('művelet nélküli hiba a következő kérést éri, a sorrend FIFO', async () => {
    const { call, billingo } = setup()
    billingo.fail({ status: 429 })
    billingo.fail({ status: 402 }, { operation: 'GetServerTime' })

    const first = await call('GET', '/organization')
    const skipped = await call('GET', '/organization')
    const second = await call('GET', '/utils/time')

    expect(first).toMatchObject({ status: 429, body: { error: { message: 'Too many requests' } } })
    expect(skipped.status).toBe(200)
    expect(second).toMatchObject({
      status: 402,
      body: { error: { message: 'You do not have subscription for this operation' } },
    })
  })

  test('a státuszhibák alapüzenetei a Billingo hibaformáiban', async () => {
    const { call, billingo } = setup()
    for (const status of [400, 401, 403, 404, 422, 503]) billingo.fail({ status })

    const responses = []
    for (let index = 0; index < 6; index++) responses.push(await call('GET', '/organization'))

    expect(responses.map((response) => [response.status, response.body])).toEqual([
      [400, { error: { message: '' } }],
      [401, { error: { message: FAKE_BILLINGO_MESSAGES.unauthorized } }],
      [403, { error: { message: FAKE_BILLINGO_MESSAGES.forbidden } }],
      [404, { error: { message: '' } }],
      [422, { message: 'Validation Failed', errors: [] }],
      [
        503,
        {
          error: {
            message: 'Internal Server Error.',
            trace_id: expect.stringMatching(HEX_TRACE_ID),
          },
        },
      ],
    ])
  })

  test('a hitelesítés a hiba előtt jön: kulcs nélkül 401, a hiba megmarad', async () => {
    const { call } = setup({ faults: [{ fault: { status: 500 } }] })

    const unauthenticated = await call('GET', '/organization', { key: null })
    const faulted = await call('GET', '/organization')

    expect(unauthenticated.status).toBe(401)
    expect(faulted.status).toBe(500)
  })

  test('az opciókban ütemezett hibák a reset után újra élesek', async () => {
    const { call, billingo } = setup({
      faults: [{ fault: { status: 500 }, operation: 'GetOrganizationData' }],
    })

    const before = await call('GET', '/organization')
    billingo.reset()
    const afterReset = await call('GET', '/organization')
    const healthy = await call('GET', '/organization')

    expect([before.status, afterReset.status, healthy.status]).toEqual([500, 500, 200])
  })

  test('hibás hibaparaméterek: magyar TypeError', () => {
    const { billingo } = setup()

    expect(() => billingo.fail('network', { times: 0 })).toThrow('A times értéke')
    expect(() => billingo.fail({ status: 200 })).toThrow('400 és 599')
    expect(() => billingo.fail({ status: 600 })).toThrow('400 és 599')
    expect(() =>
      billingo.fail('network', { operation: 'Nincs' as unknown as OperationId }),
    ).toThrow('Ismeretlen Billingo művelet: Nincs')
    expect(() => billingo.fail('notReady', { afterSuccess: true })).toThrow('afterSuccess')
    expect(() => billingo.fail('villám' as unknown as 'network')).toThrow(
      'Ismeretlen hamis Billingo hiba',
    )
  })
})

describe('betekintés és izoláció', () => {
  test('a naplóban művelet, útvonal, lekérdezés és törzs van, kulcs soha', async () => {
    const { call, billingo } = setup()

    await call('POST', '/bank-accounts', { body: ACCOUNT_INPUT })
    await call('GET', '/bank-accounts?per_page=10&page=1')

    expect(billingo.requests).toEqual([
      {
        operation: 'CreateBankAccount',
        method: 'POST',
        path: '/bank-accounts',
        query: {},
        body: ACCOUNT_INPUT,
        status: 201,
        faulted: false,
      },
      {
        operation: 'ListBankAccount',
        method: 'GET',
        path: '/bank-accounts',
        query: { per_page: '10', page: '1' },
        body: undefined,
        status: 200,
        faulted: false,
      },
    ])
    expect(JSON.stringify(billingo.requests)).not.toContain(KEY)
  })

  test('count és counts műveletenként', async () => {
    const { tarca, billingo } = setup()

    await tarca.organization.get()
    await tarca.organization.get()
    await tarca.utils.serverTime()
    await billingo.fetch(`${API}/nincs`, { headers: { 'X-API-KEY': KEY } })

    expect(billingo.count()).toBe(4)
    expect(billingo.count('GetOrganizationData')).toBe(2)
    expect(billingo.count('ListBankAccount')).toBe(0)
    expect(billingo.counts()).toEqual({ GetOrganizationData: 2, GetServerTime: 1 })
  })

  test('két példány állapota független, az azonosítók példányonként 1-től indulnak', async () => {
    const first = setup()
    const second = setup()

    await first.tarca.bankAccounts.create({ name: 'Első', accountNumber: '1', currency: 'HUF' })
    const other = await second.tarca.bankAccounts.create({
      name: 'Második',
      accountNumber: '2',
      currency: 'HUF',
    })
    first.billingo.fail({ status: 500 })

    expect(other.id).toBe(1)
    expect(first.billingo.data.bankAccounts.size).toBe(1)
    expect(second.billingo.data.bankAccounts.size).toBe(1)
    expect((await second.call('GET', '/organization')).status).toBe(200)
  })

  test('reset: üres napló, kezdőállapot, az azonosítók újraindulnak', async () => {
    const { tarca, billingo } = setup()
    await tarca.bankAccounts.create({ name: 'A', accountNumber: '1', currency: 'HUF' })
    billingo.fail({ status: 500 })

    billingo.reset()
    const created = await tarca.bankAccounts.create({
      name: 'B',
      accountNumber: '2',
      currency: 'HUF',
    })

    expect(created.id).toBe(1)
    expect(billingo.requests).toHaveLength(1)
    expect([...billingo.data.bankAccounts.keys()]).toEqual([1])
    expect(billingo.data.documentBlocks.size).toBe(2)
  })

  test('friss teszt profil számlatömbjei: Számlák és Nyugták NYT előtaggal', () => {
    const { billingo } = setup()

    expect([...billingo.data.documentBlocks.values()]).toEqual([
      {
        id: 1,
        name: 'Számlák',
        prefix: '',
        customField1: '',
        customField2: '',
        type: 'invoice',
      },
      {
        id: 2,
        name: 'Nyugták',
        prefix: 'NYT',
        customField1: '',
        customField2: '',
        type: 'receipt',
      },
    ])
  })
})

const UNDOCUMENTED_STATUSES: Readonly<Record<string, string>> = {
  'GetBankAccount 403':
    'Az ismeretlen vagy idegen azonosítóra a Billingo élőben 403-at ad (hivatalos MCP fixture: not_found.json), a spec erre a műveletre csak 404-et dokumentál.',
}

const LIVE_DEVIATIONS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /\.(prev|next)_page_url: null nem engedett$/,
    reason:
      'Élőben null az első és az utolsó oldalon (hivatalos MCP fixture: bank_accounts.json), a spec nem nullable stringet ír.',
  },
]

function genericErrorSchema(status: number): string {
  if (status === 422) return 'ValidationErrorResponse'
  return status >= 500 ? 'ServerErrorResponse' : 'ClientErrorResponse'
}

function usesGenericShape(exchange: Exchange): boolean {
  return (
    exchange.faulted ||
    exchange.operation === undefined ||
    exchange.status === 501 ||
    UNDOCUMENTED_STATUSES[`${exchange.operation} ${exchange.status}`] !== undefined
  )
}

function specErrors(exchange: Exchange): string[] {
  const spec = loadMergedSpec()
  if (!spec) throw new Error('Nincs .spec-cache: futtasd az npm run spec:fetch parancsot.')
  const label = `${exchange.label} → ${exchange.status}`
  let errors: readonly string[]
  if (usesGenericShape(exchange)) {
    errors =
      exchange.body === undefined
        ? ['hiányzik a hibaválasz törzse']
        : createValidator(spec.components.schemas).validate(
            genericErrorSchema(exchange.status),
            exchange.body,
            { direction: 'response', mode: 'strict' },
          )
  } else if (exchange.operation !== undefined) {
    errors = responseErrors(exchange.operation, exchange.status, exchange.body, {
      mode: 'strict',
      contentType: exchange.contentType,
    }).errors
  } else {
    errors = []
  }
  return errors
    .filter((error) => !LIVE_DEVIATIONS.some((deviation) => deviation.pattern.test(error)))
    .map((error) => `${label}: ${error}`)
}

describe.skipIf(!SPEC_AVAILABLE)('minden válasz a friss Billingo spec ellen', () => {
  test('az ellenőrzés nem üres: hibás törzs, nem dokumentált státusz, rossz null, fölös törzs', () => {
    const base = { faulted: false, contentType: 'application/json' }
    const broken = specErrors({
      ...base,
      label: 'GET /organization',
      operation: 'GetOrganizationData',
      status: 200,
      body: { tax_code: 12, subscription: { features: ['nincs_ilyen'] }, extra: true },
    })
    const undocumented = specErrors({
      ...base,
      label: 'GET /utils/time',
      operation: 'GetServerTime',
      status: 404,
      body: { error: { message: '' } },
    })
    const nullName = specErrors({
      ...base,
      label: 'GET /bank-accounts',
      operation: 'ListBankAccount',
      status: 200,
      body: { data: [{ name: null, account_number: '1', currency: 'HUF' }], prev_page_url: null },
    })
    const unexpectedBody = specErrors({
      ...base,
      label: 'DELETE /bank-accounts/1',
      operation: 'DeleteBankAccount',
      status: 204,
      body: { id: 1 },
    })
    const brokenError = specErrors({
      ...base,
      label: 'GET /organization',
      operation: 'GetOrganizationData',
      status: 500,
      body: { error: { message: 'x', trace_id: 5 } },
      faulted: true,
    })

    expect(broken.length).toBeGreaterThanOrEqual(3)
    expect(broken.join('\n')).toContain('tax_code')
    expect(broken.join('\n')).toContain('nincs_ilyen')
    expect(broken.join('\n')).toContain('extra')
    expect(undocumented).toHaveLength(1)
    expect(undocumented[0]).toContain('404')
    expect(nullName).toHaveLength(1)
    expect(nullName[0]).toContain('data[0].name: null nem engedett')
    expect(unexpectedBody).toHaveLength(1)
    expect(brokenError).toHaveLength(1)
    expect(brokenError[0]).toContain('trace_id')
  })

  test('a hamis Billingo pénznemlistája azonos a spec Currency enumjával', () => {
    const currency = loadMergedSpec()?.components.schemas.Currency
    expect([...CURRENCIES].sort()).toEqual([...(currency?.enum ?? [])].sort())
  })

  test('a fenti tesztek minden válasza megfelel a spec válaszsémájának', () => {
    expect(exchanges.length).toBeGreaterThan(50)
    expect(exchanges.flatMap(specErrors)).toEqual([])
  })

  test('minden megvalósított művelet legalább egy sikeres válasza át lett vizsgálva', () => {
    const succeeded = new Set<string | undefined>(
      exchanges
        .filter((exchange) => !exchange.faulted && exchange.status >= 200 && exchange.status < 300)
        .map((exchange) => exchange.operation),
    )
    const implemented = Object.keys(FAKE_ROUTES)

    expect(implemented.length).toBeGreaterThanOrEqual(10)
    expect(implemented.filter((operation) => !succeeded.has(operation))).toEqual([])
  })
})
