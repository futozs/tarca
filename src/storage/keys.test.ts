import { describe, expect, test } from 'vitest'
import type { Document, DocumentType } from '../generated/billingo'
import { StorageError } from './errors'
import { documentPdfKey, sanitizeKeySegment } from './keys'

function doc(type: DocumentType, invoiceNumber = 'E-1', invoiceDate = '2026-09-03'): Document {
  return { id: 1, type, invoiceNumber, invoiceDate }
}

describe('documentPdfKey', () => {
  test('számla: szamlak/ÉÉÉÉ/HH/<sorszám>.pdf a kiállítás dátumából', () => {
    expect(documentPdfKey(doc('invoice', 'TARCA / 2026-000012'))).toBe(
      'szamlak/2026/09/TARCA-2026-000012.pdf',
    )
  })

  test.each([
    ['proforma', 'szamlak/dijbekero/2026/09/E-1.pdf'],
    ['advance', 'szamlak/elolegszamla/2026/09/E-1.pdf'],
    ['modification', 'szamlak/modosito/2026/09/E-1.pdf'],
    ['cancellation', 'szamlak/sztorno/2026/09/E-1.pdf'],
    ['receipt', 'nyugtak/2026/09/E-1.pdf'],
    ['receipt_cancellation', 'nyugtak/sztorno/2026/09/E-1.pdf'],
    ['offer', 'arajanlatok/2026/09/E-1.pdf'],
    ['order_form', 'megrendelok/2026/09/E-1.pdf'],
    ['waybill', 'szallitolevelek/2026/09/E-1.pdf'],
    ['dossier', 'dossziek/2026/09/E-1.pdf'],
    ['cert_of_completion', 'teljesitesigazolasok/2026/09/E-1.pdf'],
    ['d_cert_of_completion', 'teljesitesigazolasok/2026/09/E-1.pdf'],
  ] as const)('%s → %s', (type, key) => {
    expect(documentPdfKey(doc(type))).toBe(key)
  })

  test('egyedi, többszintű prefix szanitizálva a mappák elé kerül', () => {
    expect(documentPdfKey(doc('receipt'), { prefix: '/ügyfél 1/../bolt/' })).toBe(
      'ugyfel-1/bolt/nyugtak/2026/09/E-1.pdf',
    )
    expect(documentPdfKey(doc('invoice'), { prefix: '' })).toBe('szamlak/2026/09/E-1.pdf')
  })

  test('a sorszámból fájlnév-biztos nevet képez, a kulcs nem léphet ki', () => {
    expect(documentPdfKey(doc('invoice', ' E/ÁRVÍZ 2026\\12 '))).toBe(
      'szamlak/2026/09/E-ARVIZ-2026-12.pdf',
    )
    expect(documentPdfKey(doc('invoice', '../../etc/passwd'))).toBe(
      'szamlak/2026/09/etc-passwd.pdf',
    )
  })

  test.each(['draft', 'draft_offer', 'draft_order_form', 'draft_waybill'] as const)(
    'piszkozatra (%s) StorageError',
    (type) => {
      expect(() => documentPdfKey(doc(type, ''))).toThrow(StorageError)
      expect(() => documentPdfKey(doc(type, 'X-1'))).toThrow('piszkozat')
    },
  )

  test('sorszám nélküli, ismeretlen típusú vagy dátum nélküli bizonylatnál StorageError', () => {
    expect(() => documentPdfKey(doc('invoice', ''))).toThrow('nincs sorszáma')
    expect(() => documentPdfKey(doc('invoice', '../..'))).toThrow('nem képezhető fájlnév')
    expect(() =>
      documentPdfKey({ id: 1, invoiceNumber: 'E-1', invoiceDate: '2026-09-03' }),
    ).toThrow('Ismeretlen bizonylattípus')
    expect(() => documentPdfKey(doc('canceled' as DocumentType))).toThrow(StorageError)
    expect(() => documentPdfKey(doc('constructor' as DocumentType))).toThrow('Ismeretlen')
    expect(() => documentPdfKey({ id: 1, type: 'invoice', invoiceNumber: 'E-1' })).toThrow(
      'invoiceDate',
    )
    const error = (() => {
      try {
        documentPdfKey(doc('draft', ''))
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toMatchObject({ name: 'StorageError', operation: 'key' })
  })

  test('érvénytelen dátumnál RangeError', () => {
    expect(() => documentPdfKey(doc('invoice', 'E-1', '2026-02-30'))).toThrow(RangeError)
  })
})

describe('sanitizeKeySegment', () => {
  test('ékezetet eltávolít, a széleken lévő pontot és kötőjelet levágja', () => {
    expect(sanitizeKeySegment('..Őrült  fűzfa--')).toBe('Orult-fuzfa')
    expect(sanitizeKeySegment('a.b_c-d')).toBe('a.b_c-d')
    expect(sanitizeKeySegment('..')).toBe('')
  })
})
