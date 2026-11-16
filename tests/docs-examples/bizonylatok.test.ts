import { describe, expect } from 'vitest'
import { isBillingoError, type PaymentInput } from '../../src/index'
import { memoryStore } from '../../src/stores/index'
import { BUYER, docsClient, docsExample, ITEMS, pinDocsClock, sentBodies } from './helpers'

pinDocsClock()

const UNCERTAIN = ['server', 'network', 'timeout', 'unexpected_response']

async function withPartner(fake: Parameters<typeof docsClient>[1] = {}) {
  const client = docsClient({}, fake)
  await client.tarca.partners.create(BUYER)
  return client
}

async function issued() {
  const client = await withPartner()
  const szamla = await client.tarca.documents.create({ partner: 1, items: ITEMS })
  return { ...client, szamlaId: szamla.id ?? 0, szamla }
}

describe('bizonylatok', () => {
  docsExample('bizonylatok', 'createOnce a rendelés azonosítójával', async () => {
    const { tarca } = docsClient()

    const { document, created } = await tarca.documents.createOnce({
      vendorId: 'ORDER-1001',
      partner: BUYER,
      items: ITEMS,
    })

    expect(created).toBe(true)
    expect(document.grossTotal).toBe(190_500)
  })
})

describe('bizonylatok/kiallitas', () => {
  docsExample(
    'bizonylatok/kiallitas/keres',
    'egyetlen POST a megadott partnerrel és tömbbel',
    async () => {
      const { tarca, billingo } = await withPartner()

      const szamla = await tarca.documents.create({
        vendorId: 'WEB-1001',
        partner: 1,
        blockId: 1,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
          { name: 'Tankönyv', quantity: 2, grossUnitPrice: 4_200, vat: 5 },
        ],
        fulfillmentDate: '2026-11-16',
        dueDate: '2026-12-01',
        comment: 'Köszönjük a megrendelést.',
        orderNumber: 'ORDER-1001',
      })

      expect(szamla).toMatchObject({ invoiceNumber: '2026-1', grossTotal: 198_900 })
      expect(billingo.count('ListDocumentBlock')).toBe(0)
      expect(billingo.count('ListPartner')).toBe(0)
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        {
          vendor_id: 'WEB-1001',
          type: 'invoice',
          fulfillment_date: '2026-11-16',
          due_date: '2026-12-01',
          payment_method: 'wire_transfer',
          language: 'hu',
          currency: 'HUF',
          electronic: false,
          items: [
            {
              name: 'Webfejlesztés',
              quantity: 10,
              unit: 'óra',
              vat: '27%',
              unit_price: 15_000,
              unit_price_type: 'net',
            },
            {
              name: 'Tankönyv',
              quantity: 2,
              unit: 'db',
              vat: '5%',
              unit_price: 4_200,
              unit_price_type: 'gross',
            },
          ],
          comment: 'Köszönjük a megrendelést.',
          settings: { should_send_email: false, order_number: 'ORDER-1001' },
          block_id: 1,
          partner_id: 1,
        },
      ])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/keres',
    'partneradatokkal a négy kérés sorrendje',
    async () => {
      const { tarca, billingo } = docsClient()

      await tarca.documents.create({ partner: BUYER, items: ITEMS })

      expect(billingo.requests.map((request) => request.operation)).toEqual([
        'ListDocumentBlock',
        'ListPartner',
        'CreatePartner',
        'CreateDocument',
      ])
      expect(billingo.requests[0]?.query).toEqual({ type: 'invoice', per_page: '100' })
    },
  )

  docsExample(
    'bizonylatok/kiallitas/keres',
    'hibás bemenetre kérés nélküli mezőhibák',
    async () => {
      const { tarca, billingo } = docsClient()

      const error = await tarca.documents
        .create({
          partner: BUYER,
          items: [{ name: '', quantity: 1, netUnitPrice: 1_000, grossUnitPrice: 1_270, vat: 12.5 }],
          dueDate: '2026-02-30',
        } as never)
        .catch((caught: unknown) => caught)

      expect(isBillingoError(error) && error.category).toBe('validation')
      expect(isBillingoError(error) && error.fieldErrors.map((item) => item.field)).toEqual([
        'items.0.name',
        'items.0',
        'items.0.vat',
        'dueDate',
      ])
      expect(billingo.requests).toEqual([])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/valasz',
    'bizonytalan hiba után vendorId alapján visszakeres',
    async () => {
      const { tarca, billingo } = await withPartner()
      billingo.fail('network', { operation: 'CreateDocument', afterSuccess: true })
      const szamla = {
        vendorId: 'ORDER-1001',
        partner: 1,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
      }
      let talalat: string | undefined

      try {
        await tarca.documents.create(szamla)
      } catch (error) {
        if (!isBillingoError(error) || !UNCERTAIN.includes(error.category)) throw error
        const meglevo = await tarca.documents.findByVendorId(szamla.vendorId)
        if (meglevo === null) throw error
        talalat = meglevo.invoiceNumber
      }

      expect(talalat).toBe('2026-1')
      expect(billingo.count('CreateDocument')).toBe(1)
    },
  )

  docsExample('bizonylatok/kiallitas/valasz', 'a válasz mezői friss számlán', async () => {
    const { szamla } = await issued()

    expect(szamla).toMatchObject({
      type: 'invoice',
      correctionType: 'invoice',
      cancelled: false,
      paymentStatus: 'outstanding',
      onlineSzamlaStatus: 'processing',
      discount: null,
      recurringId: null,
      organization: { taxNumber: '00000000-0-00', bankAccount: { id: null } },
    })
    expect(szamla.paidDate).toBe(szamla.invoiceDate)
  })

  docsExample('bizonylatok/kiallitas/minta', 'két áfakulcs, 198 900 Ft', async () => {
    const { tarca, billingo } = docsClient()

    const szamla = await tarca.documents.create({
      partner: {
        name: 'Vevő Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
        emails: ['vevo@example.hu'],
        taxcode: '12345678-2-42',
        taxType: 'HAS_TAX_NUMBER',
      },
      items: [
        { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        { name: 'Tankönyv', quantity: 2, grossUnitPrice: 4_200, vat: 5 },
      ],
      fulfillmentDate: '2026-11-16',
      dueInDays: 15,
      comment: 'Köszönjük a megrendelést.',
      orderNumber: 'ORDER-1001',
    })

    expect(szamla).toMatchObject({
      invoiceNumber: '2026-1',
      grossTotal: 198_900,
      paymentStatus: 'outstanding',
    })
    expect(szamla.items?.[1]?.netUnitAmount).toBe(4_000.000001)
    expect(szamla.summary?.vatRateSummary?.map((rate) => rate.vatRateGrossAmount)).toEqual([
      190_500, 8_400,
    ])
    expect(billingo.requests).toHaveLength(4)
  })

  docsExample('bizonylatok/kiallitas/minta', 'a legrövidebb számla', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({
      partner: { ...BUYER, emails: ['vevo@ceg.hu'] },
      items: ITEMS,
    })

    expect(szamla).toMatchObject({ invoiceNumber: '2026-1', grossTotal: 190_500 })
  })
})

