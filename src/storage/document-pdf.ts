import type { DocumentsApi } from '../documents/documents'
import type { Document } from '../generated/billingo'
import { storageError } from './errors'
import { documentPdfKey } from './keys'
import { storePdf } from './store-pdf'
import type { StorageAdapter, StoredFile } from './types'

export interface DocumentPdfSource {
  readonly documents: Pick<DocumentsApi, 'get' | 'pdf'>
}

export interface StoreDocumentPdfOptions {
  readonly key?: string | undefined
  readonly maxWaitMs?: number | undefined
  readonly signal?: AbortSignal | undefined
}

async function resolveTarget(
  tarca: DocumentPdfSource,
  documentOrId: Document | number,
  options: StoreDocumentPdfOptions,
): Promise<{ readonly id: number; readonly key: string }> {
  if (typeof documentOrId === 'number' && options.key !== undefined) {
    return { id: documentOrId, key: options.key }
  }
  const document =
    typeof documentOrId === 'number'
      ? await tarca.documents.get(documentOrId, { signal: options.signal })
      : documentOrId
  if (document.id === undefined) {
    throw storageError(
      'put',
      options.key,
      'A bizonylatnak nincs azonosítója (id), a PDF-je nem tölthető le.',
    )
  }
  return { id: document.id, key: options.key ?? documentPdfKey(document) }
}

export async function storeDocumentPdf(
  tarca: DocumentPdfSource,
  storage: StorageAdapter,
  documentOrId: Document | number,
  options: StoreDocumentPdfOptions = {},
): Promise<StoredFile> {
  const { id, key } = await resolveTarget(tarca, documentOrId, options)
  const pdf = await tarca.documents.pdf(id, {
    ...(options.maxWaitMs === undefined ? {} : { maxWaitMs: options.maxWaitMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  return storePdf(storage, key, pdf.bytes)
}
