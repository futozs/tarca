import type { RequestOptions, TarcaContext } from '../core/context'
import type { Id, ServerTime, TaxNumberCheckResponse } from '../generated/billingo'

export interface UtilsApi {
  serverTime(options?: RequestOptions): Promise<ServerTime>
  checkTaxNumber(taxNumber: string, options?: RequestOptions): Promise<TaxNumberCheckResponse>
  convertLegacyId(legacyId: number, options?: RequestOptions): Promise<Id>
}

export function createUtilsApi(context: TarcaContext): UtilsApi {
  return {
    serverTime: (options) =>
      context.json<ServerTime>({ operation: 'GetServerTime', signal: options?.signal }),
    checkTaxNumber: (taxNumber, options) =>
      context.json<TaxNumberCheckResponse>({
        operation: 'CheckTaxNumber',
        pathParams: { tax_number: taxNumber.trim() },
        signal: options?.signal,
      }),
    convertLegacyId: (legacyId, options) =>
      context.json<Id>({
        operation: 'GetId',
        pathParams: { id: legacyId },
        signal: options?.signal,
      }),
  }
}
