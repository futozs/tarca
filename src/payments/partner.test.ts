import { describe, expect, test } from 'vitest'
import { hungarianTaxNumber, partnerFromCustomer } from './partner'

const ADDRESS = { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' }

describe('partnerFromCustomer', () => {
  test('magánszemélyből NO_TAX_NUMBER partnert készít, a két címsort összefűzi', () => {
    expect(
      partnerFromCustomer({
        name: ' Kovács Éva ',
        email: ' eva@pelda.hu ',
        address: { ...ADDRESS, line2: '2/3' },
      }),
    ).toEqual({
      name: 'Kovács Éva',
      address: {
        countryCode: 'HU',
        postCode: '1111',
        city: 'Budapest',
        address: 'Fő utca 1., 2/3',
      },
      emails: ['eva@pelda.hu'],
      taxType: 'NO_TAX_NUMBER',
    })
  })

  test('magyar adószámnál HAS_TAX_NUMBER, a számot kötőjeles alakra hozza', () => {
    expect(
      partnerFromCustomer({ name: 'Példa Kft.', taxNumber: '12345678 2 42', address: ADDRESS }),
    ).toMatchObject({ taxcode: '12345678-2-42', taxType: 'HAS_TAX_NUMBER' })
    expect(
      partnerFromCustomer({
        name: 'Példa Kft.',
        taxNumber: '12345678242',
        euTaxNumber: 'HU12345678',
        address: ADDRESS,
      }),
    ).toMatchObject({ taxcode: '12345678-2-42', taxType: 'HAS_TAX_NUMBER' })
  })

  test('külföldi vagy EU-s adószámnál FOREIGN, az országkódot nagybetűsíti', () => {
    expect(
      partnerFromCustomer({
        name: 'Muster GmbH',
        euTaxNumber: 'atu 12345678',
        address: { country: 'at', zip: '1010', city: 'Wien', line1: 'Ring 1' },
      }),
    ).toMatchObject({
      address: { countryCode: 'AT' },
      taxcode: 'ATU12345678',
      taxType: 'FOREIGN',
    })
    expect(
      partnerFromCustomer({
        name: 'Acme Ltd.',
        taxNumber: 'GB123456789',
        address: { country: 'GB', zip: 'N1', city: 'London', line1: '1 Main St' },
      }),
    ).toMatchObject({ taxcode: 'GB123456789', taxType: 'FOREIGN' })
  })

  test('magyar vevő csak közösségi vagy nem belföldi adószámmal validációs hibát kap', () => {
    for (const customer of [
      { name: 'Példa Kft.', euTaxNumber: 'HU12345678', address: ADDRESS },
      { name: 'Példa Kft.', taxNumber: '1234', address: ADDRESS },
      {
        name: 'Példa Kft.',
        euTaxNumber: 'HU12345678',
        address: { ...ADDRESS, country: undefined },
      },
    ]) {
      expect(() => partnerFromCustomer(customer)).toThrow(
        expect.objectContaining({ category: 'validation' }),
      )
    }
  })

  test('adószám nélküli cégnél nem jelöl adótípust, ország nélkül a Billingo alapértékére bízza', () => {
    const partner = partnerFromCustomer({
      name: 'Példa Bt.',
      isBusiness: true,
      address: { zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
    })
    expect(partner).toEqual({
      name: 'Példa Bt.',
      address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    })
  })

  test('hiányos névnél, címnél vagy érvénytelen országkódnál undefined-ot ad', () => {
    expect(partnerFromCustomer(undefined)).toBeUndefined()
    expect(partnerFromCustomer({ name: 'Kovács Éva' })).toBeUndefined()
    expect(
      partnerFromCustomer({ name: 'Kovács Éva', address: { zip: '1111', city: 'Budapest' } }),
    ).toBeUndefined()
    expect(partnerFromCustomer({ name: ' ', address: ADDRESS })).toBeUndefined()
    expect(
      partnerFromCustomer({ name: 'Max Muster', address: { ...ADDRESS, country: 'Österreich' } }),
    ).toBeUndefined()
  })
})

describe('hungarianTaxNumber', () => {
  test('a 11 jegyű és a kötőjeles alakot is felismeri, a többit nem', () => {
    expect(hungarianTaxNumber('12345678-2-42')).toBe('12345678-2-42')
    expect(hungarianTaxNumber('12345678242')).toBe('12345678-2-42')
    expect(hungarianTaxNumber('HU12345678')).toBeUndefined()
    expect(hungarianTaxNumber(undefined)).toBeUndefined()
  })
})
