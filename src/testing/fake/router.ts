import { BILLINGO_OPERATIONS, type OperationId } from '../../core/operations'

export type RouteResolution =
  | {
      readonly kind: 'match'
      readonly operation: OperationId
      readonly params: Readonly<Record<string, string>>
    }
  | { readonly kind: 'method-not-allowed'; readonly allowed: readonly string[] }
  | { readonly kind: 'not-found' }

interface CompiledRoute {
  readonly operation: OperationId
  readonly method: string
  readonly segments: readonly string[]
}

const VERB_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

const PARAM = /^\{(\w+)\}$/

export function isOperationId(value: unknown): value is OperationId {
  return typeof value === 'string' && Object.hasOwn(BILLINGO_OPERATIONS, value)
}

const ROUTES: readonly CompiledRoute[] = Object.entries(BILLINGO_OPERATIONS).flatMap(
  ([operation, info]) => {
    if (!isOperationId(operation)) return []
    return [{ operation, method: info.method, segments: info.path.split('/').filter(Boolean) }]
  },
)

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

function matchSegments(
  route: CompiledRoute,
  segments: readonly string[],
): Record<string, string> | undefined {
  if (route.segments.length !== segments.length) return undefined
  const params: Record<string, string> = {}
  for (const [index, expected] of route.segments.entries()) {
    const actual = segments[index] ?? ''
    const name = PARAM.exec(expected)?.[1]
    if (name === undefined) {
      if (expected !== actual) return undefined
      continue
    }
    const value = decode(actual)
    if (value === undefined) return undefined
    params[name] = value
  }
  return params
}

export function resolveRoute(method: string, path: string): RouteResolution {
  const segments = path.split('/').filter(Boolean)
  const candidates = ROUTES.flatMap((route) => {
    const params = matchSegments(route, segments)
    return params === undefined ? [] : [{ route, params }]
  })
  if (candidates.length === 0) return { kind: 'not-found' }
  const wanted = method === 'HEAD' ? 'GET' : method
  const match = candidates.find((candidate) => candidate.route.method === wanted)
  if (match) return { kind: 'match', operation: match.route.operation, params: match.params }
  const methods = new Set(candidates.map((candidate) => candidate.route.method))
  if (methods.has('GET')) methods.add('HEAD')
  return { kind: 'method-not-allowed', allowed: VERB_ORDER.filter((verb) => methods.has(verb)) }
}
