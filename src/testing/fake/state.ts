import { addBudapestDays, toBudapestDate } from '../../core/dates'
import type {
  BankAccount,
  Currency,
  DocumentBlock,
  Feature,
  TaxpayerAddress,
} from '../../generated/billingo'

export type FakeBankAccount = Required<BankAccount>

export type FakeDocumentBlock = Required<DocumentBlock>

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
}

export interface FakeBillingoData {
  readonly documentBlocks: Map<number, FakeDocumentBlock>
  readonly bankAccounts: Map<number, FakeBankAccount>
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

const DEFAULT_HUF_RATES: Readonly<Partial<Record<Currency, number>>> = {
  EUR: 390,
  USD: 360,
  GBP: 460,
  CHF: 410,
}

const SEEDED_DOCUMENT_BLOCKS: readonly Omit<FakeDocumentBlock, 'id'>[] = [
  { name: 'Számlák', prefix: '', customField1: '', customField2: '', type: 'invoice' },
  { name: 'Nyugták', prefix: 'NYT', customField1: '', customField2: '', type: 'receipt' },
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
    },
    sequences: new Map(),
    documentBlocks: new Map(),
    bankAccounts: new Map(),
  }
  for (const block of SEEDED_DOCUMENT_BLOCKS) {
    const id = nextId(state, 'documentBlocks')
    state.documentBlocks.set(id, { id, ...block })
  }
  return state
}
