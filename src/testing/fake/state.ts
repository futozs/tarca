import { addBudapestDays, toBudapestDate } from '../../core/dates'
import type {
  BankAccount,
  Currency,
  Document,
  DocumentBlockSchema,
  DocumentExportQueryType,
  DocumentExportType,
  DocumentItem,
  Feature,
  Partner,
  PaymentHistory,
  Product,
  Spending,
  TaxpayerAddress,
} from '../../generated/billingo'

export type FakeBankAccount = Required<BankAccount>

export type FakeDocumentBlock = Required<DocumentBlockSchema>

export type FakePartner = Required<Partner>

export type FakeProduct = Required<Product>

export type FakeSpending = Required<Spending>

export type FakeDocumentItem = Required<DocumentItem>

export type FakePayment = Required<PaymentHistory>

export type FakeDocument = Omit<Required<Document>, 'items'> & {
  readonly items: readonly FakeDocumentItem[]
}

export interface FakeDocumentRecord {
  readonly document: FakeDocument
  readonly vendorId: string | undefined
  readonly issuedAt: Date
  readonly modifiedAt: Date
  readonly archived?: boolean
  readonly payments?: readonly FakePayment[]
}

export interface FakeDocumentExport {
  readonly id: string
  readonly queryType: DocumentExportQueryType
  readonly startDate: string
  readonly endDate: string
  readonly exportType: DocumentExportType
  readonly documentBlockId: number | undefined
  readonly polls: number
}

export interface FakeTaxpayer {
  readonly name: string
  readonly shortName?: string | undefined
  readonly addresses?: readonly TaxpayerAddress[] | undefined
}

export interface FakeSubscription {
  readonly expirationDate?: string | undefined
  readonly features?: readonly Feature[] | undefined
}

export interface FakeBillingoStateOptions {
  readonly now?: (() => Date) | undefined
  readonly apiKeys?: readonly string[] | undefined
  readonly taxCode?: string | undefined
  readonly hasNavConnection?: boolean | undefined
  readonly subscription?: FakeSubscription | undefined
  readonly hufRates?: Readonly<Partial<Record<Currency, number>>> | undefined
  readonly taxpayers?: Readonly<Record<string, FakeTaxpayer>> | undefined
  readonly legacyIds?: Readonly<Record<number, number>> | undefined
  readonly stock?: Readonly<Record<string, number>> | undefined
  readonly navRecordDelayMs?: number | undefined
}

export interface FakeBillingoConfig {
  readonly now: () => Date
  readonly apiKeys: ReadonlySet<string> | undefined
  readonly taxCode: string
  readonly hasNavConnection: boolean
  readonly subscription: {
    readonly expirationDate: string
    readonly features: readonly Feature[]
  }
  readonly hufRates: Readonly<Partial<Record<Currency, number>>>
  readonly taxpayers: Readonly<Record<string, FakeTaxpayer>>
  readonly legacyIds: ReadonlyMap<number, number>
  readonly stock: Readonly<Record<string, number>> | undefined
  readonly navRecordDelayMs: number
}

export interface FakeBillingoData {
  readonly documentBlocks: Map<number, FakeDocumentBlock>
  readonly bankAccounts: Map<number, FakeBankAccount>
  readonly partners: Map<number, FakePartner>
  readonly products: Map<number, FakeProduct>
  readonly spendings: Map<number, FakeSpending>
  readonly documentExports: Map<string, FakeDocumentExport>
  readonly documents: Map<number, FakeDocumentRecord>
}

export type FakeBillingoDataView = {
  readonly [K in keyof FakeBillingoData]: FakeBillingoData[K] extends Map<infer Key, infer Value>
    ? ReadonlyMap<Key, Value>
    : never
}

export interface FakeBillingoState extends FakeBillingoData {
  readonly config: FakeBillingoConfig
  readonly sequences: Map<string, number>
}

export const DEFAULT_TAX_CODE = '00000000-0-00'

export const DEFAULT_NAV_RECORD_DELAY_MS = 10_000

const DEFAULT_HUF_RATES: Readonly<Partial<Record<Currency, number>>> = {
  EUR: 390,
  USD: 360,
  GBP: 460,
  CHF: 410,
}

export const DOCUMENT_BLOCK_DEFAULTS: Omit<FakeDocumentBlock, 'id' | 'name' | 'prefix' | 'type'> = {
  customField1: '',
  customField2: '',
  templateId: 0,
  picPath: null,
  normalNotificationId: 0,
  proformaNotificationId: 0,
  generated: false,
  invoiceNumberFormat: 'default',
  senderEmail: null,
  senderName: '',
  bccEmail: null,
  createInvoiceFromPaidProforma: false,
  fulfillmentDateFromProformaPaymentDate: false,
  attachXmlToInvoicePdf: false,
  advancePaidInstant: false,
  financialFulfillmentHighlight: 'basic',
  entitlementsInDocumentComment: false,
  bankAccountId: null,
}

