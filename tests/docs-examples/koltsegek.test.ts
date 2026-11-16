import { describe, expect } from 'vitest'
import {
  BillingoError,
  isBillingoError,
  nullIfNotFound,
  type SpendingInput,
  todayInBudapest,
} from '../../src/index'
import { docsClient, docsExample, sentBodies } from './helpers'

const SZOFTVER: SpendingInput = {
  category: 'software',
  currency: 'HUF',
  conversionRate: 1,
  totalGross: 12_700,
  totalGrossHuf: 12_700,
  totalVatAmount: 2_700,
  totalVatAmountHuf: 2_700,
  invoiceNumber: 'SZLA-2026-42',
  invoiceDate: '2026-11-10',
  fulfillmentDate: '2026-11-10',
  dueDate: '2026-11-18',
  paymentMethod: 'wire_transfer',
}

const SZOFTVER_TORZS = {
  category: 'software',
  currency: 'HUF',
  conversion_rate: 1,
  total_gross: 12_700,
  total_gross_huf: 12_700,
  total_vat_amount: 2_700,
  total_vat_amount_huf: 2_700,
  invoice_number: 'SZLA-2026-42',
  payment_method: 'wire_transfer',
  fulfillment_date: '2026-11-10',
  invoice_date: '2026-11-10',
  due_date: '2026-11-18',
}

const HIRDETES = {
  category: 'advertisement',
  currency: 'HUF',
  conversionRate: 1,
  totalGross: 63_500,
  totalGrossHuf: 63_500,
  totalVatAmount: 13_500,
  totalVatAmountHuf: 13_500,
  invoiceNumber: 'HIRDETES-2026-7',
  invoiceDate: '2026-11-03',
  fulfillmentDate: '2026-11-03',
  dueDate: '2026-11-11',
  paymentMethod: 'wire_transfer',
  comment: 'Novemberi kampány',
} as const

const BERLET = {
  category: 'office_rent',
  currency: 'HUF',
  conversionRate: 1,
  totalGross: 254_000,
  totalGrossHuf: 254_000,
  totalVatAmount: 54_000,
  totalVatAmountHuf: 54_000,
  paymentMethod: 'wire_transfer',
} as const

