import { BILLINGO_OPERATIONS, type OperationId } from '../core/operations'
import {
  type ActiveFault,
  createFaultQueue,
  type FakeBillingoFault,
  type FakeBillingoFaultOptions,
  type FakeBillingoScheduledFault,
} from './fake/faults'
import {
  clientError,
  FAKE_BILLINGO_MESSAGES,
  FAKE_RATE_LIMIT_PER_MINUTE,
  type FakeResponse,
  serverError,
  statusFaultResponse,
  toFetchResponse,
} from './fake/http'
import { FAKE_ROUTES } from './fake/registry'
import { apiLocation, parseBody, readIncoming } from './fake/request'
import { resolveRoute } from './fake/router'
import {
  createState,
  type FakeBillingoConfig,
  type FakeBillingoDataView,
  type FakeBillingoState,
  type FakeBillingoStateOptions,
} from './fake/state'

export interface FakeBillingoOptions extends FakeBillingoStateOptions {
  readonly faults?: readonly FakeBillingoScheduledFault[] | undefined
}

export type FakeBillingoOutcome = number | 'network' | 'timeout'

export interface FakeBillingoRequestRecord {
  readonly operation: OperationId | undefined
  readonly method: string
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  readonly body: unknown
  readonly status: FakeBillingoOutcome
  readonly faulted: boolean
}

export interface FakeBillingo {
  readonly fetch: typeof globalThis.fetch
  readonly requests: readonly FakeBillingoRequestRecord[]
  readonly data: FakeBillingoDataView
  count(operation?: OperationId): number
  counts(): Readonly<Partial<Record<OperationId, number>>>
  fail(fault: FakeBillingoFault, options?: FakeBillingoFaultOptions): void
  reset(): void
}

function notImplementedMessage(operation: OperationId): string {
  const { method, path } = BILLINGO_OPERATIONS[operation]
  return `A hamis Billingo még nem valósítja meg ezt a műveletet: ${operation} (${method} ${path}).`
}

function methodNotAllowedMessage(method: string, allowed: readonly string[]): string {
  return `The ${method} method is not supported for this route. Supported methods: ${allowed.join(', ')}.`
}

function isAuthenticated(config: FakeBillingoConfig, headers: Headers): boolean {
  const key = headers.get('x-api-key')?.trim()
  if (!key) return false
  return config.apiKeys === undefined || config.apiKeys.has(key)
}

const RATE_LIMIT_WINDOW_MS = 60_000

export function createFakeBillingoFetch(options: FakeBillingoOptions = {}): FakeBillingo {
  let state: FakeBillingoState = createState(options)
  const requests: FakeBillingoRequestRecord[] = []
  let keyedRequestTimes: number[] = []
  const rateLimitRemaining = (): number => {
    const now = state.config.now().getTime()
    keyedRequestTimes = keyedRequestTimes.filter((time) => now - time < RATE_LIMIT_WINDOW_MS)
    keyedRequestTimes.push(now)
    return Math.max(0, FAKE_RATE_LIMIT_PER_MINUTE - keyedRequestTimes.length)
  }
  const faults = createFaultQueue()
  const scheduleInitialFaults = (): void => {
    for (const scheduled of options.faults ?? []) faults.add(scheduled.fault, scheduled)
  }
  scheduleInitialFaults()

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const incoming = await readIncoming(input, init)
    const { apiUrl, path } = apiLocation(incoming.url)
    const body = parseBody(incoming.bodyText)
    const route = resolveRoute(incoming.method, path)
    const operation = route.kind === 'match' ? route.operation : undefined
    const log = (status: FakeBillingoOutcome, faulted: boolean): void => {
      requests.push({
        operation,
        method: incoming.method,
        path,
        query: Object.fromEntries(incoming.url.searchParams),
        body,
        status,
        faulted,
      })
    }
    const respond = (response: FakeResponse, faulted = false, remaining?: number): Response => {
      log(response.status, faulted)
      return toFetchResponse(response, incoming.method !== 'HEAD', remaining)
    }
    const applyFault = (fault: ActiveFault): Response => {
      const { effect } = fault
      if (effect.kind === 'network') {
        log('network', true)
        throw new TypeError('fetch failed')
      }
      if (effect.kind === 'timeout') {
        log('timeout', true)
        throw new DOMException('A hamis Billingo nem válaszolt (időtúllépés).', 'TimeoutError')
      }
      if (effect.kind === 'notReady') {
        return respond(clientError(202, FAKE_BILLINGO_MESSAGES.notReady), true)
      }
      return respond(statusFaultResponse(effect.status, effect.message), true)
    }

    if (route.kind === 'not-found') return respond(clientError(404, ''))
    if (route.kind === 'method-not-allowed') {
      return respond(clientError(405, methodNotAllowedMessage(incoming.method, route.allowed)))
    }
    if (!isAuthenticated(state.config, incoming.headers)) {
      return respond(clientError(401, FAKE_BILLINGO_MESSAGES.unauthorized))
    }
    const remaining = rateLimitRemaining()
    const fault = faults.take(route.operation)
    if (fault && !fault.afterSuccess) return applyFault(fault)
    const handler = FAKE_ROUTES[route.operation]
    const response = handler
      ? handler(state, {
          operation: route.operation,
          params: route.params,
          query: incoming.url.searchParams,
          body,
          path,
          apiUrl,
        })
      : serverError(501, notImplementedMessage(route.operation))
    if (fault && response.status < 400) return applyFault(fault)
    return respond(response, false, remaining)
  }

  return {
    fetch: fakeFetch as typeof globalThis.fetch,
    requests,
    get data(): FakeBillingoDataView {
      return state
    },
    count(operation) {
      if (operation === undefined) return requests.length
      return requests.filter((request) => request.operation === operation).length
    },
    counts() {
      const counts: Partial<Record<OperationId, number>> = {}
      for (const request of requests) {
        if (request.operation !== undefined) {
          counts[request.operation] = (counts[request.operation] ?? 0) + 1
        }
      }
      return counts
    },
    fail(fault, faultOptions = {}) {
      faults.add(fault, faultOptions)
    },
    reset() {
      state = createState(options)
      requests.length = 0
      keyedRequestTimes = []
      faults.clear()
      scheduleInitialFaults()
    },
  }
}
