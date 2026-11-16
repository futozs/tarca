import { describe, expect } from 'vitest'
import {
  addBudapestDays,
  createTarca,
  isBillingoError,
  nullIfNotFound,
  type PartnerInput,
} from '../../src/index'
import { createFakeBillingoFetch, createMockTarca } from '../../src/testing/index'
import { docsClient, docsExample } from './helpers'

const VEVO_ADOZO = {
  '12345678-2-42': {
    name: 'VEVŐ KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG',
    shortName: 'VEVŐ KFT.',
    addresses: [
      {
        type: 'HQ',
        countryCode: 'HU',
        postalCode: '1111',
        city: 'BUDAPEST',
        streetName: 'FŐ',
        publicPlaceCategory: 'UTCA',
        number: '1.',
      },
    ],
  },
} as const

describe('segedvegpontok/szervezet', () => {
  docsExample('segedvegpontok/szervezet', 'teszt profil becslése a NAV-kapcsolatból', async () => {
    const teszt = docsClient().tarca
    const eles = docsClient(
      {},
      { hasNavConnection: true, subscription: { features: ['api_limit_pro'] } },
    ).tarca

    async function profil(tarca: typeof teszt) {
      const szervezet = await tarca.organization.get()
      const funkciok = szervezet.subscription?.features ?? []
      const tesztProfil = szervezet.hasNavConnection === false && funkciok.length === 0
      return [tesztProfil ? 'Fejlesztői teszt profil' : 'Éles profil', szervezet.taxCode]
    }

    expect(await profil(teszt)).toEqual(['Fejlesztői teszt profil', '00000000-0-00'])
    expect((await profil(eles))[0]).toBe('Éles profil')
  })

  docsExample('segedvegpontok/szervezet', 'kulcs, majd a teszt profil adatai', async () => {
    const { tarca, billingo } = docsClient()

    const ervenyes = await tarca.verifyCredentials()
    const szervezet = await tarca.organization.get()

    expect(ervenyes).toBe(true)
    expect(szervezet).toEqual({
      taxCode: '00000000-0-00',
      subscription: { expirationDate: addBudapestDays(new Date(), 1), features: [] },
      hasNavConnection: false,
      kobakReceiptFsEnabled: true,
      hasSuccessfulNavReceiptSubmission: false,
    })
    expect(billingo.requests.map((request) => request.operation)).toEqual([
      'GetOrganizationData',
      'GetOrganizationData',
    ])
  })
})

describe('segedvegpontok/kulcs-ellenorzese', () => {
  async function inditas(tarca: ReturnType<typeof docsClient>['tarca']) {
    const naplo: unknown[] = []
    try {
      if (!(await tarca.verifyCredentials())) {
        throw new Error('A Billingo nem fogadta el a BILLINGO_API_KEY kulcsot.')
      }
    } catch (error) {
      if (isBillingoError(error) && error.retryable) {
        naplo.push('A Billingo most nem érhető el, a kulcsot később ellenőrizd:', error.category)
      } else {
        throw error
      }
    }
    return naplo
  }

  docsExample('segedvegpontok/kulcs-ellenorzese', 'jó kulccsal nem dob', async () => {
    expect(await inditas(docsClient().tarca)).toEqual([])
  })

  docsExample(
    'segedvegpontok/kulcs-ellenorzese',
    'rossz kulcsra hamis, és az indulás leáll',
    async () => {
      const { tarca } = docsClient({}, { apiKeys: ['masik-kulcs'] })

      await expect(inditas(tarca)).rejects.toThrow(
        'A Billingo nem fogadta el a BILLINGO_API_KEY kulcsot.',
      )
      expect(await createMockTarca({ credentialsValid: false }).verifyCredentials()).toBe(false)
    },
  )

  docsExample(
    'segedvegpontok/kulcs-ellenorzese',
    'hálózati hibánál továbbdob, újrapróbálás után',
    async () => {
      const { tarca, billingo } = docsClient()
      billingo.fail('network', { operation: 'GetOrganizationData', times: 3 })

      expect(await inditas(tarca)).toEqual([
        'A Billingo most nem érhető el, a kulcsot később ellenőrizd:',
        'network',
      ])
      expect(billingo.count('GetOrganizationData')).toBe(3)
    },
  )

  docsExample(
    'segedvegpontok/kulcs-ellenorzese',
    'kulcs nélkül már a createTarca dob',
    async () => {
      expect(() => createTarca({ apiKey: ' ', fetch: createFakeBillingoFetch().fetch })).toThrow(
        expect.objectContaining({ category: 'configuration' }),
      )
    },
  )
})

