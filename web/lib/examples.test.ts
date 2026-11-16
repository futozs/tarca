import { describe, expect, test } from 'vitest'
import {
  type GeneratedRequest,
  pickRequests,
  requestLine,
  requestText,
  responseText,
} from './examples'

const listPartners: GeneratedRequest = {
  id: 1,
  operation: 'ListPartner',
  method: 'GET',
  path: '/partners',
  query: [
    ['per_page', '100'],
    ['query', 'Vevő Kft.'],
  ],
  requestBody: undefined,
  status: 200,
  responseHeaders: [['content-type', 'application/json']],
  responseKind: 'json',
  responseBody: '{\n  "data": []\n}',
}

const createDocument: GeneratedRequest = {
  ...listPartners,
  id: 2,
  operation: 'CreateDocument',
  method: 'POST',
  path: '/documents',
  query: [],
  requestBody: '{\n  "partner_id": 1\n}',
  status: 201,
}

describe('sandbox példák kérései', () => {
  test('a kérés sora olvashatóan, kódolás nélkül mutatja a query paramétereket', () => {
    expect(requestLine(listPartners)).toBe('GET /partners?per_page=100&query=Vevő Kft.')
    expect(requestLine(createDocument)).toBe('POST /documents')
  })

  test('a törzs nélküli kérés egy sor, a törzses JSON fejlécet kap', () => {
    expect(requestText(listPartners)).toBe('GET /partners?per_page=100&query=Vevő Kft. HTTP/1.1')
    expect(requestText(createDocument)).toBe(
      'POST /documents HTTP/1.1\ncontent-type: application/json\n\n{\n  "partner_id": 1\n}',
    )
  })

  test('a válasz a státuszt, a fejléceket és a törzset mutatja', () => {
    expect(responseText(listPartners)).toBe(
      'HTTP/1.1 200\ncontent-type: application/json\n\n{\n  "data": []\n}',
    )
  })

  test('elveszett válasznál a hiba okát írja, üres törzzsel', () => {
    const lost: GeneratedRequest = {
      ...createDocument,
      status: 'network',
      responseHeaders: [],
      responseKind: 'empty',
      responseBody: '',
    }
    expect(responseText(lost)).toBe('nincs válasz (hálózati hiba)')
  })

  test('művelet szerint szűr, művelet nélkül mindet adja', () => {
    expect(pickRequests([listPartners, createDocument], 'CreateDocument')).toEqual([createDocument])
    expect(pickRequests([listPartners, createDocument], undefined)).toHaveLength(2)
  })
})
