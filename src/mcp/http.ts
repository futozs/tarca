import { configurationError } from '../core/errors'
import {
  failure,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
} from './protocol'
import type { TarcaMcpServer } from './server'

export const DEFAULT_MAX_BODY_BYTES = 1_048_576

export interface TarcaMcpHandlerOptions {
  readonly authorize: (request: Request) => boolean | Promise<boolean>
  readonly allowedOrigins?: readonly string[] | undefined
  readonly maxBodyBytes?: number | undefined
}

export type TarcaMcpHandler = (request: Request) => Promise<Response>

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } })
}

function rejection(
  status: number,
  message: string,
  code: number = JSON_RPC_INVALID_REQUEST,
  headers: Record<string, string> = {},
): Response {
  return reply(status, failure(null, code, message), headers)
}

function resolveLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_BODY_BYTES
  if (!Number.isSafeInteger(value) || value < 1) {
    throw configurationError(`A maxBodyBytes pozitív egész szám legyen, kapott: ${String(value)}`)
  }
  return value
}

async function readLimited(request: Request, limit: number): Promise<Uint8Array | undefined> {
  if (request.body === null) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function parseJson(
  bytes: Uint8Array,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch {
    return { ok: false }
  }
}

export function createTarcaMcpHandler(
  server: TarcaMcpServer,
  options: TarcaMcpHandlerOptions,
): TarcaMcpHandler {
  if (typeof options.authorize !== 'function') {
    throw configurationError(
      'A createTarcaMcpHandler authorize függvényt kér: a szerveroldali Billingo kulccsal névtelen végpont nem indul, mert bárki bizonylatot kérdezhetne le vagy állíthatna ki vele.',
    )
  }
  if (!server.hasConfirmationSecret) {
    throw configurationError(
      'HTTP módban a createTarcaMcpServer confirmationSecret beállítása kötelező: a folyamatonként véletlen titokkal kiadott megerősítő kódot egy másik példány nem tudná ellenőrizni.',
    )
  }
  const limit = resolveLimit(options.maxBodyBytes)
  const origins = new Set(options.allowedOrigins ?? [])
  return async (request) => {
    if (request.method !== 'POST') {
      return rejection(405, 'Csak POST kérés engedélyezett (JSON-RPC).', JSON_RPC_INVALID_REQUEST, {
        allow: 'POST',
      })
    }
    const origin = request.headers.get('origin')
    if (origin !== null && !origins.has(origin)) {
      return rejection(403, 'Nem engedélyezett Origin.')
    }
    let authorized: boolean
    try {
      authorized = (await options.authorize(request)) === true
    } catch {
      return rejection(500, 'A hitelesítés ellenőrzése hibát dobott.', JSON_RPC_INTERNAL_ERROR)
    }
    if (!authorized) return rejection(401, 'Hiányzó vagy érvénytelen hitelesítés.')
    const contentType = request.headers.get('content-type') ?? ''
    if (!/^application\/json\b/i.test(contentType.trim())) {
      return rejection(415, 'A kérés törzse application/json legyen.')
    }
    const declared = Number(request.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > limit) {
      return rejection(413, `A kérés törzse legfeljebb ${limit} bájt lehet.`)
    }
    const bytes = await readLimited(request, limit)
    if (bytes === undefined) return rejection(413, `A kérés törzse legfeljebb ${limit} bájt lehet.`)
    const parsed = parseJson(bytes)
    if (!parsed.ok) return rejection(400, 'Érvénytelen JSON.', JSON_RPC_PARSE_ERROR)
    const connection = server.connect({
      protocolVersion: request.headers.get('mcp-protocol-version') ?? undefined,
    })
    const response = await connection.handle(parsed.value)
    if (response === undefined) return new Response(null, { status: 202, headers: HEADERS })
    return reply(200, response)
  }
}
