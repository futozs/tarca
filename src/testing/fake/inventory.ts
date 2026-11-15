import { clientError, type FakeRoutes, ok } from './http'
import { withExistingProduct } from './products'

export const STOCK_TRACKING_DISABLED = 'Automatic order processing is disabled'

export const inventoryRoutes: FakeRoutes = {
  GetProductQuantity: (state, request) =>
    withExistingProduct(state, request, (product) => {
      const { stock } = state.config
      if (stock === undefined) return clientError(400, STOCK_TRACKING_DISABLED)
      return ok({ availableQuantity: stock[product.sku] ?? 0 })
    }),
}
