import { describe, expect, test } from 'vitest'
import {
  currencyExponent,
  decimalToMinor,
  fromMinorUnits,
  isBillingoCurrency,
  normalizeCurrency,
  parseDecimalAmount,
} from './amounts'

describe('currencyExponent', () => {
  test('a forint a Stripe-nál és az ISO 4217 szerint is kétdecimális', () => {
    expect(currencyExponent('HUF', 'stripe')).toBe(2)
    expect(currencyExponent('HUF')).toBe(2)
  })

  test('a Stripe nulladecimális listáját használja Stripe konvencióval', () => {
    expect(currencyExponent('JPY', 'stripe')).toBe(0)
    expect(currencyExponent('MGA', 'stripe')).toBe(0)
    expect(currencyExponent('ISK', 'stripe')).toBe(2)
    expect(currencyExponent('UGX', 'stripe')).toBe(2)
  })

  test('az ISO 4217 szerinti nulla-, három- és négydecimális pénznemeket ismeri', () => {
    expect(currencyExponent('ISK')).toBe(0)
    expect(currencyExponent('UGX')).toBe(0)
    expect(currencyExponent('KRW')).toBe(0)
    expect(currencyExponent('KWD', 'stripe')).toBe(3)
    expect(currencyExponent('IQD')).toBe(3)
    expect(currencyExponent('CLF')).toBe(4)
    expect(currencyExponent(' jpy ', 'stripe')).toBe(0)
  })
})

describe('fromMinorUnits', () => {
  test('a Stripe 127000 HUF minor unitja 1270 Ft, ISO minor unitban is 127000', () => {
    expect(fromMinorUnits(127_000, 'huf', 'stripe')).toEqual({
      value: 1270,
      minor: 127_000,
      currency: 'HUF',
    })
  })

  test('a nulla- és háromdecimális pénznemet pontosan váltja', () => {
    expect(fromMinorUnits(1500, 'JPY', 'stripe')).toEqual({
      value: 1500,
      minor: 1500,
      currency: 'JPY',
    })
    expect(fromMinorUnits(1234, 'KWD', 'stripe')).toEqual({
      value: 1.234,
      minor: 1234,
      currency: 'KWD',
    })
    expect(fromMinorUnits(1999, 'EUR')).toEqual({ value: 19.99, minor: 1999, currency: 'EUR' })
  })

  test('a Stripe és az ISO eltérő tizedeseit átszámolja (ISK, MGA)', () => {
    expect(fromMinorUnits(10_000, 'ISK', 'stripe')).toEqual({
      value: 100,
      minor: 100,
      currency: 'ISK',
    })
    expect(fromMinorUnits(1500, 'MGA', 'stripe')).toEqual({
      value: 1500,
      minor: 150_000,
      currency: 'MGA',
    })
    expect(() => fromMinorUnits(10_050, 'ISK', 'stripe')).toThrow(RangeError)
  })

  test('nem egész vagy nem véges értékre RangeError-t dob', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, 2 ** 60]) {
      expect(() => fromMinorUnits(value, 'EUR', 'stripe')).toThrow(RangeError)
    }
  })

  test('a negatív összeget is megtartja, a 0 nem lesz -0', () => {
    expect(fromMinorUnits(-250, 'EUR')).toEqual({ value: -2.5, minor: -250, currency: 'EUR' })
    expect(Object.is(fromMinorUnits(-0, 'EUR').value, 0)).toBe(true)
  })
})

describe('parseDecimalAmount', () => {
  test('a decimális szöveget és számot pontos minor unitra alakítja', () => {
    expect(parseDecimalAmount('1000', 'HUF')).toEqual({
      value: 1000,
      minor: 100_000,
      currency: 'HUF',
    })
    expect(parseDecimalAmount(' 10.50 ', 'eur')).toEqual({
      value: 10.5,
      minor: 1050,
      currency: 'EUR',
    })
    expect(parseDecimalAmount('.5', 'EUR')).toEqual({ value: 0.5, minor: 50, currency: 'EUR' })
    expect(parseDecimalAmount('-3.25', 'EUR')).toEqual({
      value: -3.25,
      minor: -325,
      currency: 'EUR',
    })
    expect(parseDecimalAmount(2540.0, 'HUF')).toEqual({
      value: 2540,
      minor: 254_000,
      currency: 'HUF',
    })
    expect(parseDecimalAmount('19.990', 'EUR').minor).toBe(1999)
    expect(parseDecimalAmount('1500', 'JPY')).toEqual({ value: 1500, minor: 1500, currency: 'JPY' })
  })

  test('a pénznemnél több tizedesre, érvénytelen formára és nem véges számra RangeError-t dob', () => {
    for (const value of ['', '1,5', '1e3', 'abc', '1.', '--1', '-', '10.001', Number.NaN, 1e21]) {
      expect(() => parseDecimalAmount(value, 'EUR')).toThrow(RangeError)
    }
    expect(() => parseDecimalAmount('10.5', 'JPY')).toThrow(RangeError)
  })

  test('a lebegőpontos összeadás maradéka nem csúszik be (0.1 + 0.2)', () => {
    expect(decimalToMinor(0.1 + 0.2, 2)).toBeUndefined()
    expect(decimalToMinor(0.3, 2)).toBe(30)
  })
})

describe('normalizeCurrency és isBillingoCurrency', () => {
  test('nagybetűssé alakít, és csak a Billingo pénznemeit fogadja el', () => {
    expect(normalizeCurrency(' eur ')).toBe('EUR')
    expect(isBillingoCurrency('HUF')).toBe(true)
    expect(isBillingoCurrency('EUR')).toBe(true)
    expect(isBillingoCurrency('BTC')).toBe(false)
    expect(isBillingoCurrency('eur')).toBe(false)
  })
})
