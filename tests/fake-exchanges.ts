import { createTarca, type Tarca } from '../src/client'
import type { OperationId } from '../src/core/operations'
import {
  createFakeBillingoFetch,
  type FakeBillingo,
  type FakeBillingoOptions,
} from '../src/testing'
import { createValidator, loadMergedSpec, responseErrors } from './openapi'

export const FAKE_API = 'https://api.billingo.hu/v3'

export const FAKE_KEY = 'tarca-fake-teszt-kulcs'

export interface FakeExchange {
  readonly label: string
  readonly operation: OperationId | undefined
  readonly status: number
  readonly body: unknown
  readonly contentType: string | undefined
  readonly faulted: boolean
}

export interface FakeCallResult {
  readonly status: number
  readonly body: unknown
  readonly contentType: string | null
  readonly headers: Headers
  readonly bytes: Uint8Array
}

export interface FakeHarness {
  readonly billingo: FakeBillingo
  readonly tarca: Tarca
  call(method: string, path: string, body?: unknown): Promise<FakeCallResult>
}

export interface FakeExchangeLog {
  readonly exchanges: readonly FakeExchange[]
  harness(options?: FakeBillingoOptions): FakeHarness
}

function isJson(contentType: string | null): boolean {
  return contentType?.startsWith('application/json') ?? false
}

function parse(bytes: Uint8Array, contentType: string | null): unknown {
  if (bytes.length === 0 || !isJson(contentType)) return undefined
  return JSON.parse(new TextDecoder().decode(bytes))
}

export function createFakeExchangeLog(): FakeExchangeLog {
  const exchanges: FakeExchange[] = []
  return {
    exchanges,
    harness(options = {}) {
      const billingo = createFakeBillingoFetch(options)
      const capture = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const response = await billingo.fetch(input, init)
        const record = billingo.requests.at(-1)
        if (!record) throw new Error('A hamis Billingo nem naplózta a kérést.')
        const contentType = response.headers.get('content-type')
        exchanges.push({
          label: `${record.method} ${record.path}`,
          operation: record.operation,
          status: response.status,
          body: parse(new Uint8Array(await response.clone().arrayBuffer()), contentType),
          contentType: contentType ?? undefined,
          faulted: record.faulted,
        })
        return response
      }
      const fetch = capture as typeof globalThis.fetch
      const tarca = createTarca({ apiKey: FAKE_KEY, fetch, retryDelayMs: 0 })
      return {
        billingo,
        tarca,
        async call(method, path, body) {
          const headers = new Headers({ 'X-API-KEY': FAKE_KEY })
          if (body !== undefined) headers.set('content-type', 'application/json')
          const response = await fetch(`${FAKE_API}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          const bytes = new Uint8Array(await response.arrayBuffer())
          const contentType = response.headers.get('content-type')
          return {
            status: response.status,
            body: parse(bytes, contentType),
            contentType,
            headers: response.headers,
            bytes,
          }
        },
      }
    },
  }
}

function genericErrorSchema(status: number): string {
  if (status === 422) return 'ValidationErrorResponse'
  return status >= 500 ? 'ServerErrorResponse' : 'ClientErrorResponse'
}

export function fakeExchangeSpecErrors(exchange: FakeExchange): string[] {
  const spec = loadMergedSpec()
  if (!spec) throw new Error('Nincs .spec-cache: futtasd az npm run spec:fetch parancsot.')
  const label = `${exchange.label} → ${exchange.status}`
  const operation = exchange.faulted || exchange.status === 501 ? undefined : exchange.operation
  const errors =
    operation === undefined
      ? createValidator(spec.components.schemas).validate(
          genericErrorSchema(exchange.status),
          exchange.body,
          { direction: 'response', mode: 'strict' },
        )
      : responseErrors(operation, exchange.status, exchange.body, {
          mode: 'strict',
          contentType: exchange.contentType,
        }).errors
  return errors.map((error) => `${label}: ${error}`)
}

export function succeededOperations(exchanges: readonly FakeExchange[]): Set<string> {
  return new Set(
    exchanges
      .filter((exchange) => !exchange.faulted && exchange.status >= 200 && exchange.status < 300)
      .flatMap((exchange) => (exchange.operation === undefined ? [] : [exchange.operation])),
  )
}
