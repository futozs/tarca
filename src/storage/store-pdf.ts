import { storageError } from './errors'
import { PDF_CONTENT_TYPE } from './shared'
import type { StorageAdapter, StoredFile } from './types'

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46] as const

export function isPdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_SIGNATURE.length) return false
  return PDF_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

export async function storePdf(
  storage: StorageAdapter,
  key: string,
  pdf: Uint8Array,
): Promise<StoredFile> {
  if (!isPdf(pdf)) {
    throw storageError('put', key, 'A tárolandó tartalom nem PDF (hiányzik a %PDF fejléc).')
  }
  return storage.put(key, pdf, { contentType: PDF_CONTENT_TYPE })
}
