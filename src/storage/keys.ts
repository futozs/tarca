import { toBillingoDate } from '../core/dates'
import type { Document, DocumentType } from '../generated/billingo'
import { type StorageError, storageError } from './errors'

export interface DocumentPdfKeyOptions {
  readonly prefix?: string | undefined
}

export const INVOICE_KEY_FOLDER = 'szamlak'
export const RECEIPT_KEY_FOLDER = 'nyugtak'

export const DRAFT_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set([
  'draft',
  'draft_offer',
  'draft_order_form',
  'draft_waybill',
])

const DOCUMENT_FOLDERS: Readonly<Record<DocumentType, readonly string[]>> = {
  invoice: [INVOICE_KEY_FOLDER],
  proforma: [INVOICE_KEY_FOLDER, 'dijbekero'],
  advance: [INVOICE_KEY_FOLDER, 'elolegszamla'],
  modification: [INVOICE_KEY_FOLDER, 'modosito'],
  cancellation: [INVOICE_KEY_FOLDER, 'sztorno'],
  receipt: [RECEIPT_KEY_FOLDER],
  receipt_cancellation: [RECEIPT_KEY_FOLDER, 'sztorno'],
  offer: ['arajanlatok'],
  order_form: ['megrendelok'],
  waybill: ['szallitolevelek'],
  dossier: ['dossziek'],
  cert_of_completion: ['teljesitesigazolasok'],
  d_cert_of_completion: ['teljesitesigazolasok'],
  draft: [],
  draft_offer: [],
  draft_order_form: [],
  draft_waybill: [],
}

const COMBINING_MARKS = /\p{M}/gu

export function sanitizeKeySegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

function keyError(message: string): StorageError {
  return storageError('key', undefined, message)
}

export function documentPdfKey(document: Document, options: DocumentPdfKeyOptions = {}): string {
  const { type, invoiceNumber } = document
  if (type === undefined || !Object.hasOwn(DOCUMENT_FOLDERS, type)) {
    throw keyError(`Ismeretlen bizonylattípus, nem képezhető tárhelykulcs: ${String(type)}`)
  }
  if (DRAFT_DOCUMENT_TYPES.has(type) || !invoiceNumber) {
    throw keyError(
      `A piszkozatnak (id: ${document.id ?? 'ismeretlen'}) nincs sorszáma, ezért nem képezhető belőle tárhelykulcs. Véglegesítés után mentsd el a PDF-et.`,
    )
  }
  const fileName = sanitizeKeySegment(invoiceNumber)
  if (fileName === '') {
    throw keyError(`A bizonylatszámból nem képezhető fájlnév: ${JSON.stringify(invoiceNumber)}`)
  }
  if (document.invoiceDate === undefined) {
    throw keyError(`A bizonylatból (${invoiceNumber}) hiányzik a kiállítás dátuma (invoiceDate).`)
  }
  const [year = '', month = ''] = toBillingoDate(document.invoiceDate).split('-')
  return [...(options.prefix ?? '').split('/'), ...DOCUMENT_FOLDERS[type], year, month]
    .map(sanitizeKeySegment)
    .filter((segment) => segment !== '')
    .concat(`${fileName}.pdf`)
    .join('/')
}
