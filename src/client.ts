import { type BankAccountsApi, createBankAccountsApi } from './bank-accounts/bank-accounts'
import {
  type BillingoOptions,
  createContext,
  type RequestOptions,
  type TarcaContext,
} from './core/context'
import { isBillingoError } from './core/errors'
import { type CurrenciesApi, createCurrenciesApi } from './currencies/currencies'
import { createOrganizationApi, type OrganizationApi } from './organization/organization'
import { createUtilsApi, type UtilsApi } from './utils/utils'

export type TarcaOptions = BillingoOptions

export interface Tarca {
  readonly bankAccounts: BankAccountsApi
  readonly currencies: CurrenciesApi
  readonly organization: OrganizationApi
  readonly utils: UtilsApi
  verifyCredentials(options?: RequestOptions): Promise<boolean>
}

export async function nullIfNotFound<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch (error) {
    if (isBillingoError(error) && error.isNotFound) return null
    throw error
  }
}

export function createTarcaFromContext(context: TarcaContext): Tarca {
  const organization = createOrganizationApi(context)
  return {
    bankAccounts: createBankAccountsApi(context),
    currencies: createCurrenciesApi(context),
    organization,
    utils: createUtilsApi(context),
    async verifyCredentials(options) {
      try {
        await organization.get(options)
        return true
      } catch (error) {
        if (isBillingoError(error) && error.category === 'auth') return false
        throw error
      }
    },
  }
}

export function createTarca(options: TarcaOptions = {}): Tarca {
  return createTarcaFromContext(createContext(options))
}
