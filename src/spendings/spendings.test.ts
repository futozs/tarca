import { describe, expect, test } from 'vitest'
import { createTestContext, mockBillingo } from '../../tests/helpers'
import { parameterErrors, requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { BillingoError } from '../core/errors'
import { createSpendingsApi, type SpendingInput } from './spendings'

const LIVE_SPENDING = {
  id: 46873659,
  organization_id: 253389,
  category: 'other',
  paid_at: null,
  fulfillment_date: '2026-11-15',
  partner: null,
  invoice_number: 'TARCA-PROBE-S1',
  currency: 'HUF',
  conversion_rate: 1,
  total_gross: 1270,
  total_gross_local: 1270,
  total_vat_amount: 270,
  total_vat_amount_local: 270,
  invoice_date: '2026-11-15',
  due_date: '2026-11-15',
  payment_method: 'cash',
  comment: 'TARCA-PROBE',
  items: [],
}

const BEFORE_BUDAPEST_MIDNIGHT = new Date('2026-11-14T22:59:59Z')
const AFTER_BUDAPEST_MIDNIGHT = new Date('2026-11-14T23:00:00Z')

const INPUT: SpendingInput = {
  category: 'other',
  currency: 'HUF',
  conversionRate: 1,
  totalGross: 1270,
  totalGrossHuf: 1270,
  totalVatAmount: 270,
  totalVatAmountHuf: 270,
  fulfillmentDate: AFTER_BUDAPEST_MIDNIGHT,
  invoiceNumber: 'SZ-2026/1',
  invoiceDate: '2026-11-13',
  dueDate: BEFORE_BUDAPEST_MIDNIGHT,
  paymentMethod: 'cash',
}

const MINIMAL_BODY = {
  category: 'other',
  currency: 'HUF',
  conversion_rate: 1,
  total_gross: 1270,
  total_gross_huf: 1270,
  total_vat_amount: 270,
  total_vat_amount_huf: 270,
  fulfillment_date: '2026-11-15',
  invoice_number: 'SZ-2026/1',
  invoice_date: '2026-11-13',
  due_date: '2026-11-14',
  payment_method: 'cash',
}

const FULL_INPUT: SpendingInput = {
  ...INPUT,
  currency: 'EUR',
  conversionRate: 389.17,
  totalGross: 127,
  totalGrossHuf: 49_424.59,
  totalVatAmount: 27,
  totalVatAmountHuf: 10_507.59,
  paidAt: '2026-11-20',
  comment: 'Nyomdai munka',
  paymentMethod: 'wire_transfer',
  partnerId: 1968648578,
  category: 'advertisement',
}

function listPage(data: readonly unknown[], extra: Record<string, unknown> = {}) {
  return {
    total: data.length,
    per_page: 25,
    current_page: 1,
    last_page: 1,
    prev_page_url: null,
    next_page_url: null,
    data,
    ...extra,
  }
}

function setup(...replies: Parameters<typeof mockBillingo>) {
  const mock = mockBillingo(...replies)
  return { mock, spendings: createSpendingsApi(createTestContext(mock)) }
}

describe('spendings', () => {
  test('létrehozás: a dátumok budapesti YYYY-MM-DD alakban, snake_case törzs, paidAt csak ha van', async () => {
    const { mock, spendings } = setup({ status: 201, json: LIVE_SPENDING })

    const created = await spendings.create(INPUT)

    expect(created).toMatchObject({
      id: 46873659,
      organizationId: 253389,
      paidAt: null,
      partner: null,
      totalGrossLocal: 1270,
      items: [],
    })
    expect(mock.requests.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      'POST /v3/spendings',
    ])
    expect(mock.requests[0]?.body).toEqual(MINIMAL_BODY)
  })

  test('teljes cserés módosítás minden mezővel, lekérés created_by_nav-val, törlés', async () => {
    const { mock, spendings } = setup(
      { status: 200, json: { ...LIVE_SPENDING, paid_at: '2026-11-20' } },
      { status: 200, json: { ...LIVE_SPENDING, created_by_nav: false } },
      { status: 204 },
    )

    expect((await spendings.update(46873659, FULL_INPUT)).paidAt).toBe('2026-11-20')
    expect(await spendings.get(46873659)).toMatchObject({ id: 46873659, createdByNav: false })
    await expect(spendings.delete(46873659)).resolves.toBeUndefined()

    expect(
      mock.requests.map(
        (request) => `${request.operation} ${request.method} ${request.url.pathname}`,
      ),
    ).toEqual([
      'SpendingUpdate PUT /v3/spendings/46873659',
      'SpendingShow GET /v3/spendings/46873659',
      'SpendingDelete DELETE /v3/spendings/46873659',
    ])
    expect(mock.requests[0]?.body).toEqual({
      category: 'advertisement',
      currency: 'EUR',
      conversion_rate: 389.17,
      total_gross: 127,
      total_gross_huf: 49_424.59,
      total_vat_amount: 27,
      total_vat_amount_huf: 10_507.59,
      fulfillment_date: '2026-11-15',
      invoice_number: 'SZ-2026/1',
      invoice_date: '2026-11-13',
      due_date: '2026-11-14',
      paid_at: '2026-11-20',
      comment: 'Nyomdai munka',
      payment_method: 'wire_transfer',
      partner_id: 1968648578,
    })
  })

  test('hibás dátumra kérés nélkül elutasított Promise: a törzsben validation hiba mezőnként, a szűrőben RangeError', async () => {
    const { mock, spendings } = setup()

    const create = spendings
      .create({ ...INPUT, invoiceDate: '2026-02-30', dueDate: '2026-13-01' })
      .catch((caught: unknown) => caught)
    const update = spendings
      .update(1, { ...INPUT, paidAt: '2026.11.15' })
      .catch((caught: unknown) => caught)
    const list = spendings.list({ startDate: '15/11/2026' })

    expect(await create).toBeInstanceOf(BillingoError)
    expect(await create).toMatchObject({
      category: 'validation',
      operation: 'SpendingSave',
      fieldErrors: [
        { field: 'invoiceDate', message: 'Nem létező naptári dátum: 2026-02-30' },
        { field: 'dueDate', message: 'Nem létező naptári dátum: 2026-13-01' },
      ],
    })
    expect(await update).toMatchObject({
      category: 'validation',
      operation: 'SpendingUpdate',
      fieldErrors: [{ field: 'paidAt', message: expect.stringContaining('2026.11.15') }],
    })
    await expect(list).rejects.toThrow(RangeError)
    expect(mock.requests).toEqual([])
  })

  test('lista minden szűrővel: a spec paraméternevei, budapesti dátumok', async () => {
    const item = { ...LIVE_SPENDING, items: undefined, created_by_nav: false }
    const { mock, spendings } = setup({ status: 200, json: listPage([item]) })

    const result = await spendings.list({
      q: 'Nyomda',
      page: 2,
      perPage: 50,
      spendingDate: 'invoice_date',
      startDate: AFTER_BUDAPEST_MIDNIGHT,
      endDate: '2026-11-30',
      paymentStatus: 'unpaid',
      spendingType: 'manual',
      categories: 'other',
      currencies: 'HUF',
      paymentMethods: 'cash',
    })

    expect(mock.requests[0]?.operation).toBe('SpendingList')
    expect(Object.fromEntries(mock.requests[0]?.url.searchParams ?? [])).toEqual({
      q: 'Nyomda',
      page: '2',
      per_page: '50',
      spending_date: 'invoice_date',
      start_date: '2026-11-15',
      end_date: '2026-11-30',
      payment_status: 'unpaid',
      spending_type: 'manual',
      categories: 'other',
      currencies: 'HUF',
      payment_methods: 'cash',
    })
    expect(result.data).toEqual([expect.objectContaining({ id: 46873659, createdByNav: false })])
    expect(result.total).toBe(1)
  })

  test('lista szűrő nélkül üres query-vel; all() minden oldalt bejár a szűrőkkel', async () => {
    const { mock, spendings } = setup(
      { status: 200, json: listPage([]) },
      { status: 200, json: listPage([LIVE_SPENDING], { last_page: 2, per_page: 100, total: 2 }) },
      {
        status: 200,
        json: listPage([{ ...LIVE_SPENDING, id: 2 }], {
          current_page: 2,
          last_page: 2,
          per_page: 100,
          total: 2,
        }),
      },
    )

    await spendings.list()
    const ids: number[] = []
    for await (const spending of spendings.all({ categories: 'other' })) ids.push(spending.id ?? 0)

    expect(ids).toEqual([46873659, 2])
    expect(mock.requests.map((request) => request.url.search)).toEqual([
      '',
      '?categories=other&page=1&per_page=100',
      '?categories=other&page=2&per_page=100',
    ])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('a költség kérései a friss Billingo spec ellen', () => {
  test('a minimális és a teljes törzs és a teljes lista-lekérdezés megfelel a spec-nek', async () => {
    const { mock, spendings } = setup(
      { status: 201, json: LIVE_SPENDING },
      { status: 200, json: LIVE_SPENDING },
    )

    await spendings.create(INPUT)
    await spendings.update(1, FULL_INPUT)

    expect(requestErrors('SpendingSave', mock.requests[0]?.body)).toEqual([])
    expect(requestErrors('SpendingUpdate', mock.requests[1]?.body)).toEqual([])
    const { invoice_number: _number, ...withoutNumber } = MINIMAL_BODY
    expect(requestErrors('SpendingSave', withoutNumber)).toEqual([
      'SpendingSave.invoice_number: kötelező mező hiányzik',
    ])
    expect(
      parameterErrors('SpendingList', {
        path: {},
        query: new URLSearchParams({ spending_date: 'paid_at', categories: 'nincs' }),
      }),
    ).toHaveLength(2)
  })
})
