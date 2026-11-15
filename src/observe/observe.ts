import type {
  CompleteEvent,
  HookWarning,
  RequestEvent,
  ResponseEvent,
  TarcaHooks,
} from '../core/context'
import { hmacHex } from '../core/crypto'
import { type BillingoError, isBillingoError } from '../core/errors'
import type { Metrics } from './metrics'

export type LogMethod = (data: Readonly<Record<string, unknown>>, message: string) => void

export interface ObserveLogger {
  readonly debug?: LogMethod | undefined
  readonly info?: LogMethod | undefined
  readonly warn?: LogMethod | undefined
  readonly error?: LogMethod | undefined
}

export type SpanAttributeValue = string | number | boolean

export interface ObserveSpan {
  setAttribute(key: string, value: SpanAttributeValue): unknown
  setStatus(status: { readonly code: number; readonly message?: string }): unknown
  recordException(exception: { readonly name: string; readonly message: string } | Error): unknown
  end(): unknown
}

export interface ObserveTracer {
  startSpan(
    name: string,
    options?: {
      readonly kind?: number
      readonly attributes?: Readonly<Record<string, SpanAttributeValue>>
    },
  ): ObserveSpan
}

export interface ObserveOptions {
  readonly logger?: ObserveLogger | undefined
  readonly tracer?: ObserveTracer | undefined
  readonly metrics?: Metrics | undefined
  readonly redact?: boolean | undefined
  readonly refSalt?: string | undefined
  readonly logRequests?: boolean | undefined
}

export interface ObservedDocumentEvent {
  readonly action: string
  readonly operation?: string | undefined
  readonly vendorId?: string | undefined
  readonly document: {
    readonly id?: number | undefined
    readonly type?: string | undefined
    readonly invoiceNumber?: string | undefined
  }
}

export interface ObserveHooks extends TarcaHooks {
  readonly onDocument: (event: ObservedDocumentEvent) => Promise<void>
}

export const SPAN_STATUS_OK = 1
export const SPAN_STATUS_ERROR = 2
export const SPAN_KIND_CLIENT = 2
export const MAX_OPEN_SPANS = 1_000

function randomSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function safely(run: () => void): void {
  try {
    run()
  } catch {
    return
  }
}

function spanKey(event: RequestEvent): string {
  return `${event.requestId}:${event.attempt}`
}

function billingoErrorData(
  error: BillingoError,
  redact: boolean,
): Readonly<Record<string, unknown>> {
  const fields = error.fieldErrors.map((item) => item.field)
  return {
    errorCategory: error.category,
    retryable: error.retryable,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.traceId === undefined ? {} : { traceId: error.traceId }),
    ...(fields.length === 0 ? {} : { fields }),
    ...(redact
      ? {}
      : {
          errorMessage: error.message,
          ...(error.hint === undefined ? {} : { hint: error.hint }),
          ...(error.apiMessage === undefined ? {} : { apiMessage: error.apiMessage }),
          ...(error.fieldErrors.length === 0 ? {} : { fieldErrors: error.fieldErrors }),
        }),
  }
}

function errorData(error: unknown, redact: boolean): Readonly<Record<string, unknown>> {
  if (isBillingoError(error)) return billingoErrorData(error, redact)
  const name = error instanceof Error ? error.name : typeof error
  if (redact) return { errorName: name }
  return { errorName: name, errorMessage: error instanceof Error ? error.message : String(error) }
}

