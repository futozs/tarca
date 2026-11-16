import { describe, expect } from 'vitest'
import {
  createTarca,
  isBillingoError,
  nullIfNotFound,
  type PartnerInput,
  type PartnerReplacement,
} from '../../src/index'
import { BUYER, docsClient, docsExample, sentBodies } from './helpers'

const CIM = { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' }

const WIRE_ADDRESS = {
  country_code: 'HU',
  post_code: '1111',
  city: 'Budapest',
  address: 'Fő utca 1.',
}

function queryString(query: Readonly<Record<string, string>>): string {
  return new URLSearchParams(query).toString()
}

describe('partnerek', () => {
  docsExample('partnerek', 'a findOrCreate a meglévő partnert adja azonos adatokra', async () => {
    const { tarca } = docsClient()

    const elso = await tarca.partners.findOrCreate(BUYER)
    const masodik = await tarca.partners.findOrCreate(BUYER)

    expect([elso.created, masodik.created]).toEqual([true, false])
    expect(masodik.partner.id).toBe(elso.partner.id)
  })
})

describe('partnerek/kereses-vagy-letrehozas', () => {
  const vevo: PartnerInput = {
    name: 'Vevő Kft.',
    address: CIM,
    emails: ['vevo@example.hu'],
    taxcode: '12345678-2-42',
    taxType: 'HAS_TAX_NUMBER',
  }

  docsExample(
    'partnerek/kereses-vagy-letrehozas/keres',
    'egy keresés 100-as oldallal, majd a létrehozás a kiegészített országkóddal',
    async () => {
      const { tarca, billingo } = docsClient()

      const { partner, created } = await tarca.partners.findOrCreate(vevo)

      expect(created).toBe(true)
      expect(partner.id).toBe(1)
      const [lista] = billingo.requests.filter((request) => request.operation === 'ListPartner')
      expect(queryString(lista?.query ?? {})).toBe('page=1&per_page=100&query=Vev%C5%91+Kft.')
      expect(sentBodies(billingo, 'CreatePartner')).toEqual([
        {
          name: 'Vevő Kft.',
          address: WIRE_ADDRESS,
          emails: ['vevo@example.hu'],
          taxcode: '12345678-2-42',
          tax_type: 'HAS_TAX_NUMBER',
        },
      ])
    },
  )

  docsExample(
    'partnerek/kereses-vagy-letrehozas/keres',
    'a normalizált név, a nagybetűs e-mail és a hiányzó mező egyezik, a sorrend és az ország nem',
    async () => {
      const { tarca } = docsClient()
      const { partner } = await tarca.partners.findOrCreate({
        ...vevo,
        emails: ['a@example.hu', 'b@example.hu'],
        phone: '+36 1 234 5678',
      })

      const egyezik = await tarca.partners.findOrCreate({
        name: ' Vevő  Kft. ',
        address: CIM,
        emails: ['A@Example.hu', 'b@example.hu'],
      })
      const forditott = await tarca.partners.findOrCreate({
        name: 'Vevő Kft.',
        address: CIM,
        emails: ['b@example.hu', 'a@example.hu'],
      })
      const masikCim = await tarca.partners.findOrCreate({
        name: 'Vevő Kft.',
        address: { ...CIM, address: 'Fő u. 1.' },
      })
      const masikOrszag = await tarca.partners.findOrCreate({
        name: 'Vevő Kft.',
        address: { ...CIM, countryCode: 'AT' },
      })

      expect(egyezik).toEqual({ partner, created: false })
      expect([forditott.created, masikCim.created, masikOrszag.created]).toEqual([true, true, true])
    },
  )

  docsExample(
    'partnerek/kereses-vagy-letrehozas/keres',
    'üres névre validation hiba, kérés nélkül',
    async () => {
      const { tarca, billingo } = docsClient()

      const error = await tarca.partners
        .findOrCreate({ name: '   ', address: CIM })
        .catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        category: 'validation',
        fieldErrors: [{ field: 'name', message: 'A partner neve nem lehet üres.' }],
      })
      expect(billingo.requests).toEqual([])
    },
  )

  docsExample(
    'partnerek/kereses-vagy-letrehozas/valasz',
    'elveszett válasz után a második findOrCreate a már létrejött partnert adja',
    async () => {
      const { tarca, billingo } = docsClient()
      billingo.fail('network', { operation: 'CreatePartner', afterSuccess: true })
      const vevoAdat = { name: 'Vevő Kft.', address: CIM }

      async function partnerId(): Promise<number | undefined> {
        try {
          return (await tarca.partners.findOrCreate(vevoAdat)).partner.id
        } catch (error) {
          if (
            isBillingoError(error) &&
            (error.category === 'network' || error.category === 'timeout')
          ) {
            return (await tarca.partners.findOrCreate(vevoAdat)).partner.id
          }
          throw error
        }
      }

      expect(await partnerId()).toBe(1)
      expect(billingo.count('CreatePartner')).toBe(1)
      expect(billingo.data.partners.size).toBe(1)
    },
  )

  docsExample(
    'partnerek/kereses-vagy-letrehozas/valasz',
    'hiányzó címre a létrehozás 422-t ad a Billingo mezőneveivel',
    async () => {
      const { tarca } = docsClient()

      const error = await tarca.partners
        .findOrCreate({ name: 'Vevő Kft.', address: { postCode: '', city: '', address: '' } })
        .catch((caught: unknown) => caught)

      expect(error).toMatchObject({ category: 'validation', status: 422 })
      expect(isBillingoError(error) && error.fieldErrors.map((item) => item.field)).toEqual([
        'address.post_code',
        'address.city',
        'address.address',
      ])
    },
  )

  docsExample(
    'partnerek/kereses-vagy-letrehozas/minta',
    'azonos adatokra a meglévő partner, új címre új partner',
    async () => {
      const { tarca, billingo } = docsClient()
      const adatok = {
        name: 'Vevő Kft.',
        address: CIM,
        emails: ['vevo@example.hu'],
        taxcode: '12345678-2-42',
      }

      const elso = await tarca.partners.findOrCreate(adatok)
      const ugyanaz = await tarca.partners.findOrCreate(adatok)
      const koltozott = await tarca.partners.findOrCreate({
        ...adatok,
        address: { postCode: '1052', city: 'Budapest', address: 'Váci utca 10.' },
      })

      expect([elso.created, ugyanaz.created, koltozott.created]).toEqual([true, false, true])
      expect([elso.partner.id, ugyanaz.partner.id, koltozott.partner.id]).toEqual([1, 1, 2])
      expect(billingo.requests.map((request) => request.operation)).toEqual([
        'ListPartner',
        'CreatePartner',
        'ListPartner',
        'ListPartner',
        'CreatePartner',
      ])
    },
  )
})

