import { describe, expect, test } from 'vitest'
import { buildQuery, fillPath, joinUrl } from './url'

describe('URL építés', () => {
  test('az útvonal paramétereit kódolva tölti ki', () => {
    expect(fillPath('/documents/{id}/download', { id: 12 })).toBe('/documents/12/download')
    expect(fillPath('/documents/vendor/{vendor_id}', { vendor_id: 'ORDER 1/2' })).toBe(
      '/documents/vendor/ORDER%201%2F2',
    )
    expect(() => fillPath('/documents/{id}')).toThrow('id')
  })

  test('a . és .. útvonal-paramétert elutasítja, mert a fetch URL-feldolgozója útvonal-lépésnek venné', () => {
    expect(new URL('https://api.billingo.hu/v3/documents/vendor/..').pathname).toBe(
      '/v3/documents/',
    )
    for (const vendorId of ['.', '..']) {
      expect(() => fillPath('/documents/vendor/{vendor_id}', { vendor_id: vendorId })).toThrow(
        RangeError,
      )
    }
    expect(fillPath('/documents/vendor/{vendor_id}', { vendor_id: '...' })).toBe(
      '/documents/vendor/...',
    )
    expect(fillPath('/documents/vendor/{vendor_id}', { vendor_id: '%2e%2e' })).toBe(
      '/documents/vendor/%252e%252e',
    )
  })

  test('a query kulcsait snake_case-re alakítja, az undefined értéket kihagyja', () => {
    expect(
      buildQuery({ perPage: 25, paymentStatus: 'paid', blockId: undefined, archived: false }),
    ).toBe('?per_page=25&payment_status=paid&archived=false')
    expect(buildQuery()).toBe('')
  })

  test('a bázis URL záró perjelét levágja', () => {
    expect(joinUrl('https://api.billingo.hu/v3/', '/utils/time', '')).toBe(
      'https://api.billingo.hu/v3/utils/time',
    )
  })
})
