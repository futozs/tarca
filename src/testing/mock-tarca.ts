import { createTarca, type Tarca } from '../client'
import { isPlainObject } from '../core/case'
import type { TarcaHooks } from '../core/context'
import { BillingoError } from '../core/errors'
import type { TarcaDefaults } from '../documents/defaults'
import {
  createFakeBillingoFetch,
  type FakeBillingo,
  type FakeBillingoOptions,
} from './fake-billingo'

type MethodPaths<T, Prefix extends string> = {
  [K in keyof T & string]: T[K] extends (...args: never[]) => unknown
    ? `${Prefix}${K}`
    : T[K] extends object
      ? MethodPaths<T[K], `${Prefix}${K}.`>
      : never
}[keyof T & string]

export type MockTarcaMethod = MethodPaths<Tarca, ''>

export interface MockCall {
  readonly method: MockTarcaMethod
  readonly args: readonly unknown[]
}

export interface MockFailureOptions {
  readonly afterSuccess?: boolean | undefined
}

export interface MockTarcaOptions extends Omit<FakeBillingoOptions, 'apiKeys'> {
  readonly credentialsValid?: boolean | undefined
  readonly defaults?: TarcaDefaults | undefined
  readonly hooks?: TarcaHooks | undefined
}

export interface MockTarca extends Tarca {
  readonly calls: readonly MockCall[]
  readonly billingo: FakeBillingo
  failNext(method: MockTarcaMethod, error?: BillingoError, options?: MockFailureOptions): void
  reset(): void
}

interface PendingFailure {
  readonly error: BillingoError
  readonly afterSuccess: boolean
}

type AnyMethod = (...args: unknown[]) => unknown

const MOCK_API_KEY = 'tarca-mock-kulcs'

function isMethod(value: unknown): value is AnyMethod {
  return typeof value === 'function'
}

function instrument<T extends object>(
  target: T,
  prefix: string,
  wrap: (name: string, method: AnyMethod) => AnyMethod,
): T {
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(target))
  for (const [key, value] of Object.entries(target)) {
    const name = `${prefix}${key}`
    if (isMethod(value)) result[key] = wrap(name, value)
    else if (isPlainObject(value)) result[key] = instrument(value, `${name}.`, wrap)
  }
  return result as T
}

async function settle(failure: PendingFailure | undefined, start: () => unknown): Promise<unknown> {
  if (failure && !failure.afterSuccess) throw failure.error
  const result = await start()
  if (failure) throw failure.error
  return result
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
  )
}

async function* iterate(
  failure: PendingFailure | undefined,
  start: () => unknown,
): AsyncGenerator<unknown, void, undefined> {
  if (failure && !failure.afterSuccess) throw failure.error
  const iterable = start()
  if (!isAsyncIterable(iterable)) {
    throw new TypeError('Az all metódusnak async iterátort kell visszaadnia.')
  }
  yield* iterable
  if (failure) throw failure.error
}

export function createMockTarca(options: MockTarcaOptions = {}): MockTarca {
  const { credentialsValid, defaults, hooks, ...fakeOptions } = options
  const billingo = createFakeBillingoFetch({
    ...fakeOptions,
    ...(credentialsValid === false ? { apiKeys: [] } : {}),
  })
  const client = createTarca({
    apiKey: MOCK_API_KEY,
    fetch: billingo.fetch,
    retryDelayMs: 0,
    defaults,
    hooks,
  })
  const calls: MockCall[] = []
  const failures = new Map<string, PendingFailure>()
  const methods = new Set<string>()

  const wrap = (name: string, method: AnyMethod): AnyMethod => {
    methods.add(name)
    return (...args) => {
      calls.push({ method: name as MockTarcaMethod, args })
      const failure = failures.get(name)
      failures.delete(name)
      const start = (): unknown => method(...args)
      return name.endsWith('.all') ? iterate(failure, start) : settle(failure, start)
    }
  }

  const tarca = instrument(client, '', wrap)
  return {
    ...tarca,
    calls,
    billingo,
    failNext(method, error, failureOptions) {
      if (!methods.has(method)) throw new TypeError(`Ismeretlen tarca metódus: ${String(method)}`)
      failures.set(method, {
        error:
          error ??
          new BillingoError('Hálózati hiba a Billingo elérésekor.', { category: 'network' }),
        afterSuccess: failureOptions?.afterSuccess === true,
      })
    },
    reset() {
      calls.length = 0
      failures.clear()
      billingo.reset()
    },
  }
}
