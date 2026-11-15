import { abortable, type RequestOptions } from '../core/context'
import { BillingoError, configurationError } from '../core/errors'
import type { DocumentBlocksApi } from '../document-blocks/document-blocks'
import type {
  Currency,
  DocumentBlockType,
  DocumentLanguage,
  PaymentMethod,
} from '../generated/billingo'
import { CURRENCIES, DOCUMENT_LANGUAGES, isOneOf, PAYMENT_METHODS } from './enums'

export interface TarcaDefaults {
  readonly blockId?: number | undefined
  readonly receiptBlockId?: number | undefined
  readonly bankAccountId?: number | undefined
  readonly paymentMethod?: PaymentMethod | undefined
  readonly language?: DocumentLanguage | undefined
  readonly currency?: Currency | undefined
  readonly dueInDays?: number | undefined
  readonly electronic?: boolean | undefined
  readonly sendEmail?: boolean | undefined
}

export interface ResolvedDefaults {
  readonly blockId: number | undefined
  readonly receiptBlockId: number | undefined
  readonly bankAccountId: number | undefined
  readonly paymentMethod: PaymentMethod | undefined
  readonly language: DocumentLanguage
  readonly currency: Currency
  readonly dueInDays: number
  readonly electronic: boolean
  readonly sendEmail: boolean
}

export const DEFAULT_DUE_IN_DAYS = 8

function describe(value: unknown): string {
  return typeof value === 'string' ? `„${value}”` : String(value)
}

function optionalId(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) {
    throw configurationError(
      `A defaults.${field} pozitív egész azonosító legyen, kapott: ${describe(value)}`,
    )
  }
  return value
}

function optionalFlag(value: boolean | undefined, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw configurationError(
      `A defaults.${field} true vagy false legyen, kapott: ${describe(value)}`,
    )
  }
  return value
}

function optionalChoice<T extends string>(
  values: readonly T[],
  value: T | undefined,
  field: string,
): T | undefined {
  if (value === undefined || isOneOf(values, value)) return value
  throw configurationError(
    `A defaults.${field} értéke nem ismert Billingo érték: ${describe(value)}. Lehetséges: ${values.join(', ')}`,
  )
}

export function resolveDefaults(defaults: TarcaDefaults = {}): ResolvedDefaults {
  const dueInDays = defaults.dueInDays ?? DEFAULT_DUE_IN_DAYS
  if (!Number.isSafeInteger(dueInDays) || dueInDays < 0) {
    throw configurationError(
      `A defaults.dueInDays nemnegatív egész szám legyen, kapott: ${describe(defaults.dueInDays)}`,
    )
  }
  return {
    blockId: optionalId(defaults.blockId, 'blockId'),
    receiptBlockId: optionalId(defaults.receiptBlockId, 'receiptBlockId'),
    bankAccountId: optionalId(defaults.bankAccountId, 'bankAccountId'),
    paymentMethod: optionalChoice(PAYMENT_METHODS, defaults.paymentMethod, 'paymentMethod'),
    language: optionalChoice(DOCUMENT_LANGUAGES, defaults.language, 'language') ?? 'hu',
    currency: optionalChoice(CURRENCIES, defaults.currency, 'currency') ?? 'HUF',
    dueInDays,
    electronic: optionalFlag(defaults.electronic, 'electronic', false),
    sendEmail: optionalFlag(defaults.sendEmail, 'sendEmail', false),
  }
}

export type BlockKind = Extract<DocumentBlockType, 'invoice' | 'receipt'>

export interface BlockResolver {
  resolve(kind: BlockKind, options?: RequestOptions): Promise<number>
}

function missingBlockError(kind: BlockKind): BillingoError {
  const setting = kind === 'invoice' ? 'blockId' : 'receiptBlockId'
  return new BillingoError(
    `Nincs ${kind === 'invoice' ? 'számla' : 'nyugta'} típusú („${kind}”) bizonylattömb a Billingo fiókban.`,
    {
      category: 'configuration',
      operation: 'ListDocumentBlock',
      hint: `Hozz létre egyet a Billingo felületén vagy a documentBlocks.create-tel, vagy add meg a createTarca({ defaults: { ${setting} } }) beállítást.`,
    },
  )
}

export function createBlockResolver(
  blocks: DocumentBlocksApi,
  defaults: ResolvedDefaults,
): BlockResolver {
  const cache = new Map<BlockKind, Promise<number>>()
  const lookup = async (kind: BlockKind): Promise<number> => {
    const page = await blocks.list({ type: kind, perPage: 100 })
    const id = page.data.find((block) => block.type === kind)?.id
    if (id === undefined) throw missingBlockError(kind)
    return id
  }
  return {
    async resolve(kind, options) {
      const configured = kind === 'invoice' ? defaults.blockId : defaults.receiptBlockId
      if (configured !== undefined) return configured
      options?.signal?.throwIfAborted()
      let pending = cache.get(kind)
      if (!pending) {
        const started = lookup(kind)
        cache.set(kind, started)
        started.catch(() => {
          if (cache.get(kind) === started) cache.delete(kind)
        })
        pending = started
      }
      return abortable(pending, options?.signal)
    },
  }
}
