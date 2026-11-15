import type { RequestOptions, TarcaContext } from '../core/context'
import { BillingoError } from '../core/errors'
import type { Id, ServerTime, TaxNumberCheckResponse } from '../generated/billingo'

export interface UtilsApi {
  serverTime(options?: RequestOptions): Promise<ServerTime>
  checkTaxNumber(taxNumber: string, options?: RequestOptions): Promise<TaxNumberCheckResponse>
  convertLegacyId(legacyId: number, options?: RequestOptions): Promise<Id>
}

const TAX_NUMBER = /^\d{8}-[1-5]-\d{2}$/

function invalidTaxNumber(): BillingoError {
  const message =
    'Az adószámot a teljes NNNNNNNN-N-NN alakban kell megadni (például 12345678-2-41), a 8 jegyű törzsszám nem elég.'
  return new BillingoError(message, {
    category: 'validation',
    operation: 'CheckTaxNumber',
    fieldErrors: [{ field: 'taxNumber', message }],
    hint: 'A Billingo a rövid vagy hibás alakú adószámra 422-es hibát ad, ezért a tárca a kérést el sem küldi.',
  })
}

export function createUtilsApi(context: TarcaContext): UtilsApi {
  return {
    serverTime: (options) =>
      context.json<ServerTime>({ operation: 'GetServerTime', signal: options?.signal }),
    async checkTaxNumber(taxNumber, options) {
      const normalized = taxNumber.trim()
      if (!TAX_NUMBER.test(normalized)) throw invalidTaxNumber()
      return context.json<TaxNumberCheckResponse>({
        operation: 'CheckTaxNumber',
        pathParams: { tax_number: normalized },
        signal: options?.signal,
      })
    },
    convertLegacyId: (legacyId, options) =>
      context.json<Id>({
        operation: 'GetId',
        pathParams: { id: legacyId },
        signal: options?.signal,
      }),
  }
}