describe('partnerek/lista', () => {
  docsExample('partnerek/lista/keres', 'egy oldal 50-nel és a teljes lista', async () => {
    const { tarca, billingo } = docsClient()
    await tarca.partners.create(BUYER)

    const oldal = await tarca.partners.list({ query: 'vevő', perPage: 50 })
    const nevek: string[] = []
    for await (const partner of tarca.partners.all({ query: 'vevő' })) nevek.push(partner.name)

    expect([oldal.total, oldal.data.length]).toEqual([1, 1])
    expect(nevek).toEqual(['Vevő Kft.'])
    const lists = billingo.requests.filter((request) => request.operation === 'ListPartner')
    expect(lists.map((request) => queryString(request.query))).toEqual([
      'per_page=50&query=vev%C5%91',
      'page=1&per_page=100&query=vev%C5%91',
    ])
  })

  docsExample('partnerek/lista/keres', 'hibás lapozásra RangeError, kérés nélkül', async () => {
    const { tarca, billingo } = docsClient()

    await expect(tarca.partners.list({ perPage: 101 })).rejects.toBeInstanceOf(RangeError)
    await expect(tarca.partners.list({ page: 0 })).rejects.toBeInstanceOf(RangeError)
    expect(billingo.requests).toEqual([])
  })

  docsExample('partnerek/lista/valasz', 'a Page számai és a null dueDays', async () => {
    const { tarca } = docsClient()
    await tarca.partners.create(BUYER)

    const oldal = await tarca.partners.list()

    expect(oldal).toMatchObject({ total: 1, perPage: 25, currentPage: 1, lastPage: 1 })
    expect(oldal.data[0]?.customBillingSettings?.dueDays).toBeNull()
    expect(Object.keys(oldal)).not.toContain('prevPageUrl')
  })

  docsExample(
    'partnerek/lista/minta',
    'szó elejére talál, szó közepére és adószámra nem',
    async () => {
      const { tarca } = docsClient()
      const cim = CIM
      await tarca.partners.create({ name: 'Vevő Kft.', address: cim, taxcode: '12345678-2-42' })
      await tarca.partners.create({ name: 'Minta Bt.', address: cim })

      const szoEleje = await tarca.partners.list({ query: 'vev' })
      const szoKozepe = await tarca.partners.list({ query: 'evő' })
      const adoszam = await tarca.partners.list({ query: '12345678' })
      const mind: string[] = []
      for await (const partner of tarca.partners.all()) mind.push(partner.name)

      expect(szoEleje.data.map((partner) => partner.name)).toEqual(['Vevő Kft.'])
      expect([szoEleje.total, szoKozepe.total, adoszam.total]).toEqual([1, 0, 0])
      expect(mind).toEqual(['Minta Bt.', 'Vevő Kft.'])
      expect((await tarca.partners.list({ query: 'kft' })).total).toBe(1)
    },
  )
})

