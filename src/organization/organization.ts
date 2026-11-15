import type { RequestOptions, TarcaContext } from '../core/context'
import type { OrganizationData } from '../generated/billingo'

export interface OrganizationApi {
  get(options?: RequestOptions): Promise<OrganizationData>
}

export function createOrganizationApi(context: TarcaContext): OrganizationApi {
  return {
    get: (options) =>
      context.json<OrganizationData>({ operation: 'GetOrganizationData', signal: options?.signal }),
  }
}
