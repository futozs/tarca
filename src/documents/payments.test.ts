import { describe, expect, test } from 'vitest'
import { mockBillingo, type Reply, TEST_API_KEY } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { createTarca } from '../client'
import { BillingoError } from '../core/errors'
import type { PaymentInput } from './payments'

const ID = 141703673
const PATH = `/v3/documents/${ID}/payments`

function setup(...replies: Reply[]) {
  const mock = mockBillingo(...replies)
  const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: mock.fetch, retryDelayMs: 0 })
  return { mock, payments: tarca.documents.payments }
}

function sent(mock: ReturnType<typeof mockBillingo>): string[] {
  return mock.requests.map((request) => `${request.method} ${request.url.pathname}`)
}

const SAVED = [
  {
    date: '2026-11-15',
    price: 500,
    payment_method: 'wire_transfer',
    voucher_number: '',
    conversion_rate: 1,
  },
  {
    date: '2026-11-15',
    price: 770,
    payment_method: 'cash',
    voucher_number: '',
    conversion_rate: 1,
  },
]

const SAVED_CAMEL = [
  {
    date: '2026-11-15',
    price: 500,
    paymentMethod: 'wire_transfer',
    voucherNumber: '',
    conversionRate: 1,
  },
  { date: '2026-11-15', price: 770, paymentMethod: 'cash', voucherNumber: '', conversionRate: 1 },
]

describe('documents.payments', () => {
  test('list: a csupasz tömb camelCase alakban (P:077)', async () => {
    const { mock, payments } = setup({ status: 200, json: SAVED })

    expect(await payments.list(ID)).toEqual(SAVED_CAMEL)
    expect(sent(mock)).toEqual([`GET ${PATH}`])
    expect(mock.requests[0]?.operation).toBe('GetPayment')
  })

  test('replace: PUT csupasz tömbbel, budapesti dátummal, a kihagyott mezők nélkül (P:076)', async () => {
    const { mock, payments } = setup({ status: 200, json: SAVED })

    const result = await payments.replace(ID, [
      { date: new Date('2026-11-14T23:30:00Z'), price: 500, paymentMethod: 'wire_transfer' },
      {
        date: '2026-11-15',
        price: 770,
        paymentMethod: 'cash',
        voucherNumber: 'P-1',
        conversionRate: 1,
      },
    ])

    expect(sent(mock)).toEqual([`PUT ${PATH}`])
    expect(mock.requests[0]?.operation).toBe('UpdatePayment')
    expect(mock.requests[0]?.body).toEqual([
      { date: '2026-11-15', price: 500, payment_method: 'wire_transfer' },
      {
        date: '2026-11-15',
        price: 770,
        payment_method: 'cash',
        voucher_number: 'P-1',
        conversion_rate: 1,
      },
    ])
    expect(result).toEqual(SAVED_CAMEL)
  })

  test('replace: az üres tömb is teljes csere, elküldi', async () => {
    const { mock, payments } = setup({ status: 200, json: [] })

    expect(await payments.replace(ID, [])).toEqual([])
    expect(mock.requests[0]?.body).toEqual([])
  })

  test('add: lekéri a meglévőket, és azokkal együtt teljes cserét küld', async () => {
    const existing = [
      { ...SAVED[0], voucher_number: null, conversion_rate: null },
      { ...SAVED[1], voucher_number: 'V-2', conversion_rate: 1 },
    ]
    const { mock, payments } = setup(
      { status: 200, json: existing },
      { status: 200, json: [...SAVED, SAVED[0]] },
    )

    const result = await payments.add(ID, {
      date: '2026-11-16',
      price: 100,
      paymentMethod: 'bankcard',
    })

    expect(sent(mock)).toEqual([`GET ${PATH}`, `PUT ${PATH}`])
    expect(mock.requests[1]?.body).toEqual([
      { date: '2026-11-15', price: 500, payment_method: 'wire_transfer' },
      {
        date: '2026-11-15',
        price: 770,
        payment_method: 'cash',
        voucher_number: 'V-2',
        conversion_rate: 1,
      },
      { date: '2026-11-16', price: 100, payment_method: 'bankcard' },
    ])
    expect(result).toHaveLength(3)
  })

  test('clear: DELETE, az élő 200 []-ra undefined (P:079)', async () => {
    const { mock, payments } = setup({ status: 200, json: [] })

    expect(await payments.clear(ID)).toBeUndefined()
    expect(sent(mock)).toEqual([`DELETE ${PATH}`])
    expect(mock.requests[0]?.operation).toBe('DeletePayment')
  })

  test('hibás dátum, ár, fizetési mód vagy árfolyam: kérés nélkül validation hiba, mezőnként', async () => {
    const { mock, payments } = setup()
    const valid: PaymentInput = { date: '2026-11-15', price: 1, paymentMethod: 'cash' }

    const error = await payments
      .replace(ID, [
        valid,
        { ...valid, date: '2026-02-30' },
        { ...valid, price: Number.NaN },
        { ...valid, paymentMethod: 'kartya' as PaymentInput['paymentMethod'] },
        { ...valid, conversionRate: 0 },
        null as unknown as PaymentInput,
        { ...valid, conversionRate: Number.POSITIVE_INFINITY },
        'x' as unknown as PaymentInput,
      ])
      .catch((caught: unknown) => caught)
    const notArray = await payments
      .replace(ID, valid as unknown as PaymentInput[])
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({ category: 'validation', operation: 'UpdatePayment' })
    expect((error as BillingoError).fieldErrors.map((item) => item.field)).toEqual([
      'payments.1.date',
      'payments.2.price',
      'payments.3.paymentMethod',
      'payments.4.conversionRate',
      'payments.5',
      'payments.6.conversionRate',
      'payments.7',
    ])
    expect(notArray).toMatchObject({ fieldErrors: [{ field: 'payments' }] })
    expect(mock.requests).toEqual([])
  })

  test('add: a hibás befizetést még a lekérés előtt elutasítja', async () => {
    const { mock, payments } = setup()

    const error = await payments
      .add(ID, { date: 'tegnap', price: 1, paymentMethod: 'cash' })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      category: 'validation',
      fieldErrors: [{ field: 'payment.date' }],
    })
    expect(mock.requests).toEqual([])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('a befizetések kérése a friss Billingo spec ellen', () => {
  test('a minden mezőt tartalmazó csupasz tömb megfelel az UpdatePayment törzsének', async () => {
    const { mock, payments } = setup({ status: 200, json: SAVED })

    await payments.replace(ID, [
      { date: '2026-11-15', price: 500, paymentMethod: 'wire_transfer' },
      {
        date: '2026-11-15',
        price: 12.5,
        paymentMethod: 'cash',
        voucherNumber: 'P-1',
        conversionRate: 389.17,
      },
    ])

    expect(requestErrors('UpdatePayment', mock.requests[0]?.body)).toEqual([])
    expect(requestErrors('UpdatePayment', [{ date: '2026-11-15', price: 1 }])).not.toEqual([])
  })
})
