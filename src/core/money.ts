import type {
  DocumentItem,
  DocumentSummary,
  DocumentVatRateSummary,
  Vat,
} from '../generated/billingo'

export interface PricedLine {
  readonly unitPrice: number
  readonly unitPriceType: 'net' | 'gross'
  readonly quantity: number
  readonly vat: Vat
}

export type LineAmounts = Required<
  Pick<DocumentItem, 'netUnitAmount' | 'netAmount' | 'vatAmount' | 'grossAmount'>
>

export interface DocumentTotals {
  readonly grossTotal: number
  readonly summary: Required<DocumentSummary>
}

export function roundHalfUp(value: number, decimals: number): number {
  const sign = value < 0 ? -1 : 1
  const [mantissa, exponent = '0'] = String(Math.abs(value)).split('e')
  const shifted = Math.round(Number(`${mantissa}e${Number(exponent) + decimals}`))
  const rounded = sign * Number(`${shifted}e-${decimals}`)
  return Object.is(rounded, -0) ? 0 : rounded
}

export function nextMicroAbove(value: number): number {
  const sign = value < 0 ? -1 : 1
  const [mantissa, exponent = '0'] = String(Math.abs(value)).split('e')
  const micros = Math.floor(Number(`${mantissa}e${Number(exponent) + 6}`)) + 1
  return sign * Number(`${micros}e-6`)
}

export function vatPercentage(vat: Vat): number {
  const match = /^(\d+(?:,\d+)?)%$/.exec(vat)
  return match?.[1] ? roundHalfUp(Number(match[1].replace(',', '.')) / 100, 6) : 0
}

export function lineAmounts(line: PricedLine): LineAmounts {
  const rate = vatPercentage(line.vat)
  if (line.unitPriceType === 'net') {
    const netAmount = roundHalfUp(line.unitPrice * line.quantity, 2)
    const vatAmount = roundHalfUp(netAmount * rate, 2)
    return {
      netUnitAmount: line.unitPrice,
      netAmount,
      vatAmount,
      grossAmount: roundHalfUp(netAmount + vatAmount, 2),
    }
  }
  const grossAmount = roundHalfUp(line.unitPrice * line.quantity, 2)
  const netAmount = roundHalfUp(grossAmount / (1 + rate), 2)
  return {
    netUnitAmount: nextMicroAbove(line.unitPrice / (1 + rate)),
    netAmount,
    vatAmount: roundHalfUp(grossAmount - netAmount, 2),
    grossAmount,
  }
}

export function negatedAmounts(amounts: LineAmounts): LineAmounts {
  return {
    netUnitAmount: -amounts.netUnitAmount,
    netAmount: -amounts.netAmount,
    vatAmount: -amounts.vatAmount,
    grossAmount: -amounts.grossAmount,
  }
}

interface RateBucket {
  readonly vat: Vat
  net: number
  tax: number
  gross: number
}

export function documentTotals(
  items: readonly (LineAmounts & { readonly vat: Vat })[],
  conversionRate: number,
): DocumentTotals {
  const buckets = new Map<Vat, RateBucket>()
  for (const item of items) {
    const bucket = buckets.get(item.vat) ?? { vat: item.vat, net: 0, tax: 0, gross: 0 }
    bucket.net += item.netAmount
    bucket.tax += item.vatAmount
    bucket.gross += item.grossAmount
    buckets.set(item.vat, bucket)
  }
  const rates = [...buckets.values()]
  const netAmount = roundHalfUp(
    rates.reduce((sum, bucket) => sum + bucket.net, 0),
    2,
  )
  const vatAmount = roundHalfUp(
    rates.reduce((sum, bucket) => sum + bucket.net * vatPercentage(bucket.vat), 0),
    2,
  )
  const grossTotal = roundHalfUp(netAmount + vatAmount, 2)
  const vatRateSummary: Required<DocumentVatRateSummary>[] = rates.map((bucket) => {
    const rate = vatPercentage(bucket.vat)
    return {
      vatName: bucket.vat,
      vatPercentage: rate,
      vatRateNetAmount: roundHalfUp(bucket.net, 2),
      vatRateVatAmount: roundHalfUp(bucket.tax, 2),
      vatRateVatAmountLocal: roundHalfUp(bucket.net * conversionRate * rate, 0),
      vatRateGrossAmount: roundHalfUp(bucket.gross, 2),
    }
  })
  return {
    grossTotal,
    summary: {
      netAmount,
      netAmountLocal: roundHalfUp(netAmount * conversionRate, 6),
      grossAmountLocal: roundHalfUp(grossTotal * conversionRate, 6),
      vatAmount,
      vatAmountLocal: roundHalfUp(vatAmount * conversionRate, 0),
      vatRateSummary,
    },
  }
}
