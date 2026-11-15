import { type BankAccountsApi, createBankAccountsApi } from './bank-accounts/bank-accounts'
import {
  type BillingoOptions,
  createContext,
  type RequestOptions,
  type TarcaContext,
} from './core/context'
import { isBillingoError } from './core/errors'
import { type OnceGuard, onceScopeOf, transportIdentity } from './core/once-guard'
import type { KeyValueStore } from './core/store'
import { type CurrenciesApi, createCurrenciesApi } from './currencies/currencies'
import { createDocumentBlocksApi, type DocumentBlocksApi } from './document-blocks/document-blocks'
import { createBlockResolver, resolveDefaults, type TarcaDefaults } from './documents/defaults'
import { createDocumentsApi, type DocumentsApi } from './documents/documents'
import { createExportsApi, type ExportsApi } from './exports/exports'
import { createInventoryApi, type InventoryApi } from './inventory/inventory'
import { createOrganizationApi, type OrganizationApi } from './organization/organization'
import { createPartnersApi, type PartnersApi } from './partners/partners'
import { createProductsApi, type ProductsApi } from './products/products'
import { createReceiptsApi, type ReceiptsApi } from './receipts/receipts'
import { createSpendingsApi, type SpendingsApi } from './spendings/spendings'
import { createUtilsApi, type UtilsApi } from './utils/utils'

export interface TarcaOptions extends BillingoOptions {
  readonly defaults?: TarcaDefaults | undefined
  readonly createOnceLock?: KeyValueStore | undefined
}

export interface TarcaSettings {
  readonly defaults?: TarcaDefaults | undefined
  readonly once?: OnceGuard | undefined
}

export interface Tarca {
  readonly bankAccounts: BankAccountsApi
  readonly currencies: CurrenciesApi
  readonly documentBlocks: DocumentBlocksApi
  readonly documents: DocumentsApi
  readonly exports: ExportsApi
  readonly inventory: InventoryApi
  readonly organization: OrganizationApi
  readonly partners: PartnersApi
  readonly products: ProductsApi
  readonly receipts: ReceiptsApi
  readonly spendings: SpendingsApi
  readonly utils: UtilsApi
  verifyCredentials(options?: RequestOptions): Promise<boolean>
}

export function createTarcaFromContext(context: TarcaContext, settings: TarcaSettings = {}): Tarca {
  const defaults = resolveDefaults(settings.defaults)
  const guard = settings.once ?? { scope: crypto.randomUUID() }
  const organization = createOrganizationApi(context)
  const documentBlocks = createDocumentBlocksApi(context)
  const partners = createPartnersApi(context)
  const blocks = createBlockResolver(documentBlocks, defaults)
  const documents = createDocumentsApi(context, { partners, blocks, defaults, guard })
  return {
    bankAccounts: createBankAccountsApi(context),
    currencies: createCurrenciesApi(context),
    documentBlocks,
    documents,
    exports: createExportsApi(context),
    inventory: createInventoryApi(context),
    organization,
    partners,
    products: createProductsApi(context),
    receipts: createReceiptsApi(context, { partners, blocks, defaults, guard, query: documents }),
    spendings: createSpendingsApi(context),
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
  const context = createContext(options)
  return createTarcaFromContext(context, {
    defaults: options.defaults,
    once: {
      scope: onceScopeOf(options),
      transport: transportIdentity(options.fetch),
      lock: options.createOnceLock,
      warn: options.hooks?.onWarning,
    },
  })
}
