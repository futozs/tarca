import { BILLINGO_OPERATIONS } from 'tarcajs'
import { createFakeBillingoFetch, type FakeBillingo } from 'tarcajs/testing'
import type { BillingoSnapshot, RequestOutcome, ResponseKind, SandboxRequest } from './protocol'

const API_PREFIX = '/v3'
const MAX_BODY_CHARS = 20_000

interface OperationPattern {
  readonly operation: string
  readonly method: string
  readonly pattern: RegExp
  readonly literals: number
}

const OPERATION_PATTERNS: readonly OperationPattern[] = Object.entries(BILLINGO_OPERATIONS)
  .map(([operation, info]) => {
    const segments = info.path.split('/').filter(Boolean)
    const source = segments
      .map((segment) =>
        /^\{.+\}$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^$()|[\]\\]/g, '\\$&'),
      )
      .join('/')
    return {
      operation,
      method: info.method,
      pattern: new RegExp(`^/${source}/?$`),
      literals: segments.filter((segment) => !segment.startsWith('{')).length,
    }
  })
  .sort((a, b) => b.literals - a.literals)

export function operationFor(method: string, path: string): string | undefined {
  const upper = method.toUpperCase()
  return OPERATION_PATTERNS.find((item) => item.method === upper && item.pattern.test(path))
    ?.operation
}

function truncate(text: string): string {
  if (text.length <= MAX_BODY_CHARS) return text
  return `${text.slice(0, MAX_BODY_CHARS)}\n… (${text.length.toLocaleString('hu-HU')} karakter, a többi levágva)`
}

export function prettyJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return undefined
  }
}

function kindOf(contentType: string, body: Uint8Array): ResponseKind {
  if (body.byteLength === 0) return 'empty'
  if (body[0] === 0x25 && body[1] === 0x50 && body[2] === 0x44 && body[3] === 0x46) return 'pdf'
  if (contentType.includes('json')) return 'json'
  if (contentType.includes('csv')) return 'csv'
  return 'text'
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return init.body
  if (init?.body !== undefined && init.body !== null) return new Response(init.body).text()
  if (input instanceof Request) return input.clone().text()
  return ''
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input
  if (input instanceof Request) return new URL(input.url)
  return new URL(input)
}

function outcomeOf(error: unknown): RequestOutcome {
  return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export interface SandboxBillingoOptions {
  readonly latencyMs?: readonly [number, number] | undefined
  readonly onRequest?: ((request: SandboxRequest) => void) | undefined
}

export interface SandboxBillingo {
  readonly fake: FakeBillingo
  readonly fetch: typeof globalThis.fetch
  readonly requests: readonly SandboxRequest[]
  snapshot(): BillingoSnapshot
}

export function createSandboxBillingo(options: SandboxBillingoOptions = {}): SandboxBillingo {
  const fake = createFakeBillingoFetch()
  const requests: SandboxRequest[] = []
  let counter = 0

  const latency = (): number => {
    if (!options.latencyMs) return 0
    const [min, max] = options.latencyMs
    return Math.round(min + Math.random() * (max - min))
  }

  const record = (request: SandboxRequest): void => {
    requests.push(request)
    options.onRequest?.(request)
  }

  const recordingFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    counter += 1
    const id = counter
    const startedAt = performance.now()
    const url = urlOf(input)
    const method = methodOf(input, init)
    const path = url.pathname.startsWith(API_PREFIX)
      ? url.pathname.slice(API_PREFIX.length) || '/'
      : url.pathname
    const bodyText = await readRequestBody(input, init)
    const base = {
      id,
      operation: operationFor(method, path),
      method,
      path,
      query: [...url.searchParams.entries()],
      requestBody: bodyText ? truncate(prettyJson(bodyText) ?? bodyText) : undefined,
    }

    const delay = latency()
    if (delay > 0) await wait(delay, init?.signal)

    let response: Response
    try {
      response = await fake.fetch(input, init)
    } catch (error) {
      record({
        ...base,
        status: outcomeOf(error),
        responseHeaders: [],
        responseKind: 'empty',
        responseBody: '',
        durationMs: performance.now() - startedAt,
      })
      throw error
    }

    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    const contentType = response.headers.get('content-type') ?? ''
    const kind = kindOf(contentType, bytes)
    const text = new TextDecoder().decode(bytes)
    record({
      ...base,
      status: response.status,
      responseHeaders: [...response.headers.entries()],
      responseKind: kind,
      responseBody: truncate(kind === 'json' ? (prettyJson(text) ?? text) : text),
      durationMs: performance.now() - startedAt,
    })
    return response
  }

  return {
    fake,
    fetch: recordingFetch,
    requests,
    snapshot() {
      const data = fake.data
      return {
        documents: [...data.documents.values()].map(({ document, vendorId }) => ({
          id: document.id,
          invoiceNumber: document.invoiceNumber,
          type: document.type,
          grossTotal: document.grossTotal,
          currency: document.currency,
          paymentStatus: document.paymentStatus,
          cancelled: document.cancelled,
          vendorId,
          partnerName: document.partner?.name ?? undefined,
        })),
        partners: data.partners.size,
        products: data.products.size,
      }
    },
  }
}
