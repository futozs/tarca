import { describe, expect, test } from 'vitest'
import { createTestContext, mockBillingo, type Reply } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { BillingoError, nullIfNotFound } from '../core/errors'
import { createPartnersApi, type PartnerInput } from './partners'

function setup(...replies: Reply[]) {
  const mock = mockBillingo(...replies)
  return { mock, partners: createPartnersApi(createTestContext(mock)) }
}

function storedPartner(id: number, fields: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Vevő Kft.',
    address: {
      country_code: 'HU',
      post_code: '1111',
      city: 'Budapest',
      address: 'Fő utca 1.',
    },
    emails: ['szamla@vevo.example'],
    taxcode: '12345676-2-42',
    iban: '',
    swift: '',
    account_number: '',
    phone: '+36301234567',
    general_ledger_number: '',
    tax_type: 'HAS_TAX_NUMBER',
    custom_billing_settings: {
      payment_method: null,
      document_form: null,
      due_days: null,
      document_currency: null,
      template_language_code: null,
      discount: null,
      custom_label: null,
    },
    group_member_tax_number: '',
    giro_settings: {
      giro_default_settings: true,
      giro_payment_request_enabled: false,
      giro_different_amount_allowed: false,
    },
    partner_shipping: {
      match: true,
      name: '',
      mode: 'none',
      address: { country_code: 'HU', post_code: '', city: '', address: '' },
    },
    internal_comment: '',
    partner_show_type: 'show_all',
    ...fields,
  }
}

function page(data: readonly unknown[], currentPage = 1, lastPage = 1) {
  return {
    status: 200,
    json: {
      total: data.length,
      per_page: 100,
      current_page: currentPage,
      last_page: lastPage,
      prev_page_url: null,
      next_page_url: null,
      data,
    },
  }
}

const SZEGED = { country_code: 'HU', post_code: '6720', city: 'Szeged', address: 'Fő utca 1.' }

const BUYER: PartnerInput = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['szamla@vevo.example'],
  taxcode: '12345676-2-42',
  taxType: 'HAS_TAX_NUMBER',
}

const FULL_PARTNER: PartnerInput = {
  name: 'Teljes Partner Zrt.',
  address: { countryCode: 'AT', postCode: '1010', city: 'Wien', address: 'Ring 1.' },
  emails: ['szamla@teljes.example', 'konyveles@teljes.example'],
  taxcode: 'ATU12345678',
  iban: 'HU42117730161111101800000000',
  swift: 'OTPVHUHB',
  accountNumber: '11773016-11111018',
  phone: '+43 1 234 5678',
  generalLedgerNumber: '311',
  taxType: 'FOREIGN',
  customBillingSettings: {
    paymentMethod: 'wire_transfer',
    documentForm: 'electronic',
    dueDays: 15,
    documentCurrency: 'EUR',
    templateLanguageCode: 'de',
    discount: { type: 'percent', value: 5 },
    customLabel: { label: 'Partner', isVisible: true },
  },
  groupMemberTaxNumber: '',
  giroSettings: {
    giroDefaultSettings: false,
    giroPaymentRequestEnabled: true,
    giroDifferentAmountAllowed: false,
  },
  partnerShipping: {
    match: false,
    name: 'Raktár',
    mode: 'gls',
    address: { countryCode: 'AT', postCode: '1020', city: 'Wien', address: 'Lager 2.' },
  },
  internalComment: 'Belső megjegyzés',
  partnerShowType: 'show_outgoing',
}

function described(request: { method: string; url: URL }): string {
  return `${request.method} ${request.url.pathname}${request.url.search}`
}

