import type { RequestOptions, TarcaContext } from '../core/context'
import { type DateInput, toBillingoDate } from '../core/dates'
import type { PaymentHistory, PaymentMethod } from '../generated/billingo'
import { assertValid, createInputCheck, describeValue, type InputCheck, type Wire } from './check'
import { PAYMENT_METHODS } from './enums'

export interface PaymentInput {
  readonly date: DateInput
  readonly price: number
  readonly paymentMethod: PaymentMethod
  readonly voucherNumber?: string
  readonly conversionRate?: number
}

export interface DocumentPaymentsApi {
  list(id: number, options?: RequestOptions): Promise<PaymentHistory[]>
  replace(
    id: number,
    payments: readonly PaymentInput[],
    options?: RequestOptions,
  ): Promise<PaymentHistory[]>
  add(id: number, payment: PaymentInput, options?: RequestOptions): Promise<PaymentHistory[]>
  clear(id: number, options?: RequestOptions): Promise<void>
}

function checkPayment(check: InputCheck, payment: PaymentInput, field: string): void {
  if (typeof payment !== 'object' || payment === null) {
    check.fail(field, 'A befizetés objektum legyen.')
    return
  }
  check.convert(`${field}.date`, () => toBillingoDate(payment.date))
  check.finite(payment.price, `${field}.price`)
  check.choice(PAYMENT_METHODS, payment.paymentMethod, `${field}.paymentMethod`, 'fizetési mód')
  const rate = payment.conversionRate
  if (rate !== undefined && !(Number.isFinite(rate) && rate > 0)) {
    check.fail(`${field}.conversionRate`, `Pozitív szám kell, kapott: ${describeValue(rate)}.`)
  }
}

function toWirePayment(payment: PaymentInput): Wire<PaymentHistory> {
  return {
    date: toBillingoDate(payment.date),
    price: payment.price,
    paymentMethod: payment.paymentMethod,
    voucherNumber: payment.voucherNumber,
    conversionRate: payment.conversionRate,
  }
}

function fromHistory(payment: PaymentHistory): PaymentInput {
  return {
    date: payment.date,
    price: payment.price,
    paymentMethod: payment.paymentMethod,
    ...(payment.voucherNumber == null ? {} : { voucherNumber: payment.voucherNumber }),
    ...(payment.conversionRate == null ? {} : { conversionRate: payment.conversionRate }),
  }
}

export function createDocumentPaymentsApi(context: TarcaContext): DocumentPaymentsApi {
  const list = (id: number, options?: RequestOptions): Promise<PaymentHistory[]> =>
    context.json<PaymentHistory[]>({
      operation: 'GetPayment',
      pathParams: { id },
      signal: options?.signal,
    })
  const replace = async (
    id: number,
    payments: readonly PaymentInput[],
    options?: RequestOptions,
  ): Promise<PaymentHistory[]> => {
    const check = createInputCheck()
    if (!Array.isArray(payments)) {
      check.fail('payments', 'A befizetések tömbje kell (üres tömb: minden befizetés törlése).')
    } else {
      payments.forEach((payment, index) => {
        checkPayment(check, payment, `payments.${index}`)
      })
    }
    assertValid(check, 'UpdatePayment', 'befizetés')
    return context.json<PaymentHistory[]>({
      operation: 'UpdatePayment',
      pathParams: { id },
      body: payments.map(toWirePayment),
      signal: options?.signal,
    })
  }
  return {
    list,
    replace,
    async add(id, payment, options) {
      const check = createInputCheck()
      checkPayment(check, payment, 'payment')
      assertValid(check, 'UpdatePayment', 'befizetés')
      const existing = await list(id, options)
      return replace(id, [...existing.map(fromHistory), payment], options)
    },
    clear: (id, options) =>
      context.empty({ operation: 'DeletePayment', pathParams: { id }, signal: options?.signal }),
  }
}
