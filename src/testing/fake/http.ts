import { toApiCase } from '../../core/case'
import type { OperationId } from '../../core/operations'
import { MAX_PER_PAGE } from '../../core/pagination'
import type { FakeBillingoState } from './state'

export const FAKE_BILLINGO_MESSAGES: {
  readonly unauthorized: string
  readonly forbidden: string
  readonly subscription: string
  readonly tooManyRequests: string
  readonly serverError: string
  readonly validationFailed: string
  readonly notReady: string
  readonly navConnectionRequired: string
  readonly taxNumberFormat: string
} = {
  unauthorized: 'Authorization information (Header: X-API-KEY or X-TOKEN) is missing or invalid.',
  forbidden:
    'You do not have permission for this operation. Or any ID in request is invalid or you do not have permission.',
  subscription: 'You do not have subscription for this operation',
  tooManyRequests: 'Too many requests',
  serverError: 'Internal Server Error.',
  validationFailed: 'Validation Failed',
  notReady: 'Document PDF has not generated yet.',
  navConnectionRequired:
    'To use this feature, please ensure you have a live connection to NAV (not available in sandbox mode)',
  taxNumberFormat: 'The tax number format is invalid.',
}

export interface FakeFieldError {
  readonly field: string
  readonly message: string
}

export interface FakeResponse {
  readonly status: number
  readonly body?: unknown
}

export interface FakeRequest {
  readonly operation: OperationId
  readonly params: Readonly<Record<string, string>>
  readonly query: URLSearchParams
  readonly body: unknown
  readonly path: string
  readonly apiUrl: string
}

export type FakeHandler = (state: FakeBillingoState, request: FakeRequest) => FakeResponse

export type FakeRoutes = Readonly<Partial<Record<OperationId, FakeHandler>>>

export function ok(body: unknown, status = 200): FakeResponse {
  return { status, body }
}

export function noContent(): FakeResponse {
  return { status: 204 }
}

export function clientError(status: number, message: string): FakeResponse {
  return { status, body: { error: { message } } }
}

export function serverError(
  status = 500,
  message: string = FAKE_BILLINGO_MESSAGES.serverError,
): FakeResponse {
  return {
    status,
    body: { error: { message, trace_id: crypto.randomUUID().replace(/-/g, '') } },
  }
}

export function validationFailed(errors: readonly FakeFieldError[]): FakeResponse {
  return { status: 422, body: { message: FAKE_BILLINGO_MESSAGES.validationFailed, errors } }
}

export function forbidden(): FakeResponse {
  return clientError(403, FAKE_BILLINGO_MESSAGES.forbidden)
}

export function statusFaultResponse(status: number, message: string | undefined): FakeResponse {
  if (status >= 500) return serverError(status, message)
  if (status === 422) {
    return {
      status,
      body: { message: message ?? FAKE_BILLINGO_MESSAGES.validationFailed, errors: [] },
    }
  }
  const defaults: Readonly<Record<number, string>> = {
    401: FAKE_BILLINGO_MESSAGES.unauthorized,
    402: FAKE_BILLINGO_MESSAGES.subscription,
    403: FAKE_BILLINGO_MESSAGES.forbidden,
    429: FAKE_BILLINGO_MESSAGES.tooManyRequests,
  }
  return clientError(status, message ?? defaults[status] ?? '')
}

export function toFetchResponse(response: FakeResponse, includeBody = true): Response {
  if (response.body === undefined || !includeBody) {
    return new Response(null, { status: response.status })
  }
  return new Response(JSON.stringify(toApiCase(response.body)), {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  })
}

function attribute(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
}