describe('segedvegpontok/adoszam-ellenorzes', () => {
  docsExample(
    'segedvegpontok/adoszam-ellenorzes/keres',
    'csak a teljes adószám megy ki',
    async () => {
      const { tarca, billingo } = docsClient({}, { hasNavConnection: true })

      for (const adoszam of ['12345678', '12345678242', 'HU12345678', '00000000-0-00']) {
        await expect(tarca.utils.checkTaxNumber(adoszam)).rejects.toMatchObject({
          category: 'validation',
          fieldErrors: [{ field: 'taxNumber' }],
        })
      }
      expect(billingo.requests).toEqual([])

      await tarca.utils.checkTaxNumber('12345678-2-42')
      await tarca.utils.checkTaxNumber(' 12345678-2-42 ')

      expect(billingo.requests.map((request) => request.path)).toEqual([
        '/utils/check-tax-number/12345678-2-42',
        '/utils/check-tax-number/12345678-2-42',
      ])
    },
  )

  docsExample(
    'segedvegpontok/adoszam-ellenorzes/keres',
    'kötőjelek pótlása az űrlap adatából',
    async () => {
      function adoszamKotojellel(bevitt: string) {
        const szamjegyek = bevitt.replace(/\D/g, '')
        if (szamjegyek.length !== 11) return undefined
        return `${szamjegyek.slice(0, 8)}-${szamjegyek.slice(8, 9)}-${szamjegyek.slice(9)}`
      }

      const adoszam = adoszamKotojellel('12345678 2 42')

      expect(adoszam).toBe('12345678-2-42')
      expect(adoszamKotojellel('12345678')).toBeUndefined()
    },
  )

  docsExample('segedvegpontok/adoszam-ellenorzes/valasz', 'vevő a NAV válaszából', async () => {
    const { tarca } = docsClient({}, { hasNavConnection: true, taxpayers: VEVO_ADOZO })

    async function vevoAdoszambol(adoszam: string): Promise<PartnerInput | undefined> {
      const valasz = await tarca.utils.checkTaxNumber(adoszam)
      const szekhely = valasz.addresses?.find((cim) => cim.type === 'HQ') ?? valasz.addresses?.[0]
      if (valasz.result !== 'validation_ok' || !valasz.taxpayerName || !szekhely) return undefined
      return {
        name: valasz.taxpayerName,
        address: {
          postCode: szekhely.postalCode,
          city: szekhely.city,
          address: [szekhely.streetName, szekhely.publicPlaceCategory, szekhely.number]
            .filter(Boolean)
            .join(' '),
        },
        taxType: 'HAS_TAX_NUMBER',
        taxcode: valasz.taxNumber,
      }
    }

    expect(await vevoAdoszambol('12345678-2-42')).toEqual({
      name: 'VEVŐ KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG',
      address: { postCode: '1111', city: 'BUDAPEST', address: 'FŐ UTCA 1.' },
      taxType: 'HAS_TAX_NUMBER',
      taxcode: '12345678-2-42',
    })
    expect(await vevoAdoszambol('87654321-1-13')).toBeUndefined()
  })

  docsExample(
    'segedvegpontok/adoszam-ellenorzes/valasz',
    'nav_unavailable: undefined, nem retryable',
    async () => {
      const { tarca } = docsClient()

      async function adoszamEllenorzes(adoszam: string) {
        try {
          return await tarca.utils.checkTaxNumber(adoszam)
        } catch (error) {
          if (isBillingoError(error) && error.category === 'nav_unavailable') return undefined
          throw error
        }
      }

      const valasz = await adoszamEllenorzes('12345678-2-42')
      const hiba = await tarca.utils.checkTaxNumber('12345678-2-42').catch((error) => error)

      expect(valasz?.result ?? 'Nincs NAV-kapcsolat, az adószámot kézzel ellenőrizd.').toBe(
        'Nincs NAV-kapcsolat, az adószámot kézzel ellenőrizd.',
      )
      expect(hiba).toMatchObject({ category: 'nav_unavailable', status: 401, retryable: false })
      expect(hiba.hint).toContain('nem kulcshiba')
    },
  )

  docsExample(
    'segedvegpontok/adoszam-ellenorzes/valasz',
    'a hamis Billingo taxpayers opciója',
    async () => {
      const billingo = createFakeBillingoFetch({ hasNavConnection: true, taxpayers: VEVO_ADOZO })
      const tarca = createTarca({ apiKey: 'teszt-kulcs', fetch: billingo.fetch })

      const ismert = await tarca.utils.checkTaxNumber('12345678-2-42')
      const ismeretlen = await tarca.utils.checkTaxNumber('87654321-1-13')

      expect([ismert.result, ismert.taxpayerShortName, ismeretlen.result]).toEqual([
        'validation_ok',
        'VEVŐ KFT.',
        'non_exist_tax_number',
      ])
    },
  )

  docsExample(
    'segedvegpontok/adoszam-ellenorzes/minta',
    'törzsszám kérés nélkül, teljes adószám 401',
    async () => {
      const { tarca, billingo } = docsClient()
      const naplo: unknown[][] = []

      for (const adoszam of ['12345678', '12345678-2-42']) {
        try {
          const valasz = await tarca.utils.checkTaxNumber(adoszam)
          naplo.push([adoszam, valasz.result, valasz.taxpayerName])
        } catch (error) {
          if (!isBillingoError(error)) throw error
          naplo.push([adoszam, error.category, error.status])
        }
      }

      expect(naplo).toEqual([
        ['12345678', 'validation', undefined],
        ['12345678-2-42', 'nav_unavailable', 401],
      ])
      expect(billingo.requests).toHaveLength(1)
    },
  )
})

