import type { Country, Currency } from '../../generated/billingo'

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

export const COUNTRIES: readonly string[] = (
  'AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN ' +
  'BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DG ' +
  'DJ DK DM DO DZ EA EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM ' +
  'GN GP GQ GR GS GT GU GW GY HK HN HR HT HU IC ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH ' +
  'MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM ' +
  'PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ ' +
  'SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XA XB XK YE YT ZA ZM ZW'
).split(' ')

const COUNTRY_SET: ReadonlySet<string> = new Set(COUNTRIES)

export function isCountry(value: unknown): value is Country {
  return typeof value === 'string' && COUNTRY_SET.has(value)
}
