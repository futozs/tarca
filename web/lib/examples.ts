import examples from '@/generated/examples.json'
import type { GeneratedExample } from '@/scripts/examples-runner'

export type { GeneratedExample }
export type GeneratedRequest = GeneratedExample['requests'][number]

const all = examples as readonly GeneratedExample[]

export function getExample(slug: string): GeneratedExample {
  const example = all.find((item) => item.slug === slug)
  if (!example) {
    throw new Error(`Nincs "${slug}" nevű példa a sandbox/examples mappában.`)
  }
  return example
}

export function requestLine(request: GeneratedRequest): string {
  const query = request.query.map(([key, value]) => `${key}=${value}`).join('&')
  return `${request.method} ${request.path}${query ? `?${query}` : ''}`
}

export function requestText(request: GeneratedRequest): string {
  const line = `${requestLine(request)} HTTP/1.1`
  return request.requestBody
    ? `${line}\ncontent-type: application/json\n\n${request.requestBody}`
    : line
}

export function responseText(request: GeneratedRequest): string {
  const status =
    typeof request.status === 'number'
      ? `HTTP/1.1 ${request.status}`
      : `nincs válasz (${request.status === 'network' ? 'hálózati hiba' : 'időtúllépés'})`
  const headers = request.responseHeaders.map(([name, value]) => `${name}: ${value}`)
  const head = [status, ...headers].join('\n')
  return request.responseBody ? `${head}\n\n${request.responseBody}` : head
}

export function pickRequests(
  requests: readonly GeneratedRequest[],
  operation: string | undefined,
): readonly GeneratedRequest[] {
  if (!operation) return requests
  return requests.filter((request) => request.operation === operation)
}
