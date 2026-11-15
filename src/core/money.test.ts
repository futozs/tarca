import { describe, expect, test } from 'vitest'
import { nextMicroAbove, roundHalfUp } from './money'

describe('Billingo kerekítés', () => {
  test('a kerekítés fél fillérnél felfelé kerekít, negatív összegnél is, és nem ad -0-t', () => {
    expect([roundHalfUp(1.005, 2), roundHalfUp(-1.005, 2), roundHalfUp(2.5, 0)]).toEqual([
      1.01, -1.01, 3,
    ])
    expect([roundHalfUp(-0.0001, 2), roundHalfUp(1e-7, 2), roundHalfUp(9.9954, 2)]).toEqual([
      0, 0, 10,
    ])
    expect(Object.is(roundHalfUp(-0.001, 2), 0)).toBe(true)
  })

  test('bruttó egységárnál a nettó egységár a bruttó/(1+kulcs) feletti legkisebb hattizedes szám (élőben: 1270 → 1000.000001, 10 → 7.874016)', () => {
    expect([nextMicroAbove(1270 / 1.27), nextMicroAbove(10 / 1.27)]).toEqual([
      1000.000001, 7.874016,
    ])
    expect([nextMicroAbove(1000 / 1.27), nextMicroAbove(-10 / 1.27)]).toEqual([
      787.401575, -7.874016,
    ])
  })
})
