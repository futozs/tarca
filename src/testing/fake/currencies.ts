import type { ConversationRate, Currency } from '../../generated/billingo'
import { isCurrency } from './enums'
import {
  type FakeFieldError,
  type FakeRoutes,
  LARAVEL_MESSAGES,
  ok,
  requiredEnum,
  validationFailed,
} from './http'
import { type FakeBillingoState, today } from './state'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function hufValue(state: FakeBillingoState, currency: Currency): number | undefined {
  return currency === 'HUF' ? 1 : state.config.hufRates[currency]
}

export function missingRateMessage(currency: Currency): string {
  return `A hamis Billingo nem ismeri a(z) ${currency} árfolyamát. Add meg a hufRates opcióban (1 ${currency} hány forint).`
}

export const currencyRoutes: FakeRoutes = {
  GetConversionRate: (state, request) => {
    const errors: FakeFieldError[] = []
    const query = Object.fromEntries(request.query)
    const from = requiredEnum(query, 'from', isCurrency, errors)
    const to = requiredEnum(query, 'to', isCurrency, errors)
    const date = request.query.get('date')
    if (date !== null && !isCalendarDate(date)) {
      errors.push({ field: 'date', message: LARAVEL_MESSAGES.dateFormat('date') })
    }
    if (errors.length > 0 || from === undefined || to === undefined) return validationFailed(errors)
    const fromValue = from === to ? 1 : hufValue(state, from)
    const toValue = from === to ? 1 : hufValue(state, to)
    if (fromValue === undefined || toValue === undefined) {
      const field = fromValue === undefined ? 'from' : 'to'
      return validationFailed([
        { field, message: missingRateMessage(fromValue === undefined ? from : to) },
      ])
    }
    const rate: Required<ConversationRate> = {
      fromCurrency: from,
      toCurrency: to,
      conversationRate: Math.round((fromValue / toValue) * 1_000_000) / 1_000_000,
      date: date ?? today(state),
    }
    return ok(rate)
  },
}
