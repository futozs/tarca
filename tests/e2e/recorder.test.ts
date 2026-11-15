import { describe, expect, test } from 'vitest'
import {
  billingoSpecValidator,
  createSpecValidator,
  type OpenApiSpec,
  SPEC_AVAILABLE,
} from '../openapi'
import { createResponseRecorder, type RecordedExchange, validateRecording } from './recorder'

const API = 'https://api.billingo.hu/v3'

function replying(response: () => Response): typeof globalThis.fetch {
  return (async () => response()) as typeof globalThis.fetch
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

describe('a válaszrögzítő fetch', () => {
  test('műveletre képezi a kérést, rögzíti a JSON törzseket, és a választ érintetlenül adja tovább', async () => {
    const recorder = createResponseRecorder()
    const fetch = recorder.wrap(replying(() => json(201, { id: 1, name: 'Fő' })))

    const response = await fetch(`${API}/bank-accounts?page=2`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Fő' }),
    })

    expect(await response.json()).toEqual({ id: 1, name: 'Fő' })
    expect(recorder.records).toHaveLength(1)
    expect(recorder.records[0]).toMatchObject({
      method: 'POST',
      operation: 'CreateBankAccount',
      pathParams: {},
      requestBody: { name: 'Fő' },
      requestBodyIssue: undefined,
      status: 201,
      contentType: 'application/json; charset=utf-8',
      responseBody: { id: 1, name: 'Fő' },
      responseBodyIssue: undefined,
    })
    expect(recorder.records[0]?.query.get('page')).toBe('2')
  })

  test('a bináris választ nem olvassa ki, a hibás JSON-t és az ismeretlen útvonalat megjelöli', async () => {
    const recorder = createResponseRecorder()
    const pdf = recorder.wrap(
      replying(() => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })),
    )
    const broken = recorder.wrap(
      replying(
        () =>
          new Response('<html>', { status: 500, headers: { 'content-type': 'application/json' } }),
      ),
    )

    const response = await pdf(`${API}/documents/5/download`)
    await broken(`${API}/ismeretlen`, { method: 'DELETE', body: new Blob(['x']) })

    expect(await response.text()).toBe('%PDF-1.7')
    expect(recorder.records[0]).toMatchObject({
      operation: 'DownloadDocument',
      pathParams: { id: '5' },
      responseBody: undefined,
      responseBodyIssue: undefined,
    })
    expect(recorder.records[1]).toMatchObject({
      method: 'DELETE',
      operation: undefined,
      requestBodyIssue: 'a kéréstörzs nem JSON szöveg',
      responseBodyIssue: 'nem értelmezhető JSON',
    })
  })

  test('a hálózati hibát továbbengedi, és nem rögzít hozzá választ', async () => {
    const recorder = createResponseRecorder()
    const fetch = recorder.wrap((async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch)

    await expect(fetch(`${API}/utils/time`)).rejects.toThrow('fetch failed')
    expect(recorder.records).toEqual([])
  })
})

const SPEC = {
  info: { version: 'teszt' },
  paths: {
    '/bank-accounts/{id}': {
      get: {
        operationId: 'GetBankAccount',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } },
          },
        },
      },
      put: {
        operationId: 'UpdateBankAccount',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } },
        },
        responses: { '200': {} },
      },
    },
  },
  components: {
    schemas: {
      Account: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, iban: { type: 'string' } },
      },
    },
  },
} as unknown as OpenApiSpec

function exchange(overrides: Partial<RecordedExchange>): RecordedExchange {
  return {
    method: 'GET',
    operation: 'GetBankAccount',
    pathParams: { id: '1' },
    query: new URLSearchParams(),
    requestBody: undefined,
    requestBodyIssue: undefined,
    status: 200,
    contentType: 'application/json',
    responseBody: { name: 'Fő' },
    responseBodyIssue: undefined,
    ...overrides,
  }
}

describe('a rögzített forgalom ellenőrzése', () => {
  const validator = createSpecValidator(SPEC, {})
  const records = [
    exchange({}),
    exchange({ responseBody: { name: 'TITKOS', iban: null, extra: 'TITKOS' } }),
    exchange({ responseBody: { name: 7 } }),
    exchange({ pathParams: { id: 'abc' }, status: 404, responseBody: { error: {} } }),
    exchange({
      method: 'PUT',
      operation: 'UpdateBankAccount',
      requestBody: { iban: 'TITKOS' },
      responseBody: undefined,
      contentType: undefined,
    }),
    exchange({ responseBodyIssue: 'nem értelmezhető JSON' }),
    exchange({ method: 'POST', operation: undefined }),
  ]

  test('laza, kitakart módban: az eltérés hiba, az extra mező és a null figyelmeztetés, érték sehol', () => {
    const report = validateRecording(records, validator, { mode: 'lenient', redact: true })

    expect(report).toEqual({
      exchanges: 7,
      errors: [
        'GetBankAccount 200 válasz: Account.name: string típus kell, kapott: number',
        'GetBankAccount útvonal.id: integer típus kell, kapott: string',
        'UpdateBankAccount kérés: Account.name: kötelező mező hiányzik',
        'GetBankAccount 200 válasz: nem értelmezhető JSON',
        'POST: a kérés egyik Billingo műveletre sem illeszkedik',
      ],
      warnings: [
        'GetBankAccount 200 válasz: Account.iban: null, pedig a spec szerint nem nullable',
        'GetBankAccount 200 válasz: Account.extra: a sémában nem szereplő mező',
        'GetBankAccount 404: a státusz nincs dokumentálva',
      ],
    })
    expect(JSON.stringify(report)).not.toContain('TITKOS')
  })

  test('szigorú módban minden eltérés hiba, és nincs figyelmeztetés', () => {
    const report = validateRecording(records.slice(1, 2), validator, {
      mode: 'strict',
      redact: false,
    })

    expect(report).toEqual({
      exchanges: 1,
      errors: [
        'GetBankAccount 200 válasz: Account.iban: null nem engedett',
        'GetBankAccount 200 válasz: Account.extra: a sémában nem szereplő mező',
      ],
      warnings: [],
    })
  })

  test('a rögzítőt kikerülő kérés hiba, mert a válasza ellenőrizetlen maradna', () => {
    const report = validateRecording([exchange({})], validator, {
      mode: 'strict',
      redact: false,
      expectedOperations: ['GetBankAccount', 'UpdateBankAccount'],
    })

    expect(report.errors).toEqual([
      'UpdateBankAccount: a kérés kikerülte a rögzítőt, a válasza nincs ellenőrizve',
    ])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('a rögzített forgalom a friss Billingo spec ellen', () => {
  test('az üres oldal null lapozó URL-je lazán figyelmeztetés, szigorúan hiba', () => {
    const page = exchange({
      operation: 'ListBankAccount',
      pathParams: {},
      query: new URLSearchParams('page=1&per_page=100'),
      responseBody: {
        data: [],
        total: 0,
        per_page: 100,
        current_page: 1,
        last_page: 1,
        prev_page_url: null,
        next_page_url: null,
      },
    })

    expect(
      validateRecording([page], billingoSpecValidator(), { mode: 'lenient', redact: true }),
    ).toEqual({
      exchanges: 1,
      errors: [],
      warnings: [
        'ListBankAccount 200 válasz: BankAccountList.prev_page_url: null, pedig a spec szerint nem nullable',
        'ListBankAccount 200 válasz: BankAccountList.next_page_url: null, pedig a spec szerint nem nullable',
      ],
    })
    expect(
      validateRecording([page], billingoSpecValidator(), { mode: 'strict', redact: false }).errors,
    ).toHaveLength(2)
  })
})
