import { expect } from 'vitest'
import { createContext, type TarcaContext, type TarcaHooks } from '../src/core/context'
import type { OperationId } from '../src/core/operations'
import {
  type MatchedOperation,
  matchOperation,
  parameterErrors,
  requestErrors,
  SPEC_AVAILABLE,
} from './openapi'

export const TEST_API_KEY = 'tarca-teszt-kulcs-0000'

export interface CapturedRequest {
  readonly method: string
  readonly url: URL
  readonly headers: Headers
  readonly body: unknown
  readonly operation: OperationId | undefined
}

export type Reply =
  | { readonly status: number; readonly json?: unknown; readonly headers?: Record<string, string> }
  | {
      readonly status: number
      readonly bytes: Uint8Array<ArrayBuffer>
      readonly headers?: Record<string, string>
    }
  | Error

export interface MockBillingo {
  readonly fetch: typeof globalThis.fetch
  readonly requests: CapturedRequest[]
}

export interface ContractCheck {
  readonly operation: OperationId | undefined
  readonly body: unknown
  readonly violations: readonly string[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function requestContractViolations(
  method: string,
  url: URL,
  init: RequestInit | undefined,
): ContractCheck {
  const raw = init?.body
  const hasBody = raw !== undefined && raw !== null
  let body: unknown
  let readable = !hasBody
  const violations: string[] = []
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw)
      readable = true
    } catch (error) {
      violations.push(`a törzs nem érvényes JSON (${errorMessage(error)})`)
    }
  } else if (hasBody) {
    violations.push('a törzs nem JSON szöveg')
  }
  let matched: MatchedOperation
  try {
    matched = matchOperation(method, url)
  } catch (error) {
    return { operation: undefined, body, violations: [...violations, errorMessage(error)] }
  }
  const { operation, pathParams } = matched
  const verb = method.toUpperCase()
  if (hasBody && (verb === 'GET' || verb === 'DELETE')) {
    violations.push(`${operation}: ${verb} kérésnek nem lehet törzse`)
  }
  const contentType = new Headers(init?.headers).get('content-type') ?? ''
  if (typeof raw === 'string' && !contentType.toLowerCase().startsWith('application/json')) {
    violations.push(`${operation}: JSON törzs application/json Content-Type nélkül`)
  }
  if (SPEC_AVAILABLE) {
    try {
      violations.push(...parameterErrors(operation, { path: pathParams, query: url.searchParams }))
      if (readable) violations.push(...requestErrors(operation, body))
    } catch (error) {
      violations.push(errorMessage(error))
    }
  }
  return { operation, body, violations }
}

function failContract(check: ContractCheck): never {
  const subject = check.operation ?? 'ismeretlen művelet'
  expect
    .soft(check.violations, `A tárca kérése megszegi a Billingo szerződést (${subject})`)
    .toEqual([])
  throw new Error(`Szerződésszegő kérés (${subject}): ${check.violations.join('; ')}`)
}

function createMock(replies: readonly Reply[], contract: boolean): MockBillingo {
  const requests: CapturedRequest[] = []
  const queue = [...replies]
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    const url = new URL(String(input))
    const check = requestContractViolations(method, url, init)
    requests.push({
      method,
      url,
      headers: new Headers(init?.headers),
      body: check.body,
      operation: check.operation,
    })
    if (contract && check.violations.length > 0) failContract(check)
    const reply = queue.shift()
    if (!reply) throw new Error('A mock Billingo-nak nincs több előkészített válasza.')
    if (reply instanceof Error) throw reply
    const headers = new Headers(reply.headers)
    if ('bytes' in reply) return new Response(reply.bytes, { status: reply.status, headers })
    if (reply.json === undefined) return new Response(null, { status: reply.status, headers })
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(reply.json), { status: reply.status, headers })
  }
  return { fetch: fetch as typeof globalThis.fetch, requests }
}

export function mockBillingo(...replies: Reply[]): MockBillingo {
  return createMock(replies, true)
}

export function mockBillingoWithoutContract(reason: string, ...replies: Reply[]): MockBillingo {
  if (reason.trim() === '') {
    throw new Error('A szerződés-ellenőrzés kikapcsolásához indoklás kell.')
  }
  return createMock(replies, false)
}

export function createTestContext(mock: MockBillingo, hooks?: TarcaHooks): TarcaContext {
  return createContext({
    apiKey: TEST_API_KEY,
    fetch: mock.fetch,
    retryDelayMs: 0,
    ...(hooks ? { hooks } : {}),
  })
}
