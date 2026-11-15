import { describe, expect, test } from 'vitest'
import { BILLINGO_OPERATIONS } from '../../core/operations'
import { isOperationId, resolveRoute } from './router'

describe('resolveRoute', () => {
  test('minden Billingo művelet a saját útvonalán a saját műveletére illeszkedik', () => {
    const mismatches = Object.entries(BILLINGO_OPERATIONS).flatMap(([operation, info]) => {
      const path = info.path.replace(/\{\w+\}/g, '7')
      const route = resolveRoute(info.method, path)
      return route.kind === 'match' && route.operation === operation
        ? []
        : [`${operation}: ${info.method} ${path} → ${JSON.stringify(route)}`]
    })

    expect(mismatches).toEqual([])
  })

  test('a művelettábla sorrendjében illeszkedik, a paraméter dekódolva érkezik', () => {
    expect(resolveRoute('POST', '/documents/receipt')).toEqual({
      kind: 'match',
      operation: 'CreateReceipt',
      params: {},
    })
    expect(resolveRoute('GET', '/documents/vendor/ORDER%2F1%20A')).toEqual({
      kind: 'match',
      operation: 'GetDocumentByVendorId',
      params: { vendor_id: 'ORDER/1 A' },
    })
    expect(resolveRoute('PUT', '/documents/receipt/9')).toEqual({
      kind: 'match',
      operation: 'CreateReceiptFromDraft',
      params: { id: '9' },
    })
    expect(resolveRoute('GET', '/documents/vendor/download')).toEqual({
      kind: 'match',
      operation: 'GetDocumentByVendorId',
      params: { vendor_id: 'download' },
    })
    expect(resolveRoute('GET', '/documents/receipt')).toEqual({
      kind: 'match',
      operation: 'GetDocument',
      params: { id: 'receipt' },
    })
  })

  test('a HEAD a GET útvonalra illeszkedik', () => {
    expect(resolveRoute('HEAD', '/utils/time')).toEqual({
      kind: 'match',
      operation: 'GetServerTime',
      params: {},
    })
  })

  test('405: az engedett metódusok a Laravel sorrendjében, HEAD-del a GET mellett', () => {
    expect(resolveRoute('PATCH', '/bank-accounts/1')).toEqual({
      kind: 'method-not-allowed',
      allowed: ['GET', 'HEAD', 'PUT', 'DELETE'],
    })
    expect(resolveRoute('DELETE', '/bank-accounts')).toEqual({
      kind: 'method-not-allowed',
      allowed: ['GET', 'HEAD', 'POST'],
    })
    expect(resolveRoute('GET', '/documents/1/cancel')).toEqual({
      kind: 'method-not-allowed',
      allowed: ['POST'],
    })
    expect(resolveRoute('PATCH', '/documents/receipt')).toEqual({
      kind: 'method-not-allowed',
      allowed: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
    })
  })

  test('ismeretlen útvonal, üres vagy hibásan kódolt paraméter: not-found', () => {
    expect(resolveRoute('GET', '/nincs')).toEqual({ kind: 'not-found' })
    expect(resolveRoute('GET', '/bank-accounts/1/extra')).toEqual({ kind: 'not-found' })
    expect(resolveRoute('GET', '/documents/vendor/%E0%A4%A')).toEqual({ kind: 'not-found' })
    expect(resolveRoute('GET', '/')).toEqual({ kind: 'not-found' })
  })

  test('isOperationId csak a művelettábla kulcsait fogadja el', () => {
    expect(isOperationId('GetBankAccount')).toBe(true)
    expect(isOperationId('getBankAccount')).toBe(false)
    expect(isOperationId('toString')).toBe(false)
    expect(isOperationId(7)).toBe(false)
  })
})
