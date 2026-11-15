import { isOneOf, RECEIPT_VATS, toVatCode, VATS } from '../documents/enums'
import type { ReceiptVat, Vat } from '../generated/billingo'
import { isJsonObject, type JsonObject } from './protocol'

export type ToolErrorCategory = 'invalid_input' | 'confirmation' | 'refused'

export interface ToolInputErrorOptions {
  readonly category?: ToolErrorCategory | undefined
  readonly fields?: readonly string[] | undefined
}

export class ToolInputError extends Error {
  override readonly name: string = 'ToolInputError'
  readonly category: ToolErrorCategory
  readonly fields: readonly string[]

  constructor(message: string, options: ToolInputErrorOptions = {}) {
    super(message)
    this.category = options.category ?? 'invalid_input'
    this.fields = options.fields ?? []
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NUMERIC_TEXT = /^-?\d+(?:[.,]\d+)?$/

export function field(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`
}

function invalid(message: string, at: string): ToolInputError {
  return new ToolInputError(message, { fields: [at] })
}

export function objectArg(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) throw invalid(`A(z) ${path} mezőnek objektumnak kell lennie.`, path)
  return value
}

export function assertKnownKeys(value: JsonObject, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length === 0) return
  const where = path === '' ? 'a bemenetben' : `a(z) ${path} objektumban`
  throw new ToolInputError(
    `Ismeretlen mező ${where}: ${unknown.join(', ')}. Megengedett mezők: ${allowed.join(', ')}.`,
    { fields: unknown.map((key) => field(path, key)) },
  )
}

export function optionalString(value: JsonObject, key: string, path: string): string | undefined {
  const raw = value[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') {
    throw invalid(`A(z) ${field(path, key)} mezőnek szövegnek kell lennie.`, field(path, key))
  }
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

export function requiredString(value: JsonObject, key: string, path: string): string {
  const result = optionalString(value, key, path)
  if (result === undefined) {
    throw invalid(`A(z) ${field(path, key)} mező kötelező, és nem lehet üres.`, field(path, key))
  }
  return result
}

export function optionalNumber(value: JsonObject, key: string, path: string): number | undefined {
  const raw = value[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw invalid(`A(z) ${field(path, key)} mezőnek véges számnak kell lennie.`, field(path, key))
  }
  return raw
}

export function optionalInteger(value: JsonObject, key: string, path: string): number | undefined {
  const result = optionalNumber(value, key, path)
  if (result !== undefined && !Number.isSafeInteger(result)) {
    throw invalid(`A(z) ${field(path, key)} mezőnek egész számnak kell lennie.`, field(path, key))
  }
  return result
}

export function optionalId(value: JsonObject, key: string, path: string): number | undefined {
  const result = optionalInteger(value, key, path)
  if (result !== undefined && result < 1) {
    throw invalid(
      `A(z) ${field(path, key)} mezőnek pozitív egész azonosítónak kell lennie.`,
      field(path, key),
    )
  }
  return result
}

export function requiredId(value: JsonObject, key: string, path: string): number {
  const result = optionalId(value, key, path)
  if (result === undefined) {
    throw invalid(
      `A(z) ${field(path, key)} mező kötelező (pozitív egész azonosító).`,
      field(path, key),
    )
  }
  return result
}

export function optionalBoolean(value: JsonObject, key: string, path: string): boolean | undefined {
  const raw = value[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'boolean') {
    throw invalid(
      `A(z) ${field(path, key)} mezőnek true vagy false értéknek kell lennie.`,
      field(path, key),
    )
  }
  return raw
}

export function requiredBoolean(value: JsonObject, key: string, path: string): boolean {
  const result = optionalBoolean(value, key, path)
  if (result === undefined) {
    throw invalid(`A(z) ${field(path, key)} mező kötelező (true vagy false).`, field(path, key))
  }
  return result
}

export function optionalDate(value: JsonObject, key: string, path: string): string | undefined {
  const result = optionalString(value, key, path)
  if (result !== undefined && !DATE_PATTERN.test(result)) {
    throw invalid(
      `A(z) ${field(path, key)} mezőt ÉÉÉÉ-HH-NN formában add meg (például 2026-11-16).`,
      field(path, key),
    )
  }
  return result
}

export function optionalEnum<T extends string>(
  value: JsonObject,
  key: string,
  path: string,
  allowed: readonly T[],
): T | undefined {
  const raw = optionalString(value, key, path)
  if (raw === undefined) return undefined
  if (isOneOf(allowed, raw)) return raw
  throw invalid(
    `A(z) ${field(path, key)} értéke nem megengedett: ${raw}. Lehetséges értékek: ${allowed.join(', ')}.`,
    field(path, key),
  )
}

export function optionalArray(
  value: JsonObject,
  key: string,
  path: string,
): readonly unknown[] | undefined {
  const raw = value[key]
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    throw invalid(`A(z) ${field(path, key)} mezőnek tömbnek kell lennie.`, field(path, key))
  }
  return raw
}

export function requiredArray(
  value: JsonObject,
  key: string,
  path: string,
  limits: { readonly min: number; readonly max: number },
): readonly unknown[] {
  const result = optionalArray(value, key, path) ?? []
  if (result.length < limits.min || result.length > limits.max) {
    throw invalid(
      `A(z) ${field(path, key)} tömbben ${limits.min} és ${limits.max} közötti számú elem lehet, kapott: ${result.length}.`,
      field(path, key),
    )
  }
  return result
}

export function stringList(
  value: JsonObject,
  key: string,
  path: string,
  limits: { readonly min: number; readonly max: number },
): string[] {
  return requiredArray(value, key, path, limits).map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw invalid(
        `A(z) ${field(path, key)}.${index} elemnek nem üres szövegnek kell lennie.`,
        `${field(path, key)}.${index}`,
      )
    }
    return entry.trim()
  })
}

function numericFromText(value: unknown): unknown {
  if (typeof value !== 'string' || !NUMERIC_TEXT.test(value.trim())) return value
  return Number(value.trim().replace(',', '.'))
}

function vatOf<T extends string>(values: readonly T[], value: unknown, at: string): T {
  const candidate = numericFromText(value)
  if (typeof candidate === 'number' || typeof candidate === 'string') {
    try {
      return toVatCode(values, candidate)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  throw invalid(
    `Ismeretlen áfakulcs a(z) ${at} mezőben: ${JSON.stringify(value) ?? 'undefined'}. Lehetséges értékek: ${values.join(', ')} (számként is, például 27 vagy 5.5).`,
    at,
  )
}

export function documentVat(value: unknown, at: string): Vat {
  return vatOf(VATS, value, at)
}

export function receiptVat(value: unknown, at: string): ReceiptVat {
  return vatOf(RECEIPT_VATS, value, at)
}
