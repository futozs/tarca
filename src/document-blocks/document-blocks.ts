import type { RequestOptions, TarcaContext } from '../core/context'
import { BillingoError } from '../core/errors'
import type { OperationId } from '../core/operations'
import {
  assertPageQuery,
  iteratePages,
  type Page,
  type PageQuery,
  type RawPage,
  toPage,
} from '../core/pagination'
import type {
  DocumentBlock,
  DocumentBlockSchema,
  DocumentBlockType,
  DocumentBlockUpdate,
} from '../generated/billingo'

export interface DocumentBlockListQuery extends PageQuery {
  readonly type?: DocumentBlockType
}

export type DocumentBlockInput = Omit<
  DocumentBlockUpdate,
  | 'customField1'
  | 'customField2'
  | 'templateId'
  | 'normalNotificationId'
  | 'proformaNotificationId'
  | 'generated'
>

type NullableBlockField =
  | 'customField1'
  | 'customField2'
  | 'senderEmail'
  | 'bccEmail'
  | 'bankAccountId'

export type DocumentBlockReplacement = Omit<DocumentBlockUpdate, NullableBlockField> & {
  readonly [K in NullableBlockField]?: DocumentBlockUpdate[K] | null
} & {
  readonly id?: number
  readonly picPath?: string | null
}

export interface DocumentBlocksApi {
  list(query?: DocumentBlockListQuery, options?: RequestOptions): Promise<Page<DocumentBlock>>
  all(
    query?: Omit<DocumentBlockListQuery, 'page'>,
    options?: RequestOptions,
  ): AsyncGenerator<DocumentBlock>
  get(id: number, options?: RequestOptions): Promise<DocumentBlockSchema>
  create(input: DocumentBlockInput, options?: RequestOptions): Promise<DocumentBlockSchema>
  update(
    id: number,
    replacement: DocumentBlockReplacement,
    options?: RequestOptions,
  ): Promise<DocumentBlockSchema>
  delete(id: number, options?: RequestOptions): Promise<void>
}

const BLOCK_NAME = /^[\p{L}\p{M}\p{N} ]+$/u

const NOT_SENT = new Set(['id', 'picPath'])

function invalidBlockName(name: string, operation: OperationId): BillingoError {
  const message =
    name.trim() === ''
      ? 'A számlatömb neve nem lehet üres.'
      : `A számlatömb neve csak betűt, számot és szóközt tartalmazhat (például „TARCA E2E”), kapott: „${name}”.`
  return new BillingoError(message, {
    category: 'validation',
    operation,
    fieldErrors: [{ field: 'name', message }],
    hint: 'A Billingo erre 422-t ad („The Invoice pad name may only contain letters and numbers and space.”), ezért a tárca a kérést el sem küldi.',
  })
}

function assertBlockName(name: string, operation: OperationId): void {
  if (name.trim() === '' || !BLOCK_NAME.test(name)) throw invalidBlockName(name, operation)
}

function replacementBody(replacement: DocumentBlockReplacement): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(replacement).filter(([key, value]) => value !== null && !NOT_SENT.has(key)),
  )
}

export function createDocumentBlocksApi(context: TarcaContext): DocumentBlocksApi {
  const list = async (query: DocumentBlockListQuery = {}, options?: RequestOptions) => {
    assertPageQuery(query)
    const raw = await context.json<RawPage<DocumentBlock>>({
      operation: 'ListDocumentBlock',
      query: { page: query.page, perPage: query.perPage, type: query.type },
      signal: options?.signal,
    })
    return toPage(raw, query)
  }
  return {
    list,
    all: (query = {}, options) => iteratePages(list, query, options),
    get: (id, options) =>
      context.json<DocumentBlockSchema>({
        operation: 'GetDocumentBlock',
        pathParams: { id },
        signal: options?.signal,
      }),
    async create(input, options) {
      assertBlockName(input.name, 'CreateDocumentBlock')
      return context.json<DocumentBlockSchema>({
        operation: 'CreateDocumentBlock',
        body: input,
        signal: options?.signal,
      })
    },
    async update(id, replacement, options) {
      assertBlockName(replacement.name, 'UpdateDocumentBlock')
      return context.json<DocumentBlockSchema>({
        operation: 'UpdateDocumentBlock',
        pathParams: { id },
        body: replacementBody(replacement),
        signal: options?.signal,
      })
    },
    delete: (id, options) =>
      context.empty({
        operation: 'DeleteDocumentBlock',
        pathParams: { id },
        signal: options?.signal,
      }),
  }
}