describe('bizonylatok/kiallitas/szabalyok', () => {
  docsExample(
    'bizonylatok/kiallitas/szabalyok/tetelek-es-afa',
    'nettó, bruttó és termékes tétel',
    async () => {
      const { tarca, billingo } = await withPartner()
      await tarca.products.create({
        name: 'Póló',
        currency: 'HUF',
        vat: '27%',
        unit: 'db',
        grossUnitPrice: 6_350,
      })

      const szamla = await tarca.documents.create({
        partner: 1,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
          { name: 'Tankönyv', quantity: 2, grossUnitPrice: 4_200, vat: 5 },
          { productId: 1, quantity: 2 },
        ],
      })

      expect(szamla.grossTotal).toBe(211_600)
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        expect.objectContaining({
          items: [
            expect.objectContaining({ unit_price_type: 'net' }),
            expect.objectContaining({ unit_price_type: 'gross' }),
            { product_id: 1, quantity: 2 },
          ],
        }),
      ])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/tetelek-es-afa',
    'kedvezmény negatív tételsorral',
    async () => {
      const { tarca } = await withPartner()

      const szamla = await tarca.documents.create({
        partner: 1,
        items: [
          { name: 'Éves előfizetés', quantity: 1, netUnitPrice: 120_000, vat: 27 },
          { name: 'Kedvezmény 10%', quantity: 1, netUnitPrice: -12_000, vat: 27 },
        ],
      })

      expect(szamla.grossTotal).toBe(137_160)
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/tetelek-es-afa',
    'a discountPercent a dróton',
    async () => {
      const { tarca, billingo } = await withPartner()

      await tarca.documents.create({ partner: 1, items: ITEMS, discountPercent: 10 })

      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        expect.objectContaining({ discount: { type: 'percent', value: 10 } }),
      ])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/datumok-es-hatarido',
    'Date a budapesti napra váltva',
    async () => {
      const { tarca, billingo } = await withPartner()

      const szamla = await tarca.documents.create({
        partner: 1,
        items: [{ name: 'Tanácsadás', quantity: 2, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
        fulfillmentDate: '2026-11-10',
        dueDate: new Date('2026-11-30T23:30:00Z'),
      })

      expect(szamla).toMatchObject({ fulfillmentDate: '2026-11-10', dueDate: '2026-12-01' })
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        expect.objectContaining({ fulfillment_date: '2026-11-10', due_date: '2026-12-01' }),
      ])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/datumok-es-hatarido',
    'dueDate és dueInDays együtt hiba',
    async () => {
      const { tarca, billingo } = await withPartner()

      const error = await tarca.documents
        .create({ partner: 1, items: ITEMS, dueDate: '2026-12-01', dueInDays: 8 })
        .catch((caught: unknown) => caught)

      expect(isBillingoError(error) && error.fieldErrors).toEqual([
        { field: 'dueDate', message: 'A dueDate és a dueInDays közül csak az egyiket add meg.' },
      ])
      expect(billingo.count('CreateDocument')).toBe(0)
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/partner-megadasa',
    'partneradatokból új partner',
    async () => {
      const { tarca, billingo } = docsClient()

      const szamla = await tarca.documents.create({
        partner: {
          name: 'Vevő Kft.',
          address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
          emails: ['vevo@example.hu'],
          taxcode: '12345678-2-42',
          taxType: 'HAS_TAX_NUMBER',
        },
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
      })

      expect(szamla.partner).toMatchObject({ id: 1, taxcode: '12345678-2-42' })
      expect(billingo.count('CreatePartner')).toBe(1)
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/partner-megadasa',
    'megváltozott címre új partner',
    async () => {
      const { tarca, billingo } = docsClient()

      const elso = await tarca.documents.create({ partner: BUYER, items: ITEMS })
      const ugyanaz = await tarca.documents.create({ partner: BUYER, items: ITEMS })
      const uj = await tarca.documents.create({
        partner: { ...BUYER, address: { ...BUYER.address, address: 'Fő utca 2.' } },
        items: ITEMS,
      })

      expect(ugyanaz.partner?.id).toBe(elso.partner?.id)
      expect(uj.partner?.id).not.toBe(elso.partner?.id)
      expect(billingo.count('CreatePartner')).toBe(2)
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/deviza',
    'euró számla a Billingo árfolyamával',
    async () => {
      const { tarca, billingo } = await withPartner()

      const { rate } = await tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: '2026-11-16' })

      const szamla = await tarca.documents.create({
        partner: 1,
        currency: 'EUR',
        conversionRate: rate,
        language: 'en',
        items: [{ name: 'Consulting', quantity: 3, unit: 'hour', netUnitPrice: 120, vat: 27 }],
      })

      expect(rate).toBe(390)
      expect(szamla).toMatchObject({ grossTotal: 457.2, currency: 'EUR' })
      expect(szamla.summary?.grossAmountLocal).toBe(178_308)
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        expect.objectContaining({ currency: 'EUR', conversion_rate: 390, language: 'en' }),
      ])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/deviza',
    'devizás számla árfolyam nélkül hiba',
    async () => {
      const { tarca, billingo } = await withPartner()

      const error = await tarca.documents
        .create({ partner: 1, currency: 'EUR', items: ITEMS })
        .catch((caught: unknown) => caught)

      expect(isBillingoError(error) && error.fieldErrors.map((item) => item.field)).toEqual([
        'conversionRate',
      ])
      expect(billingo.count('CreateDocument')).toBe(0)
    },
  )

  docsExample('bizonylatok/kiallitas/szabalyok/deviza', 'a sandbox példája', async () => {
    const { tarca } = docsClient()

    const { rate } = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' })
    const szamla = await tarca.documents.create({
      partner: {
        name: 'Kunde GmbH',
        address: { countryCode: 'AT', postCode: '1010', city: 'Wien', address: 'Graben 1.' },
      },
      currency: 'EUR',
      conversionRate: rate,
      language: 'en',
      items: [{ name: 'Consulting', quantity: 3, unit: 'hour', netUnitPrice: 120, vat: 27 }],
    })

    expect(szamla).toMatchObject({ grossTotal: 457.2, currency: 'EUR', language: 'en' })
  })

  docsExample(
    'bizonylatok/kiallitas/szabalyok/deviza',
    'élőben mért forintosítás 389,17-tel',
    async () => {
      const { tarca } = await withPartner()

      const szamla = await tarca.documents.create({
        partner: 1,
        currency: 'EUR',
        conversionRate: 389.17,
        items: [
          { name: 'A', quantity: 3, netUnitPrice: 12.34, vat: 27 },
          { name: 'B', quantity: 7, netUnitPrice: 0.99, vat: 5 },
        ],
      })

      expect(szamla.summary).toMatchObject({
        netAmount: 43.95,
        vatAmount: 10.34,
        netAmountLocal: 17_104.0215,
        grossAmountLocal: 21_128.0393,
        vatAmountLocal: 4_024,
      })
      expect(szamla.summary?.vatRateSummary?.map((rate) => rate.vatRateVatAmountLocal)).toEqual([
        3_890, 135,
      ])
      expect(szamla.grossTotal).toBe(54.29)
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/fizetes-es-megjelenes',
    'kártya, angol nyelv, e-számla',
    async () => {
      const { tarca, billingo } = docsClient({ defaults: { bankAccountId: 1, electronic: true } })
      await tarca.partners.create(BUYER)
      await tarca.bankAccounts.create({
        name: 'Fő számla',
        accountNumber: '11773016-11111018',
        currency: 'HUF',
      })

      const szamla = await tarca.documents.create({
        partner: 1,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
        paymentMethod: 'bankcard',
        language: 'en',
      })

      expect(szamla).toMatchObject({ paymentMethod: 'bankcard', language: 'en', electronic: true })
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        expect.objectContaining({ bank_account_id: 1, electronic: true }),
      ])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/fizetes-es-megjelenes',
    'számlatömb nélkül configuration hiba',
    async () => {
      const { tarca, billingo } = await withPartner()
      await tarca.documentBlocks.delete(1)

      const error = await tarca.documents
        .create({ partner: 1, items: ITEMS })
        .catch((caught: unknown) => caught)

      expect(isBillingoError(error) && error.category).toBe('configuration')
      expect(billingo.count('CreateDocument')).toBe(0)
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/ertesites-es-rendelesszam',
    'a sendEmail és az orderNumber nyer',
    async () => {
      const { tarca, billingo } = await withPartner()

      const szamla = await tarca.documents.create({
        vendorId: 'ORDER-1001',
        partner: 1,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
        sendEmail: true,
        orderNumber: 'ORDER-1001',
        comment: 'Köszönjük a megrendelést.',
        settings: { round: 'five' },
      })

      expect(szamla.settings).toMatchObject({ shouldSendEmail: true, orderNumber: 'ORDER-1001' })
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        expect.objectContaining({
          settings: { round: 'five', should_send_email: true, order_number: 'ORDER-1001' },
        }),
      ])
    },
  )

  docsExample('bizonylatok/kiallitas/szabalyok/kerekites', 'áfakulcsonként 19 660 Ft', async () => {
    const { tarca } = await withPartner()

    const szamla = await tarca.documents.create({
      partner: 1,
      items: [
        { name: 'Szoftverlicenc', quantity: 1, netUnitPrice: 10_000, vat: 27 },
        { name: 'Szakkönyv', quantity: 3, netUnitPrice: 1_000, vat: 5 },
        { name: 'Póló', quantity: 3, grossUnitPrice: 1_270, vat: 27 },
      ],
    })

    expect(szamla.grossTotal).toBe(19_660)
    expect(szamla.summary).toMatchObject({ netAmount: 16_000, vatAmount: 3_660 })
    expect(
      szamla.summary?.vatRateSummary?.map((rate) => [
        rate.vatName,
        rate.vatRateNetAmount,
        rate.vatRateVatAmount,
        rate.vatRateGrossAmount,
      ]),
    ).toEqual([
      ['27%', 13_000, 3_510, 16_510],
      ['5%', 3_000, 150, 3_150],
    ])
    expect(szamla.items?.[2]?.netUnitAmount).toBe(1_000.000001)
  })

  docsExample(
    'bizonylatok/kiallitas/szabalyok/nyers-kuldes',
    'a DocumentInsert változatlanul megy',
    async () => {
      const { tarca, billingo } = await withPartner()

      const szamla = await tarca.documents.createRaw({
        partnerId: 1,
        blockId: 1,
        type: 'invoice',
        fulfillmentDate: '2026-11-16',
        dueDate: '2026-11-24',
        paymentMethod: 'cash',
        language: 'hu',
        currency: 'HUF',
        electronic: false,
        items: [
          {
            name: 'Javítás',
            unitPrice: 1_000,
            unitPriceType: 'net',
            quantity: 1,
            unit: 'db',
            vat: '27%',
          },
        ],
      })

      expect(szamla).toMatchObject({ invoiceNumber: '2026-1', grossTotal: 1_270 })
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        {
          partner_id: 1,
          block_id: 1,
          type: 'invoice',
          fulfillment_date: '2026-11-16',
          due_date: '2026-11-24',
          payment_method: 'cash',
          language: 'hu',
          currency: 'HUF',
          electronic: false,
          items: [
            {
              name: 'Javítás',
              unit_price: 1_000,
              unit_price_type: 'net',
              quantity: 1,
              unit: 'db',
              vat: '27%',
            },
          ],
        },
      ])
    },
  )

  docsExample(
    'bizonylatok/kiallitas/szabalyok/nyers-kuldes',
    'árfolyam nélkül a Billingo 422-je',
    async () => {
      const { tarca } = await withPartner()

      const error = await tarca.documents
        .createRaw({
          partnerId: 1,
          blockId: 1,
          type: 'invoice',
          fulfillmentDate: '2026-11-16',
          dueDate: '2026-11-24',
          paymentMethod: 'cash',
          language: 'hu',
          currency: 'EUR',
          items: [
            {
              name: 'Javítás',
              unitPrice: 10,
              unitPriceType: 'net',
              quantity: 1,
              unit: 'db',
              vat: '27%',
            },
          ],
        })
        .catch((caught: unknown) => caught)

      expect(isBillingoError(error) && [error.status, error.fieldErrors[0]?.field]).toEqual([
        422,
        'conversion_rate',
      ])
    },
  )
})