export function observe(options: ObserveOptions = {}): ObserveHooks {
  const { logger, tracer, metrics } = options
  const redact = options.redact !== false
  const salt = options.refSalt ?? randomSalt()
  const spans = new Map<string, ObserveSpan>()

  async function vendorRef(vendorId: string | undefined): Promise<string | undefined> {
    const trimmed = vendorId?.trim()
    if (!trimmed) return undefined
    if (!redact) return trimmed
    return `hmac:${(await hmacHex('SHA-256', salt, trimmed)).slice(0, 16)}`
  }

  const startSpan = (event: RequestEvent, active: ObserveTracer): void => {
    if (spans.size >= MAX_OPEN_SPANS) {
      const oldest = spans.keys().next().value
      if (oldest !== undefined) {
        const span = spans.get(oldest)
        spans.delete(oldest)
        span?.end()
      }
    }
    spans.set(
      spanKey(event),
      active.startSpan(`billingo ${event.operation}`, {
        kind: SPAN_KIND_CLIENT,
        attributes: {
          'billingo.operation': event.operation,
          'http.request.method': event.method,
          'url.template': event.path,
          'billingo.attempt': event.attempt,
          'billingo.request_id': event.requestId,
        },
      }),
    )
  }

  const onRequest = (event: RequestEvent): void => {
    if (tracer) safely(() => startSpan(event, tracer))
    if (options.logRequests === true) {
      safely(() =>
        logger?.debug?.(
          {
            event: 'tarca.request.start',
            operation: event.operation,
            method: event.method,
            path: event.path,
            attempt: event.attempt,
            requestId: event.requestId,
          },
          `tarca: ${event.operation} kérés indul`,
        ),
      )
    }
  }

  const onResponse = (event: ResponseEvent): void => {
    const span = spans.get(spanKey(event))
    if (!span) return
    safely(() => span.setAttribute('http.response.status_code', event.status))
  }

  const describeSpan = (span: ObserveSpan, event: CompleteEvent): void => {
    const { error } = event
    if (error) {
      span.setAttribute('billingo.error.category', error.category)
      if (error.status !== undefined) span.setAttribute('http.response.status_code', error.status)
      if (error.traceId !== undefined) span.setAttribute('billingo.trace_id', error.traceId)
      span.recordException(
        redact ? { name: error.name, message: `Billingo hiba: ${error.category}` } : error,
      )
      span.setStatus({ code: SPAN_STATUS_ERROR, message: redact ? error.category : error.message })
    } else if (event.outcome === 'error') {
      span.setStatus({ code: SPAN_STATUS_ERROR })
    } else {
      span.setStatus({ code: SPAN_STATUS_OK })
    }
  }

  const closeSpan = (span: ObserveSpan, event: CompleteEvent): void => {
    try {
      describeSpan(span, event)
    } finally {
      span.end()
    }
  }

  const countRequest = (active: Metrics, event: CompleteEvent): void => {
    const category = event.error?.category
    const labels = { operation: event.operation }
    active.counter('tarca_requests_total', {
      operation: event.operation,
      outcome: event.outcome === 'success' ? 'success' : (category ?? 'error'),
    })
    active.histogram('tarca_request_duration_ms', event.durationMs, labels)
    if (event.willRetry) active.counter('tarca_retries_total', labels)
    if (category === 'rate_limit') active.counter('tarca_rate_limited_total', labels)
    if (category === 'unexpected_response') {
      active.counter('tarca_unexpected_response_total', labels)
    }
  }

  const onComplete = (event: CompleteEvent): void => {
    const key = spanKey(event)
    const span = spans.get(key)
    spans.delete(key)
    if (span) safely(() => closeSpan(span, event))
    if (metrics) safely(() => countRequest(metrics, event))
    const category = event.error?.category
    const data = {
      event: 'tarca.request',
      operation: event.operation,
      method: event.method,
      path: event.path,
      attempt: event.attempt,
      requestId: event.requestId,
      outcome: event.outcome,
      durationMs: event.durationMs,
      willRetry: event.willRetry,
      ...(event.error ? errorData(event.error, redact) : {}),
    }
    safely(() => {
      if (event.outcome === 'success') {
        logger?.info?.(data, `tarca: ${event.operation} sikeres (${event.durationMs} ms)`)
        return
      }
      logger?.warn?.(
        data,
        `tarca: ${event.operation} sikertelen${category ? ` (${category})` : ''}${event.willRetry ? ', újrapróbálás' : ''}`,
      )
    })
  }

  const onWarning = (warning: HookWarning): void => {
    safely(() => {
      metrics?.counter('tarca_warnings_total', { hook: warning.hook })
      if (warning.hook === 'createOnceLock') metrics?.counter('tarca_lock_errors_total')
    })
    safely(() =>
      logger?.warn?.(
        {
          event: 'tarca.warning',
          hook: warning.hook,
          operation: warning.operation,
          ...errorData(warning.error, redact),
        },
        warning.message ?? `tarca: figyelmeztetés (${warning.hook})`,
      ),
    )
  }

  const onDocument = async (event: ObservedDocumentEvent): Promise<void> => {
    const type = event.document.type ?? 'unknown'
    safely(() => metrics?.counter('tarca_documents_total', { type, action: event.action }))
    if (!logger?.info) return
    try {
      const ref = await vendorRef(event.vendorId)
      const number = event.document.invoiceNumber || undefined
      logger.info(
        {
          event: 'tarca.document',
          type,
          action: event.action,
          ...(event.operation === undefined ? {} : { operation: event.operation }),
          ...(event.document.id === undefined ? {} : { documentId: event.document.id }),
          ...(number === undefined ? {} : { number }),
          ...(ref === undefined ? {} : { vendorRef: ref }),
        },
        `tarca: ${type} ${event.action}${number === undefined ? '' : ` ${number}`}`,
      )
    } catch {
      return
    }
  }

  return { onRequest, onResponse, onComplete, onWarning, onDocument }
}

type Handler = (event: unknown) => unknown

const SETTINGS: ReadonlySet<string> = new Set(['onDocumentError'])
const SEQUENTIAL: ReadonlySet<string> = new Set(['onDocument'])

function isHandler(value: unknown): value is Handler {
  return typeof value === 'function'
}

function chainSequential(handlers: readonly Handler[]): Handler {
  return async (event) => {
    let failure: { readonly error: unknown } | undefined
    for (const handler of handlers) {
      try {
        await handler(event)
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
  }
}

function chainSync(handlers: readonly Handler[]): Handler {
  return (event) => {
    let failure: { readonly error: unknown } | undefined
    const pending: Promise<unknown>[] = []
    for (const handler of handlers) {
      try {
        const result = handler(event)
        if (result instanceof Promise) pending.push(result)
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure) {
      for (const promise of pending) promise.catch(() => undefined)
      throw failure.error
    }
    if (pending.length === 0) return undefined
    return Promise.all(pending).then(() => undefined)
  }
}

export function combineHooks(...hooks: readonly (TarcaHooks | undefined)[]): TarcaHooks {
  const present = hooks.filter((hook): hook is TarcaHooks => hook !== undefined)
  const values = new Map<string, unknown[]>()
  for (const hook of present) {
    for (const [name, value] of Object.entries(hook)) {
      if (value === undefined) continue
      values.set(name, [...(values.get(name) ?? []), value])
    }
  }
  return Object.fromEntries(
    [...values].map(([name, list]) => {
      const handlers = list.filter(isHandler)
      if (SETTINGS.has(name) || handlers.length !== list.length) return [name, list.at(-1)]
      return [name, SEQUENTIAL.has(name) ? chainSequential(handlers) : chainSync(handlers)]
    }),
  )
}
