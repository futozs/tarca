import { BillingoError, type FieldError } from '../core/errors'
import type { OperationId } from '../core/operations'
import { isDotSegment } from '../core/url'
import type { PartnerInput } from '../partners/partners'
import { CURRENCIES, isOneOf } from './enums'

export type Wire<T> = {
  readonly [K in keyof T]: Record<never, never> extends Pick<T, K> ? T[K] | undefined : T[K]
}

export interface InputCheck {
  readonly errors: readonly FieldError[]
  fail(field: string, message: string): void
  convert(field: string, convert: () => unknown): void
  id(value: unknown, field: string): void
  finite(value: unknown, field: string): void
  text(value: unknown, field: string): void
  choice(values: readonly string[], value: unknown, field: string, label: string): void
  flag(value: unknown, field: string): void
  partner(value: number | PartnerInput | undefined, field: string): void
  currency(value: unknown, conversionRate: unknown): void
  vendorId(value: unknown, required: boolean): void
}

export function describeValue(value: unknown): string {
  return typeof value === 'string' ? `„${value}”` : String(value)
}

export function createInputCheck(): InputCheck {
  const errors: FieldError[] = []
  const fail = (field: string, message: string): void => {
    errors.push({ field, message })
  }
  const id = (value: unknown, field: string): void => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return
    fail(field, `Pozitív egész azonosító kell, kapott: ${describeValue(value)}.`)
  }
  return {
    errors,
    fail,
    convert(field, convert) {
      try {
        convert()
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        fail(field, error.message)
      }
    },
    id,
    finite(value, field) {
      if (typeof value === 'number' && Number.isFinite(value)) return
      fail(field, `Véges szám kell, kapott: ${describeValue(value)}.`)
    },
    text(value, field) {
      if (typeof value === 'string' && value.trim() !== '') return
      fail(field, 'Nem lehet üres.')
    },
    choice(values, value, field, label) {
      if (isOneOf(values, value)) return
      fail(field, `Ismeretlen ${label}: ${describeValue(value)}.`)
    },
    flag(value, field) {
      if (value === undefined || typeof value === 'boolean') return
      fail(field, `true vagy false kell, kapott: ${describeValue(value)}.`)
    },
    partner(value, field) {
      if (typeof value !== 'object' || value === null) {
        id(value, field)
        return
      }
      if (typeof value.name !== 'string' || value.name.trim() === '') {
        fail(`${field}.name`, 'A partner neve nem lehet üres.')
      }
      if (typeof value.address !== 'object' || value.address === null) {
        fail(`${field}.address`, 'A partner címe kötelező (postCode, city, address).')
      }
    },
    currency(value, conversionRate) {
      if (!isOneOf(CURRENCIES, value)) {
        fail('currency', `Ismeretlen pénznem: ${describeValue(value)}.`)
        return
      }
      if (conversionRate === undefined) {
        if (value === 'HUF') return
        fail(
          'conversionRate',
          `Nem forintos (${value}) bizonylathoz kötelező az árfolyam, például a currencies.rate({ from: '${value}', to: 'HUF' }) eredménye.`,
        )
        return
      }
      if (
        typeof conversionRate === 'number' &&
        Number.isFinite(conversionRate) &&
        conversionRate > 0
      )
        return
      fail('conversionRate', `Pozitív szám kell, kapott: ${describeValue(conversionRate)}.`)
    },
    vendorId(value, required) {
      if (value === undefined && !required) return
      if (typeof value === 'string' && isDotSegment(value.trim())) {
        fail(
          'vendorId',
          `A vendorId nem lehet „${value.trim()}”: a Billingo útvonalában a fetch útvonal-lépésnek venné, így a bizonylat vendorId alapján nem lenne visszakereshető.`,
        )
        return
      }
      if (typeof value === 'string' && value.trim() !== '') return
      fail(
        'vendorId',
        required
          ? 'A createOnce-hoz kötelező a vendorId (a saját egyedi azonosítód, például a rendelésszám).'
          : 'A vendorId nem lehet üres.',
      )
    },
  }
}

export function assertValid(check: InputCheck, operation: OperationId, subject: string): void {
  if (check.errors.length === 0) return
  const details = check.errors.map((item) => `${item.field}: ${item.message}`).join('; ')
  throw new BillingoError(`Hibás ${subject}: ${details}`, {
    category: 'validation',
    operation,
    fieldErrors: check.errors,
    hint: 'A tárca a kérést el sem küldte a Billingónak, így semmi nem jött létre.',
  })
}
