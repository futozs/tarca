import { describe, expect, test } from 'vitest'
import { BillingoError } from '../core/errors'
import { allocateRefund, type RefundableItem } from './refund'

const ITEMS: readonly RefundableItem[] = [
  { name: 'Könyv', vat: '5%', grossMinor: 4_990, unit: 'db' },
  { name: 'Póló', vat: '27%', grossMinor: 6_990, sku: 'SKU-1' },
  { name: 'Szállítás', vat: '27%', grossMinor: 1_490 },
]

function total(allocations: readonly { grossMinor: number }[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.grossMinor, 0)
}

describe('allocateRefund', () => {
  test('a visszatérítést pontosan, arányosan osztja szét, a tétel áfakulcsán', () => {
    const allocations = allocateRefund(ITEMS, 5_000)

    expect(total(allocations)).toBe(5_000)
    expect(allocations).toEqual([
      { index: 0, name: 'Könyv', vat: '5%', grossMinor: 1_852, unit: 'db' },
      { index: 1, name: 'Póló', vat: '27%', grossMinor: 2_595, sku: 'SKU-1' },
      { index: 2, name: 'Szállítás', vat: '27%', grossMinor: 553 },
    ])
  })

  test('teljes összegnél pontosan az eredeti tételeket adja', () => {
    expect(allocateRefund(ITEMS, 13_470).map((allocation) => allocation.grossMinor)).toEqual([
      4_990, 6_990, 1_490,
    ])
  })

  test('egy egységet a legnagyobb maradékú tételre tesz, a nullás tételt kihagyja', () => {
    const allocations = allocateRefund(
      [
        { name: 'A', vat: '27%', grossMinor: 100 },
        { name: 'B', vat: '27%', grossMinor: 1 },
        { name: 'C', vat: '0%', grossMinor: 0 },
      ],
      1,
    )
    expect(allocations).toEqual([{ index: 0, name: 'A', vat: '27%', grossMinor: 1 }])
  })

  test('egyenlő maradéknál a korábbi tétel kapja', () => {
    const allocations = allocateRefund(
      [
        { name: 'A', vat: '27%', grossMinor: 50 },
        { name: 'B', vat: '27%', grossMinor: 50 },
      ],
      1,
    )
    expect(allocations.map((allocation) => allocation.name)).toEqual(['A'])
  })

  test('a korábbi visszatérítések után a maradékon oszt, és tételenként nem lépi túl az eredetit', () => {
    const items: RefundableItem[] = [
      { name: 'A', vat: '27%', grossMinor: 100 },
      { name: 'B', vat: '5%', grossMinor: 1 },
    ]
    const first = allocateRefund(items, 50)
    const second = allocateRefund(items, 51, { refundedBeforeMinor: 50 })
    const perItem = [0, 1].map((index) =>
      [...first, ...second]
        .filter((allocation) => allocation.index === index)
        .reduce((sum, allocation) => sum + allocation.grossMinor, 0),
    )
    expect(perItem).toEqual([100, 1])
  })

  test('sok apró visszatérítés után is pontosan az eredetit adja vissza tételenként', () => {
    const items: RefundableItem[] = [
      { name: 'A', vat: '27%', grossMinor: 333 },
      { name: 'B', vat: '18%', grossMinor: 333 },
      { name: 'C', vat: '5%', grossMinor: 334 },
    ]
    const perItem = [0, 0, 0]
    for (let step = 0; step < 1_000; step++) {
      for (const allocation of allocateRefund(items, 1, { refundedBeforeMinor: step })) {
        perItem[allocation.index] = (perItem[allocation.index] ?? 0) + allocation.grossMinor
      }
    }
    expect(perItem).toEqual([333, 333, 334])
  })

  test('nagy összegeknél is pontos (BigInt, nincs lebegőpontos túlcsordulás)', () => {
    const allocations = allocateRefund(
      [
        { name: 'A', vat: '27%', grossMinor: 999_999_999_999_999 },
        { name: 'B', vat: '27%', grossMinor: 777_777_777_777_777 },
      ],
      888_888_888_888_887,
    )
    expect(total(allocations)).toBe(888_888_888_888_887)
  })

  test('különleges áfakódot is megtart', () => {
    expect(allocateRefund([{ name: 'A', vat: 'AAM', grossMinor: 1000 }], 10)[0]?.vat).toBe('AAM')
  })

  test.each([
    ['üres tétellista', [], 10, {}],
    ['nulla visszatérítés', ITEMS, 0, {}],
    ['negatív visszatérítés', ITEMS, -5, {}],
    ['az eredetinél nagyobb visszatérítés', ITEMS, 13_471, {}],
    ['a korábbiakkal együtt túl nagy', ITEMS, 100, { refundedBeforeMinor: 13_400 }],
    ['negatív korábbi összeg', ITEMS, 100, { refundedBeforeMinor: -1 }],
    ['nem egész visszatérítés', ITEMS, 10.5, {}],
    ['nem véges összeg', ITEMS, Number.NaN, {}],
    ['nem biztonságos egész', ITEMS, 2 ** 60, {}],
    ['negatív tétel', [{ name: 'A', vat: '27%', grossMinor: -1 }], 1, {}],
    ['nem egész tétel', [{ name: 'A', vat: '27%', grossMinor: 1.5 }], 1, {}],
  ] as const)('validációs hibát dob: %s', (_label, items, refund, options) => {
    expect(() => allocateRefund(items as readonly RefundableItem[], refund, options)).toThrow(
      BillingoError,
    )
  })
})
