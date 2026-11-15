export interface IncomingRequest {
  readonly method: string
  readonly url: URL
  readonly headers: Headers
  readonly bodyText: string | undefined
}

export interface ApiLocation {
  readonly apiUrl: string
  readonly path: string
}

export async function readIncoming(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<IncomingRequest> {
  const request = new Request(input, init)
  request.signal.throwIfAborted()
  const text = await request.text()
  return {
    method: request.method.toUpperCase(),
    url: new URL(request.url),
    headers: request.headers,
    bodyText: text === '' ? undefined : text,
  }
}

export function apiLocation(url: URL): ApiLocation {
  const match = /^(.*?\/v3)(\/.*)?$/.exec(url.pathname)
  if (!match) return { apiUrl: url.origin, path: url.pathname }
  return { apiUrl: `${url.origin}${match[1] ?? ''}`, path: match[2] ?? '/' }
}

export function parseBody(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
