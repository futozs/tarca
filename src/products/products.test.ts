import { describe, expect, test } from 'vitest'
import { createTestContext, mockBillingo } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { BillingoError, nullIfNotFound } from '../core/errors'
import { createProductsApi, type ProductInput } from './products'

const LIVE_PRODUCT = {
  id: 29217069,
  name: 'TARCA-PROBE termék',
  comment: 'TARCA-PROBE',
  currency: 'HUF',
  vat: '27%',
  net_unit_price: 1000,
  gross_unit_price: 1270,
  unit: 'db',
  general_ledger_number: '',
  general_ledger_taxcode: '',
  entitlement: null,
  ean: '',
  sku: '',
  is_manage: false,
  purchase_price: null,
  is_generate_erase_code: false,
  connect_product_id: null,
  apply_discount: false,
  apply_quantity: false,
  is_connect_product: false,
  is_deposit_fee: false,
}

const NET_INPUT: ProductInput = {
  name: 'Webfejlesztés',
  currency: 'HUF',
  vat: '27%',
  netUnitPrice: 15_000,
  unit: 'óra',
}

const FULL_INPUT: ProductInput = {
  name: 'Kávé',
  comment: 'Pörkölt, 250 g',
  currency: 'EUR',
  vat: '5%',
  grossUnitPrice: 12.5,
  unit: 'csomag',
  generalLedgerNumber: '911',
  generalLedgerTaxcode: '467',
  entitlement: 'AAM',
  ean: '5990000000001',
  sku: 'KAVE-250',
  isManage: true,
  purchasePrice: 6.2,
  isGenerateEraseCode: false,
  applyDiscount: true,
  applyQuantity: true,
  isConnectProduct: false,
  isDepositFee: false,
}

function page(data: readonly unknown[], extra: Record<string, unknown> = {}) {
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
  return { mock, products: createProductsApi(createTestContext(mock)) }
}

function sent(mock: ReturnType<typeof mockBillingo>): string[] {
  return mock.requests.map(
    (request) =>
      `${request.operation} ${request.method} ${request.url.pathname}${request.url.search}`,
  )
}

