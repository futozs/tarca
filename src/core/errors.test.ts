import { describe, expect, test } from 'vitest'
import {
  BillingoError,
  errorFromResponse,
  isBillingoError,
  parseErrorBody,
  statusInfo,
} from './errors'

describe('Billingo hibák', () => {
  test('a státuszkódból kategória és magyar üzenet lesz', () => {
    expect(statusInfo(401).category).toBe('auth')
    expect(statusInfo(402).category).toBe('subscription')
    expect(statusInfo(403).category).toBe('forbidden')
    expect(statusInfo(404).category).toBe('not_found')
    expect(statusInfo(422).category).toBe('validation')
    expect(statusInfo(429).category).toBe('rate_limit')
    expect(statusInfo(202).category).toBe('not_ready')
    expect(statusInfo(503)).toEqual({
      category: 'server',
      message: 'A Billingo szerverhibát adott (503).',
    })
    expect(statusInfo(418).category).toBe('validation')
    expect(statusInfo(302).category).toBe('unexpected_response')
  })

  test('a háromféle hibatörzset egységesen olvassa', () => {
    expect(parseErrorBody({ error: { message: ' Too many requests ', trace_id: 'abc' } })).toEqual({
      apiMessage: 'Too many requests',
      traceId: 'abc',
      fieldErrors: [],
    })
    expect(
      parseErrorBody({ message: 'invalid', errors: [{ field: 'name', message: 'required' }, 'x'] }),
    ).toEqual({
      apiMessage: 'invalid',
      traceId: undefined,
      fieldErrors: [{ field: 'name', message: 'required' }],
    })
    expect(parseErrorBody({ errors: [{}] }).fieldErrors).toEqual([{ field: '', message: '' }])
    expect(parseErrorBody('<html>')).toEqual({
      apiMessage: undefined,
      traceId: undefined,
      fieldErrors: [],
    })
  })

  test('a hibaüzenet tartalmazza a Billingo eredeti üzenetét', () => {
    const error = errorFromResponse({
      status: 402,
      body: { error: { message: 'You do not have subscription for this operation' } },
      operation: 'CreateDocument',
      requestId: 'r1',
      retryAfterMs: undefined,
      rateLimit: undefined,
    })

    expect(error.message).toBe(
      'A Billingo előfizetés nem engedi ezt a műveletet. (You do not have subscription for this operation)',
    )
    expect(error.hint).toContain('díjcsomag')
    expect(error.retryable).toBe(false)
    expect(isBillingoError(error)).toBe(true)
    expect(isBillingoError(new Error('x'))).toBe(false)
  })

  test('az isNotFound és a cause mezők', () => {
    const cause = new Error('alap')
    const error = new BillingoError('nincs', { category: 'not_found', cause })

    expect(error.isNotFound).toBe(true)
    expect(error.cause).toBe(cause)
    expect(error.fieldErrors).toEqual([])
    expect(error.name).toBe('BillingoError')
  })
})
