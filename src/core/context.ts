import { fromApiCase, toApiCase } from './case'
import { BillingoError, errorFromResponse, type RateLimitInfo } from './errors'
import { type HttpMethod, type OperationId, operationInfo } from './operations'
import { buildQuery, fillPath, joinUrl, type PathParams, type QueryParams } from './url'

export const BILLINGO_API_URL = 'https://api.billingo.hu/v3'
export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_ATTEMPTS = 5
export const MAX_RETRY_AFTER_MS = 60_000
export const RETRY_JITTER = 0.2
const DEFAULT_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 1_000

export interface RequestEvent {
  readonly operation: OperationId
  readonly method: HttpMethod
  readonly path: string
  readonly attempt: number
  readonly requestId: string
}

export interface ResponseEvent extends RequestEvent {
  readonly status: number
  readonly durationMs: number
  readonly rateLimit: RateLimitInfo | undefined
}

export interface ErrorEvent extends RequestEvent {
  readonly error: BillingoError
  readonly willRetry: boolean
}

export interface CompleteEvent extends RequestEvent {
  readonly outcome: 'success' | 'error'
  readonly durationMs: number
  readonly error?: BillingoError | undefined
  readonly willRetry: boolean
}

export interface HookWarning {
  readonly hook: HookName
  readonly operation: OperationId
  readonly error: unknown
}

export interface TarcaHooks {
  readonly onRequest?: (event: RequestEvent) => void
  readonly onResponse?: (event: ResponseEvent) => void
  readonly onError?: (event: ErrorEvent) => void
  readonly onComplete?: (event: CompleteEvent) => void
  readonly onWarning?: (warning: HookWarning) => void
}

type HookName = 'onRequest' | 'onResponse' | 'onError' | 'onComplete'

export interface BillingoOptions {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly retryDelayMs?: number
  readonly hooks?: TarcaHooks
}

export interface RequestOptions {
  readonly signal?: AbortSignal | undefined
}

export interface ApiRequest {
  readonly operation: OperationId
  readonly pathParams?: PathParams
  readonly query?: QueryParams
  readonly body?: unknown
  readonly signal?: AbortSignal | undefined
}

export interface BinaryResponse {
  readonly bytes: Uint8Array
  readonly contentType: string | undefined
}

export interface TarcaContext {
  json<T>(request: ApiRequest): Promise<T>
  binary(request: ApiRequest): Promise<BinaryResponse>
  empty(request: ApiRequest): Promise<void>
}

type Expect = 'json' | 'binary' | 'empty'

interface RawResponse {
  readonly status: number
  readonly headers: Headers
  readonly bytes: Uint8Array
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  const value = env?.[name]?.trim()
  return value ? value : undefined
}

function configurationError(message: string): BillingoError {
  return new BillingoError(message, { category: 'configuration' })
}

export function resolveApiKey(options: BillingoOptions): string {
  const apiKey = options.apiKey?.trim() || readEnv('BILLINGO_API_KEY')
  if (!apiKey) {
    throw configurationError(
      'Hiányzik a Billingo API kulcs. Add meg az apiKey opciót, vagy állítsd be a BILLINGO_API_KEY környezeti változót.',
    )
  }
  return apiKey
}

function resolveAttempts(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ATTEMPTS
  if (!Number.isInteger(value) || value < 1) {
    throw configurationError(`A maxAttempts értéke legalább 1 egész szám legyen, kapott: ${value}`)
  }
  return Math.min(value, MAX_ATTEMPTS)
}

function resolveNonNegative(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) {
    throw configurationError(`A ${name} értéke nemnegatív szám legyen, kapott: ${value}`)
  }
  return value
}

export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - now)
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)?.trim()
  if (!raw || !/^\d+$/.test(raw)) return undefined
  return Number(raw)
}

export function parseRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = headerNumber(headers, 'x-ratelimit-limit')
  const remaining = headerNumber(headers, 'x-ratelimit-remaining')
  const reset = headerNumber(headers, 'x-ratelimit-reset')
  if (limit === undefined && remaining === undefined && reset === undefined) return undefined
  return {
    limit,
    remaining,
    resetAt: reset === undefined ? undefined : new Date(reset * 1000),
  }
}

