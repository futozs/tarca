import type { RequestOptions, TarcaContext } from '../core/context'
import { isBillingoError, withHint } from '../core/errors'
import type { ProductQuantity } from '../generated/billingo'

export interface InventoryApi {
  quantity(productId: number, options?: RequestOptions): Promise<ProductQuantity>
}

const STOCK_TRACKING_DISABLED = /automatic order processing is disabled/i

const STOCK_TRACKING_HINT =
  'A Billingo ilyenkor 400-at ad („Automatic order processing is disabled”), a fejlesztői teszt profilon készletkezelés nélküli termékre is. A készletkezelést a Billingo felületén lehet bekapcsolni.'

const STOCK_TRACKING_MESSAGE =
  'A termék készlete nem kérdezhető le, mert a Billingóban nincs bekapcsolva a készletkezelés (automatikus rendeléskezelés).'

export function createInventoryApi(context: TarcaContext): InventoryApi {
  return {
    async quantity(productId, options) {
      try {
        return await context.json<ProductQuantity>({
          operation: 'GetProductQuantity',
          pathParams: { id: productId },
          signal: options?.signal,
        })
      } catch (error) {
        if (
          isBillingoError(error) &&
          error.status === 400 &&
          STOCK_TRACKING_DISABLED.test(error.apiMessage ?? '')
        ) {
          throw withHint(error, STOCK_TRACKING_HINT, STOCK_TRACKING_MESSAGE)
        }
        throw error
      }
    },
  }
}