describe('partnerek/letrehozas', () => {
  docsExample(
    'partnerek/letrehozas/keres',
    'a tárca snake_case törzset küld HU országkóddal',
    async () => {
      const { tarca, billingo } = docsClient()

      const partner = await tarca.partners.create({
        name: 'Vevő Kft.',
        address: CIM,
        emails: ['vevo@example.hu'],
        taxcode: '12345678-2-42',
        taxType: 'HAS_TAX_NUMBER',
        customBillingSettings: { paymentMethod: 'wire_transfer', dueDays: 15 },
      })

      expect(partner.id).toBe(1)
      expect(sentBodies(billingo, 'CreatePartner')).toEqual([
        {
          name: 'Vevő Kft.',
          address: WIRE_ADDRESS,
          emails: ['vevo@example.hu'],
          taxcode: '12345678-2-42',
          tax_type: 'HAS_TAX_NUMBER',
          custom_billing_settings: { payment_method: 'wire_transfer', due_days: 15 },
        },
      ])
    },
  )

  docsExample('partnerek/letrehozas/keres', 'a kihagyott mezők alapértékei', async () => {
    const { tarca } = docsClient()

    const partner = await tarca.partners.create(BUYER)

    expect(partner).toMatchObject({
      emails: [],
      taxcode: '',
      taxType: '',
      phone: '',
      iban: '',
      swift: '',
      accountNumber: '',
      generalLedgerNumber: '',
      groupMemberTaxNumber: '',
      internalComment: '',
      partnerShowType: 'show_all',
      giroSettings: {
        giroDefaultSettings: true,
        giroPaymentRequestEnabled: false,
        giroDifferentAmountAllowed: false,
      },
      partnerShipping: { match: true, mode: 'none' },
    })
    expect(Object.values(partner.customBillingSettings ?? {}).every((v) => v === null)).toBe(true)
  })

  docsExample('partnerek/letrehozas/valasz', 'hiányzó címre 422 a Billingo törzsével', async () => {
    const { tarca } = docsClient()

    const error = await tarca.partners
      .create({ name: 'Vevő Kft.', address: { postCode: '', city: '', address: '' } })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      category: 'validation',
      status: 422,
      apiMessage: 'Validation Failed',
      fieldErrors: [
        { field: 'address.post_code', message: 'The address.post code field is required.' },
        { field: 'address.city', message: 'The address.city field is required.' },
        { field: 'address.address', message: 'The address.address field is required.' },
      ],
    })
  })

  docsExample(
    'partnerek/letrehozas/valasz',
    'elveszett válasz után a findOrCreate megtalálja a létrejött partnert',
    async () => {
      const { tarca, billingo } = docsClient()
      billingo.fail('network', { operation: 'CreatePartner', afterSuccess: true })
      const adatok = { name: 'Vevő Kft.', address: CIM }
      let eredmeny: { id: number | undefined; created: boolean } | undefined

      try {
        await tarca.partners.create(adatok)
      } catch (error) {
        const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']
        if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
        const { partner, created } = await tarca.partners.findOrCreate(adatok)
        eredmeny = { id: partner.id, created }
      }

      expect(eredmeny).toEqual({ id: 1, created: false })
      expect(billingo.data.partners.size).toBe(1)
    },
  )

  docsExample('partnerek/letrehozas/minta', 'a 201-es válasz alapértékei', async () => {
    const { tarca, billingo } = docsClient()

    const partner = await tarca.partners.create({
      name: 'Vevő Kft.',
      address: CIM,
      emails: ['vevo@example.hu'],
      taxcode: '12345678-2-42',
      taxType: 'HAS_TAX_NUMBER',
    })

    expect(partner.id).toBe(1)
    expect(partner.address.countryCode).toBe('HU')
    expect(partner.taxType).toBe('HAS_TAX_NUMBER')
    expect(partner.phone).toBe('')
    expect(partner.customBillingSettings?.dueDays).toBeNull()
    expect(billingo.requests.map((request) => request.status)).toEqual([201])
  })
})