export function retryDelay(
  baseMs: number,
  attempt: number,
  random: number = Math.random(),
): number {
  const backoff = baseMs * 2 ** (attempt - 1)
  return Math.round(backoff * (1 - RETRY_JITTER + 2 * RETRY_JITTER * random))
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function callHook<T extends RequestEvent>(hooks: TarcaHooks, name: HookName, event: T): void {
  const hook = hooks[name] as ((event: T) => void) | undefined
  if (!hook) return
  try {
    hook(event)
  } catch (error) {
    hooks.onWarning?.({ hook: name, operation: event.operation, error })
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes).trim()
  if (text === '') return undefined
  return JSON.parse(text)
}

function safeDecodeJson(bytes: Uint8Array): unknown {
  try {
    return decodeJson(bytes)
  } catch {
    return undefined
  }
}

export function createContext(options: BillingoOptions = {}): TarcaContext {
  const apiKey = resolveApiKey(options)
  const baseUrl = options.baseUrl ?? BILLINGO_API_URL
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw configurationError('Nem található fetch implementáció. Add meg a fetch opciót.')
  }
  const timeoutMs = resolveNonNegative('timeoutMs', options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const retryDelayMs = resolveNonNegative(
    'retryDelayMs',
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
  )
  const safeAttempts = resolveAttempts(options.maxAttempts)
  const hooks = options.hooks ?? {}

  async function send(
    request: ApiRequest,
    expect: Expect,
    requestId: string,
    method: HttpMethod,
  ): Promise<RawResponse> {
    const info = operationInfo(request.operation)
    const url = joinUrl(baseUrl, fillPath(info.path, request.pathParams), buildQuery(request.query))
    const headers = new Headers({
      'X-API-KEY': apiKey,
      Accept:
        expect === 'binary' ? 'application/pdf, application/octet-stream, */*' : 'application/json',
    })
    const body = request.body === undefined ? undefined : JSON.stringify(toApiCase(request.body))
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    request.signal?.throwIfAborted()
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        signal,
        ...(body === undefined ? {} : { body }),
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { status: response.status, headers: response.headers, bytes }
    } catch (error) {
      if (request.signal?.aborted) throw request.signal.reason
      if (timeoutSignal.aborted || isAbortError(error)) {
        throw new BillingoError(`A Billingo nem válaszolt ${timeoutMs} ms alatt.`, {
          category: 'timeout',
          operation: request.operation,
          requestId,
          cause: error,
        })
      }
      throw new BillingoError('Hálózati hiba a Billingo elérésekor.', {
        category: 'network',
        operation: request.operation,
        requestId,
        cause: error,
      })
    }
  }

  function interpret(
    request: ApiRequest,
    expect: Expect,
    raw: RawResponse,
    requestId: string,
  ): unknown {
    const rateLimit = parseRateLimit(raw.headers)
    const isSuccess = raw.status >= 200 && raw.status < 300 && raw.status !== 202
    if (!isSuccess) {
      throw errorFromResponse({
        status: raw.status,
        body: safeDecodeJson(raw.bytes),
        operation: request.operation,
        requestId,
        retryAfterMs: parseRetryAfter(raw.headers.get('retry-after'), Date.now()),
        rateLimit,
      })
    }
    if (expect === 'empty') return undefined
    if (expect === 'binary') {
      const contentType = raw.headers.get('content-type') ?? undefined
      return { bytes: raw.bytes, contentType } satisfies BinaryResponse
    }
    try {
      return fromApiCase(decodeJson(raw.bytes))
    } catch (error) {
      throw new BillingoError('A Billingo válasza nem értelmezhető JSON.', {
        category: 'unexpected_response',
        status: raw.status,
        operation: request.operation,
        requestId,
        cause: error,
      })
    }
  }

  async function execute(request: ApiRequest, expect: Expect): Promise<unknown> {
    const { method, path } = operationInfo(request.operation)
    const maxAttempts = method === 'GET' ? safeAttempts : 1
    const requestId = crypto.randomUUID()
    for (let attempt = 1; ; attempt++) {
      const base = { operation: request.operation, method, path, attempt, requestId }
      const startedAt = Date.now()
      callHook(hooks, 'onRequest', base)
      try {
        const raw = await send(request, expect, requestId, method)
        callHook(hooks, 'onResponse', {
          ...base,
          status: raw.status,
          durationMs: Date.now() - startedAt,
          rateLimit: parseRateLimit(raw.headers),
        })
        const result = interpret(request, expect, raw, requestId)
        callHook(hooks, 'onComplete', {
          ...base,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
          willRetry: false,
        })
        return result
      } catch (error) {
        if (!(error instanceof BillingoError)) {
          callHook(hooks, 'onComplete', {
            ...base,
            outcome: 'error',
            durationMs: Date.now() - startedAt,
            willRetry: false,
          })
          throw error
        }
        const willRetry =
          error.retryable &&
          attempt < maxAttempts &&
          (error.retryAfterMs === undefined || error.retryAfterMs <= MAX_RETRY_AFTER_MS)
        callHook(hooks, 'onError', { ...base, error, willRetry })
        callHook(hooks, 'onComplete', {
          ...base,
          outcome: 'error',
          durationMs: Date.now() - startedAt,
          error,
          willRetry,
        })
        if (!willRetry) throw error
        await sleep(
          Math.max(retryDelay(retryDelayMs, attempt), error.retryAfterMs ?? 0),
          request.signal,
        )
      }
    }
  }

  return {
    json: async <T>(request: ApiRequest): Promise<T> => (await execute(request, 'json')) as T,
    binary: async (request: ApiRequest): Promise<BinaryResponse> =>
      (await execute(request, 'binary')) as BinaryResponse,
    empty: async (request: ApiRequest): Promise<void> => {
      await execute(request, 'empty')
    },
  }
}
