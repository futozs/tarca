import { bankAccountRoutes } from './bank-accounts'
import { currencyRoutes } from './currencies'
import { documentActionRoutes } from './document-actions'
import { documentBlockRoutes } from './document-blocks'
import { documentRoutes } from './documents'
import { exportRoutes } from './exports'
import type { FakeRoutes } from './http'
import { inventoryRoutes } from './inventory'
import { organizationRoutes } from './organization'
import { partnerRoutes } from './partners'
import { productRoutes } from './products'
import { receiptRoutes } from './receipts'
import { spendingRoutes } from './spendings'
import { utilsRoutes } from './utils'

export const FAKE_ROUTES: FakeRoutes = {
  ...organizationRoutes,
  ...utilsRoutes,
  ...currencyRoutes,
  ...bankAccountRoutes,
  ...partnerRoutes,
  ...documentBlockRoutes,
  ...productRoutes,
  ...inventoryRoutes,
  ...spendingRoutes,
  ...exportRoutes,
  ...documentRoutes,
  ...documentActionRoutes,
  ...receiptRoutes,
}
