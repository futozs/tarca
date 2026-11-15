import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { allocateRefund } from '../../src/payments/refund'

const RUNS = { numRuns: 400 }
const vat = fc.constantFrom('27%', '18%', '5%', '0%', 'AAM', 'TAM', 'EU', '5,5%')
const items = fc
  .array(
    fc.record({
      name: fc.constant('T'),
      vat,
      grossMinor: fc.integer({ min: 0, max: 100_000_000 }),
    }),
    { minLength: 1, maxLength: 12 },
  )
  .filter((list) => list.some((item) => item.grossMinor > 0))

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

describe('allocateRefund invariánsai', () => {
  test('a szétosztás összege pontosan a visszatérítés, tételenként 0 és az eredeti között', () => {
    fc.assert(
      fc.property(items, fc.double({ min: 0, max: 1, noNaN: true }), (list, fraction) => {
        const total = sum(list.map((item) => item.grossMinor))
        const refund = Math.max(1, Math.floor(total * fraction))
        const allocation = allocateRefund(list, refund)
        expect(sum(allocation.map((entry) => entry.grossMinor))).toBe(refund)
        for (const entry of allocation) {
          expect(Number.isSafeInteger(entry.grossMinor)).toBe(true)
          expect(entry.grossMinor).toBeGreaterThan(0)
          expect(entry.grossMinor).toBeLessThanOrEqual(list[entry.index]?.grossMinor ?? -1)
          expect(entry.vat).toBe(list[entry.index]?.vat)
        }
      }),
      RUNS,
    )
  })

  test('egymást követő visszatérítések tételenként sem lépik túl az eredetit', () => {
    fc.assert(
      fc.property(
        items,
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 10 }),
        (list, weights) => {
          const total = sum(list.map((item) => item.grossMinor))
          const weightSum = sum(weights)
          const refunds = weights
            .map((weight) => Math.floor((total * weight) / weightSum))
            .filter((value) => value > 0)
          const perItem = list.map(() => 0)
          let before = 0
          for (const refund of refunds) {
            for (const entry of allocateRefund(list, refund, { refundedBeforeMinor: before })) {
              perItem[entry.index] = (perItem[entry.index] ?? 0) + entry.grossMinor
            }
            before += refund
          }
          for (const [index, item] of list.entries()) {
            expect(perItem[index]).toBeLessThanOrEqual(item.grossMinor)
          }
          expect(sum(perItem)).toBe(before)
        },
      ),
      RUNS,
    )
  })
})

describe('allocateRefund útfüggetlensége', () => {
  test('ugyanaz az összeg egyben vagy részletekben ugyanazt a tételenkénti végeredményt adja', () => {
    fc.assert(
      fc.property(
        items,
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 8 }),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (list, weights, fraction) => {
          const total = sum(list.map((item) => item.grossMinor))
          const target = Math.max(weights.length, Math.floor(total * fraction))
          if (target > total) return
          const weightSum = sum(weights)
          const parts = weights.map((weight) =>
            Math.max(1, Math.floor((target * weight) / weightSum)),
          )
          const partSum = sum(parts)
          if (partSum > total) return
          const stepwise = list.map(() => 0)
          let before = 0
          for (const part of parts) {
            for (const entry of allocateRefund(list, part, { refundedBeforeMinor: before })) {
              stepwise[entry.index] = (stepwise[entry.index] ?? 0) + entry.grossMinor
            }
            before += part
          }
          const single = list.map(() => 0)
          for (const entry of allocateRefund(list, partSum)) single[entry.index] = entry.grossMinor
          expect(stepwise).toEqual(single)
        },
      ),
      RUNS,
    )
  })

  test('a teljes összeg visszatérítése pontosan az eredeti tételeket adja', () => {
    fc.assert(
      fc.property(items, (list) => {
        const total = sum(list.map((item) => item.grossMinor))
        const result = list.map(() => 0)
        for (const entry of allocateRefund(list, total)) result[entry.index] = entry.grossMinor
        expect(result).toEqual(list.map((item) => item.grossMinor))
      }),
      RUNS,
    )
  })

  test('a túl nagy visszatérítést mindig elutasítja', () => {
    fc.assert(
      fc.property(items, fc.integer({ min: 1, max: 1_000 }), (list, extra) => {
        const total = sum(list.map((item) => item.grossMinor))
        expect(() => allocateRefund(list, total + extra)).toThrow()
        expect(() => allocateRefund(list, extra, { refundedBeforeMinor: total })).toThrow()
      }),
      RUNS,
    )
  })
})
