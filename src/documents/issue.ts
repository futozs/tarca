import type { RequestOptions, TarcaContext } from '../core/context'
import { BillingoError } from '../core/errors'
import type { OnceGuard } from '../core/once-guard'
import type { Document, DocumentInsert } from '../generated/billingo'
import type { PartnerInput, PartnersApi } from '../partners/partners'
import type { BlockKind, BlockResolver, ResolvedDefaults } from './defaults'
import {
  type DocumentBody,
  type DocumentInput,
  type DocumentOnceInput,
  type DraftFinalizeInput,
  type PreparedDocument,
  prepareDocument,
} from './input'
import { type CreateOnceOptions, type DocumentOnceResult, issueOnce } from './once'
import type { DocumentQueryApi } from './query'

export interface IssuingDeps {
  readonly context: TarcaContext
  readonly partners: PartnersApi
  readonly blocks: BlockResolver
  readonly defaults: ResolvedDefaults
  readonly guard: OnceGuard
  readonly query: DocumentQueryApi
}

export interface DocumentIssuingApi {
  create(input: DocumentInput, options?: RequestOptions): Promise<Document>
  createRaw(insert: DocumentInsert, options?: RequestOptions): Promise<Document>
  createOnce(input: DocumentOnceInput, options?: CreateOnceOptions): Promise<DocumentOnceResult>
  finalizeDraft(id: number, input: DraftFinalizeInput, options?: RequestOptions): Promise<Document>
  deleteDraft(id: number, options?: RequestOptions): Promise<void>
}

export async function resolvePartnerId(
  partners: PartnersApi,
  partner: number | PartnerInput,
  options: RequestOptions | undefined,
): Promise<number> {
  if (typeof partner === 'number') return partner
  const { partner: found } = await partners.findOrCreate(partner, options)
  if (found.id === undefined) {
    throw new BillingoError('A Billingo a partnert azonosító nélkül adta vissza.', {
      category: 'unexpected_response',
      operation: 'CreatePartner',
    })
  }
  return found.id
}

export interface ResolvedTarget {
  readonly blockId: number
  readonly partnerId: number
}

export async function resolveTarget(
  deps: Pick<IssuingDeps, 'partners' | 'blocks'>,
  kind: BlockKind,
  blockId: number | undefined,
  partner: number | PartnerInput,
  options: RequestOptions | undefined,
): Promise<ResolvedTarget> {
  const block = blockId ?? (await deps.blocks.resolve(kind, options))
  return { blockId: block, partnerId: await resolvePartnerId(deps.partners, partner, options) }
}

export function createDocumentIssuingApi(deps: IssuingDeps): DocumentIssuingApi {
  const { context } = deps
  const post = (body: DocumentBody & ResolvedTarget, options?: RequestOptions) =>
    context.json<Document>({ operation: 'CreateDocument', body, signal: options?.signal })
  const targetOf = (prepared: PreparedDocument, options?: RequestOptions) =>
    resolveTarget(deps, 'invoice', prepared.blockId, prepared.partner, options)
  const created = (document: Document, vendorId: string | undefined) =>
    context.emitDocument({ action: 'created', operation: 'CreateDocument', document, vendorId })
  return {
    async create(input, options) {
      const prepared = prepareDocument(input, deps.defaults, 'CreateDocument')
      const document = await post(
        { ...prepared.body, ...(await targetOf(prepared, options)) },
        options,
      )
      await created(document, prepared.body.vendorId)
      return document
    },
    async createRaw(insert, options) {
      const document = await context.json<Document>({
        operation: 'CreateDocument',
        body: insert,
        signal: options?.signal,
      })
      await created(document, insert.vendorId)
      return document
    },
    async createOnce(input, options = {}) {
      const prepared = prepareDocument(input, deps.defaults, 'CreateDocument', {
        vendorIdRequired: true,
      })
      const vendorId = input.vendorId.trim()
      const result = await issueOnce(
        deps.guard,
        {
          vendorId,
          operation: 'CreateDocument',
          find: () => deps.query.findByVendorId(vendorId, options),
          target: () => targetOf(prepared, options),
          issue: (target) => post({ ...prepared.body, ...target }, options),
        },
        options,
      )
      if (result.created) await created(result.document, vendorId)
      return result
    },
    async finalizeDraft(id, input, options) {
      const prepared = prepareDocument(input, deps.defaults, 'CreateDocumentFromDraft')
      const target = await targetOf(prepared, options)
      const document = await context.json<Document>({
        operation: 'CreateDocumentFromDraft',
        pathParams: { id },
        body: { ...prepared.body, ...target },
        signal: options?.signal,
      })
      await context.emitDocument({
        action: 'finalized',
        operation: 'CreateDocumentFromDraft',
        document,
        vendorId: prepared.body.vendorId,
      })
      return document
    },
    deleteDraft: (id, options) =>
      context.empty({ operation: 'DeleteDocument', pathParams: { id }, signal: options?.signal }),
  }
}