describe('partnerek/lekeres', () => {
  docsExample('partnerek/lekeres', 'lekérés, majd törlés után null', async () => {
    const { tarca, billingo } = docsClient()

    const uj = await tarca.partners.create({ name: 'Vevő Kft.', address: CIM })
    const partner = await tarca.partners.get(uj.id ?? 0)
    await tarca.partners.delete(uj.id ?? 0)
    const torolt = await nullIfNotFound(tarca.partners.get(uj.id ?? 0))

    expect([partner.name, partner.taxType]).toEqual(['Vevő Kft.', ''])
    expect(torolt).toBeNull()
    expect(billingo.requests.map((request) => request.status)).toEqual([201, 200, 204, 404])
  })

  docsExample('partnerek/lekeres', 'a dróton érkező válasz a dokumentált alakú', async () => {
    const billingo = docsClient().billingo
    const responses: unknown[] = []
    const tarca = createTarca({
      apiKey: 'teszt',
      retryDelayMs: 0,
      fetch: async (input, init) => {
        const response = await billingo.fetch(input, init)
        if ((init?.method ?? 'GET') === 'GET') responses.push(await response.clone().json())
        return response
      },
    })

    const uj = await tarca.partners.create({ name: 'Vevő Kft.', address: CIM })
    await tarca.partners.get(uj.id ?? 0)

    expect(responses).toEqual([
      {
        id: 1,
        name: 'Vevő Kft.',
        address: WIRE_ADDRESS,
        emails: [],
        taxcode: '',
        iban: '',
        swift: '',
        account_number: '',
        phone: '',
        general_ledger_number: '',
        tax_type: '',
        custom_billing_settings: {
          payment_method: null,
          document_form: null,
          due_days: null,
          document_currency: null,
          template_language_code: null,
          discount: null,
          custom_label: null,
        },
        group_member_tax_number: '',
        giro_settings: {
          giro_default_settings: true,
          giro_payment_request_enabled: false,
          giro_different_amount_allowed: false,
        },
        partner_shipping: {
          match: true,
          name: '',
          mode: 'none',
          address: { country_code: 'HU', post_code: '', city: '', address: '' },
        },
        internal_comment: '',
        partner_show_type: 'show_all',
      },
    ])
  })
})