describe('bizonylatok/pontosan-egyszer', () => {
  docsExample('bizonylatok/pontosan-egyszer/keres', 'opciókkal, a kérések sorrendje', async () => {
    const { tarca, billingo } = docsClient()

    const { document, created } = await tarca.documents.createOnce(
      {
        vendorId: 'ORDER-1001',
        partner: {
          name: 'Vevő Kft.',
          address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
        },
        items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
      },
      { recoveryDelayMs: 500, signal: AbortSignal.timeout(20_000) },
    )

    expect(created).toBe(true)
    expect(document.invoiceNumber).toBe('2026-1')
    expect(billingo.requests.map((request) => [request.operation, request.status])).toEqual([
      ['GetDocumentByVendorId', 404],
      ['ListDocumentBlock', 200],
      ['ListPartner', 200],
      ['CreatePartner', 201],
      ['CreateDocument', 201],
    ])
  })

  docsExample('bizonylatok/pontosan-egyszer/keres', 'zár memóriás tárolóval', async () => {
    const { tarca, billingo } = docsClient({ createOnceLock: memoryStore() })
    const input = { vendorId: 'ORDER-1001', partner: BUYER, items: ITEMS }

    const [elso, masodik] = await Promise.all([
      tarca.documents.createOnce(input),
      tarca.documents.createOnce(input),
    ])

    expect([elso.created, masodik.created].sort()).toEqual([false, true])
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  docsExample('bizonylatok/pontosan-egyszer/keres', 'a .. vendorId kérés nélkül hiba', async () => {
    const { tarca, billingo } = docsClient()

    const error = await tarca.documents
      .createOnce({ vendorId: '..', partner: BUYER, items: ITEMS })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.fieldErrors[0]?.field).toBe('vendorId')
    expect(billingo.requests).toEqual([])
  })

  docsExample(
    'bizonylatok/pontosan-egyszer/valasz',
    'webhook válasz, a második hívás nem állít ki',
    async () => {
      const { tarca, billingo } = await withPartner()

      async function szamlazas(rendelesId: string): Promise<Response> {
        try {
          const { document } = await tarca.documents.createOnce({
            vendorId: `ORDER-${rendelesId}`,
            partner: 1,
            items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
          })
          return Response.json({ szamla: document.invoiceNumber })
        } catch (error) {
          if (isBillingoError(error) && error.category === 'validation') {
            return Response.json({ hiba: error.message }, { status: 422 })
          }
          return new Response('Később próbáld újra.', { status: 500 })
        }
      }

      const elso = await szamlazas('1001')
      const masodik = await szamlazas('1001')

      expect(elso.status).toBe(200)
      expect(await masodik.json()).toEqual({ szamla: '2026-1' })
      expect(billingo.count('CreateDocument')).toBe(1)
    },
  )

  docsExample(
    'bizonylatok/pontosan-egyszer/valasz',
    'sztornózott bizonylat created: false',
    async () => {
      const { tarca } = await withPartner()
      const input = { vendorId: 'ORDER-1001', partner: 1, items: ITEMS }
      const { document } = await tarca.documents.createOnce(input)
      await tarca.documents.cancel(document.id ?? 0)

      const ujra = await tarca.documents.createOnce(input)

      expect(ujra).toMatchObject({ created: false, document: { id: document.id, cancelled: true } })
    },
  )

  docsExample('bizonylatok/pontosan-egyszer/minta', 'kétszer ugyanarra a rendelésre', async () => {
    const { tarca, billingo } = docsClient()
    const rendeles = {
      id: 1001,
      partner: BUYER,
      tetelek: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
    }

    const elso = await tarca.documents.createOnce({
      vendorId: `RENDELES-${rendeles.id}`,
      partner: rendeles.partner,
      items: rendeles.tetelek,
    })
    const masodik = await tarca.documents.createOnce({
      vendorId: `RENDELES-${rendeles.id}`,
      partner: rendeles.partner,
      items: rendeles.tetelek,
    })

    expect([elso.created, masodik.created]).toEqual([true, false])
    expect(masodik.document.invoiceNumber).toBe(elso.document.invoiceNumber)
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  docsExample(
    'bizonylatok/pontosan-egyszer/minta',
    'elveszett válasz után created: true',
    async () => {
      const { tarca, billingo } = docsClient()
      billingo.fail('network', { operation: 'CreateDocument', afterSuccess: true })

      const { document, created } = await tarca.documents.createOnce({
        vendorId: 'RENDELES-1002',
        partner: BUYER,
        items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
      })

      expect(created).toBe(true)
      expect(document.invoiceNumber).toBe('2026-1')
      expect(billingo.count('CreateDocument')).toBe(1)
      expect(billingo.data.documents.size).toBe(1)
    },
  )
})

describe('bizonylatok/lekeres', () => {
  docsExample('bizonylatok/lekeres', 'findByVendorId null, majd a számla', async () => {
    const { tarca } = await withPartner()

    expect(await tarca.documents.findByVendorId('ORDER-1001')).toBeNull()

    await tarca.documents.create({ vendorId: 'ORDER-1001', partner: 1, items: ITEMS })
    const szamla = await tarca.documents.findByVendorId('ORDER-1001')

    expect(szamla).toMatchObject({
      invoiceNumber: '2026-1',
      paymentStatus: 'outstanding',
      cancelled: false,
    })
  })

  docsExample('bizonylatok/lekeres', 'ismeretlen id 403, ismeretlen vendorId 404', async () => {
    const { tarca } = docsClient()

    const id = await tarca.documents.get(999).catch((caught: unknown) => caught)
    const vendor = await tarca.documents.getByVendorId('NINCS').catch((caught: unknown) => caught)
    const pont = await tarca.documents.getByVendorId('..').catch((caught: unknown) => caught)

    expect(isBillingoError(id) && [id.status, id.category]).toEqual([403, 'forbidden'])
    expect(isBillingoError(vendor) && [vendor.status, vendor.category]).toEqual([404, 'not_found'])
    expect(pont).toBeInstanceOf(RangeError)
  })

  docsExample('bizonylatok/lekeres', 'a sandbox példája', async () => {
    const { tarca, billingo } = docsClient()

    const szamla = await tarca.documents.create({
      vendorId: 'ORDER-1001',
      partner: BUYER,
      items: ITEMS,
    })
    const azonositoval = await tarca.documents.get(szamla.id ?? 0)
    const vendorIdval = await tarca.documents.getByVendorId('ORDER-1001')
    const nincsIlyen = await tarca.documents.findByVendorId('ORDER-9999')

    expect([azonositoval.invoiceNumber, vendorIdval.invoiceNumber, nincsIlyen]).toEqual([
      '2026-1',
      '2026-1',
      null,
    ])
    expect(billingo.requests.at(-1)?.status).toBe(404)
  })
})

describe('bizonylatok/lista', () => {
  docsExample('bizonylatok/lista/keres', 'a szűrők query paraméterei', async () => {
    const { tarca, billingo } = docsClient()

    const oldal = await tarca.documents.list({
      type: 'invoice',
      paymentStatus: 'outstanding',
      startDate: '2026-11-01',
      endDate: new Date('2026-11-16T23:30:00Z'),
      lastModifiedDate: new Date('2026-11-16T10:00:00Z'),
      perPage: 50,
    })

    expect(oldal).toMatchObject({ total: 0, data: [] })
    expect(billingo.requests[0]?.query).toEqual({
      per_page: '50',
      payment_status: 'outstanding',
      start_date: '2026-11-01',
      end_date: '2026-11-17',
      type: 'invoice',
      last_modified_date: '2026-11-16 11:00:00',
    })
  })

  docsExample(
    'bizonylatok/lista/keres',
    'hibás lapozás és lastModifiedDate RangeError',
    async () => {
      const { tarca, billingo } = docsClient()

      await expect(tarca.documents.list({ perPage: 101 })).rejects.toBeInstanceOf(RangeError)
      await expect(tarca.documents.list({ page: 0 })).rejects.toBeInstanceOf(RangeError)
      await expect(tarca.documents.list({ lastModifiedDate: '2026-11-16' })).rejects.toBeInstanceOf(
        RangeError,
      )
      expect(billingo.requests).toEqual([])
    },
  )

  docsExample('bizonylatok/lista/valasz', 'all() a kifizetetlen számlákon', async () => {
    const { tarca, billingo } = await withPartner()
    const fizetett = await tarca.documents.create({ partner: 1, items: ITEMS })
    await tarca.documents.create({ partner: 1, items: ITEMS })
    await tarca.documents.payments.replace(fizetett.id ?? 0, [
      { date: '2026-11-16', price: 190_500, paymentMethod: 'wire_transfer' },
    ])
    const szamok: string[] = []

    for await (const szamla of tarca.documents.all({
      type: 'invoice',
      paymentStatus: 'outstanding',
    })) {
      szamok.push(szamla.invoiceNumber ?? '')
    }

    expect(szamok).toEqual(['2026-2'])
    expect(billingo.requests.at(-1)?.query).toMatchObject({ per_page: '100', page: '1' })
  })

  docsExample('bizonylatok/lista/minta', 'kettesével lapozva, majd az összes', async () => {
    const { tarca } = docsClient()
    const partner = BUYER

    for (const orak of [2, 4, 6]) {
      await tarca.documents.create({
        partner,
        items: [{ name: 'Tanácsadás', quantity: orak, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
      })
    }
    const oldal = await tarca.documents.list({ paymentStatus: 'outstanding', perPage: 2 })
    let osszesen = 0
    for await (const szamla of tarca.documents.all({ type: 'invoice' })) {
      osszesen += szamla.grossTotal ?? 0
    }

    expect([oldal.total, oldal.currentPage, oldal.lastPage]).toEqual([3, 1, 2])
    expect(oldal.data.map((szamla) => szamla.invoiceNumber)).toEqual(['2026-3', '2026-2'])
    expect(osszesen).toBe(304_800)
  })
})

describe('bizonylatok/piszkozat', () => {
  docsExample(
    'bizonylatok/piszkozat/keres',
    'véglegesítés ugyanazzal az azonosítóval',
    async () => {
      const { tarca, billingo } = docsClient()
      const szamla = { partner: BUYER, items: ITEMS }

      const piszkozat = await tarca.documents.create({ ...szamla, type: 'draft' })
      const vegleges = await tarca.documents.finalizeDraft(piszkozat.id ?? 0, {
        ...szamla,
        comment: 'Átnézve.',
      })

      expect(piszkozat).toMatchObject({ type: 'draft', invoiceNumber: '', paymentStatus: 'none' })
      expect(vegleges).toMatchObject({ id: piszkozat.id, type: 'invoice', invoiceNumber: '2026-1' })
      expect(
        billingo.requests.find((request) => request.operation === 'CreateDocumentFromDraft'),
      ).toMatchObject({ status: 201, body: expect.objectContaining({ type: 'invoice' }) })
    },
  )

  docsExample('bizonylatok/piszkozat/keres', 'piszkozat törlése', async () => {
    const { tarca, billingo } = await withPartner()
    const piszkozatId =
      (await tarca.documents.create({ type: 'draft', partner: 1, items: ITEMS })).id ?? 0

    await tarca.documents.deleteDraft(piszkozatId)

    expect(billingo.requests.at(-1)).toMatchObject({ operation: 'DeleteDocument', status: 204 })
  })

  docsExample('bizonylatok/piszkozat/keres', 'draft típussal nem véglegesíthető', async () => {
    const { tarca, billingo } = await withPartner()

    const error = await tarca.documents
      .finalizeDraft(1, { type: 'draft' as never, partner: 1, items: ITEMS })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.fieldErrors[0]?.field).toBe('type')
    expect(billingo.count('CreateDocumentFromDraft')).toBe(0)
  })

  docsExample(
    'bizonylatok/piszkozat/valasz',
    'bizonytalan törlés után a 403 igazolja',
    async () => {
      const { tarca, billingo } = await withPartner()
      const id = (await tarca.documents.create({ type: 'draft', partner: 1, items: ITEMS })).id ?? 0
      billingo.fail('network', { operation: 'DeleteDocument', afterSuccess: true })

      try {
        await tarca.documents.deleteDraft(id)
      } catch (error) {
        if (!isBillingoError(error) || !['network', 'timeout', 'server'].includes(error.category)) {
          throw error
        }
        const megvan = await tarca.documents.get(id).then(
          () => true,
          (lekeresHiba: unknown) =>
            !(isBillingoError(lekeresHiba) && lekeresHiba.category === 'forbidden'),
        )
        if (megvan) throw error
      }

      expect(billingo.data.documents.has(id)).toBe(false)
    },
  )

  docsExample('bizonylatok/piszkozat/valasz', 'kiállított számla nem törölhető', async () => {
    const { tarca, szamlaId } = await issued()

    const error = await tarca.documents.deleteDraft(szamlaId).catch((caught: unknown) => caught)

    expect(isBillingoError(error) && [error.status, error.category]).toEqual([400, 'validation'])
  })

  docsExample(
    'bizonylatok/piszkozat/minta',
    'piszkozatból számla, törölt piszkozat 403',
    async () => {
      const { tarca } = docsClient()
      const szamla = { partner: BUYER, items: ITEMS }

      const piszkozat = await tarca.documents.create({ ...szamla, type: 'draft' })
      const veglegesitett = await tarca.documents.finalizeDraft(piszkozat.id ?? 0, szamla)
      const felesleges = await tarca.documents.create({ ...szamla, type: 'draft' })
      await tarca.documents.deleteDraft(felesleges.id ?? 0)
      const error = await tarca.documents.get(felesleges.id ?? 0).catch((caught: unknown) => caught)

      expect([piszkozat.id, piszkozat.type, piszkozat.invoiceNumber]).toEqual([1, 'draft', ''])
      expect([veglegesitett.id, veglegesitett.type, veglegesitett.invoiceNumber]).toEqual([
        1,
        'invoice',
        '2026-1',
      ])
      expect(isBillingoError(error) && [error.status, error.category]).toEqual([403, 'forbidden'])
    },
  )
})

describe('bizonylatok/masolas', () => {
  docsExample('bizonylatok/masolas', 'a másolat piszkozat, sorszám nélkül', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const masolat = await tarca.documents.copy(szamlaId)

    expect([masolat.type, masolat.invoiceNumber === '']).toEqual(['draft', true])
    expect(masolat.id).not.toBe(szamlaId)
    expect(billingo.requests.at(-1)).toMatchObject({ operation: 'DocumentCopy', status: 200 })
  })

  docsExample('bizonylatok/masolas', 'a sandbox példája', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({
      partner: BUYER,
      items: [{ name: 'Havi karbantartás', quantity: 1, netUnitPrice: 45_000, vat: 27 }],
      comment: 'Novemberi díj.',
    })
    const masolat = await tarca.documents.copy(szamla.id ?? 0)
    await tarca.documents.deleteDraft(masolat.id ?? 0)

    expect([masolat.id, masolat.type, masolat.invoiceNumber, masolat.comment]).toEqual([
      2,
      'draft',
      '',
      'Novemberi díj.',
    ])
    expect(masolat.items?.map((tetel) => tetel.name)).toEqual(['Havi karbantartás'])
  })
})

describe('bizonylatok/dijbekero', () => {
  docsExample('bizonylatok/dijbekero/keres', 'a törzs teljesítéssel és határidővel', async () => {
    const { tarca, billingo } = await withPartner()
    const dijbekeroId =
      (await tarca.documents.create({ type: 'proforma', partner: 1, items: ITEMS })).id ?? 0

    const szamla = await tarca.documents.createFromProforma(dijbekeroId, {
      fulfillmentDate: '2026-11-16',
      dueInDays: 0,
      comment: 'Fizetve átutalással.',
    })

    expect(szamla.paymentStatus).toBe('paid')
    const today = szamla.invoiceDate
    expect(sentBodies(billingo, 'CreateDocumentFromProforma')).toEqual([
      { comment: 'Fizetve átutalással.', fulfillment_date: '2026-11-16', due_date: today },
    ])
  })

  docsExample(
    'bizonylatok/dijbekero/valasz',
    'a számla megkeresése a relatedDocuments alapján',
    async () => {
      const { tarca } = await withPartner()
      const dijbekeroId =
        (await tarca.documents.create({ type: 'proforma', partner: 1, items: ITEMS })).id ?? 0
      await tarca.documents.createFromProforma(dijbekeroId)
      const partnerId = 1

      const oldal = await tarca.documents.list({ partnerId, type: 'invoice', perPage: 20 })
      const szamla = oldal.data.find((bizonylat) =>
        bizonylat.relatedDocuments?.some((kapcsolt) => kapcsolt.id === dijbekeroId),
      )

      expect(szamla?.invoiceNumber).toBe('2026-1')
    },
  )

  docsExample('bizonylatok/dijbekero/valasz', 'számla nem archiválható', async () => {
    const { tarca, szamlaId } = await issued()

    const error = await tarca.documents.archive(szamlaId).catch((caught: unknown) => caught)

    expect(isBillingoError(error) && [error.status, error.apiMessage]).toEqual([
      400,
      'Only proforma documents can be archived.',
    ])
  })

  docsExample('bizonylatok/dijbekero/minta', 'díjbekérő, fizetett számla, archiválás', async () => {
    const { tarca, billingo } = docsClient()
    const items = [{ name: 'Éves tárhely', quantity: 1, netUnitPrice: 48_000, vat: 27 }]

    const dijbekero = await tarca.documents.create({ type: 'proforma', partner: BUYER, items })
    const szamla = await tarca.documents.createFromProforma(dijbekero.id ?? 0, { dueInDays: 0 })
    await tarca.documents.archive(dijbekero.id ?? 0)

    expect([dijbekero.invoiceNumber, dijbekero.grossTotal]).toEqual(['000001', 60_960])
    expect([szamla.invoiceNumber, szamla.paymentStatus]).toEqual(['2026-1', 'paid'])
    expect(szamla.relatedDocuments).toEqual([{ id: dijbekero.id, invoiceNumber: '000001' }])
    expect(billingo.requests.at(-1)).toMatchObject({ operation: 'ArchiveDocument', status: 204 })
    expect((await tarca.documents.list()).data.map((item) => item.id)).not.toContain(dijbekero.id)
  })
})

describe('bizonylatok/elolegszamla', () => {
  docsExample('bizonylatok/elolegszamla', 'a végszámláról levonja az előleget', async () => {
    const { tarca, billingo } = docsClient()
    const partner = BUYER

    const eloleg = await tarca.documents.create({
      type: 'advance',
      partner,
      items: [{ name: 'Előleg', quantity: 1, netUnitPrice: 50_000, vat: 27 }],
    })
    const vegszamla = await tarca.documents.create({
      partner,
      items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 200_000, vat: 27 }],
      advanceInvoiceIds: [eloleg.id ?? 0],
    })

    expect([eloleg.grossTotal, vegszamla.grossTotal]).toEqual([63_500, 190_500])
    expect(vegszamla.items?.map((tetel) => [tetel.name, tetel.grossAmount])).toEqual([
      ['Konyhabútor', 254_000],
      ['Előleg', -63_500],
    ])
    expect(vegszamla.relatedDocuments).toEqual([{ id: eloleg.id, invoiceNumber: '2026-1' }])
    expect(sentBodies(billingo, 'CreateDocument')[1]).toMatchObject({ advance_invoice: [1] })
  })

  docsExample('bizonylatok/elolegszamla/minta', 'a sandbox példája', async () => {
    const { tarca } = docsClient()
    const partner = BUYER

    const eloleg = await tarca.documents.create({
      type: 'advance',
      partner,
      items: [{ name: 'Előleg', quantity: 1, netUnitPrice: 50_000, vat: 27 }],
    })
    const vegszamla = await tarca.documents.create({
      partner,
      items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 200_000, vat: 27 }],
      advanceInvoiceIds: [eloleg.id ?? 0],
    })

    expect([eloleg.invoiceNumber, vegszamla.invoiceNumber]).toEqual(['2026-1', '2026-2'])
    expect(vegszamla.grossTotal).toBe(190_500)
  })
})

