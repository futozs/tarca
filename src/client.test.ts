import { describe, expect, test } from 'vitest'
import { mockBillingo, TEST_API_KEY } from '../tests/helpers'
import { contractErrors } from '../tests/openapi'
import { createTarca, nullIfNotFound } from './client'
import { BillingoError } from './core/errors'

function client(...replies: Parameters<typeof mockBillingo>) {
  const mock = mockBillingo(...replies)
  return { mock, tarca: createTarca({ apiKey: TEST_API_KEY, fetch: mock.fetch, retryDelayMs: 0 }) }
}

describe('createTarca', () => {
  test('utils: szerveridő, adószám-ellenőrzés és régi azonosító', async () => {
    const { mock, tarca } = client(
      {
        status: 200,
        json: { epoch: 1, formatted: '2026-11-15 13:00:00', w3c: 'x', timezone: 'Europe/Budapest' },
      },
      {
        status: 200,
        json: { tax_number: '12345678-2-41', result: 'validation_ok', taxpayer_name: 'Teszt Kft.' },
      },
      { status: 200, json: { id: 99, legacy_id: 5 } },
    )

    expect((await tarca.utils.serverTime()).timezone).toBe('Europe/Budapest')
    expect(await tarca.utils.checkTaxNumber(' 12345678-2-41 ')).toMatchObject({
      taxNumber: '12345678-2-41',
      result: 'validation_ok',
      taxpayerName: 'Teszt Kft.',
    })
    expect(await tarca.utils.convertLegacyId(5)).toEqual({ id: 99, legacyId: 5 })
    expect(mock.requests.map((request) => request.url.pathname)).toEqual([
      '/v3/utils/time',
      '/v3/utils/check-tax-number/12345678-2-41',
      '/v3/utils/convert-legacy-id/5',
    ])
  })

  test('organization.get és verifyCredentials', async () => {
    const { tarca } = client(
      { status: 200, json: { tax_code: '12345678', has_nav_connection: false } },
      { status: 200, json: { tax_code: '12345678' } },
      {
        status: 401,
        json: { error: { message: 'Authorization information is missing or invalid.' } },
      },
      { status: 500, json: {} },
    )

    expect(await tarca.organization.get()).toEqual({ taxCode: '12345678', hasNavConnection: false })
    expect(await tarca.verifyCredentials()).toBe(true)
    expect(await tarca.verifyCredentials()).toBe(false)
    await expect(tarca.verifyCredentials({})).rejects.toBeInstanceOf(BillingoError)
  })

  test('currencies.rate dátummal és nélküle', async () => {
    const { mock, tarca } = client(
      {
        status: 200,
        json: {
          from_currency: 'EUR',
          to_currency: 'HUF',
          conversation_rate: 390.5,
          date: '2026-11-13',
        },
      },
      { status: 200, json: {} },
    )

    expect(
      await tarca.currencies.rate({
        from: 'EUR',
        to: 'HUF',
        date: new Date('2026-11-13T10:00:00Z'),
      }),
    ).toEqual({ from: 'EUR', to: 'HUF', rate: 390.5, date: '2026-11-13' })
    expect(mock.requests[0]?.url.search).toBe('?from=EUR&to=HUF&date=2026-11-13')
    await expect(tarca.currencies.rate({ from: 'EUR', to: 'HUF' })).rejects.toThrow('árfolyam')
    expect(mock.requests[1]?.url.search).toBe('?from=EUR&to=HUF')
  })

  test('bankAccounts: lista, bejárás, lekérés, létrehozás, módosítás, törlés', async () => {
    const account = { id: 1, name: 'Fő', account_number: '11773016-11111018', currency: 'HUF' }
    const { mock, tarca } = client(
      {
        status: 200,
        json: { data: [account], total: 1, per_page: 25, current_page: 1, last_page: 1 },
      },
      {
        status: 200,
        json: { data: [account], total: 1, per_page: 100, current_page: 1, last_page: 1 },
      },
      { status: 200, json: account },
      { status: 201, json: account },
      { status: 200, json: account },
      { status: 204 },
    )
    const input = { name: 'Fő', accountNumber: '11773016-11111018', currency: 'HUF' } as const

    expect((await tarca.bankAccounts.list({ perPage: 25 })).data[0]?.accountNumber).toBe(
      '11773016-11111018',
    )
    const all = []
    for await (const item of tarca.bankAccounts.all()) all.push(item.id)
    expect(all).toEqual([1])
    expect((await tarca.bankAccounts.get(1)).id).toBe(1)
    expect((await tarca.bankAccounts.create(input)).id).toBe(1)
    expect((await tarca.bankAccounts.update(1, input)).id).toBe(1)
    await tarca.bankAccounts.delete(1)

    expect(
      mock.requests.map(
        (request) => `${request.method} ${request.url.pathname}${request.url.search}`,
      ),
    ).toEqual([
      'GET /v3/bank-accounts?per_page=25',
      'GET /v3/bank-accounts?page=1&per_page=100',
      'GET /v3/bank-accounts/1',
      'POST /v3/bank-accounts',
      'PUT /v3/bank-accounts/1',
      'DELETE /v3/bank-accounts/1',
    ])
    expect(contractErrors('BankAccount', mock.requests[3]?.body)).toEqual([])
    expect(contractErrors('BankAccount', mock.requests[4]?.body)).toEqual([])
    await expect(tarca.bankAccounts.list({ page: 0 })).rejects.toThrow('page')
  })

  test('nullIfNotFound csak a 404-et nyeli el', async () => {
    const { tarca } = client(
      { status: 404, json: { error: { message: '' } } },
      {
        status: 403,
        json: { error: { message: 'You do not have permission for this operation' } },
      },
    )

    expect(await nullIfNotFound(tarca.bankAccounts.get(5))).toBeNull()
    await expect(nullIfNotFound(tarca.bankAccounts.get(6))).rejects.toMatchObject({
      category: 'forbidden',
    })
  })
})