describe('partnerek/modositas', () => {
  docsExample(
    'partnerek/modositas/keres',
    'a lekért partner visszaküldve megtartja a telefont és az e-mailt',
    async () => {
      const { tarca, billingo } = docsClient()

      const uj = await tarca.partners.create({
        name: 'Vevő Kft.',
        address: CIM,
        emails: ['vevo@example.hu'],
        phone: '+36 1 234 5678',
      })
      const partnerId = uj.id ?? 0
      const { id: _, ...partner } = await tarca.partners.get(partnerId)
      const modositott = await tarca.partners.update(partnerId, {
        ...partner,
        address: { ...partner.address, postCode: '1052', address: 'Váci utca 10.' },
      })

      expect([modositott.phone, modositott.emails]).toEqual(['+36 1 234 5678', ['vevo@example.hu']])
      expect(modositott.address).toMatchObject({ postCode: '1052', address: 'Váci utca 10.' })
      expect(sentBodies(billingo, 'UpdatePartner')[0]).not.toHaveProperty('id')
    },
  )

  docsExample('partnerek/modositas/keres', 'csak név és cím: ez megy a dróton', async () => {
    const { tarca, billingo } = docsClient()
    const uj = await tarca.partners.create(BUYER)

    await tarca.partners.update(uj.id ?? 0, BUYER)

    expect(sentBodies(billingo, 'UpdatePartner')).toEqual([
      { name: 'Vevő Kft.', address: WIRE_ADDRESS },
    ])
  })

  docsExample('partnerek/modositas/valasz', 'a kihagyott e-mail címek elvesznek', async () => {
    const { tarca } = docsClient()
    const uj = await tarca.partners.create({
      name: 'Vevő Kft.',
      address: CIM,
      emails: ['vevo@example.hu'],
    })

    const csere = await tarca.partners.update(uj.id ?? 0, { name: 'Vevő Kft.', address: CIM })

    expect(csere.emails?.length ? 'rendben' : 'az e-mail címek elvesztek').toBe(
      'az e-mail címek elvesztek',
    )
  })

  docsExample(
    'partnerek/modositas/valasz',
    'bizonytalan hiba után a csere megismételhető',
    async () => {
      const { tarca, billingo } = docsClient()
      const uj = await tarca.partners.create(BUYER)
      billingo.fail('timeout', { operation: 'UpdatePartner', afterSuccess: true })
      const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']

      async function cserel(id: number, replacement: PartnerReplacement) {
        try {
          return await tarca.partners.update(id, replacement)
        } catch (error) {
          if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
          return tarca.partners.update(id, replacement)
        }
      }

      const eredmeny = await cserel(uj.id ?? 0, { ...BUYER, phone: '+36 1 234 5678' })

      expect(eredmeny.phone).toBe('+36 1 234 5678')
      expect(billingo.count('UpdatePartner')).toBe(2)
    },
  )

  docsExample(
    'partnerek/modositas/minta',
    'teljes partnerrel megmarad, csonka PUT-tal kiürül',
    async () => {
      const { tarca } = docsClient()
      const uj = await tarca.partners.create({
        name: 'Vevő Kft.',
        address: CIM,
        emails: ['vevo@example.hu'],
        phone: '+36 1 234 5678',
      })
      const partnerId = uj.id ?? 0

      const { id: _, ...partner } = await tarca.partners.get(partnerId)
      const koltozott = await tarca.partners.update(partnerId, {
        ...partner,
        address: { ...partner.address, postCode: '1052', address: 'Váci utca 10.' },
      })
      const csonka = await tarca.partners.update(partnerId, {
        name: 'Vevő Kft.',
        address: { postCode: '1052', city: 'Budapest', address: 'Váci utca 10.' },
      })

      expect([koltozott.address.address, koltozott.phone, koltozott.emails]).toEqual([
        'Váci utca 10.',
        '+36 1 234 5678',
        ['vevo@example.hu'],
      ])
      expect([csonka.phone, csonka.emails]).toEqual(['', []])
    },
  )
})

