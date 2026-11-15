import { expect } from 'vitest'
import { BillingoError } from '../../../src/core/errors'
import type { OperationId } from '../../../src/core/operations'
import type { E2eContext, E2eExclusions } from '../context'

export const PRODUCTS_E2E_OPERATIONS: readonly OperationId[] = [
  'CreateProduct',
  'GetProduct',
  'UpdateProduct',
  'ListProduct',
  'GetProductQuantity',
  'DeleteProduct',
]

export const PRODUCTS_E2E_EXCLUDED: E2eExclusions = {}

export function defineProductsSteps(ctx: E2eContext): void {
  const step = ctx.groupSteps()
  const cleanup = ctx.groupSteps()
  const productId = () => ctx.required(ctx.state.productId, 'termék id')

  step('létrehozás nettó árral: a bruttót a Billingo számolja, lekérés', async () => {
    const product = await ctx.tarca.products.create({
      name: ctx.name('termék'),
      comment: ctx.name(),
      currency: 'HUF',
      vat: '27%',
      netUnitPrice: 1000,
      unit: 'db',
    })
    ctx.state.productId = ctx.required(product.id, 'termék id')
    expect(product).toMatchObject({ netUnitPrice: 1000, grossUnitPrice: 1270, entitlement: null })
    const fetched = await ctx.tarca.products.get(productId())
    expect(fetched).toMatchObject({
      name: ctx.name('termék'),
      comment: ctx.name(),
      vat: '27%',
      netUnitPrice: 1000,
      grossUnitPrice: 1270,
      unit: 'db',
    })
  })

  step('teljes cserés módosítás bruttó árral: a kihagyott megjegyzés kiürül', async () => {
    const updated = await ctx.tarca.products.update(productId(), {
      name: ctx.name('termék módosítva'),
      currency: 'HUF',
      vat: '27%',
      grossUnitPrice: 2540,
      unit: 'db',
    })
    expect(updated).toMatchObject({
      id: productId(),
      name: ctx.name('termék módosítva'),
      comment: '',
      grossUnitPrice: 2540,
    })
    expect(updated.netUnitPrice).toBeCloseTo(2000, 4)
  })

  step('keresés a futásazonosítóra', async () => {
    const page = await ctx.tarca.products.list({ query: ctx.runId, perPage: 100 })
    expect(page.data.map((product) => product.id)).toContain(productId())
  })

  step('készlet készletkezelés nélkül: 400 „Automatic order processing is disabled”', async () => {
    const outcome = await ctx.tarca.inventory.quantity(productId()).then(
      () => 'sikeres válasz',
      (error: unknown) => error,
    )
    expect(outcome).toBeInstanceOf(BillingoError)
    expect(outcome).toMatchObject({
      status: 400,
      category: 'validation',
      apiMessage: 'Automatic order processing is disabled',
    })
    expect((outcome as BillingoError).hint).toContain('készletkezelés')
  })

  cleanup('takarítás: törlés, utána a lekérés 404 „Product is not found.”', async () => {
    await ctx.tarca.products.delete(productId())
    await expect(ctx.tarca.products.get(productId())).rejects.toMatchObject({
      category: 'not_found',
      status: 404,
      apiMessage: 'Product is not found.',
    })
  })
}
