import type { OrganizationData } from '../../generated/billingo'
import { type FakeRoutes, ok } from './http'

export const organizationRoutes: FakeRoutes = {
  GetOrganizationData: (state) => {
    const organization: Required<OrganizationData> = {
      taxCode: state.config.taxCode,
      subscription: {
        expirationDate: state.config.subscription.expirationDate,
        features: state.config.subscription.features,
      },
      hasNavConnection: state.config.hasNavConnection,
      kobakReceiptFsEnabled: true,
      hasSuccessfulNavReceiptSubmission: false,
    }
    return ok(organization)
  },
}