describe('partnerek/torles', () => {
  docsExample('partnerek/torles', 'törlés 204, utána null', async () => {
    const { tarca, billingo } = docsClient()

    const partner = await tarca.partners.create(BUYER)
    await tarca.partners.delete(partner.id ?? 0)

    expect(await nullIfNotFound(tarca.partners.get(partner.id ?? 0))).toBeNull()
    expect(
      billingo.requests.find((request) => request.operation === 'DeletePartner'),
    ).toMatchObject({ method: 'DELETE', path: '/partners/1', status: 204, body: undefined })
  })

  docsExample('partnerek/torles', 'a második törlés 404-ét sikerként kezeli', async () => {
    const { tarca } = docsClient()
    const partner = await tarca.partners.create(BUYER)

    async function torol(id: number): Promise<void> {
      try {
        await tarca.partners.delete(id)
      } catch (error) {
        if (isBillingoError(error) && error.category === 'not_found') return
        throw error
      }
    }

    await torol(partner.id ?? 0)
    await expect(torol(partner.id ?? 0)).resolves.toBeUndefined()
  })

  docsExample('partnerek/torles', 'a bizonylat megtartja a törölt partner adatait', async () => {
    const { tarca } = docsClient()
    const document = await tarca.documents.create({
      partner: BUYER,
      items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
    })

    await tarca.partners.delete(document.partner?.id ?? 0)

    expect((await tarca.documents.get(document.id ?? 0)).partner?.name).toBe('Vevő Kft.')
  })
})

describe('partnerek/guess', () => {
  docsExample('partnerek/guess/keres', 'új névre új partner, a dokumentált törzzsel', async () => {
    const { tarca, billingo } = docsClient()

    const partner = await tarca.partners.guess({
      name: 'Vevő Kft.',
      address: CIM,
      taxcode: '12345678-2-42',
    })

    expect(partner.id).toBe(1)
    expect(sentBodies(billingo, 'PartnerGuess')).toEqual([
      { name: 'Vevő Kft.', address: WIRE_ADDRESS, taxcode: '12345678-2-42' },
    ])
    expect(billingo.requests[0]).toMatchObject({ path: '/partners/guess', status: 201 })
  })

  docsExample('partnerek/guess/valasz', 'a válasz taxType üres, a tárolt nem', async () => {
    const { tarca } = docsClient()

    const tipp = await tarca.partners.guess({
      name: 'Vevő Kft.',
      address: CIM,
      taxcode: '12345678-2-42',
      taxType: 'HAS_TAX_NUMBER',
    })
    const partner = await tarca.partners.get(tipp.id ?? 0)

    expect([tipp.taxType, partner.taxType]).toEqual(['', 'HAS_TAX_NUMBER'])
  })

  docsExample(
    'partnerek/guess/minta',
    'pontos névre a meglévő, a név elejére új partner, mindkettő 201',
    async () => {
      const { tarca, billingo } = docsClient()
      const cim = CIM
      const meglevo = await tarca.partners.create({
        name: 'Vevő Kft.',
        address: cim,
        taxcode: '12345678-2-42',
        taxType: 'HAS_TAX_NUMBER',
      })

      const pontosNev = await tarca.partners.guess({ name: 'Vevő Kft.', address: cim })
      const nevEleje = await tarca.partners.guess({ name: 'Vevő', address: cim })

      expect([meglevo.id, meglevo.taxType]).toEqual([1, 'HAS_TAX_NUMBER'])
      expect([pontosNev.id, pontosNev.taxType]).toEqual([1, ''])
      expect(nevEleje.id).toBe(2)
      expect(
        billingo.requests
          .filter((request) => request.operation === 'PartnerGuess')
          .map((request) => request.status),
      ).toEqual([201, 201])
    },
  )
})
