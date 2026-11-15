import { BillingoError } from '../core/errors'
import type { Country, PartnerTaxType } from '../generated/billingo'
import type { PartnerInput } from '../partners/partners'
import type { PaymentCustomer } from './types'

const HUNGARIAN_TAX_NUMBER = /^(\d{8})-?(\d)-?(\d{2})$/
const HUNGARIAN_EU_TAX_NUMBER = /^HU\d{8}$/
const COUNTRY_CODE = /^[A-Z]{2}$/

interface PartnerTax {
  readonly taxcode?: string
  readonly taxType?: PartnerTaxType
}

function isCountryCode(value: string): value is Country {
  return COUNTRY_CODE.test(value)
}

function compact(value: string | undefined): string | undefined {
  const result = value?.replace(/\s+/g, '').toUpperCase()
  return result === '' ? undefined : result
}

export function hungarianTaxNumber(value: string | undefined): string | undefined {
  const match = HUNGARIAN_TAX_NUMBER.exec(compact(value) ?? '')
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined
}

function taxOf(customer: PaymentCustomer, country: Country | undefined): PartnerTax {
  const domestic = hungarianTaxNumber(customer.taxNumber)
  if (domestic) return { taxcode: domestic, taxType: 'HAS_TAX_NUMBER' }
  const foreign = compact(customer.euTaxNumber) ?? compact(customer.taxNumber)
  if (foreign) {
    if (country === 'HU' || HUNGARIAN_EU_TAX_NUMBER.test(foreign)) {
      throw new BillingoError(
        'A magyar vevőnek csak közösségi vagy nem belföldi formátumú adószáma van; a számlához és a NAV-hoz a belföldi adószám (12345678-1-23) kell.',
        {
          category: 'validation',
          hint: 'Add meg a vevőt a partner opcióban, a belföldi adószámmal (taxcode) és taxType: HAS_TAX_NUMBER beállítással.',
        },
      )
    }
    return { taxcode: foreign, taxType: 'FOREIGN' }
  }
  if (customer.isBusiness === true) return {}
  return { taxType: 'NO_TAX_NUMBER' }
}

export function partnerFromCustomer(
  customer: PaymentCustomer | undefined,
): PartnerInput | undefined {
  if (!customer) return undefined
  const address = customer.address
  const name = customer.name?.trim()
  const postCode = address?.zip?.trim()
  const city = address?.city?.trim()
  const street = [address?.line1, address?.line2]
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .join(', ')
  const country = address?.country?.trim().toUpperCase() || undefined
  if (!name || !postCode || !city || !street) return undefined
  if (country !== undefined && !isCountryCode(country)) return undefined
  const email = customer.email?.trim()
  return {
    name,
    address: {
      ...(country === undefined ? {} : { countryCode: country }),
      postCode,
      city,
      address: street,
    },
    ...(email ? { emails: [email] } : {}),
    ...taxOf(customer, country),
  }
}
