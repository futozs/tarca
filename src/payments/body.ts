import { WebhookVerificationError } from './errors'
import type { JsonRecord } from './json'
import type { PaymentProvider } from './types'

export const DEFAULT_MAX_WEBHOOK_BYTES = 1_048_576

function tooLarge(provider: PaymentProvider, maxBytes: number): WebhookVerificationError {
  return new WebhookVerificationError(
    provider,
    'payload_too_large',
    `A webhook törzse nagyobb a megengedett ${maxBytes} bájtnál.`,
  )
}

export function resolveMaxBodyBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_WEBHOOK_BYTES
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`A maxBodyBytes pozitív egész szám legyen, kapott: ${String(value)}`)
  }
  return value
}

export async function readRawBody(
  request: Request,
  provider: PaymentProvider,
  maxBytes: number = DEFAULT_MAX_WEBHOOK_BYTES,
): Promise<string> {
  const limit = resolveMaxBodyBytes(maxBytes)
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(provider, limit)
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge(provider, limit)
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export function parseJsonObject(provider: PaymentProvider, payload: string): JsonRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new WebhookVerificationError(
      provider,
      'invalid_payload',
      'A webhook törzse nem érvényes JSON.',
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WebhookVerificationError(
      provider,
      'invalid_payload',
      'A webhook törzse nem JSON objektum.',
    )
  }
  return parsed as JsonRecord
}

export function plainResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