describe('segedvegpontok/szerverido', () => {
  docsExample('segedvegpontok/szerverido', 'a helyi óra eltérése a Billingótól', async () => {
    const { tarca } = docsClient()

    const ido = await tarca.utils.serverTime()
    const elteresMp = Math.round(Date.now() / 1000) - (ido.epoch ?? 0)

    expect(Math.abs(elteresMp)).toBeLessThanOrEqual(1)
    expect(ido.timezone).toBe('Europe/Budapest')
    expect(ido.w3c).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[12]:00$/)
    expect(ido.formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  docsExample(
    'segedvegpontok/szerverido',
    'szerveridő és kétszer ugyanaz a régi azonosító',
    async () => {
      const { tarca } = docsClient()

      const ido = await tarca.utils.serverTime()
      const azonosito = await tarca.utils.convertLegacyId(123)
      const ujra = await tarca.utils.convertLegacyId(123)

      expect(ido.timezone).toBe('Europe/Budapest')
      expect([azonosito.legacyId, azonosito.id === ujra.id]).toEqual([123, true])
    },
  )
})

describe('segedvegpontok/regi-azonosito', () => {
  docsExample('segedvegpontok/regi-azonosito', 'átváltás, majd a partner lekérése', async () => {
    const { tarca } = docsClient()

    const { id } = await tarca.utils.convertLegacyId(987_654)
    const partner = id === undefined ? null : await nullIfNotFound(tarca.partners.get(id))

    expect(id).toBeGreaterThan(0)
    expect(partner?.name ?? 'Nincs ilyen partner a v3-ban.').toBe('Nincs ilyen partner a v3-ban.')
  })

  docsExample('segedvegpontok/regi-azonosito', 'legacyIds rögzített pár, nullára 404', async () => {
    const { tarca } = docsClient({}, { legacyIds: { 123: 41_330_552 } })

    expect(await tarca.utils.convertLegacyId(123)).toEqual({ id: 41_330_552, legacyId: 123 })
    await expect(tarca.utils.convertLegacyId(0)).rejects.toMatchObject({ category: 'not_found' })
  })

  docsExample('segedvegpontok/regi-azonosito', 'kétszer ugyanaz az azonosító', async () => {
    const { tarca, billingo } = docsClient()

    const azonosito = await tarca.utils.convertLegacyId(123)
    const ujra = await tarca.utils.convertLegacyId(123)

    expect([azonosito.legacyId, azonosito.id === ujra.id]).toEqual([123, true])
    expect(billingo.requests.map((request) => request.path)).toEqual([
      '/utils/convert-legacy-id/123',
      '/utils/convert-legacy-id/123',
    ])
  })
})