describe('products', () => {
  test('lista névkereséssel: a query a Billingo query paramétere, a válasz camelCase', async () => {
    const { mock, products } = setup({ status: 200, json: page([LIVE_PRODUCT]) })

    const result = await products.list({ query: 'TARCA-PROBE', perPage: 25 })

    expect(sent(mock)).toEqual(['ListProduct GET /v3/products?per_page=25&query=TARCA-PROBE'])
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: 29217069,
          netUnitPrice: 1000,
          grossUnitPrice: 1270,
          entitlement: null,
          purchasePrice: null,
          connectProductId: null,
          isManage: false,
        }),
      ],
      total: 1,
      perPage: 25,
      currentPage: 1,
      lastPage: 1,
    })
  })

  test('all: minden oldalt bejár, a keresőszót minden oldalra továbbviszi', async () => {
    const second = { ...LIVE_PRODUCT, id: 2 }
    const { mock, products } = setup(
      { status: 200, json: page([LIVE_PRODUCT], { per_page: 100, last_page: 2, total: 2 }) },
      {
        status: 200,
        json: page([second], { per_page: 100, current_page: 2, last_page: 2, total: 2 }),
      },
    )

    const ids: number[] = []
    for await (const product of products.all({ query: 'kávé' })) ids.push(product.id ?? 0)

    expect(ids).toEqual([29217069, 2])
    expect(sent(mock)).toEqual([
      'ListProduct GET /v3/products?page=1&per_page=100&query=k%C3%A1v%C3%A9',
      'ListProduct GET /v3/products?page=2&per_page=100&query=k%C3%A1v%C3%A9',
    ])
  })

  test('hibás lapozásra kérés nélkül RangeError', async () => {
    const { mock, products } = setup()

    await expect(products.list({ perPage: 101 })).rejects.toThrow(RangeError)
    await expect(products.list({ page: 0 })).rejects.toThrow('page')
    expect(mock.requests).toEqual([])
  })

  test('lekérés, létrehozás nettó árral, teljes cserés módosítás bruttó árral, törlés', async () => {
    const { mock, products } = setup(
      { status: 200, json: LIVE_PRODUCT },
      { status: 201, json: { ...LIVE_PRODUCT, id: 7 } },
      { status: 200, json: { ...LIVE_PRODUCT, id: 7, comment: '' } },
      { status: 204 },
    )

    expect((await products.get(29217069)).grossUnitPrice).toBe(1270)
    expect((await products.create(NET_INPUT)).id).toBe(7)
    expect((await products.update(7, FULL_INPUT)).comment).toBe('')
    await expect(products.delete(7)).resolves.toBeUndefined()

    expect(sent(mock)).toEqual([
      'GetProduct GET /v3/products/29217069',
      'CreateProduct POST /v3/products',
      'UpdateProduct PUT /v3/products/7',
      'DeleteProduct DELETE /v3/products/7',
    ])
    expect(mock.requests[1]?.body).toEqual({
      name: 'Webfejlesztés',
      currency: 'HUF',
      vat: '27%',
      net_unit_price: 15_000,
      unit: 'óra',
    })
    expect(mock.requests[2]?.body).toEqual({
      name: 'Kávé',
      comment: 'Pörkölt, 250 g',
      currency: 'EUR',
      vat: '5%',
      gross_unit_price: 12.5,
      unit: 'csomag',
      general_ledger_number: '911',
      general_ledger_taxcode: '467',
      entitlement: 'AAM',
      ean: '5990000000001',
      sku: 'KAVE-250',
      is_manage: true,
      purchase_price: 6.2,
      is_generate_erase_code: false,
      apply_discount: true,
      apply_quantity: true,
      is_connect_product: false,
      is_deposit_fee: false,
    })
  })

  test('pontosan egy ár: két ár, ár nélkül és nem véges ár esetén kérés nélkül validation hiba', async () => {
    const { mock, products } = setup()
    const { netUnitPrice: _net, ...withoutPrice } = NET_INPUT
    const cases = [
      { input: { ...NET_INPUT, grossUnitPrice: 19_050 }, message: 'pontosan egy árat' },
      { input: withoutPrice, message: 'pontosan egy árat' },
      { input: { ...NET_INPUT, netUnitPrice: Number.NaN }, message: 'netUnitPrice értéke' },
      {
        input: { ...withoutPrice, grossUnitPrice: Number.POSITIVE_INFINITY },
        message: 'grossUnitPrice értéke',
      },
    ]

    for (const { input, message } of cases) {
      for (const [operation, call] of [
        ['CreateProduct', () => products.create(input as ProductInput)],
        ['UpdateProduct', () => products.update(7, input as ProductInput)],
      ] as const) {
        const error = await call().catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(BillingoError)
        expect(error).toMatchObject({
          category: 'validation',
          operation,
          status: undefined,
          fieldErrors: [{ field: 'netUnitPrice' }, { field: 'grossUnitPrice' }],
        })
        expect((error as BillingoError).message).toContain(message)
        expect((error as BillingoError).hint).toContain('You must specify only one price')
      }
    }
    expect(mock.requests).toEqual([])
  })

  test('törölt termék: 404 „Product is not found.”, a nullIfNotFound null-t ad', async () => {
    const { products } = setup(
      { status: 404, json: { error: { message: 'Product is not found.' } } },
      { status: 404, json: { error: { message: 'Product is not found.' } } },
    )

    await expect(products.get(1)).rejects.toMatchObject({
      category: 'not_found',
      status: 404,
      apiMessage: 'Product is not found.',
    })
    expect(await nullIfNotFound(products.get(1))).toBeNull()
  })
})

describe.skipIf(!SPEC_AVAILABLE)('a termék kérései a friss Billingo spec ellen', () => {
  test('a minimális és a teljes törzs is megfelel a Product sémának', async () => {
    const { mock, products } = setup(
      { status: 201, json: LIVE_PRODUCT },
      { status: 200, json: LIVE_PRODUCT },
    )

    await products.create(NET_INPUT)
    await products.update(1, FULL_INPUT)

    expect(requestErrors('CreateProduct', mock.requests[0]?.body)).toEqual([])
    expect(requestErrors('UpdateProduct', mock.requests[1]?.body)).toEqual([])
    expect(requestErrors('CreateProduct', LIVE_PRODUCT)).toEqual([
      'Product.id: csak olvasható mező, kérésben nem küldhető',
    ])
  })
})
