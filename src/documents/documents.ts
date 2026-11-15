import type { TarcaContext } from '../core/context'
import type { OnceGuard } from '../core/once-guard'
import type { PartnersApi } from '../partners/partners'
import { createDocumentActionsApi, type DocumentActionsApi } from './actions'
import type { BlockResolver, ResolvedDefaults } from './defaults'
import { createDocumentFilesApi, type DocumentFilesApi } from './files'
import { createDocumentIssuingApi, type DocumentIssuingApi } from './issue'
import { createDocumentPaymentsApi, type DocumentPaymentsApi } from './payments'
import { createDocumentQueryApi, type DocumentQueryApi } from './query'

export interface DocumentsApiDeps {
  readonly partners: PartnersApi
  readonly blocks: BlockResolver
  readonly defaults: ResolvedDefaults
  readonly guard: OnceGuard
}

export interface DocumentsApi
  extends DocumentQueryApi,
    DocumentIssuingApi,
    DocumentFilesApi,
    DocumentActionsApi {
  readonly payments: DocumentPaymentsApi
}

export function createDocumentsApi(context: TarcaContext, deps: DocumentsApiDeps): DocumentsApi {
  const query = createDocumentQueryApi(context)
  return {
    ...query,
    ...createDocumentIssuingApi({ ...deps, context, query }),
    ...createDocumentFilesApi(context),
    ...createDocumentActionsApi(context, deps.defaults),
    payments: createDocumentPaymentsApi(context),
  }
}