export const LARAVEL_MESSAGES: {
  readonly required: (field: string) => string
  readonly string: (field: string) => string
  readonly boolean: (field: string) => string
  readonly integer: (field: string) => string
  readonly selected: (field: string) => string
  readonly min: (field: string, min: number) => string
  readonly max: (field: string, max: number) => string
  readonly dateFormat: (field: string) => string
} = {
  required: (field) => `The ${attribute(field)} field is required.`,
  string: (field) => `The ${attribute(field)} must be a string.`,
  boolean: (field) => `The ${attribute(field)} field must be true or false.`,
  integer: (field) => `The ${attribute(field)} must be an integer.`,
  selected: (field) => `The selected ${attribute(field)} is invalid.`,
  min: (field, min) => `The ${attribute(field)} must be at least ${min}.`,
  max: (field, max) => `The ${attribute(field)} must not be greater than ${max}.`,
  dateFormat: (field) => `The ${attribute(field)} does not match the format Y-m-d.`,
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function bodyFields(body: unknown): Record<string, unknown> {
  return isRecord(body) ? body : {}
}

export function requiredString(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): string {
  const value = fields[field]
  if (isBlank(value)) {
    errors.push({ field, message: LARAVEL_MESSAGES.required(field) })
    return ''
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: LARAVEL_MESSAGES.string(field) })
    return ''
  }
  return value.trim()
}

export function optionalString(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): string {
  const value = fields[field]
  if (isBlank(value)) return ''
  if (typeof value !== 'string') {
    errors.push({ field, message: LARAVEL_MESSAGES.string(field) })
    return ''
  }
  return value.trim()
}

export function optionalBoolean(
  fields: Record<string, unknown>,
  field: string,
  errors: FakeFieldError[],
): boolean {
  const value = fields[field]
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') {
    errors.push({ field, message: LARAVEL_MESSAGES.boolean(field) })
    return false
  }
  return value
}

export function requiredEnum<T extends string>(
  fields: Record<string, unknown>,
  field: string,
  isAllowed: (value: unknown) => value is T,
  errors: FakeFieldError[],
): T | undefined {
  const value = fields[field]
  if (isBlank(value)) {
    errors.push({ field, message: LARAVEL_MESSAGES.required(field) })
    return undefined
  }
  if (isAllowed(value)) return value
  errors.push({ field, message: LARAVEL_MESSAGES.selected(field) })
  return undefined
}

function integerParam(
  query: URLSearchParams,
  field: string,
  fallback: number,
  limits: { readonly min: number; readonly max?: number },
  errors: FakeFieldError[],
): number {
  const raw = query.get(field)
  if (raw === null || raw.trim() === '') return fallback
  if (!/^-?\d+$/.test(raw.trim())) {
    errors.push({ field, message: LARAVEL_MESSAGES.integer(field) })
    return fallback
  }
  const value = Number(raw)
  if (value < limits.min) errors.push({ field, message: LARAVEL_MESSAGES.min(field, limits.min) })
  else if (limits.max !== undefined && value > limits.max) {
    errors.push({ field, message: LARAVEL_MESSAGES.max(field, limits.max) })
  }
  return value
}

const DEFAULT_PER_PAGE = 25

function pageUrl(request: FakeRequest, page: number): string {
  return `${request.apiUrl}${request.path}?page=${page}`
}

export function paginate(request: FakeRequest, items: readonly unknown[]): FakeResponse {
  const errors: FakeFieldError[] = []
  const page = integerParam(request.query, 'page', 1, { min: 1 }, errors)
  const perPage = integerParam(
    request.query,
    'per_page',
    DEFAULT_PER_PAGE,
    { min: 1, max: MAX_PER_PAGE },
    errors,
  )
  if (errors.length > 0) return validationFailed(errors)
  const lastPage = Math.max(1, Math.ceil(items.length / perPage))
  return ok({
    total: items.length,
    perPage,
    currentPage: page,
    lastPage,
    prevPageUrl: page > 1 ? pageUrl(request, page - 1) : null,
    nextPageUrl: page < lastPage ? pageUrl(request, page + 1) : null,
    data: items.slice((page - 1) * perPage, page * perPage),
  })
}

export function positiveIntegerParam(request: FakeRequest, name: string): number | undefined {
  const raw = request.params[name] ?? ''
  if (!/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
