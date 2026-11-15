import type { OperationId } from './operations'

export type BillingoErrorCategory =
  | 'auth'
  | 'subscription'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
  | 'server'
  | 'not_ready'
  | 'network'
  | 'timeout'
  | 'configuration'
  | 'unexpected_response'

export interface FieldError {
  readonly field: string
  readonly message: string
}

export interface RateLimitInfo {
  readonly limit: number | undefined
  readonly remaining: number | undefined
  readonly resetAt: Date | undefined
}

export interface BillingoErrorOptions {
  readonly category: BillingoErrorCategory
  readonly status?: number | undefined
  readonly operation?: OperationId | undefined
  readonly apiMessage?: string | undefined
  readonly traceId?: string | undefined
  readonly fieldErrors?: readonly FieldError[] | undefined
  readonly retryAfterMs?: number | undefined
  readonly rateLimit?: RateLimitInfo | undefined
  readonly requestId?: string | undefined
  readonly hint?: string | undefined
  readonly cause?: unknown
}

const RETRYABLE_CATEGORIES: ReadonlySet<BillingoErrorCategory> = new Set([
  'rate_limit',
  'server',
  'not_ready',
  'network',
  'timeout',
])

export class BillingoError extends Error {
  override readonly name: string = 'BillingoError'
  readonly category: BillingoErrorCategory
  readonly retryable: boolean
  readonly status: number | undefined
  readonly operation: OperationId | undefined
  readonly apiMessage: string | undefined
  readonly traceId: string | undefined
  readonly fieldErrors: readonly FieldError[]
  readonly retryAfterMs: number | undefined
  readonly rateLimit: RateLimitInfo | undefined
  readonly requestId: string | undefined
  readonly hint: string | undefined

  constructor(message: string, options: BillingoErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.category = options.category
    this.retryable = RETRYABLE_CATEGORIES.has(options.category)
    this.status = options.status
    this.operation = options.operation
    this.apiMessage = options.apiMessage
    this.traceId = options.traceId
    this.fieldErrors = options.fieldErrors ?? []
    this.retryAfterMs = options.retryAfterMs
    this.rateLimit = options.rateLimit
    this.requestId = options.requestId
    this.hint = options.hint
  }

  get isNotFound(): boolean {
    return this.category === 'not_found'
  }
}

export function isBillingoError(error: unknown): error is BillingoError {
  return error instanceof BillingoError
}

interface StatusInfo {
  readonly category: BillingoErrorCategory
  readonly message: string
  readonly hint?: string
}

const STATUS_INFO: Readonly<Record<number, StatusInfo>> = {
  202: {
    category: 'not_ready',
    message: 'A Billingo még készíti a kért fájlt.',
    hint: 'A PDF a bizonylat létrehozása után néhány másodpercig még nem tölthető le. Próbáld újra kicsit később.',
  },
  400: { category: 'validation', message: 'A Billingo hibásnak találta a kérést.' },
  401: {
    category: 'auth',
    message: 'A Billingo nem fogadta el az API kulcsot.',
    hint: 'Ellenőrizd a BILLINGO_API_KEY értékét. Új kulcsot az app.billingo.hu/api-key oldalon lehet létrehozni.',
  },
  402: {
    category: 'subscription',
    message: 'A Billingo előfizetés nem engedi ezt a műveletet.',
    hint: 'Az API csak megfelelő díjcsomaggal érhető el, vagy lejárt az előfizetés. Nézd meg a Billingo fiók előfizetési adatait.',
  },
  403: { category: 'forbidden', message: 'A Billingo megtagadta a műveletet.' },
  404: { category: 'not_found', message: 'A Billingo nem találja a kért erőforrást.' },
  422: { category: 'validation', message: 'A Billingo elutasította a küldött adatokat.' },
  429: {
    category: 'rate_limit',
    message: 'Túl sok kérés: a Billingo átmenetileg korlátozza a forgalmat.',
    hint: 'Várj a Retry-After fejlécben megadott ideig, és csökkentsd a kérések ütemét.',
  },
}

export function statusInfo(status: number): StatusInfo {
  const known = STATUS_INFO[status]
  if (known) return known
  if (status >= 500)
    return { category: 'server', message: `A Billingo szerverhibát adott (${status}).` }
  if (status >= 400)
    return { category: 'validation', message: `A Billingo hibát adott (${status}).` }
  return {
    category: 'unexpected_response',
    message: `A Billingo váratlan választ adott (${status}).`,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ParsedErrorBody {
  readonly apiMessage: string | undefined
  readonly traceId: string | undefined
  readonly fieldErrors: readonly FieldError[]
}

export function parseErrorBody(body: unknown): ParsedErrorBody {
  if (!isRecord(body)) return { apiMessage: undefined, traceId: undefined, fieldErrors: [] }
  const wrapper = isRecord(body.error) ? body.error : undefined
  const message = typeof wrapper?.message === 'string' ? wrapper.message : body.message
  const traceId = wrapper?.trace_id ?? body.trace_id
  const errors = Array.isArray(body.errors) ? body.errors : []
  const fieldErrors = errors.filter(isRecord).map((item) => ({
    field: typeof item.field === 'string' ? item.field : '',
    message: typeof item.message === 'string' ? item.message : '',
  }))
  return {
    apiMessage: typeof message === 'string' && message.trim() !== '' ? message.trim() : undefined,
    traceId: typeof traceId === 'string' && traceId !== '' ? traceId : undefined,
    fieldErrors,
  }
}

export interface ResponseErrorInput {
  readonly status: number
  readonly body: unknown
  readonly operation: OperationId
  readonly requestId: string
  readonly retryAfterMs: number | undefined
  readonly rateLimit: RateLimitInfo | undefined
}

export function errorFromResponse(input: ResponseErrorInput): BillingoError {
  const info = statusInfo(input.status)
  const { apiMessage, traceId, fieldErrors } = parseErrorBody(input.body)
  const details = fieldErrors.map((item) => `${item.field}: ${item.message}`).join('; ')
  const suffix = details ? ` ${details}` : apiMessage ? ` (${apiMessage})` : ''
  return new BillingoError(`${info.message}${suffix}`, {
    category: info.category,
    status: input.status,
    operation: input.operation,
    apiMessage,
    traceId,
    fieldErrors,
    retryAfterMs: input.retryAfterMs,
    rateLimit: input.rateLimit,
    requestId: input.requestId,
    hint: info.hint,
  })
}
