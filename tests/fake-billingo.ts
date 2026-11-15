export interface FakeBillingoOptions {
  readonly taxCode: string
  readonly hasNavConnection?: boolean
}

export interface FakeBillingo {
  readonly fetch: typeof globalThis.fetch
}

type Json = Record<string, unknown>

function json(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status })
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function notFound(): Response {
  return json(404, { error: { message: '' } })
}

export function createFakeBillingo(options: FakeBillingoOptions): FakeBillingo {
  const bankAccounts = new Map<number, Json>()
  let nextId = 1

  function route(method: string, path: string, body: Json | undefined): Response {
    if (method === 'GET' && path === '/organization') {
      return json(200, {
        tax_code: options.taxCode,
        has_nav_connection: options.hasNavConnection ?? false,
      })
    }
    if (method === 'GET' && path === '/utils/time') {
      return json(200, { epoch: 1_763_200_000, timezone: 'Europe/Budapest' })
    }
    if (method === 'GET' && path === '/currencies') {
      return json(200, { from_currency: 'EUR', to_currency: 'HUF', conversation_rate: 390 })
    }
    if (path === '/bank-accounts') {
      if (method === 'GET') {
        const data = [...bankAccounts.values()]
        return json(200, { data, total: data.length, per_page: 100, current_page: 1, last_page: 1 })
      }
      const id = nextId++
      bankAccounts.set(id, { ...body, id })
      return json(201, bankAccounts.get(id))
    }
    const match = /^\/bank-accounts\/(\d+)$/.exec(path)
    if (match) {
      const id = Number(match[1])
      const existing = bankAccounts.get(id)
      if (!existing) return notFound()
      if (method === 'GET') return json(200, existing)
      if (method === 'PUT') {
        bankAccounts.set(id, { ...body, id })
        return json(200, bankAccounts.get(id))
      }
      bankAccounts.delete(id)
      return json(204)
    }
    return notFound()
  }

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    if (!headers.get('x-api-key')) {
      return json(401, { error: { message: 'Authorization information is missing or invalid.' } })
    }
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Json) : undefined
    return route(init?.method ?? 'GET', url.pathname.replace(/^\/v3/, ''), body)
  }
  return { fetch: fetch as typeof globalThis.fetch }
}