describe('koltsegek/lista', () => {
  docsExample(
    'koltsegek/lista/keres',
    'lejárt, fizetetlen költségek a határidő szerint',
    async () => {
      const { tarca, billingo } = docsClient()
      await tarca.spendings.create({
        ...SZOFTVER,
        dueDate: '2026-01-10',
        invoiceNumber: 'LEJART-1',
      })
      await tarca.spendings.create({ ...SZOFTVER, dueDate: '2026-01-10', paidAt: '2026-01-09' })

      const lejart = await tarca.spendings.list({
        spendingDate: 'due_date',
        endDate: new Date(),
        paymentStatus: 'expired',
        perPage: 100,
      })

      expect(lejart.total).toBe(1)
      expect(lejart.data.map((koltseg) => koltseg.invoiceNumber)).toEqual(['LEJART-1'])
      expect(billingo.requests.at(-1)?.query).toEqual({
        spending_date: 'due_date',
        end_date: todayInBudapest(),
        payment_status: 'expired',
        per_page: '100',
      })
    },
  )

  docsExample(
    'koltsegek/lista/keres',
    'számlaszám keresése a kelt napjára szűrt listában',
    async () => {
      const { tarca, billingo } = docsClient()
      await tarca.spendings.create({ ...SZOFTVER, invoiceNumber: 'MAS-1' })
      const rogzitett = await tarca.spendings.create(SZOFTVER)

      async function koltsegSzamlaszamra(szamlaszam: string, kelt: string) {
        for await (const koltseg of tarca.spendings.all({
          spendingDate: 'invoice_date',
          startDate: kelt,
          endDate: kelt,
        })) {
          if (koltseg.invoiceNumber === szamlaszam) return koltseg
        }
        return undefined
      }

      const talalat = await koltsegSzamlaszamra('SZLA-2026-42', '2026-11-10')

      expect(talalat?.id).toBe(rogzitett.id)
      expect(billingo.requests.at(-1)?.query).toEqual({
        spending_date: 'invoice_date',
        start_date: '2026-11-10',
        end_date: '2026-11-10',
        page: '1',
        per_page: '100',
      })
    },
  )

  docsExample('koltsegek/lista/keres', 'hibás szűrőkre RangeError, kérés nélkül', async () => {
    const { tarca, billingo } = docsClient()

    await expect(tarca.spendings.list({ startDate: '15/11/2026' })).rejects.toThrow(
      new RangeError(
        'A dátumot YYYY-MM-DD formában vagy Date objektumként add meg, kapott: 15/11/2026',
      ),
    )
    await expect(tarca.spendings.list({ startDate: '2026-02-30' })).rejects.toThrow(
      new RangeError('Nem létező naptári dátum: 2026-02-30'),
    )
    await expect(tarca.spendings.list({ perPage: 101 })).rejects.toThrow(
      new RangeError('A perPage értéke 1 és 100 közötti egész szám legyen, kapott: 101'),
    )
    await expect(tarca.spendings.list({ page: 0 })).rejects.toThrow(
      new RangeError('A page értéke legalább 1 egész szám legyen, kapott: 0'),
    )
    expect(billingo.requests).toEqual([])
  })

  docsExample('koltsegek/lista/valasz', 'üres lista: 25-ös oldalméret, lastPage 1', async () => {
    const { tarca } = docsClient()

    const oldal = await tarca.spendings.list({ paymentStatus: 'unpaid' })

    expect(oldal).toEqual({ data: [], total: 0, perPage: 25, currentPage: 1, lastPage: 1 })
  })

  docsExample(
    'koltsegek/lista/minta',
    'két bérleti díjból csak a fizetetlen jön vissza',
    async () => {
      const { tarca, billingo } = docsClient()
      await tarca.spendings.create({
        ...BERLET,
        invoiceNumber: 'BERLET-2026-10',
        invoiceDate: '2026-10-01',
        fulfillmentDate: '2026-10-01',
        dueDate: '2026-10-08',
        paidAt: '2026-10-06',
      })
      await tarca.spendings.create({
        ...BERLET,
        invoiceNumber: 'BERLET-2026-11',
        invoiceDate: '2026-11-02',
        fulfillmentDate: '2026-11-02',
        dueDate: '2026-11-09',
      })

      const fizetetlen = await tarca.spendings.list({
        spendingDate: 'invoice_date',
        startDate: '2026-10-01',
        endDate: '2026-11-30',
        paymentStatus: 'unpaid',
        categories: 'office_rent',
      })

      expect(fizetetlen.total).toBe(1)
      expect(fizetetlen.data.map((koltseg) => koltseg.invoiceNumber)).toEqual(['BERLET-2026-11'])
      expect(fizetetlen.data[0]).toMatchObject({ createdByNav: false })
      expect(fizetetlen.data[0]).not.toHaveProperty('items')
      const lista = billingo.requests[2]
      expect(lista?.operation).toBe('SpendingList')
      expect(Object.entries(lista?.query ?? {})).toEqual([
        ['spending_date', 'invoice_date'],
        ['start_date', '2026-10-01'],
        ['end_date', '2026-11-30'],
        ['payment_status', 'unpaid'],
        ['categories', 'office_rent'],
      ])
    },
  )
})