describe('partners', () => {
  test('list: név szerinti keresés a query paraméterrel, camelCase válasz', async () => {
    const { mock, partners } = setup(page([storedPartner(7)]))

    const result = await partners.list({ query: 'Vevő Kft', perPage: 25 })

    expect(described(mock.requests[0] ?? { method: '', url: new URL('x:') })).toBe(
      'GET /v3/partners?per_page=25&query=Vev%C5%91+Kft',
    )
    expect(mock.requests[0]?.operation).toBe('ListPartner')
    expect(result.data[0]).toMatchObject({
      id: 7,
      taxcode: '12345676-2-42',
      accountNumber: '',
      taxType: 'HAS_TAX_NUMBER',
      customBillingSettings: { dueDays: null, documentCurrency: null },
      partnerShipping: { address: { countryCode: 'HU', postCode: '' } },
    })
    await expect(partners.list({ perPage: 101 })).rejects.toThrow('perPage')
    expect(mock.requests).toHaveLength(1)
  })

  test('all: minden oldalt bejár, a query-t minden oldalnak továbbadja', async () => {
    const { mock, partners } = setup(
      page([storedPartner(1)], 1, 2),
      page([storedPartner(2, { name: 'Vevő Bt.' })], 2, 2),
    )

    const ids: number[] = []
    for await (const partner of partners.all({ query: 'Vevő' })) ids.push(partner.id ?? 0)

    expect(ids).toEqual([1, 2])
    expect(mock.requests.map((request) => request.url.search)).toEqual([
      '?page=1&per_page=100&query=Vev%C5%91',
      '?page=2&per_page=100&query=Vev%C5%91',
    ])
  })

  test('get, create, update (teljes csere), delete és guess: útvonal, metódus, snake_case törzs', async () => {
    const { mock, partners } = setup(
      { status: 200, json: storedPartner(5) },
      { status: 201, json: storedPartner(5) },
      { status: 200, json: storedPartner(5, { phone: '' }) },
      { status: 204 },
      { status: 201, json: storedPartner(9) },
    )

    expect((await partners.get(5)).address).toEqual({
      countryCode: 'HU',
      postCode: '1111',
      city: 'Budapest',
      address: 'Fő utca 1.',
    })
    expect((await partners.create(BUYER)).id).toBe(5)
    expect((await partners.update(5, { ...BUYER, name: 'Vevő Kft. új' })).phone).toBe('')
    await partners.delete(5)
    expect((await partners.guess(BUYER)).id).toBe(9)

    expect(mock.requests.map(described)).toEqual([
      'GET /v3/partners/5',
      'POST /v3/partners',
      'PUT /v3/partners/5',
      'DELETE /v3/partners/5',
      'POST /v3/partners/guess',
    ])
    expect(mock.requests.map((request) => request.operation)).toEqual([
      'GetPartner',
      'CreatePartner',
      'UpdatePartner',
      'DeletePartner',
      'PartnerGuess',
    ])
    const sent = {
      name: 'Vevő Kft.',
      address: { country_code: 'HU', post_code: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      emails: ['szamla@vevo.example'],
      taxcode: '12345676-2-42',
      tax_type: 'HAS_TAX_NUMBER',
    }
    expect(mock.requests[1]?.body).toEqual(sent)
    expect(mock.requests[2]?.body).toEqual({ ...sent, name: 'Vevő Kft. új' })
    expect(mock.requests[3]?.body).toBeUndefined()
    expect(mock.requests[4]?.body).toEqual(sent)
  })

  test('a 404 „Partner is not found.” not_found hiba, a nullIfNotFound null-t ad', async () => {
    const notFound = { status: 404, json: { error: { message: 'Partner is not found.' } } }
    const { partners } = setup(notFound, notFound)

    await expect(partners.get(41)).rejects.toMatchObject({
      category: 'not_found',
      status: 404,
      operation: 'GetPartner',
      apiMessage: 'Partner is not found.',
    })
    expect(await nullIfNotFound(partners.get(41))).toBeNull()
  })
})

describe('partners.findOrCreate', () => {
  test('a pontosan egyező tárolt partnert adja vissza, egyetlen név szerinti kereséssel', async () => {
    const { mock, partners } = setup(
      page([
        storedPartner(1, { taxcode: '11111111-2-42' }),
        storedPartner(2, { phone: '+36 1 999 9999', iban: 'HU00' }),
        storedPartner(3),
      ]),
    )

    const result = await partners.findOrCreate({
      ...BUYER,
      name: '  Vevő   Kft. ',
      emails: [' SZAMLA@Vevo.Example '],
      address: { postCode: '1111 ', city: 'Budapest', address: 'Fő  utca 1.' },
    })

    expect(result.created).toBe(false)
    expect(result.partner.id).toBe(2)
    expect(mock.requests.map(described)).toEqual([
      'GET /v3/partners?page=1&per_page=100&query=Vev%C5%91+Kft.',
    ])
  })

  test('ha a tárolt adat bármely megadott mezőben eltér, új partnert hoz létre', async () => {
    const differences: readonly Record<string, unknown>[] = [
      { name: 'vevő kft.' },
      { taxcode: '' },
      { tax_type: '' },
      { emails: [] },
      { emails: ['szamla@vevo.example', 'masik@vevo.example'] },
      {
        address: { country_code: 'AT', post_code: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
      {
        address: { country_code: 'HU', post_code: '1112', city: 'Budapest', address: 'Fő utca 1.' },
      },
      {
        address: { country_code: 'HU', post_code: '1111', city: 'Budapest', address: 'Fő utca 2.' },
      },
    ]
    for (const difference of differences) {
      const { mock, partners } = setup(page([storedPartner(1, difference)]), {
        status: 201,
        json: storedPartner(2),
      })

      const result = await partners.findOrCreate(BUYER)

      expect([difference, result.created, result.partner.id]).toEqual([difference, true, 2])
      expect(mock.requests.map((request) => request.operation)).toEqual([
        'ListPartner',
        'CreatePartner',
      ])
      expect(mock.requests[1]?.body).toMatchObject({
        name: 'Vevő Kft.',
        address: { country_code: 'HU', post_code: '1111' },
      })
    }
  })

  test('a beágyazott beállításokat és az e-mailek sorrendjét is összeveti, a meg nem adottakat nem', async () => {
    const stored = storedPartner(4, {
      emails: ['a@vevo.example', 'b@vevo.example'],
      custom_billing_settings: {
        payment_method: 'cash',
        document_form: null,
        due_days: 8,
        document_currency: null,
        template_language_code: null,
        discount: { type: 'percent', value: 5 },
        custom_label: null,
      },
    })
    const matching: PartnerInput = {
      ...BUYER,
      emails: ['A@vevo.example', 'b@vevo.example'],
      customBillingSettings: { paymentMethod: 'cash', discount: { type: 'percent', value: 5 } },
    }
    const reused = setup(page([stored]))
    const reordered = setup(page([stored]), { status: 201, json: storedPartner(5) })
    const otherDiscount = setup(page([stored]), { status: 201, json: storedPartner(6) })

    expect((await reused.partners.findOrCreate(matching)).partner.id).toBe(4)
    const swapped = await reordered.partners.findOrCreate({
      ...matching,
      emails: ['b@vevo.example', 'a@vevo.example'],
    })
    const discounted = await otherDiscount.partners.findOrCreate({
      ...matching,
      customBillingSettings: { paymentMethod: 'cash', discount: { type: 'percent', value: 6 } },
    })

    expect([swapped.created, swapped.partner.id]).toEqual([true, 5])
    expect([discounted.created, discounted.partner.id]).toEqual([true, 6])
  })

  test('a megadott null is összevetendő érték: csak tárolt nullal egyezik, más értéknél létrehoz', async () => {
    const billing = {
      payment_method: null,
      document_form: null,
      due_days: 15,
      document_currency: null,
      template_language_code: null,
      discount: null,
      custom_label: null,
    }
    const reused = setup(page([storedPartner(1)]))
    const differing = setup(page([storedPartner(1, { custom_billing_settings: billing })]), {
      status: 201,
      json: storedPartner(2),
    })
    const input: PartnerInput = { ...BUYER, customBillingSettings: { dueDays: null } }

    const same = await reused.partners.findOrCreate(input)
    const fresh = await differing.partners.findOrCreate(input)

    expect([same.created, same.partner.id]).toEqual([false, 1])
    expect([fresh.created, fresh.partner.id]).toEqual([true, 2])
    expect(differing.mock.requests[1]?.body).toMatchObject({
      custom_billing_settings: { due_days: null },
    })
  })

  test('a tárolt null beágyazott objektum nem egyezik a megadott beállítással, ilyenkor létrehoz', async () => {
    const { mock, partners } = setup(page([storedPartner(1, { partner_shipping: null })]), {
      status: 201,
      json: storedPartner(2),
    })

    const result = await partners.findOrCreate({
      ...BUYER,
      partnerShipping: { match: true },
    })

    expect([result.created, result.partner.id]).toEqual([true, 2])
    expect(mock.requests.map((request) => request.operation)).toEqual([
      'ListPartner',
      'CreatePartner',
    ])
  })

  test('a JavaScriptből érkező undefined mezőt meg nem adottnak veszi', async () => {
    const { partners } = setup(page([storedPartner(3)]))
    const fromJavaScript: PartnerInput = Object.assign({}, BUYER, { phone: undefined })

    const result = await partners.findOrCreate(fromJavaScript)

    expect([result.created, result.partner.id]).toEqual([false, 3])
  })

  test('legfeljebb három 100-as oldalt néz át, utána létrehoz', async () => {
    const others = [storedPartner(1, { address: SZEGED })]
    const { mock, partners } = setup(page(others, 1, 9), page(others, 2, 9), page(others, 3, 9), {
      status: 201,
      json: storedPartner(10),
    })

    const result = await partners.findOrCreate(BUYER)

    expect(result).toMatchObject({ created: true, partner: { id: 10 } })
    expect(mock.requests.map((request) => request.url.searchParams.get('page'))).toEqual([
      '1',
      '2',
      '3',
      null,
    ])
  })

  test('az üres oldalnál megáll, akkor is, ha a késleltetett index még több oldalt jelez', async () => {
    const { mock, partners } = setup(
      { status: 200, json: { ...page([]).json, total: 7, last_page: 3 } },
      { status: 201, json: storedPartner(11) },
    )

    expect((await partners.findOrCreate(BUYER)).created).toBe(true)
    expect(mock.requests.map((request) => request.operation)).toEqual([
      'ListPartner',
      'CreatePartner',
    ])
  })

  test('üres névre kérés nélkül validációs hibát ad', async () => {
    const { mock, partners } = setup()

    for (const name of ['', '   ']) {
      const error = await partners
        .findOrCreate({ ...BUYER, name })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(BillingoError)
      expect(error).toMatchObject({
        category: 'validation',
        operation: 'CreatePartner',
        status: undefined,
        fieldErrors: [{ field: 'name' }],
      })
    }
    expect(mock.requests).toEqual([])
  })

  test('a megszakítást a kereséshez és a létrehozáshoz is továbbadja', async () => {
    const aborted = setup()
    const reason = new Error('megszakítva')
    const controller = new AbortController()
    controller.abort(reason)
    await expect(aborted.partners.findOrCreate(BUYER, { signal: controller.signal })).rejects.toBe(
      reason,
    )
    expect(aborted.mock.requests).toEqual([])

    const later = new AbortController()
    const { mock, partners } = setup({
      status: 200,
      json: page([storedPartner(1, { address: SZEGED })]).json,
    })
    const pending = partners.findOrCreate(BUYER, { signal: later.signal })
    later.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(mock.requests.map((request) => request.operation)).toEqual(['ListPartner'])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('a partner kérések a friss Billingo spec ellen', () => {
  test('a teljes partner törzse létrehozásnál, cserénél és guess-nél is megfelel a spec-nek', async () => {
    const { mock, partners } = setup(
      { status: 201, json: storedPartner(1) },
      { status: 200, json: storedPartner(1) },
      { status: 201, json: storedPartner(1) },
      page([]),
      { status: 201, json: storedPartner(2) },
    )

    await partners.create(FULL_PARTNER)
    await partners.update(1, FULL_PARTNER)
    await partners.guess(FULL_PARTNER)
    await partners.findOrCreate(FULL_PARTNER)

    expect(requestErrors('CreatePartner', mock.requests[0]?.body)).toEqual([])
    expect(requestErrors('UpdatePartner', mock.requests[1]?.body)).toEqual([])
    expect(requestErrors('PartnerGuess', mock.requests[2]?.body)).toEqual([])
    expect(requestErrors('CreatePartner', mock.requests[4]?.body)).toEqual([])
    expect(mock.requests[0]?.body).toMatchObject({
      address: { country_code: 'AT' },
      custom_billing_settings: {
        due_days: 15,
        custom_label: { label: 'Partner', is_visible: true },
      },
      partner_shipping: { address: { country_code: 'AT', post_code: '1020' } },
    })
  })

  test('a spec elutasítja a cím nélküli partnert és az azonosítót a törzsben', () => {
    expect(requestErrors('CreatePartner', { name: 'Vevő' })).toEqual([
      'Partner.address: kötelező mező hiányzik',
    ])
    expect(requestErrors('UpdatePartner', { ...storedPartner(1), extra: 1 }).join('\n')).toContain(
      'id',
    )
  })
})
