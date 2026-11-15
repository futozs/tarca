import {
  type BinaryResponse,
  type RequestOptions,
  resolveMaxWait,
  sleep,
  type TarcaContext,
} from '../core/context'
import { type DateInput, toBillingoDate } from '../core/dates'
import { BillingoError } from '../core/errors'
import type {
  CreateDocumentExport,
  DocumentExportId,
  DocumentExportStatus,
} from '../generated/billingo'

export interface ExportInput extends Omit<CreateDocumentExport, 'startDate' | 'endDate'> {
  readonly startDate: DateInput
  readonly endDate: DateInput
}

export interface ExportJob {
  readonly id: string
}

export type ExportFile = BinaryResponse

export interface ExportResult extends ExportFile {
  readonly id: string
  readonly state: 'success' | 'warning'
  readonly message: string | undefined
}

export interface ExportRunOptions extends RequestOptions {
  readonly maxWaitMs?: number
}

export interface ExportsApi {
  create(input: ExportInput, options?: RequestOptions): Promise<ExportJob>
  poll(id: string, options?: RequestOptions): Promise<DocumentExportStatus>
  download(id: string, options?: RequestOptions): Promise<ExportFile>
  run(input: ExportInput, options?: ExportRunOptions): Promise<ExportResult>
}

export const DEFAULT_EXPORT_WAIT_MS = 60_000

export const EXPORT_POLL_DELAY_MS = 1_000

export const EXPORT_POLL_MAX_DELAY_MS = 5_000

function pollDelay(attempt: number): number {
  return Math.min(EXPORT_POLL_DELAY_MS * 2 ** Math.max(0, attempt - 1), EXPORT_POLL_MAX_DELAY_MS)
}

function exportFailed(status: DocumentExportStatus, id: string): BillingoError {
  const detail = status.message ? ` (${status.message})` : ''
  return new BillingoError(`A Billingo nem tudta elkészíteni az exportot (id: ${id})${detail}.`, {
    category: 'server',
    operation: 'Poll',
    apiMessage: status.message || undefined,
    hint: 'Az export állapota fail. Ellenőrizd a szűrőket (dátumtartomány, számlatömb, formátum), és indíts új exportot.',
  })
}

function exportNotReady(id: string, maxWaitMs: number): BillingoError {
  return new BillingoError(`Az export (id: ${id}) ${maxWaitMs} ms alatt nem készült el.`, {
    category: 'not_ready',
    operation: 'Poll',
    hint: `Az export a Billingo oldalán tovább készül: később az exports.poll('${id}') és az exports.download('${id}') hívással letölthető, új exportot nem kell indítani.`,
  })
}

function missingExportId(): BillingoError {
  return new BillingoError(
    'A Billingo export válaszából hiányzik az azonosító. Az export ettől még elindulhatott a Billingo oldalán.',
    { category: 'unexpected_response', status: 201, operation: 'Create' },
  )
}

export function createExportsApi(context: TarcaContext): ExportsApi {
  const create = async (input: ExportInput, options?: RequestOptions): Promise<ExportJob> => {
    const response = await context.json<DocumentExportId>({
      operation: 'Create',
      body: {
        ...input,
        startDate: toBillingoDate(input.startDate),
        endDate: toBillingoDate(input.endDate),
      },
      signal: options?.signal,
    })
    if (!response.id) throw missingExportId()
    return { id: response.id }
  }
  const poll = (id: string, options?: RequestOptions): Promise<DocumentExportStatus> =>
    context.json<DocumentExportStatus>({
      operation: 'Poll',
      pathParams: { id },
      signal: options?.signal,
    })
  const download = (id: string, options?: RequestOptions): Promise<ExportFile> =>
    context.binary({ operation: 'Download', pathParams: { id }, signal: options?.signal })

  return {
    create,
    poll,
    download,
    async run(input, options = {}) {
      const maxWaitMs = resolveMaxWait(options.maxWaitMs, DEFAULT_EXPORT_WAIT_MS)
      const { id } = await create(input, options)
      let waited = 0
      for (let attempt = 0; ; attempt++) {
        const delay = Math.min(pollDelay(attempt), maxWaitMs - waited)
        await sleep(delay, options.signal)
        waited += delay
        const status = await poll(id, options)
        if (status.state === 'fail') throw exportFailed(status, id)
        if (status.state === 'success' || status.state === 'warning') {
          const file = await download(id, options)
          return { ...file, id, state: status.state, message: status.message || undefined }
        }
        if (waited >= maxWaitMs) throw exportNotReady(id, maxWaitMs)
      }
    },
  }
}
