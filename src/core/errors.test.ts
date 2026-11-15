import { describe, expect, test } from 'vitest'
import {
  BillingoError,
  configurationError,
  errorFromResponse,
  isBillingoError,
  parseErrorBody,
  statusInfo,
  withHint,
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

  test('a NAV kapcsolat hiányát jelző 401 és 403 nem kulcshiba, hanem nav_unavailable', () => {
    const fromStatus = (status: number, message: string) =>
      errorFromResponse({
        status,
        body: { error: { message } },
        operation: 'CheckTaxNumber',
        requestId: 'r1',
        retryAfterMs: undefined,
        rateLimit: undefined,
      })
    const sandbox =
      'To use this feature, please ensure you have a live connection to NAV (not available in sandbox mode)'

    const error = fromStatus(401, sandbox)
    expect(error).toMatchObject({
      category: 'nav_unavailable',
      status: 401,
      retryable: false,
      apiMessage: sandbox,
    })
    expect(error.message).toBe(
      `A funkcióhoz élő NAV kapcsolat kell, ennek a Billingo profilnak nincs. (${sandbox})`,
    )
    expect(error.hint).toContain('nem kulcshiba')
    expect(error.hint).toContain('teszt profil')
    expect(fromStatus(403, 'Missing NAV connection').category).toBe('nav_unavailable')
    expect(fromStatus(401, 'Nincs NAV kapcsolat').category).toBe('nav_unavailable')
    expect(
      fromStatus(401, 'Authorization information (Header: X-API-KEY) is missing or invalid.')
        .category,
    ).toBe('auth')
    expect(fromStatus(401, 'NAV error').category).toBe('auth')
    expect(fromStatus(401, 'navigation connection lost').category).toBe('auth')
    expect(
      errorFromResponse({
        status: 401,
        body: undefined,
        operation: 'GetOrganizationData',
        requestId: 'r2',
        retryAfterMs: undefined,
        rateLimit: undefined,
      }).category,
    ).toBe('auth')
    expect(fromStatus(500, sandbox).category).toBe('server')
    expect(fromStatus(422, sandbox).category).toBe('validation')
  })
})

describe('withHint', () => {
  test('a Billingo hibájának minden mezőjét megtartja, csak a tippet (és ha kell, az üzenetet) cseréli', () => {
    const original = new BillingoError('Eredeti üzenet', {
      category: 'rate_limit',
      status: 429,
      operation: 'CancelDocument',
      apiMessage: 'Too many requests',
      traceId: 'trace-1',
      fieldErrors: [{ field: 'name', message: 'required' }],
      retryAfterMs: 1500,
      rateLimit: { limit: 300, remaining: 0, resetAt: undefined },
      requestId: 'req-1',
      hint: 'régi tipp',
    })

    const kept = withHint(original, 'új tipp')
    const renamed = withHint(original, 'új tipp', 'Új üzenet')

    const { hint: _hint, ...fields } = original
    expect(kept).toMatchObject({ ...fields, message: 'Eredeti üzenet', hint: 'új tipp' })
    expect(kept.retryable).toBe(true)
    expect(kept.cause).toBe(original)
    expect(renamed.message).toBe('Új üzenet')
    expect(renamed).toMatchObject({ ...fields, hint: 'új tipp' })
  })

  test('a configurationError configuration kategóriájú, nem ismételhető hiba', () => {
    expect(configurationError('Rossz beállítás.')).toMatchObject({
      category: 'configuration',
      retryable: false,
      message: 'Rossz beállítás.',
    })
  })
})
