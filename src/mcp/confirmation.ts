import { digestHex, hmacHex, timingSafeEqual } from '../core/crypto'
import { configurationError } from '../core/errors'
import { ToolInputError } from './arguments'

export const DEFAULT_CONFIRMATION_TTL_MS = 900_000

const SECRET_BYTES = 32
const MIN_SECRET_BYTES = 16
const SIGNATURE_LENGTH = 32
const IDEMPOTENCY_KEY_LENGTH = 20
const TOKEN_PATTERN = /^([0-9a-z]+)\.([0-9a-f]+)$/

export interface ConfirmationOptions {
  readonly secret?: string | Uint8Array | undefined
  readonly ttlMs?: number | undefined
  readonly now: () => Date
}

export interface IssuedConfirmation {
  readonly token: string
  readonly expiresAt: string
}

export interface Confirmations {
  issue(action: string, payload: unknown): Promise<IssuedConfirmation>
  verify(action: string, payload: unknown, token: unknown, previewTool: string): Promise<string>
  spend(token: string): boolean
  release(token: string): void
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? 'null'
}

export async function idempotencyKey(
  action: string,
  day: string,
  payload: unknown,
): Promise<string> {
  const digest = await digestHex('SHA-256', `${action}\n${day}\n${canonicalJson(payload)}`)
  return digest.slice(0, IDEMPOTENCY_KEY_LENGTH).toUpperCase()
}

function randomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES))
}

function resolveSecret(secret: string | Uint8Array | undefined): string | Uint8Array {
  if (secret === undefined) return randomSecret()
  const length =
    typeof secret === 'string' ? new TextEncoder().encode(secret).byteLength : secret.byteLength
  if (length < MIN_SECRET_BYTES) {
    throw configurationError(
      `A confirmationSecret legalább ${MIN_SECRET_BYTES} bájt legyen, kapott: ${length} bájt. Egy rövid vagy üres titokkal bárki hamisíthatna megerősítő kódot; generálj egyet például az openssl rand -hex 32 paranccsal.`,
    )
  }
  return secret
}

function resolveTtl(ttlMs: number | undefined): number {
  if (ttlMs === undefined) return DEFAULT_CONFIRMATION_TTL_MS
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new TypeError(`A confirmationTtlMs pozitív egész szám legyen, kapott: ${ttlMs}`)
  }
  return ttlMs
}

function confirmationError(message: string): ToolInputError {
  return new ToolInputError(message, { category: 'confirmation', fields: ['confirmation'] })
}

export function createConfirmations(options: ConfirmationOptions): Confirmations {
  const secret = resolveSecret(options.secret)
  const ttlMs = resolveTtl(options.ttlMs)
  const spent = new Map<string, number>()

  const sign = async (action: string, expiresAt: number, payload: unknown): Promise<string> => {
    const signature = await hmacHex(
      'SHA-256',
      secret,
      `${action}\n${expiresAt}\n${canonicalJson(payload)}`,
    )
    return signature.slice(0, SIGNATURE_LENGTH)
  }

  return {
    async issue(action, payload) {
      const expiresAt = options.now().getTime() + ttlMs
      const signature = await sign(action, expiresAt, payload)
      return {
        token: `${expiresAt.toString(36)}.${signature}`,
        expiresAt: new Date(expiresAt).toISOString(),
      }
    },
    async verify(action, payload, token, previewTool) {
      const again = `Hívd meg újra a ${previewTool} eszközt pontosan ezekkel az adatokkal, mutasd meg az előnézetet a felhasználónak, és a jóváhagyása után az új kóddal próbáld újra.`
      if (typeof token !== 'string' || token.trim() === '') {
        throw confirmationError(`Hiányzik a megerősítő kód (confirmation). ${again}`)
      }
      const trimmed = token.trim()
      const match = TOKEN_PATTERN.exec(trimmed)
      const expiresAt = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 36)
      if (!match?.[2] || !Number.isSafeInteger(expiresAt)) {
        throw confirmationError(`A megerősítő kód formátuma érvénytelen. ${again}`)
      }
      if (options.now().getTime() > expiresAt) {
        throw confirmationError(`A megerősítő kód lejárt. ${again}`)
      }
      const expected = await sign(action, expiresAt, payload)
      if (!timingSafeEqual(expected, match[2])) {
        throw confirmationError(
          `A megerősítő kód nem ehhez a kéréshez tartozik (az adatok eltérnek az előnézettől). ${again}`,
        )
      }
      return trimmed
    },
    spend(token) {
      const now = options.now().getTime()
      for (const [entry, expiresAt] of spent) {
        if (expiresAt < now) spent.delete(entry)
      }
      if (spent.has(token)) return false
      const expiresAt = Number.parseInt(token.split('.')[0] ?? '', 36)
      spent.set(token, Number.isSafeInteger(expiresAt) ? expiresAt : now + ttlMs)
      return true
    },
    release(token) {
      spent.delete(token)
    },
  }
}
