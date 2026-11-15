import { createTarca, type Tarca } from '../client'
import { BillingoError } from '../core/errors'
import { resolveDefaults, type TarcaDefaults } from '../documents/defaults'
import { CURRENCIES, DOCUMENT_LANGUAGES, isOneOf, PAYMENT_METHODS } from '../documents/enums'

export interface CliIo {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly nodeVersion: string
  stdout(text: string): void
  stderr(text: string): void
  readFile(path: string): Promise<string>
  readStdin(): Promise<string>
  stdinLines(): AsyncIterable<string>
  readonly fetch?: typeof globalThis.fetch | undefined
  readonly now?: (() => Date) | undefined
}

export class CliError extends Error {
  override readonly name: string = 'CliError'
}

export const API_KEY_ENV = 'BILLINGO_API_KEY'
export const ALLOW_WRITE_ENV = 'TARCA_MCP_ALLOW_WRITE'

export function apiKeyOf(io: CliIo): string {
  const key = io.env[API_KEY_ENV]?.trim()
  if (!key) {
    throw new BillingoError(
      `Hiányzik a Billingo API kulcs: állítsd be a ${API_KEY_ENV} környezeti változót.`,
      {
        category: 'configuration',
        hint: 'V3 API kulcs kell: Billingo → Beállítások → API kulcsok.',
      },
    )
  }
  return key
}

export function cliTarca(io: CliIo, defaults: TarcaDefaults = {}): Tarca {
  return createTarca({
    apiKey: apiKeyOf(io),
    defaults,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  })
}

export async function readText(io: CliIo, path: string): Promise<string> {
  if (path === '-') return io.readStdin()
  try {
    return await io.readFile(path)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CliError(`A(z) ${path} fájl nem olvasható: ${reason}`)
  }
}

export async function readJson(io: CliIo, path: string): Promise<unknown> {
  const text = await readText(io, path)
  try {
    return JSON.parse(text)
  } catch {
    throw new CliError(`A(z) ${path} nem érvényes JSON.`)
  }
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const DEFAULT_KEYS: readonly (keyof TarcaDefaults)[] = [
  'blockId',
  'receiptBlockId',
  'bankAccountId',
  'paymentMethod',
  'language',
  'currency',
  'dueInDays',
  'electronic',
  'sendEmail',
]

function defaultsOf(value: Readonly<Record<string, unknown>>, path: string): TarcaDefaults {
  const unknown = Object.keys(value).filter((key) => !DEFAULT_KEYS.some((known) => known === key))
  if (unknown.length > 0) {
    throw new CliError(
      `A(z) ${path} ismeretlen mezőt tartalmaz: ${unknown.join(', ')}. Megengedett: ${DEFAULT_KEYS.join(', ')}.`,
    )
  }
  const wrong = (key: string, expected: string): CliError =>
    new CliError(`A(z) ${path} ${key} mezője ${expected} legyen.`)
  const number = (key: keyof TarcaDefaults): number | undefined => {
    const entry = value[key]
    if (entry === undefined || typeof entry === 'number') return entry
    throw wrong(key, 'szám')
  }
  const flag = (key: keyof TarcaDefaults): boolean | undefined => {
    const entry = value[key]
    if (entry === undefined || typeof entry === 'boolean') return entry
    throw wrong(key, 'true vagy false')
  }
  const choice = <T extends string>(
    key: keyof TarcaDefaults,
    values: readonly T[],
  ): T | undefined => {
    const entry = value[key]
    if (entry === undefined || isOneOf(values, entry)) return entry
    throw wrong(key, `ezek egyike: ${values.join(', ')}`)
  }
  const defaults: TarcaDefaults = {
    blockId: number('blockId'),
    receiptBlockId: number('receiptBlockId'),
    bankAccountId: number('bankAccountId'),
    paymentMethod: choice('paymentMethod', PAYMENT_METHODS),
    language: choice('language', DOCUMENT_LANGUAGES),
    currency: choice('currency', CURRENCIES),
    dueInDays: number('dueInDays'),
    electronic: flag('electronic'),
    sendEmail: flag('sendEmail'),
  }
  resolveDefaults(defaults)
  return defaults
}

export async function readDefaults(io: CliIo, path: string | undefined): Promise<TarcaDefaults> {
  if (path === undefined) return {}
  const value = await readJson(io, path)
  if (!isRecord(value)) {
    throw new CliError(`A(z) ${path} fájlnak TarcaDefaults objektumot kell tartalmaznia.`)
  }
  return defaultsOf(value, path)
}

export function printJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`)
}
