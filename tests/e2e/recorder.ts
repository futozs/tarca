import type { OperationId } from '../../src/core/operations'
import {
  type MatchedOperation,
  matchOperation,
  type SpecValidator,
  type ValidationMode,
} from '../openapi'

export interface RecordedExchange {
  readonly method: string
  readonly operation: OperationId | undefined
  readonly pathParams: Readonly<Record<string, string>>
  readonly query: URLSearchParams
  readonly requestBody: unknown
  readonly requestBodyIssue: string | undefined
  readonly status: number
  readonly contentType: string | undefined
  readonly responseBody: unknown
  readonly responseBodyIssue: string | undefined
}

export interface ResponseRecorder {
  readonly records: readonly RecordedExchange[]
  readonly wrap: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch
}

function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return true
  const mediaType = (contentType.split(';')[0] ?? '').trim().toLowerCase()
  return mediaType === 'application/json' || /^application\/[\w.+-]+\+json$/.test(mediaType)
}

function parseJson(text: string): { readonly value: unknown; readonly issue: string | undefined } {
  if (text.trim() === '') return { value: undefined, issue: undefined }
  try {
    return { value: JSON.parse(text), issue: undefined }
  } catch {
    return { value: undefined, issue: 'nem értelmezhető JSON' }
  }
}

export function createResponseRecorder(): ResponseRecorder {
  const records: RecordedExchange[] = []
  const wrap = (inner: typeof globalThis.fetch): typeof globalThis.fetch => {
    const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const response = await inner(input, init)
      const method = (init?.method ?? 'GET').toUpperCase()
      const url = new URL(String(input))
      let matched: MatchedOperation | undefined
      try {
        matched = matchOperation(method, url)
      } catch {
        matched = undefined
      }
      const request =
        typeof init?.body === 'string'
          ? parseJson(init.body)
          : {
              value: undefined,
              issue: init?.body == null ? undefined : 'a kéréstörzs nem JSON szöveg',
            }
      const contentType = response.headers.get('content-type') ?? undefined
      const answer = isJsonContentType(contentType)
        ? parseJson(await response.clone().text())
        : { value: undefined, issue: undefined }
      records.push({
        method,
        operation: matched?.operation,
        pathParams: matched?.pathParams ?? {},
        query: url.searchParams,
        requestBody: request.value,
        requestBodyIssue: request.issue,
        status: response.status,
        contentType,
        responseBody: answer.value,
        responseBodyIssue: answer.issue,
      })
      return response
    }
    return wrapped as typeof globalThis.fetch
  }
  return { records, wrap }
}

export interface RecordingCheckOptions {
  readonly mode: ValidationMode
  readonly redact: boolean
  readonly expectedOperations?: Iterable<OperationId>
}

export interface RecordingReport {
  readonly exchanges: number
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

export function validateRecording(
  records: readonly RecordedExchange[],
  validator: SpecValidator,
  options: RecordingCheckOptions,
): RecordingReport {
  const errors: string[] = []
  const warnings: string[] = []
  const redact = { redact: options.redact }
  for (const record of records) {
    const operation = record.operation
    if (operation === undefined) {
      errors.push(`${record.method}: a kérés egyik Billingo műveletre sem illeszkedik`)
      continue
    }
    const tag = (prefix: string, message: string): string =>
      message.startsWith(operation) ? message : `${prefix}: ${message}`
    const request = `${operation} kérés`
    const response = `${operation} ${record.status} válasz`
    errors.push(
      ...validator.parameterErrors(
        operation,
        { path: record.pathParams, query: record.query },
        redact,
      ),
    )
    if (record.requestBodyIssue) errors.push(`${request}: ${record.requestBodyIssue}`)
    else {
      for (const message of validator.requestErrors(operation, record.requestBody, redact)) {
        errors.push(tag(request, message))
      }
    }
    if (record.responseBodyIssue) {
      errors.push(`${response}: ${record.responseBodyIssue}`)
      continue
    }
    const report = validator.responseErrors(operation, record.status, record.responseBody, {
      mode: options.mode,
      redact: options.redact,
      contentType: record.contentType,
    })
    for (const message of report.errors) errors.push(tag(response, message))
    for (const message of report.warnings) warnings.push(tag(response, message))
  }
  const recorded = new Set(records.map((record) => record.operation))
  for (const operation of options.expectedOperations ?? []) {
    if (!recorded.has(operation)) {
      errors.push(`${operation}: a kérés kikerülte a rögzítőt, a válasza nincs ellenőrizve`)
    }
  }
  return {
    exchanges: records.length,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  }
}
