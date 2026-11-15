import { BillingoError } from '../core/errors'

export interface RefundableItem<V extends string = string> {
  readonly name: string
  readonly vat: V
  readonly grossMinor: number
  readonly unit?: string | undefined
  readonly sku?: string | undefined
}

export interface RefundAllocation<V extends string = string> {
  readonly index: number
  readonly name: string
  readonly vat: V
  readonly grossMinor: number
  readonly unit?: string | undefined
  readonly sku?: string | undefined
}

export interface AllocateRefundOptions {
  readonly refundedBeforeMinor?: number | undefined
}

function invalid(message: string): BillingoError {
  return new BillingoError(message, { category: 'validation' })
}

function minorOf(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw invalid(`A(z) ${field} egész szám legyen a pénznem váltóegységében, kapott: ${value}`)
  }
  return BigInt(value)
}

function outranks(
  weights: readonly bigint[],
  first: number,
  firstUnit: bigint,
  second: number,
  secondUnit: bigint,
): boolean {
  const left = (weights[first] ?? 0n) * (2n * secondUnit + 1n)
  const right = (weights[second] ?? 0n) * (2n * firstUnit + 1n)
  if (left !== right) return left > right
  return first < second
}

function bestOpen(weights: readonly bigint[], shares: readonly bigint[]): number {
  let best = -1
  for (let index = 0; index < weights.length; index++) {
    const share = shares[index] ?? 0n
    if (share >= (weights[index] ?? 0n)) continue
    if (best === -1 || outranks(weights, index, share, best, shares[best] ?? 0n)) best = index
  }
  return best
}

function worstTaken(weights: readonly bigint[], shares: readonly bigint[]): number {
  let worst = -1
  for (let index = 0; index < weights.length; index++) {
    const share = shares[index] ?? 0n
    if (share === 0n) continue
    if (worst === -1 || outranks(weights, worst, (shares[worst] ?? 0n) - 1n, index, share - 1n)) {
      worst = index
    }
  }
  return worst
}

function apportion(weights: readonly bigint[], amount: bigint): bigint[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (amount === 0n || total === 0n) return weights.map(() => 0n)
  if (amount === total) return [...weights]
  const shares = weights.map((weight) => (amount * weight) / total)
  let left = amount - shares.reduce((sum, share) => sum + share, 0n)
  while (left > 0n) {
    const best = bestOpen(weights, shares)
    shares[best] = (shares[best] ?? 0n) + 1n
    left -= 1n
  }
  for (;;) {
    const best = bestOpen(weights, shares)
    const worst = worstTaken(weights, shares)
    if (best === -1 || worst === -1 || best === worst) break
    if (!outranks(weights, best, shares[best] ?? 0n, worst, (shares[worst] ?? 0n) - 1n)) break
    shares[best] = (shares[best] ?? 0n) + 1n
    shares[worst] = (shares[worst] ?? 0n) - 1n
  }
  return shares
}

export function allocateRefund<V extends string = string>(
  items: readonly RefundableItem<V>[],
  refundMinor: number,
  options: AllocateRefundOptions = {},
): RefundAllocation<V>[] {
  if (items.length === 0) throw invalid('A visszatérítés szétosztásához legalább egy tétel kell.')
  const gross = items.map((item, index) => {
    const minor = minorOf(item.grossMinor, `${index + 1}. tétel bruttó összege`)
    if (minor < 0n) throw invalid(`A(z) ${index + 1}. tétel bruttó összege negatív.`)
    return minor
  })
  const total = gross.reduce((sum, value) => sum + value, 0n)
  const refund = minorOf(refundMinor, 'visszatérített összeg')
  const before = minorOf(options.refundedBeforeMinor ?? 0, 'korábban visszatérített összeg')
  if (refund <= 0n) throw invalid('A visszatérített összeg legyen pozitív.')
  if (before < 0n) throw invalid('A korábban visszatérített összeg nem lehet negatív.')
  if (before + refund > total) {
    throw invalid(
      `A visszatérítések összege (${before + refund}) nagyobb, mint az eredeti bizonylat bruttó összege (${total}), a pénznem váltóegységében.`,
    )
  }
  const earlier = apportion(gross, before)
  const cumulative = apportion(gross, before + refund)
  return items.flatMap((item, index) => {
    const share = (cumulative[index] ?? 0n) - (earlier[index] ?? 0n)
    if (share === 0n) return []
    const allocation: RefundAllocation<V> = {
      index,
      name: item.name,
      vat: item.vat,
      grossMinor: Number(share),
      ...(item.unit === undefined ? {} : { unit: item.unit }),
      ...(item.sku === undefined ? {} : { sku: item.sku }),
    }
    return [allocation]
  })
}
