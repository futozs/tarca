import {
  type BinaryResponse,
  type RequestOptions,
  resolveMaxWait,
  sleep,
  type TarcaContext,
} from '../core/context'
import { BillingoError, isBillingoError } from '../core/errors'
import type { OperationId } from '../core/operations'
import type { DocumentPublicUrl } from '../generated/billingo'
import { assertValid, createInputCheck, describeValue } from './check'

export type DocumentPdf = BinaryResponse

export type PosPaperSize = 58 | 80

export interface PdfOptions extends RequestOptions {
  readonly maxWaitMs?: number
}

export interface PosPdfOptions extends RequestOptions {
  readonly size: PosPaperSize
}

export interface DocumentFilesApi {
  pdf(id: number, options?: PdfOptions): Promise<DocumentPdf>
  posPdf(id: number, options: PosPdfOptions): Promise<DocumentPdf>
  publicUrl(id: number, options?: RequestOptions): Promise<string>
}

export const DEFAULT_PDF_WAIT_MS = 30_000

export const PDF_WAIT_BASE_MS = 1_000

export const POS_PAPER_SIZES: readonly PosPaperSize[] = [58, 80]

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46]

function checkedPdf(operation: OperationId, file: BinaryResponse): DocumentPdf {
  if (PDF_SIGNATURE.every((byte, index) => file.bytes[index] === byte)) return file
  throw new BillingoError(
    `A Billingo válasza nem PDF (tartalomtípus: ${file.contentType ?? 'nincs'}, ${file.bytes.length} bájt).`,
    {
      category: 'unexpected_response',
      operation,
      hint: 'A PDF fájl %PDF jelekkel kezdődik, ez a válasz nem. A tartalomtípust a tárca szándékosan nem nézi, mert a Billingo a POS PDF-et application/octet-stream típussal küldi.',
    },
  )
}

function pdfNotReady(id: number, maxWaitMs: number, last: BillingoError): BillingoError {
  return new BillingoError(
    `A bizonylat (id: ${id}) PDF-je ${maxWaitMs} ms várakozás után sem készült el.`,
    {
      category: 'not_ready',
      status: last.status,
      operation: 'DownloadDocument',
      apiMessage: last.apiMessage,
      requestId: last.requestId,
      hint: `A Billingo tovább készíti a PDF-et: hívd meg később újra a documents.pdf(${id}) metódust, vagy adj meg nagyobb maxWaitMs értéket.`,
      cause: last,
    },
  )
}

function missingPublicUrl(id: number): BillingoError {
  return new BillingoError(
    `A Billingo nem adott nyilvános hivatkozást a bizonylathoz (id: ${id}).`,
    {
      category: 'unexpected_response',
      operation: 'GetPublicUrl',
    },
  )
}

export function createDocumentFilesApi(context: TarcaContext): DocumentFilesApi {
  return {
    async pdf(id, options = {}) {
      const maxWaitMs = resolveMaxWait(options.maxWaitMs, DEFAULT_PDF_WAIT_MS)
      let waited = 0
      for (let attempt = 0; ; attempt++) {
        try {
          const file = await context.binary({
            operation: 'DownloadDocument',
            pathParams: { id },
            signal: options.signal,
          })
          return checkedPdf('DownloadDocument', file)
        } catch (error) {
          if (!isBillingoError(error) || error.category !== 'not_ready') throw error
          if (waited >= maxWaitMs) throw pdfNotReady(id, maxWaitMs, error)
          const delay = Math.min(PDF_WAIT_BASE_MS * 2 ** attempt, maxWaitMs - waited)
          await sleep(delay, options.signal)
          waited += delay
        }
      }
    },
    async posPdf(id, options) {
      const check = createInputCheck()
      if (!POS_PAPER_SIZES.includes(options.size)) {
        check.fail(
          'size',
          `A papírszélesség 58 vagy 80 (mm) lehet, kapott: ${describeValue(options.size)}.`,
        )
      }
      assertValid(check, 'PosPrint', 'nyomtatási beállítás')
      const file = await context.binary({
        operation: 'PosPrint',
        pathParams: { id },
        query: { size: options.size },
        signal: options.signal,
      })
      return checkedPdf('PosPrint', file)
    },
    async publicUrl(id, options) {
      const response = await context.json<DocumentPublicUrl>({
        operation: 'GetPublicUrl',
        pathParams: { id },
        signal: options?.signal,
      })
      if (!response.publicUrl) throw missingPublicUrl(id)
      return response.publicUrl
    },
  }
}
