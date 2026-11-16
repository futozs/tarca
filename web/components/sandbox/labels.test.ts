import { describe, expect, test } from 'vitest'
import type { SandboxRequest } from '@/sandbox/runtime/protocol'
import { tokenizeJson } from './json-code'
import {
  defaultOpenRequest,
  documentTypeLabel,
  formatAmount,
  paymentStatusLabel,
  requestTarget,
  statusLabel,
  statusTone,
} from './labels'

function request(id: number, method: string): SandboxRequest {
  return {
    id,
    operation: undefined,
    method,
    path: '/documents',
    query: [],
    requestBody: undefined,
    status: 200,
    responseHeaders: [],
    responseKind: 'json',
    responseBody: '{}',
    durationMs: 0,
  }
}

describe('a sandbox kimenetének címkéi', () => {
  test('a bizonylattípus és a fizetési állapot magyarul jelenik meg', () => {
    expect(documentTypeLabel('proforma')).toBe('díjbekérő')
    expect(documentTypeLabel('receipt_cancellation')).toBe('nyugta sztornó')
    expect(documentTypeLabel('ismeretlen')).toBe('ismeretlen')
    expect(paymentStatusLabel('partially_paid')).toBe('részben fizetve')
  })

  test('az összeg magyar formátumú, forintnál tizedes nélkül', () => {
    expect(formatAmount(190_500, 'HUF').replace(/\s/g, ' ')).toBe('190 500 Ft')
    expect(formatAmount(457.2, 'EUR').replace(/\s/g, ' ')).toBe('457,20 EUR')
  })

  test('a státusz tónusa és felirata', () => {
    expect(statusTone(201)).toBe('ok')
    expect(statusTone(422)).toBe('client-error')
    expect(statusTone(503)).toBe('server-error')
    expect(statusTone('timeout')).toBe('network')
    expect(statusLabel('network')).toBe('hálózati hiba')
    expect(statusLabel(404)).toBe('404')
  })

  test('a cél a lekérdezést olvasható formában mutatja', () => {
    expect(requestTarget({ path: '/partners', query: [['query', 'Vevő Kft.']] })).toBe(
      '/partners?query=Vevő Kft.',
    )
    expect(requestTarget({ path: '/documents', query: [] })).toBe('/documents')
  })

  test('alapból az utolsó írás nyílik ki, írás nélkül az első kérés', () => {
    expect(
      defaultOpenRequest([
        request(1, 'GET'),
        request(2, 'POST'),
        request(3, 'PUT'),
        request(4, 'GET'),
      ]),
    ).toBe(3)
    expect(defaultOpenRequest([request(1, 'GET'), request(2, 'GET')])).toBe(1)
    expect(defaultOpenRequest([])).toBeUndefined()
  })
})

describe('JSON kiemelés', () => {
  test('a kulcsot, a szöveget, a számot és a literált külön jelöli', () => {
    const tokens = tokenizeJson('{\n  "név": "Vevő \\"Kft.\\"",\n  "ár": -1.5e3,\n  "ok": null\n}')
    const kinds = tokens
      .filter((token) => token.kind !== 'text')
      .map((token) => [token.kind, token.text])

    expect(kinds).toEqual([
      ['punctuation', '{'],
      ['key', '"név"'],
      ['punctuation', ':'],
      ['string', '"Vevő \\"Kft.\\""'],
      ['punctuation', ','],
      ['key', '"ár"'],
      ['punctuation', ':'],
      ['number', '-1.5e3'],
      ['punctuation', ','],
      ['key', '"ok"'],
      ['punctuation', ':'],
      ['literal', 'null'],
      ['punctuation', '}'],
    ])
  })

  test('a tokenek pontosan visszaadják a bemenetet', () => {
    const source = '{\n  "items": [\n    { "vat": "27%" }\n  ]\n}'
    expect(
      tokenizeJson(source)
        .map((token) => token.text)
        .join(''),
    ).toBe(source)
  })
})
