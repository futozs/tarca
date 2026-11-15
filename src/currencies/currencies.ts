import type { RequestOptions, TarcaContext } from '../core/context'
import { type DateInput, toBillingoDate } from '../core/dates'
import type { ConversationRate, Currency } from '../generated/billingo'

export interface ConversionRateQuery {
  readonly from: Currency
  readonly to: Currency
  readonly date?: DateInput
}

export interface ConversionRate {
  readonly from: Currency
  readonly to: Currency
  readonly rate: number
  readonly date: string | undefined
}

export interface CurrenciesApi {
  rate(query: ConversionRateQuery, options?: RequestOptions): Promise<ConversionRate>
}

export function createCurrenciesApi(context: TarcaContext): CurrenciesApi {
  return {
    async rate(query, options) {
      const response = await context.json<ConversationRate>({
        operation: 'GetConversionRate',
        query: {
          from: query.from,
          to: query.to,
          date: query.date === undefined ? undefined : toBillingoDate(query.date),
        },
        signal: options?.signal,
      })
      if (typeof response.conversationRate !== 'number') {
        throw new RangeError(
          `A Billingo árfolyam válaszából hiányzik az árfolyam (${query.from} → ${query.to}).`,
        )
      }
      return {
        from: response.fromCurrency ?? query.from,
        to: response.toCurrency ?? query.to,
        rate: response.conversationRate,
        date: response.date,
      }
    },
  }
}