describe('bizonylatok/sztorno', () => {
  docsExample('bizonylatok/sztorno/keres', 'ok és címzettek vesszővel', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const sztorno = await tarca.documents.cancel(szamlaId, {
      reason: 'A vevő elállt a vásárlástól.',
      recipients: ['vevo@example.hu', 'konyveles@example.hu'],
    })

    expect([sztorno.invoiceNumber, sztorno.grossTotal]).toEqual(['2026-2', -190_500])
    expect(billingo.requests.at(-1)).toMatchObject({ method: 'POST', status: 200 })
    expect(sentBodies(billingo, 'CancelDocument')).toEqual([
      {
        cancellation_reason: 'A vevő elállt a vásárlástól.',
        cancellation_recipients: 'vevo@example.hu,konyveles@example.hu',
      },
    ])
  })

  docsExample(
    'bizonylatok/sztorno/keres',
    'bemenet nélkül törzs sincs, hibás címre hiba',
    async () => {
      const { tarca, billingo, szamlaId } = await issued()

      const error = await tarca.documents
        .cancel(szamlaId, { recipients: ['rossz'] })
        .catch((caught: unknown) => caught)
      await tarca.documents.cancel(szamlaId)

      expect(isBillingoError(error) && error.fieldErrors[0]?.field).toBe('recipients.0')
      expect(sentBodies(billingo, 'CancelDocument')).toEqual([undefined])
    },
  )

  docsExample('bizonylatok/sztorno/valasz', 'az eredeti új állapota', async () => {
    const { tarca, szamlaId } = await issued()
    await tarca.documents.payments.add(szamlaId, {
      date: '2026-11-16',
      price: 1_000,
      paymentMethod: 'cash',
    })

    const sztorno = await tarca.documents.cancel(szamlaId)
    const eredeti = await tarca.documents.get(szamlaId)

    expect(sztorno.type).toBe('cancellation')
    expect(sztorno.relatedDocuments?.map((item) => item.id)).toContain(szamlaId)
    expect(eredeti).toMatchObject({
      cancelled: true,
      correctionType: 'canceled',
      paymentStatus: 'none',
    })
    expect(await tarca.documents.payments.list(szamlaId)).toEqual([])
  })

  docsExample('bizonylatok/sztorno/valasz', 'bizonytalan sztornó a cancelled alapján', async () => {
    const { tarca, billingo, szamlaId } = await issued()
    billingo.fail('network', { operation: 'CancelDocument', afterSuccess: true })

    async function sztornoz(id: number): Promise<void> {
      try {
        await tarca.documents.cancel(id, { reason: 'A vevő elállt a vásárlástól.' })
      } catch (error) {
        const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']
        if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
        const eredeti = await tarca.documents.get(id)
        if (!eredeti.cancelled) throw error
      }
    }

    await sztornoz(szamlaId)

    expect(billingo.count('CancelDocument')).toBe(1)
    expect((await tarca.documents.get(szamlaId)).cancelled).toBe(true)
  })

  docsExample('bizonylatok/sztorno/minta', 'számla, sztornó, eredeti sztornózva', async () => {
    const { tarca, billingo } = docsClient()

    const szamla = await tarca.documents.create({
      partner: BUYER,
      items: [{ name: 'Tanácsadás', quantity: 2, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
    })
    const sztorno = await tarca.documents.cancel(szamla.id ?? 0, {
      reason: 'A vevő elállt a vásárlástól.',
    })
    const eredeti = await tarca.documents.get(szamla.id ?? 0)

    expect([sztorno.invoiceNumber, sztorno.type, sztorno.grossTotal]).toEqual([
      '2026-2',
      'cancellation',
      -50_800,
    ])
    expect(eredeti.cancelled).toBe(true)
    expect(sentBodies(billingo, 'CancelDocument')).toEqual([
      { cancellation_reason: 'A vevő elállt a vásárlástól.' },
    ])
  })
})

describe('bizonylatok/modosito', () => {
  docsExample('bizonylatok/modosito/keres', 'különbözeti tétel negatív mennyiséggel', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const modosito = await tarca.documents.createModification(szamlaId, {
      items: [{ name: 'Webfejlesztés', quantity: -2, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
      comment: 'Két óra jóváírása.',
    })

    expect([modosito.invoiceNumber, modosito.grossTotal]).toEqual(['2026-2', -38_100])
    expect(sentBodies(billingo, 'CreateModificationDocument')).toEqual([
      {
        comment: 'Két óra jóváírása.',
        items: [
          {
            name: 'Webfejlesztés',
            quantity: -2,
            unit: 'óra',
            vat: '27%',
            unit_price: 15_000,
            unit_price_type: 'net',
          },
        ],
      },
    ])
  })

  docsExample('bizonylatok/modosito/keres', 'negatív árral ugyanaz a különbözet', async () => {
    const { tarca, szamlaId } = await issued()

    const modosito = await tarca.documents.createModification(szamlaId, {
      items: [{ name: 'Webfejlesztés', quantity: 1, unit: 'óra', netUnitPrice: -30_000, vat: 27 }],
    })

    expect(modosito.grossTotal).toBe(-38_100)
  })

  docsExample(
    'bizonylatok/modosito/valasz',
    'bizonytalan módosító a correctionType alapján',
    async () => {
      const { tarca, billingo, szamlaId } = await issued()
      billingo.fail('timeout', { operation: 'CreateModificationDocument', afterSuccess: true })
      const eredetiId = szamlaId

      try {
        await tarca.documents.createModification(eredetiId, {
          items: [
            { name: 'Webfejlesztés', quantity: -2, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
          ],
        })
      } catch (error) {
        const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']
        if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
        const eredeti = await tarca.documents.get(eredetiId)
        if (eredeti.correctionType !== 'modified') throw error
      }

      expect(billingo.count('CreateModificationDocument')).toBe(1)
    },
  )

  docsExample('bizonylatok/modosito/minta', 'két óra jóváírása, utána nincs sztornó', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
    const modosito = await tarca.documents.createModification(szamla.id ?? 0, {
      items: [{ name: 'Webfejlesztés', quantity: -2, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
      comment: 'Két óra jóváírása.',
    })
    const eredeti = await tarca.documents.get(szamla.id ?? 0)
    const error = await tarca.documents.cancel(szamla.id ?? 0).catch((caught: unknown) => caught)

    expect([modosito.invoiceNumber, modosito.type, modosito.grossTotal]).toEqual([
      '2026-2',
      'modification',
      -38_100,
    ])
    expect(modosito.relatedDocuments).toEqual([{ id: szamla.id, invoiceNumber: '2026-1' }])
    expect(eredeti.correctionType).toBe('modified')
    expect(isBillingoError(error) && [error.status, error.category, error.apiMessage]).toEqual([
      400,
      'validation',
      'Cannot cancel the document (id:1).',
    ])
    expect(isBillingoError(error) && error.hint).toContain('módosító számla')
  })
})

describe('bizonylatok/befizetes', () => {
  docsExample('bizonylatok/befizetes/keres', 'teljes csere csupasz tömbbel', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const befizetesek = await tarca.documents.payments.replace(szamlaId, [
      { date: '2026-11-10', price: 100_000, paymentMethod: 'wire_transfer' },
      { date: new Date(), price: 90_500, paymentMethod: 'bankcard', voucherNumber: 'K-1001' },
    ])

    expect(befizetesek).toHaveLength(2)
    expect((await tarca.documents.get(szamlaId)).paymentStatus).toBe('paid')
    expect(sentBodies(billingo, 'UpdatePayment')).toEqual([
      [
        { date: '2026-11-10', price: 100_000, payment_method: 'wire_transfer' },
        {
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          price: 90_500,
          payment_method: 'bankcard',
          voucher_number: 'K-1001',
        },
      ],
    ])
  })

  docsExample('bizonylatok/befizetes/keres', 'hibás befizetés kérés nélkül', async () => {
    const { tarca, billingo, szamlaId } = await issued()
    const before = billingo.requests.length

    const error = await tarca.documents.payments
      .add(szamlaId, { date: '2026-13-01', price: Number.NaN, paymentMethod: 'kp' as never })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.fieldErrors.map((item) => item.field)).toEqual([
      'payment.date',
      'payment.price',
      'payment.paymentMethod',
    ])
    expect(billingo.requests).toHaveLength(before)
  })

  docsExample('bizonylatok/befizetes/valasz', 'kiegészítés, törlés és az állapot', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const lista = await tarca.documents.payments.add(szamlaId, {
      date: '2026-11-16',
      price: 100_000,
      paymentMethod: 'wire_transfer',
    })
    const reszben = (await tarca.documents.get(szamlaId)).paymentStatus
    await tarca.documents.payments.clear(szamlaId)

    expect(lista).toEqual([
      {
        date: '2026-11-16',
        price: 100_000,
        paymentMethod: 'wire_transfer',
        voucherNumber: '',
        conversionRate: 1,
      },
    ])
    expect(reszben).toBe('partially_paid')
    expect(billingo.requests.at(-1)).toMatchObject({ operation: 'DeletePayment', status: 200 })
    expect((await tarca.documents.get(szamlaId)).paymentStatus).toBe('outstanding')
  })

  docsExample(
    'bizonylatok/befizetes/valasz',
    'bizonytalan add() után a voucherNumber dönt',
    async () => {
      const { tarca, billingo, szamlaId } = await issued()
      billingo.fail('network', { operation: 'UpdatePayment', afterSuccess: true })
      const befizetes: PaymentInput = {
        date: '2026-11-16',
        price: 63_500,
        paymentMethod: 'wire_transfer',
        voucherNumber: 'UTALAS-2026-0042',
      }

      try {
        await tarca.documents.payments.add(szamlaId, befizetes)
      } catch (error) {
        const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']
        if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
        const meglevok = await tarca.documents.payments.list(szamlaId)
        if (!meglevok.some((sor) => sor.voucherNumber === befizetes.voucherNumber)) throw error
      }

      expect(await tarca.documents.payments.list(szamlaId)).toHaveLength(1)
    },
  )

  docsExample('bizonylatok/befizetes/minta', 'két részlet, részleges, majd fizetett', async () => {
    const { tarca, billingo } = docsClient()

    const szamla = await tarca.documents.create({
      partner: BUYER,
      items: [{ name: 'Tanácsadás', quantity: 5, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
    })
    await tarca.documents.payments.add(szamla.id ?? 0, {
      date: new Date(),
      price: 63_500,
      paymentMethod: 'wire_transfer',
    })
    const reszben = await tarca.documents.get(szamla.id ?? 0)
    await tarca.documents.payments.add(szamla.id ?? 0, {
      date: new Date(),
      price: 63_500,
      paymentMethod: 'wire_transfer',
    })
    const kifizetve = await tarca.documents.get(szamla.id ?? 0)

    expect([szamla.grossTotal, reszben.paymentStatus, kifizetve.paymentStatus]).toEqual([
      127_000,
      'partially_paid',
      'paid',
    ])
    expect(sentBodies(billingo, 'UpdatePayment').at(-1)).toHaveLength(2)
  })
})

describe('bizonylatok/pdf', () => {
  docsExample('bizonylatok/pdf/keres', 'PDF, 80 mm-es blokk és link', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const pdf = await tarca.documents.pdf(szamlaId, { maxWaitMs: 10_000 })
    const blokk = await tarca.documents.posPdf(szamlaId, { size: 80 })
    const link = await tarca.documents.publicUrl(szamlaId)

    expect(pdf.filename).toBe('2026-1.pdf')
    expect(blokk.bytes.length).toBeGreaterThan(0)
    expect(link).toMatch(/^https:\/\/api\.billingo\.hu\/document-access\//)
    expect(billingo.requests.find((request) => request.operation === 'PosPrint')?.query).toEqual({
      size: '80',
    })
  })

  docsExample('bizonylatok/pdf/keres', 'ismeretlen papírszélesség kérés nélkül', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const error = await tarca.documents
      .posPdf(szamlaId, { size: 70 as never })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.fieldErrors[0]?.field).toBe('size')
    expect(billingo.count('PosPrint')).toBe(0)
  })

  docsExample('bizonylatok/pdf/valasz', 'tartalomtípusok és a not_ready', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const pdf = await tarca.documents.pdf(szamlaId)
    const blokk = await tarca.documents.posPdf(szamlaId, { size: 58 })
    billingo.fail('notReady', { operation: 'DownloadDocument' })
    const error = await tarca.documents
      .pdf(szamlaId, { maxWaitMs: 0 })
      .catch((caught: unknown) => caught)

    expect([pdf.contentType, blokk.contentType]).toEqual([
      'application/pdf',
      'application/octet-stream',
    ])
    expect(new TextDecoder().decode(blokk.bytes.slice(0, 4))).toBe('%PDF')
    expect(
      isBillingoError(error) && [error.category, error.status, error.apiMessage, error.retryable],
    ).toEqual(['not_ready', 202, 'Document PDF has not generated yet.', true])
  })

  docsExample('bizonylatok/pdf/valasz', 'pdfLetoltes a bájtokat adja', async () => {
    const { tarca, szamlaId } = await issued()

    async function pdfLetoltes(id: number): Promise<Uint8Array> {
      try {
        const { bytes } = await tarca.documents.pdf(id)
        return bytes
      } catch (error) {
        if (isBillingoError(error) && error.category === 'not_ready') {
          const { bytes } = await tarca.documents.pdf(id, { maxWaitMs: 120_000 })
          return bytes
        }
        throw error
      }
    }

    expect((await pdfLetoltes(szamlaId)).length).toBeGreaterThan(0)
  })

  docsExample('bizonylatok/pdf/valasz', 'a bináris válasz rate limit fejlécei', async () => {
    const limits: unknown[] = []
    const { tarca } = docsClient({
      hooks: { onResponse: (event) => limits.push(event.rateLimit) },
    })
    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })

    await tarca.documents.pdf(szamla.id ?? 0)

    expect(limits.at(-1)).toMatchObject({ limit: 300 })
    expect(limits.slice(0, -1).every((limit) => limit === undefined)).toBe(true)
  })

  docsExample('bizonylatok/pdf/minta', 'A4-es PDF és 80 mm-es blokk', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
    const pdf = await tarca.documents.pdf(szamla.id ?? 0)
    const blokk = await tarca.documents.posPdf(szamla.id ?? 0, { size: 80 })

    expect([pdf.filename, blokk.filename]).toEqual(['2026-1.pdf', '2026-1.pdf'])
  })

  docsExample('bizonylatok/pdf/minta', 'nyilvános link', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
    const link = await tarca.documents.publicUrl(szamla.id ?? 0)

    expect(link).toMatch(/^https:\/\/api\.billingo\.hu\/document-access\/\w+$/)
    expect(await tarca.documents.publicUrl(szamla.id ?? 0)).toBe(link)
  })
})

