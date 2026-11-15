import { bankAccountRoutes } from './bank-accounts'
import { currencyRoutes } from './currencies'
import type { FakeRoutes } from './http'
import { organizationRoutes } from './organization'
import { utilsRoutes } from './utils'

export const FAKE_ROUTES: FakeRoutes = {
  ...organizationRoutes,
  ...utilsRoutes,
  ...currencyRoutes,
  ...bankAccountRoutes,
}