describe('koltsegek/letrehozas', () => {
  docsExample('koltsegek/letrehozas/keres', 'forintos költség, a törzs snake_case', async () => {
    const { tarca, billingo } = docsClient()

    const koltseg = await tarca.spendings.create(SZOFTVER)

    expect(koltseg).toMatchObject({ totalGrossLocal: 12_700, paidAt: null, partner: null })
    expect(sentBodies(billingo, 'SpendingSave')).toEqual([SZOFTVER_TORZS])
  })

  docsExample('koltsegek/letrehozas/keres', 'devizás költség a Billingo árfolyamával', async () => {
    const { tarca, billingo } = docsClient()

    const { rate } = await tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: '2026-11-10' })

    const koltseg = await tarca.spendings.create({
      category: 'online_subscriptions',
      currency: 'EUR',
      conversionRate: rate,
      totalGross: 127,
      totalGrossHuf: Math.round(127 * rate),
      totalVatAmount: 27,
      totalVatAmountHuf: Math.round(27 * rate),
      invoiceNumber: 'INV-2026-1107',
      invoiceDate: '2026-11-10',
      fulfillmentDate: '2026-11-10',
      dueDate: '2026-11-10',
      paidAt: '2026-11-10',
      paymentMethod: 'bankcard',
    })

    expect(rate).toBe(390)
    expect(koltseg.totalGrossLocal).toBe(49_530)
    expect(koltseg.totalVatAmountLocal).toBe(10_530)
    expect(sentBodies(billingo, 'SpendingSave')).toEqual([
      expect.objectContaining({
        conversion_rate: 390,
        total_gross_huf: 49_530,
        total_vat_amount_huf: 10_530,
        paid_at: '2026-11-10',
      }),
    ])
  })

  docsExample(
    'koltsegek/letrehozas/keres',
    'hibás dátumokra mezőnkénti hiba, kérés nélkül',
    async () => {
      const { tarca, billingo } = docsClient()
      let hiba: unknown

      try {
        await tarca.spendings.create({
          category: 'software',
          currency: 'HUF',
          conversionRate: 1,
          totalGross: 12_700,
          totalGrossHuf: 12_700,
          totalVatAmount: 2_700,
          totalVatAmountHuf: 2_700,
          invoiceNumber: 'SZLA-2026-42',
          invoiceDate: '2026-02-30',
          fulfillmentDate: '2026-11-10',
          dueDate: '2026.11.18',
          paymentMethod: 'wire_transfer',
        })
      } catch (error) {
        hiba = error
      }

      expect(hiba).toBeInstanceOf(BillingoError)
      expect(hiba).toMatchObject({
        category: 'validation',
        operation: 'SpendingSave',
        fieldErrors: [
          { field: 'invoiceDate', message: 'Nem létező naptári dátum: 2026-02-30' },
          { field: 'dueDate', message: expect.stringContaining('2026.11.18') },
        ],
      })
      expect(billingo.requests).toEqual([])
    },
  )

  docsExample(
    'koltsegek/letrehozas/keres',
    'nem létező partnerre a hamis Billingo partner_id hibát ad',
    async () => {
      const { tarca } = docsClient()

      await expect(tarca.spendings.create({ ...SZOFTVER, partnerId: 5 })).rejects.toMatchObject({
        category: 'validation',
        status: 422,
        fieldErrors: [{ field: 'partner_id', message: 'The selected partner id is invalid.' }],
      })
    },
  )

  docsExample(
    'koltsegek/letrehozas/valasz',
    'rogzitEgyszer elveszett válasz után a meglévőt adja',
    async () => {
      const { tarca, billingo } = docsClient()
      const BIZONYTALAN = new Set(['network', 'timeout', 'server', 'unexpected_response'])

      async function rogzitEgyszer(adatok: SpendingInput & { invoiceDate: string }) {
        try {
          return await tarca.spendings.create(adatok)
        } catch (error) {
          if (!isBillingoError(error) || !BIZONYTALAN.has(error.category)) throw error
          for await (const koltseg of tarca.spendings.all({
            spendingDate: 'invoice_date',
            startDate: adatok.invoiceDate,
            endDate: adatok.invoiceDate,
          })) {
            if (koltseg.invoiceNumber === adatok.invoiceNumber) return koltseg
          }
          return await tarca.spendings.create(adatok)
        }
      }

      const adatok = { ...SZOFTVER, invoiceDate: '2026-11-10' }
      billingo.fail('network', { operation: 'SpendingSave', afterSuccess: true })
      const koltseg = await rogzitEgyszer(adatok)

      expect(koltseg.id).toBe(1)
      expect(billingo.count('SpendingSave')).toBe(1)
      expect(billingo.data.spendings.size).toBe(1)

      billingo.fail('network', { operation: 'SpendingSave' })
      const masik = await rogzitEgyszer({ ...adatok, invoiceNumber: 'SZLA-2026-43' })

      expect(masik.id).toBe(2)
      expect(billingo.data.spendings.size).toBe(2)
    },
  )

  docsExample('koltsegek/letrehozas/valasz', '201, partner null, createdByNav nélkül', async () => {
    const { tarca, billingo } = docsClient()

    const koltseg = await tarca.spendings.create(SZOFTVER)

    expect(billingo.requests[0]?.status).toBe(201)
    expect(koltseg.partner).toBeNull()
    expect(koltseg.items).toEqual([])
    expect(koltseg).not.toHaveProperty('createdByNav')
  })

  docsExample('koltsegek/letrehozas/minta', 'rögzítés, majd lekérés createdByNav-val', async () => {
    const { tarca, billingo } = docsClient()

    const koltseg = await tarca.spendings.create({ ...SZOFTVER, comment: 'Tárhely, november' })
    const lekert = await tarca.spendings.get(koltseg.id ?? 0)

    expect([koltseg.id, koltseg.totalGrossLocal, koltseg.partner]).toEqual([1, 12_700, null])
    expect(['createdByNav' in koltseg, lekert.createdByNav]).toEqual([false, false])
    expect(sentBodies(billingo, 'SpendingSave')[0]).not.toHaveProperty('paid_at')
    expect(sentBodies(billingo, 'SpendingSave')[0]).not.toHaveProperty('partner_id')
  })
})

