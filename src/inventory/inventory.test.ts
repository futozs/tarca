import { describe, expect, test } from 'vitest'
import { createTestContext, mockBillingo } from '../../tests/helpers'
import { BillingoError } from '../core/errors'
import { createInventoryApi } from './inventory'

const DISABLED = 'Automatic order processing is disabled'

function setup(...replies: Parameters<typeof mockBillingo>) {
  const mock = mockBillingo(...replies)
  return { mock, inventory: createInventoryApi(createTestContext(mock)) }
}

describe('inventory', () => {
  test('quantity: a termék elérhető készlete camelCase-ben', async () => {
    const { mock, inventory } = setup({ status: 200, json: { available_quantity: 12.5 } })

    expect(await inventory.quantity(29217069)).toEqual({ availableQuantity: 12.5 })
    expect(mock.requests.map((request) => [request.operation, request.url.pathname])).toEqual([
      ['GetProductQuantity', '/v3/inventory/product/29217069/quantity'],
    ])
  })

  test('készletkezelés nélkül (élőben 400): magyar üzenet és tipp, az eredeti adatokkal', async () => {
    const { inventory } = setup({
      status: 400,
      json: { error: { message: DISABLED } },
      headers: { 'x-ratelimit-limit': '300', 'x-ratelimit-remaining': '299' },
    })

    const error = await inventory.quantity(1).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      category: 'validation',
      status: 400,
      operation: 'GetProductQuantity',
      apiMessage: DISABLED,
      rateLimit: { limit: 300, remaining: 299 },
      requestId: expect.any(String),
      retryable: false,
    })
    const billingoError = error as BillingoError
    expect(billingoError.message).toContain('nincs bekapcsolva a készletkezelés')
    expect(billingoError.hint).toContain('Automatic order processing is disabled')
    expect(billingoError.cause).toBeInstanceOf(BillingoError)
    expect((billingoError.cause as BillingoError).requestId).toBe(billingoError.requestId)
  })

  test('más 400-as üzenet és a 403 változatlanul megy tovább', async () => {
    const { inventory } = setup(
      { status: 400, json: { error: { message: 'Something else' } } },
      { status: 403, json: { error: { message: 'You do not have permission' } } },
      { status: 400 },
    )

    const other = await inventory.quantity(1).catch((caught: unknown) => caught)
    const forbidden = await inventory.quantity(2).catch((caught: unknown) => caught)
    const silent = await inventory.quantity(3).catch((caught: unknown) => caught)

    expect(other).toMatchObject({ category: 'validation', apiMessage: 'Something else' })
    expect((other as BillingoError).hint).toBeUndefined()
    expect((other as BillingoError).cause).toBeUndefined()
    expect(forbidden).toMatchObject({ category: 'forbidden', status: 403 })
    expect((forbidden as BillingoError).hint).toBeUndefined()
    expect(silent).toMatchObject({ category: 'validation', status: 400, apiMessage: undefined })
    expect((silent as BillingoError).hint).toBeUndefined()
  })
})
