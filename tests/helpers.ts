import { createContext, type TarcaContext, type TarcaHooks } from '../src/core/context'

export const TEST_API_KEY = 'tarca-teszt-kulcs-0000'

export interface CapturedRequest {
  readonly method: string
  readonly url: URL
  readonly headers: Headers
  readonly body: unknown
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

export function mockBillingo(...replies: Reply[]): MockBillingo {
  const requests: CapturedRequest[] = []
  const queue = [...replies]
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body,
    })
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

export function createTestContext(mock: MockBillingo, hooks?: TarcaHooks): TarcaContext {
  return createContext({
    apiKey: TEST_API_KEY,
    fetch: mock.fetch,
    retryDelayMs: 0,
    ...(hooks ? { hooks } : {}),
  })
}
