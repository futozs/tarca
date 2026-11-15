import type { Currency } from '../../generated/billingo'

const CURRENCY_FLAGS: Readonly<Record<Currency, true>> = {
  AED: true,
  ALL: true,
  AUD: true,
  BGN: true,
  BRL: true,
  CAD: true,
  CHF: true,
  CNY: true,
  COP: true,
  CZK: true,
  DKK: true,
  EUR: true,
  GBP: true,
  GEL: true,
  HKD: true,
  HRK: true,
  HUF: true,
  IDR: true,
  ILS: true,
  INR: true,
  ISK: true,
  JPY: true,
  KRW: true,
  LEJ: true,
  MKD: true,
  MNT: true,
  MXN: true,
  MYR: true,
  NOK: true,
  NZD: true,
  PHP: true,
  PLN: true,
  RON: true,
  RSD: true,
  RUB: true,
  SEK: true,
  SGD: true,
  SKK: true,
  THB: true,
  TRY: true,
  UAH: true,
  USD: true,
  ZAR: true,
}

export const CURRENCIES: readonly string[] = Object.keys(CURRENCY_FLAGS)

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_FLAGS, value)
}
