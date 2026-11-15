import { describe, expect, test } from 'vitest'
import {
  createTestContext,
  mockBillingo,
  mockBillingoWithoutContract,
  requestContractViolations,
} from './helpers'
import { SPEC_AVAILABLE } from './openapi'

const API = 'https://api.billingo.hu/v3'
const JSON_HEADERS = { 'content-type': 'application/json' }

function violations(method: string, path: string, init?: RequestInit): readonly string[] {
  return requestContractViolations(method, new URL(`${API}${path}`), init).violations
}

describe('mockBillingo: automatikus szerződés-ellenőrzés', () => {
  test('a kérést a metódus és az útvonal alapján műveletre képezi, és rögzíti', async () => {
    const mock = mockBillingo({ status: 200, json: { epoch: 1 } }, { status: 204 })
    const context = createTestContext(mock)

    await context.json({ operation: 'GetServerTime' })
    await context.empty({ operation: 'DeleteBankAccount', pathParams: { id: 4 } })

    expect(mock.requests.map((request) => request.operation)).toEqual([
      'GetServerTime',
      'DeleteBankAccount',
    ])
  })

  test('spec nélkül is hiba: ismeretlen útvonal, törzs GET-ben, nem JSON vagy hibás JSON törzs', () => {
    expect(violations('GET', '/nincs-ilyen')).toEqual([
      'Nincs ilyen Billingo művelet: GET /v3/nincs-ilyen',
    ])
    expect(violations('GET', '/utils/time', { body: '{}', headers: JSON_HEADERS })).toContain(
      'GetServerTime: GET kérésnek nem lehet törzse',
    )
    expect(violations('delete', '/bank-accounts/1', { method: 'delete', body: '{}' })).toContain(
      'DeleteBankAccount: DELETE kérésnek nem lehet törzse',
    )
    expect(violations('POST', '/bank-accounts', { body: new Blob(['x']) })).toContain(
      'a törzs nem JSON szöveg',
    )
    expect(
      violations('POST', '/bank-accounts', { body: '{nem json', headers: JSON_HEADERS })[0],
    ).toMatch(/^a törzs nem érvényes JSON/)
    expect(violations('POST', '/bank-accounts', { body: '{}' })).toContain(
      'CreateBankAccount: JSON törzs application/json Content-Type nélkül',
    )
  })

  test.fails('a szerződésszegő kérés akkor is elbuktatja a tesztet, ha a hívó elnyeli a fetch hibáját', async () => {
    const mock = mockBillingo({ status: 200, json: {} })
    await mock
      .fetch(`${API}/utils/time`, { method: 'GET', body: '{}', headers: JSON_HEADERS })
      .catch(() => undefined)
  })

  test('a szándékos negatív teszt indoklással kikapcsolhatja az ellenőrzést', async () => {
    const mock = mockBillingoWithoutContract('a 403-as CloudFront választ szimuláljuk', {
      status: 200,
      json: {},
    })
    const response = await mock.fetch(`${API}/utils/time`, {
      method: 'GET',
      body: '{}',
      headers: JSON_HEADERS,
    })

    expect(response.status).toBe(200)
    expect(mock.requests[0]).toMatchObject({ operation: 'GetServerTime', body: {} })
    expect(() => mockBillingoWithoutContract('  ')).toThrow('indoklás')
  })
})

describe.skipIf(!SPEC_AVAILABLE)('mockBillingo: a kérés a friss spec ellen', () => {
  test('a helyes kérés átmegy', () => {
    expect(
      violations('POST', '/bank-accounts', {
        method: 'POST',
        body: JSON.stringify({ name: 'Fő', account_number: '11773016-11111018', currency: 'HUF' }),
        headers: JSON_HEADERS,
      }),
    ).toEqual([])
    expect(violations('GET', '/bank-accounts?page=1&per_page=100')).toEqual([])
  })

  test('a törzs, a query és az útvonal-paraméter hibáját is jelzi', () => {
    expect(
      violations('POST', '/bank-accounts', {
        body: JSON.stringify({ id: 3, name: 'Fő', account_number: '1' }),
        headers: JSON_HEADERS,
      }),
    ).toEqual([
      'BankAccount.currency: kötelező mező hiányzik',
      'BankAccount.id: csak olvasható mező, kérésben nem küldhető',
    ])
    expect(violations('GET', '/bank-accounts?per_page=500&perPage=5')).toEqual([
      'ListBankAccount query.per_page: nagyobb, mint 100',
      'ListBankAccount query.perPage: a spec-ben nem szereplő query paraméter',
    ])
    expect(violations('GET', '/utils/check-tax-number/12345678')).toEqual([
      'CheckTaxNumber útvonal.tax_number: nem illeszkedik a mintára (^([0-9]{8})-([12345])-([0-9]{2})$)',
    ])
    expect(violations('GET', '/bank-accounts/abc')).toEqual([
      'GetBankAccount útvonal.id: integer típus kell, kapott: "abc"',
    ])
  })

  test('a nem dokumentált műveletek kérését a spec-felülírások szerint ellenőrzi', () => {
    expect(violations('GET', '/document-blocks/1')).toEqual([])
    expect(
      violations('PUT', '/document-blocks/1', {
        body: JSON.stringify({ name: 'Tömb', sender_email: null }),
        headers: JSON_HEADERS,
      }),
    ).toEqual([
      'DocumentBlockUpdate.prefix: kötelező mező hiányzik',
      'DocumentBlockUpdate.type: kötelező mező hiányzik',
      'DocumentBlockUpdate.sender_email: null nem engedett',
    ])
  })
})