describe('koltsegek/lekeres', () => {
  docsExample('koltsegek/lekeres', 'nullIfNotFound: ismeretlen azonosítóra null', async () => {
    const { tarca, billingo } = docsClient()

    const koltseg = await nullIfNotFound(tarca.spendings.get(1))

    expect(koltseg).toBeNull()
    expect(billingo.requests[0]?.status).toBe(404)
    await expect(tarca.spendings.get(1)).rejects.toMatchObject({
      category: 'not_found',
      status: 404,
      apiMessage: 'Spending is not found.',
    })
  })

  docsExample('koltsegek/lekeres', 'a lekérés válaszában ott a createdByNav', async () => {
    const { tarca } = docsClient()
    const { id } = await tarca.spendings.create(SZOFTVER)

    const koltseg = await nullIfNotFound(tarca.spendings.get(id ?? 0))

    expect(koltseg).toMatchObject({
      invoiceNumber: 'SZLA-2026-42',
      paidAt: null,
      createdByNav: false,
    })
  })
})

describe('koltsegek/modositas', () => {
  docsExample(
    'koltsegek/modositas/keres',
    'fizetés rögzítése a teljes költség újraküldésével',
    async () => {
      const { tarca, billingo } = docsClient()
      const adatok: SpendingInput = HIRDETES

      const koltseg = await tarca.spendings.create(adatok)
      const fizetett = await tarca.spendings.update(koltseg.id ?? 0, {
        ...adatok,
        paidAt: '2026-11-10',
      })

      expect([fizetett.paidAt, fizetett.comment]).toEqual(['2026-11-10', 'Novemberi kampány'])
      expect(sentBodies(billingo, 'SpendingUpdate')).toEqual([
        {
          category: 'advertisement',
          currency: 'HUF',
          conversion_rate: 1,
          total_gross: 63_500,
          total_gross_huf: 63_500,
          total_vat_amount: 13_500,
          total_vat_amount_huf: 13_500,
          invoice_number: 'HIRDETES-2026-7',
          payment_method: 'wire_transfer',
          comment: 'Novemberi kampány',
          fulfillment_date: '2026-11-03',
          invoice_date: '2026-11-03',
          due_date: '2026-11-11',
          paid_at: '2026-11-10',
        },
      ])
    },
  )

  docsExample('koltsegek/modositas/keres', 'fizetettnek jelölés a lekért költségből', async () => {
    const { tarca, billingo } = docsClient()
    const { id } = await tarca.spendings.create(HIRDETES)

    async function fizetettnekJelol(id: number, nap: string) {
      const koltseg = await tarca.spendings.get(id)
      const { category, currency, paymentMethod } = koltseg
      if (category === undefined || currency === undefined || paymentMethod === undefined) {
        throw new Error(`A ${id} költség adatai hiányosak.`)
      }
      const adatok: SpendingInput = {
        category,
        currency,
        conversionRate: koltseg.conversionRate ?? 1,
        totalGross: koltseg.totalGross ?? 0,
        totalGrossHuf: koltseg.totalGrossLocal ?? 0,
        totalVatAmount: koltseg.totalVatAmount ?? 0,
        totalVatAmountHuf: koltseg.totalVatAmountLocal ?? 0,
        invoiceNumber: koltseg.invoiceNumber ?? '',
        invoiceDate: koltseg.invoiceDate ?? nap,
        fulfillmentDate: koltseg.fulfillmentDate ?? nap,
        dueDate: koltseg.dueDate ?? nap,
        paymentMethod,
        paidAt: nap,
        ...(koltseg.comment != null ? { comment: koltseg.comment } : {}),
        ...(koltseg.partner?.id != null ? { partnerId: koltseg.partner.id } : {}),
      }
      return tarca.spendings.update(id, adatok)
    }

    const fizetett = await fizetettnekJelol(id ?? 0, '2026-11-12')

    expect(fizetett).toMatchObject({ paidAt: '2026-11-12', comment: 'Novemberi kampány' })
    expect(sentBodies(billingo, 'SpendingUpdate')[0]).toMatchObject({
      total_gross_huf: 63_500,
      total_vat_amount_huf: 13_500,
      paid_at: '2026-11-12',
    })
    expect(sentBodies(billingo, 'SpendingUpdate')[0]).not.toHaveProperty('partner_id')
  })

  docsExample(
    'koltsegek/modositas/keres',
    'hibás dátumra SpendingUpdate hiba, kérés nélkül',
    async () => {
      const { tarca, billingo } = docsClient()

      await expect(
        tarca.spendings.update(1, { ...HIRDETES, paidAt: '2026-11-31' }),
      ).rejects.toMatchObject({
        category: 'validation',
        operation: 'SpendingUpdate',
        fieldErrors: [{ field: 'paidAt', message: 'Nem létező naptári dátum: 2026-11-31' }],
      })
      expect(billingo.requests).toEqual([])
    },
  )

  docsExample(
    'koltsegek/modositas/valasz',
    'az ismételt módosítás ugyanazt az állapotot adja',
    async () => {
      const { tarca, billingo } = docsClient()
      const { id } = await tarca.spendings.create(HIRDETES)

      const elso = await tarca.spendings.update(id ?? 0, { ...HIRDETES, paidAt: '2026-11-10' })
      const masodik = await tarca.spendings.update(id ?? 0, { ...HIRDETES, paidAt: '2026-11-10' })

      expect(masodik).toEqual(elso)
      expect(masodik.id).toBe(id)
      expect(billingo.data.spendings.size).toBe(1)
      expect(billingo.requests.at(-1)?.status).toBe(200)
      await expect(tarca.spendings.update(99, HIRDETES)).rejects.toMatchObject({
        category: 'not_found',
        apiMessage: 'Spending is not found.',
      })
    },
  )

  docsExample('koltsegek/modositas/minta', 'módosítás, törlés, majd a lekérés null', async () => {
    const { tarca, billingo } = docsClient()
    const adatok = HIRDETES

    const koltseg = await tarca.spendings.create(adatok)
    const fizetett = await tarca.spendings.update(koltseg.id ?? 0, {
      ...adatok,
      paidAt: '2026-11-10',
    })
    await tarca.spendings.delete(koltseg.id ?? 0)
    const torolt = await nullIfNotFound(tarca.spendings.get(koltseg.id ?? 0))

    expect([fizetett.paidAt, fizetett.comment]).toEqual(['2026-11-10', 'Novemberi kampány'])
    expect(torolt).toBeNull()
    expect(
      billingo.requests.map((request) => `${request.method} ${request.path} ${request.status}`),
    ).toEqual([
      'POST /spendings 201',
      'PUT /spendings/1 200',
      'DELETE /spendings/1 204',
      'GET /spendings/1 404',
    ])
  })
})

describe('koltsegek/torles', () => {
  docsExample('koltsegek/torles', 'a törlés ismételhető, a második 404-et kap', async () => {
    const { tarca, billingo } = docsClient()
    const { id } = await tarca.spendings.create(SZOFTVER)

    async function torol(id: number) {
      await nullIfNotFound(tarca.spendings.delete(id))
    }

    await torol(id ?? 0)
    await torol(id ?? 0)
    await torol(1)

    expect(billingo.data.spendings.size).toBe(0)
    expect(
      billingo.requests
        .filter((request) => request.operation === 'SpendingDelete')
        .map((request) => request.status),
    ).toEqual([204, 404, 404])
  })
})
