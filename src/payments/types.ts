import type { KeyValueStore } from '../core/store'
import type { PaymentMethod, ReceiptVat, Vat } from '../generated/billingo'

export type PaymentProvider =
  | 'stripe'
  | 'simplepay'
  | 'barion'
  | 'revolut'
  | 'paypal'
  | (string & {})

export type PaymentEventKind = 'paid' | 'refunded' | 'partially-refunded' | 'failed' | 'other'

export interface PaymentAmount {
  readonly value: number
  readonly minor: number
  readonly currency: string
}

export type PaymentVat = number | Vat | ReceiptVat

export interface PaymentAddress {
  readonly country?: string | undefined
  readonly zip?: string | undefined
  readonly city?: string | undefined
  readonly line1?: string | undefined
  readonly line2?: string | undefined
}

export interface PaymentCustomer {
  readonly name?: string | undefined
  readonly email?: string | undefined
  readonly phone?: string | undefined
  readonly taxNumber?: string | undefined
  readonly euTaxNumber?: string | undefined
  readonly isBusiness?: boolean | undefined
  readonly address?: PaymentAddress | undefined
}

export interface PaymentLineItem {
  readonly name: string
  readonly quantity: number
  readonly totalGross: PaymentAmount
  readonly unit?: string | undefined
  readonly sku?: string | undefined
  readonly vat?: PaymentVat | undefined
}

export interface PaymentRefund {
  readonly id: string
  readonly amount: PaymentAmount
  readonly refundedBefore?: PaymentAmount | undefined
  readonly createdAt?: string | undefined
}

export interface PaymentEvent {
  readonly provider: PaymentProvider
  readonly kind: PaymentEventKind
  readonly id: string
  readonly eventId?: string | undefined
  readonly eventType?: string | undefined
  readonly orderRef?: string | undefined
  readonly amount?: PaymentAmount | undefined
  readonly refundedAmount?: PaymentAmount | undefined
  readonly refunds?: readonly PaymentRefund[] | undefined
  readonly paidAt?: string | undefined
  readonly method: PaymentMethod
  readonly customer?: PaymentCustomer | undefined
  readonly items?: readonly PaymentLineItem[] | undefined
  readonly raw: unknown
}

export type PaymentHandler = (payment: PaymentEvent) => unknown

export type DedupeStoreOperation = 'get' | 'set'

export interface PaymentWarning {
  readonly kind: 'dedupe'
  readonly operation: DedupeStoreOperation
  readonly message: string
  readonly error: unknown
}

export interface PaymentWebhookBaseOptions {
  readonly onPayment: PaymentHandler
  readonly onError?: ((error: unknown) => void) | undefined
  readonly onWarning?: ((warning: PaymentWarning) => void) | undefined
  readonly dedupe?: KeyValueStore | undefined
  readonly dedupeTtlSeconds?: number | undefined
  readonly maxBodyBytes?: number | undefined
  readonly method?: PaymentMethod | undefined
  readonly fetch?: typeof globalThis.fetch | undefined
}