const SEEDED_DOCUMENT_BLOCKS: readonly Omit<FakeDocumentBlock, 'id'>[] = [
  { name: 'Számlák', prefix: '', type: 'invoice', ...DOCUMENT_BLOCK_DEFAULTS },
  { name: 'Nyugták', prefix: 'NYT', type: 'receipt', ...DOCUMENT_BLOCK_DEFAULTS },
]

function taxpayerKey(taxNumber: string): string {
  return taxNumber.replace(/\D/g, '').slice(0, 8)
}

function checkedRates(
  rates: Readonly<Partial<Record<Currency, number>>>,
): Readonly<Partial<Record<Currency, number>>> {
  for (const [currency, rate] of Object.entries(rates)) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new TypeError(
        `A hufRates.${currency} értéke pozitív szám legyen (1 ${currency} hány forint), kapott: ${String(rate)}`,
      )
    }
  }
  return rates
}

function checkedLegacyIds(legacyIds: Readonly<Record<number, number>>): Map<number, number> {
  const map = new Map<number, number>()
  for (const [legacy, id] of Object.entries(legacyIds)) {
    const legacyId = Number(legacy)
    if (!Number.isInteger(legacyId) || legacyId < 1 || !Number.isInteger(id) || id < 1) {
      throw new TypeError(
        `A legacyIds kulcsa és értéke pozitív egész legyen, kapott: ${legacy} → ${String(id)}`,
      )
    }
    map.set(legacyId, id)
  }
  return map
}

function checkedStock(
  stock: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  for (const [sku, quantity] of Object.entries(stock ?? {})) {
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
      throw new TypeError(
        `A stock.${sku} értéke véges szám legyen (a termék elérhető készlete), kapott: ${String(quantity)}`,
      )
    }
  }
  return stock
}

function checkedNavRecordDelay(delay: number): number {
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError(
      `A navRecordDelayMs nemnegatív szám legyen (ennyi idő után lesz NAV rekordja egy kiállított bizonylatnak), kapott: ${String(delay)}`,
    )
  }
  return delay
}

export function nextId(state: FakeBillingoState, sequence: string): number {
  const next = (state.sequences.get(sequence) ?? 0) + 1
  state.sequences.set(sequence, next)
  return next
}

export function today(state: FakeBillingoState): string {
  return toBudapestDate(state.config.now())
}

export function nextDocumentNumber(state: FakeBillingoState, blockId: number): string {
  const block = state.documentBlocks.get(blockId)
  if (!block) throw new RangeError(`Nincs ${blockId} azonosítójú számlatömb a hamis Billingóban.`)
  const year = today(state).slice(0, 4)
  const serial = String(nextId(state, `document-number:${blockId}:${year}`)).padStart(6, '0')
  return block.prefix === '' ? `${year}-${serial}` : `${block.prefix}-${year}-${serial}`
}

export function findTaxpayer(
  state: FakeBillingoState,
  taxNumber: string,
): FakeTaxpayer | undefined {
  return state.config.taxpayers[taxpayerKey(taxNumber)]
}

export function createState(options: FakeBillingoStateOptions = {}): FakeBillingoState {
  const now = options.now ?? (() => new Date())
  const state: FakeBillingoState = {
    config: {
      now,
      apiKeys: options.apiKeys === undefined ? undefined : new Set(options.apiKeys),
      taxCode: options.taxCode ?? DEFAULT_TAX_CODE,
      hasNavConnection: options.hasNavConnection ?? false,
      subscription: {
        expirationDate: options.subscription?.expirationDate ?? addBudapestDays(now(), 1),
        features: options.subscription?.features ?? [],
      },
      hufRates: checkedRates(options.hufRates ?? DEFAULT_HUF_RATES),
      taxpayers: Object.fromEntries(
        Object.entries(options.taxpayers ?? {}).map(([taxNumber, taxpayer]) => [
          taxpayerKey(taxNumber),
          taxpayer,
        ]),
      ),
      legacyIds: checkedLegacyIds(options.legacyIds ?? {}),
      stock: checkedStock(options.stock),
      navRecordDelayMs: checkedNavRecordDelay(
        options.navRecordDelayMs ?? DEFAULT_NAV_RECORD_DELAY_MS,
      ),
    },
    sequences: new Map(),
    documentBlocks: new Map(),
    bankAccounts: new Map(),
    partners: new Map(),
    products: new Map(),
    spendings: new Map(),
    documentExports: new Map(),
    documents: new Map(),
  }
  for (const block of SEEDED_DOCUMENT_BLOCKS) {
    const id = nextId(state, 'documentBlocks')
    state.documentBlocks.set(id, { id, ...block })
  }
  return state
}
