import { toBudapestTimestamp } from '../../core/dates'
import type { ServerTime, TaxNumberCheckResponse } from '../../generated/billingo'
import {
  clientError,
  FAKE_BILLINGO_MESSAGES,
  type FakeRoutes,
  ok,
  positiveIntegerParam,
  validationFailed,
} from './http'
import { findTaxpayer } from './state'

const TAX_NUMBER = /^([0-9]{8})-([12345])-([0-9]{2})$/

export const LEGACY_ID_NOT_FOUND = 'Legacy id is not found.'

export const utilsRoutes: FakeRoutes = {
  GetServerTime: (state) => {
    const now = state.config.now()
    const w3c = toBudapestTimestamp(now)
    const time: Required<ServerTime> = {
      epoch: Math.floor(now.getTime() / 1000),
      formatted: w3c.slice(0, 19).replace('T', ' '),
      w3c,
      timezone: 'Europe/Budapest',
    }
    return ok(time)
  },
  CheckTaxNumber: (state, request) => {
    const taxNumber = request.params.tax_number ?? ''
    if (!TAX_NUMBER.test(taxNumber)) {
      return validationFailed([
        { field: 'taxNumber', message: FAKE_BILLINGO_MESSAGES.taxNumberFormat },
      ])
    }
    if (!state.config.hasNavConnection) {
      return clientError(401, FAKE_BILLINGO_MESSAGES.navConnectionRequired)
    }
    const taxpayer = findTaxpayer(state, taxNumber)
    const result: TaxNumberCheckResponse = taxpayer
      ? {
          taxNumber,
          result: 'validation_ok',
          taxpayerName: taxpayer.name,
          taxpayerShortName: taxpayer.shortName ?? null,
          addresses: taxpayer.addresses ?? [],
        }
      : {
          taxNumber,
          result: 'non_exist_tax_number',
          taxpayerName: null,
          taxpayerShortName: null,
          addresses: null,
        }
    return ok(result)
  },
  GetId: (state, request) => {
    const legacyId = positiveIntegerParam(request, 'id')
    const id = legacyId === undefined ? undefined : state.config.legacyIds.get(legacyId)
    if (legacyId === undefined || id === undefined) return clientError(404, LEGACY_ID_NOT_FOUND)
    return ok({ id, legacyId })
  },
}