describe('bizonylatok/kuldes', () => {
  docsExample('bizonylatok/kuldes/keres', 'kiküldés két címre', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const { emails } = await tarca.documents.send(szamlaId, {
      emails: ['vevo@example.hu', 'konyveles@example.hu'],
    })

    expect(emails).toEqual(['vevo@example.hu', 'konyveles@example.hu'])
    expect(sentBodies(billingo, 'SendDocument')).toEqual([
      { emails: ['vevo@example.hu', 'konyveles@example.hu'] },
    ])
  })

  docsExample('bizonylatok/kuldes/keres', 'üres és hibás címlista', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const ures = await tarca.documents
      .send(szamlaId, { emails: [] })
      .catch((caught: unknown) => caught)
    const hibas = await tarca.documents
      .send(szamlaId, { emails: ['vevo@example.hu', 'rossz cim'] })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(ures) && ures.fieldErrors[0]?.field).toBe('emails')
    expect(isBillingoError(hibas) && hibas.fieldErrors[0]?.field).toBe('emails.1')
    expect(billingo.count('SendDocument')).toBe(0)
  })

  docsExample('bizonylatok/kuldes/keres', 'emlékeztetők friss számlán', async () => {
    const { tarca, szamlaId } = await issued()

    const { sentReminders, upcomingReminders } = await tarca.documents.reminders(szamlaId)

    expect([sentReminders?.length, upcomingReminders?.length]).toEqual([0, 0])
  })

  docsExample('bizonylatok/kuldes/minta', 'kiküldés és emlékeztetők', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
    const kikuldve = await tarca.documents.send(szamla.id ?? 0, {
      emails: ['vevo@example.hu', 'konyveles@example.hu'],
    })
    const emlekeztetok = await tarca.documents.reminders(szamla.id ?? 0)

    expect(kikuldve.emails).toEqual(['vevo@example.hu', 'konyveles@example.hu'])
    expect(emlekeztetok).toEqual({ sentReminders: [], upcomingReminders: [], sentPostalMail: [] })
  })
})

