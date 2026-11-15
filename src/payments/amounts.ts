import { CURRENCIES, isOneOf } from '../documents/enums'
import type { Currency } from '../generated/billingo'
import type { PaymentAmount } from './types'

const ISO_ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])

const ISO_THREE_DECIMAL: ReadonlySet<string> = new Set([
  'BHD',
  'IQD',
  'JOD',
  'KWD',
  'LYD',
  'OMR',
  'TND',
])

const ISO_FOUR_DECIMAL: ReadonlySet<string> = new Set(['CLF', 'UYW'])

const STRIPE_ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])

const STRIPE_THREE_DECIMAL: ReadonlySet<string> = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

const DECIMAL = /^(-?)(\d*)(?:\.(\d+))?$/

export type MinorUnitConvention = 'iso4217' | 'stripe'

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase()
}

export function isBillingoCurrency(currency: string): currency is Currency {
  return isOneOf(CURRENCIES, currency)
}

export function currencyExponent(
  currency: string,
  convention: MinorUnitConvention = 'iso4217',
): number {
  const code = normalizeCurrency(currency)
  if (convention === 'stripe') {
    if (STRIPE_ZERO_DECIMAL.has(code)) return 0
    if (STRIPE_THREE_DECIMAL.has(code)) return 3
    return 2
  }
  if (ISO_ZERO_DECIMAL.has(code)) return 0
  if (ISO_THREE_DECIMAL.has(code)) return 3
  if (ISO_FOUR_DECIMAL.has(code)) return 4
  return 2
}

function amountOf(minor: number, currency: string, exponent: number): PaymentAmount {
  return { value: minor === 0 ? 0 : minor / 10 ** exponent, minor, currency }
}

export function decimalToMinor(value: string | number, exponent: number): number | undefined {
  const source =
    typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim()
  const match = DECIMAL.exec(source)
  if (!match) return undefined
  const [, sign = '', whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') return undefined
  if (/[^0]/.test(fraction.slice(exponent))) return undefined
  const minor = Number(`${whole}${fraction.slice(0, exponent).padEnd(exponent, '0')}`)
  if (!Number.isSafeInteger(minor)) return undefined
  return sign === '-' && minor !== 0 ? -minor : minor
}

export function parseDecimalAmount(value: string | number, currency: string): PaymentAmount {
  const code = normalizeCurrency(currency)
  const exponent = currencyExponent(code)
  const minor = decimalToMinor(value, exponent)
  if (minor === undefined) {
    throw new RangeError(
      `Érvénytelen ${code} összeg: "${String(value)}". Tizedesponttal írt szám kell, legfeljebb ${exponent} tizedesjeggyel.`,
    )
  }
  return amountOf(minor, code, exponent)
}

export function fromMinorUnits(
  minor: number,
  currency: string,
  convention: MinorUnitConvention = 'iso4217',
): PaymentAmount {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Érvénytelen összeg (minor unit): ${minor}`)
  }
  const code = normalizeCurrency(currency)
  const iso = currencyExponent(code)
  const source = currencyExponent(code, convention)
  if (iso >= source) {
    const scaled = minor * 10 ** (iso - source)
    if (!Number.isSafeInteger(scaled)) {
      throw new RangeError(`Érvénytelen összeg (minor unit): ${minor}`)
    }
    return amountOf(scaled, code, iso)
  }
  const divisor = 10 ** (source - iso)
  if (minor % divisor !== 0) {
    throw new RangeError(
      `A(z) ${minor} ${code} minor unit nem váltható át: a pénznemnek ${iso} tizedesjegye van.`,
    )
  }
  return amountOf(minor / divisor, code, iso)
}