describe('bizonylatok/nav-statusz', () => {
  docsExample('bizonylatok/nav-statusz', 'közvetlenül a kiállítás után null', async () => {
    const { tarca, billingo, szamlaId } = await issued()

    const nav = await tarca.documents.navStatus(szamlaId)

    expect(nav).toBeNull()
    expect(billingo.requests.at(-1)?.status).toBe(404)
  })

  docsExample(
    'bizonylatok/nav-statusz',
    'a teszt profil no_online_szamla_settings válasza',
    async () => {
      const { tarca } = docsClient({}, { navRecordDelayMs: 0 })
      const szamlaId = (await tarca.documents.create({ partner: BUYER, items: ITEMS })).id ?? 0

      const nav = await tarca.documents.navStatus(szamlaId)

      expect(nav).toEqual({
        transactionId: '',
        status: 'no_online_szamla_settings',
        messages: [
          {
            validationResultCode: '',
            validationErrorCode: '',
            humanReadableMessage: 'NAV Online Számla összeköttetés nincs beállítva.',
          },
        ],
      })
    },
  )

  docsExample('bizonylatok/nav-statusz', 'a sandbox példája', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
    const nav = await tarca.documents.navStatus(szamla.id ?? 0)

    expect([szamla.invoiceNumber, szamla.onlineSzamlaStatus, nav]).toEqual([
      '2026-1',
      'processing',
      null,
    ])
  })
})
