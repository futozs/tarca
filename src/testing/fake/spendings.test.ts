import { describe, expect, test } from 'vitest'
import {
  createFakeExchangeLog,
  fakeExchangeSpecErrors,
  succeededOperations,
} from '../../../tests/fake-exchanges'
import { loadMergedSpec, SPEC_AVAILABLE } from '../../../tests/openapi'
import {
  FAKE_ORGANIZATION_ID,
  SPENDING_CATEGORIES,
  SPENDING_NOT_FOUND,
  SPENDING_PAYMENT_METHODS,
  spendingRoutes,
} from './spendings'

const log = createFakeExchangeLog()

const NOW = new Date('2026-11-15T13:50:07Z')

const SPENDING = {
  category: 'other',
  currency: 'HUF',
  conversion_rate: 1,
  total_gross: 1270,
  total_gross_huf: 1270,
  total_vat_amount: 270,
  total_vat_amount_huf: 270,
  fulfillment_date: '2026-11-15',
  invoice_number: 'TARCA-PROBE-S1',
  invoice_date: '2026-11-15',
  due_date: '2026-11-15',
  payment_method: 'cash',
  comment: 'TARCA-PROBE',
}

const CREATED = {
  id: 1,
  organization_id: FAKE_ORGANIZATION_ID,
  category: 'other',
  paid_at: null,
  fulfillment_date: '2026-11-15',
  partner: null,
  invoice_number: 'TARCA-PROBE-S1',
  currency: 'HUF',
  conversion_rate: 1,
  total_gross: 1270,
  total_gross_local: 1270,
  total_vat_amount: 270,
  total_vat_amount_local: 270,
  invoice_date: '2026-11-15',
  due_date: '2026-11-15',
  payment_method: 'cash',
  comment: 'TARCA-PROBE',
  items: [],
}

const PARTNER = {
  name: 'Nyomda Kft.',
  address: { country_code: 'HU', post_code: '1011', city: 'Budapest', address: 'Fő utca 1.' },
  taxcode: '12345678-2-42',
}

function harness() {
  return log.harness({ now: () => NOW })
}

describe('hamis Billingo: költségek', () => {
  test('létrehozás: 201 az élő alakkal (created_by_nav nélkül), a forintos összeg úgy marad, ahogy küldtük', async () => {
    const { call } = harness()

    const created = await call('POST', '/spendings', SPENDING)

    expect(created.status).toBe(201)
    expect(created.body).toEqual(CREATED)
    const euro = await call('POST', '/spendings', {
      ...SPENDING,
      currency: 'EUR',
      conversion_rate: 389.17,
      total_gross: 127,
      total_gross_huf: 49_500,
      total_vat_amount: 27,
      total_vat_amount_huf: 10_500,
    })
    expect(euro.body).toMatchObject({
      id: 2,
      conversion_rate: 389.17,
      total_gross: 127,
      total_gross_local: 49_500,
      total_vat_amount: 27,
      total_vat_amount_local: 10_500,
    })
  })

  test('validáció: az élőben kötelező árfolyam, számlaszám, számladátum és határidő, az élő sorrendben', async () => {
    const { call, billingo } = harness()
    const {
      conversion_rate: _rate,
      invoice_number: _number,
      invoice_date: _date,
      due_date: _due,
      ...base
    } = SPENDING

    const missing = await call('POST', '/spendings', base)
    const wrong = await call('POST', '/spendings', {
      ...SPENDING,
      currency: 'XXX',
      total_gross: '1270',
      fulfillment_date: '2026-02-30',
      category: 'nincs',
      payment_method: 'kartya',
      partner_id: 999,
    })

    expect(missing.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'conversion_rate', message: 'The conversion rate field is required.' },
        { field: 'invoice_number', message: 'The invoice number field is required.' },
        { field: 'invoice_date', message: 'The invoice date field is required.' },
        { field: 'due_date', message: 'The due date field is required.' },
      ],
    })
    expect(wrong.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'currency', message: 'The selected currency is invalid.' },
        { field: 'total_gross', message: 'The total gross must be a number.' },
        {
          field: 'fulfillment_date',
          message: 'The fulfillment date does not match the format Y-m-d.',
        },
        { field: 'category', message: 'The selected category is invalid.' },
        { field: 'payment_method', message: 'The selected payment method is invalid.' },
        { field: 'partner_id', message: 'The selected partner id is invalid.' },
      ],
    })
    expect(billingo.data.spendings.size).toBe(0)
  })

  test('partnerrel: a válaszban a partner beágyazva, a költség alakjában', async () => {
    const { call } = harness()
    const partner = await call('POST', '/partners', PARTNER)
    const partnerId = (partner.body as { id: number }).id

    const created = await call('POST', '/spendings', { ...SPENDING, partner_id: partnerId })

    expect(created.status).toBe(201)
    expect((created.body as { partner: unknown }).partner).toEqual({
      id: partnerId,
      name: 'Nyomda Kft.',
      tax_code: '12345678-2-42',
      address: PARTNER.address,
      iban: '',
      swift: '',
      account_number: '',
      phone: '',
      internal_comment: '',
      group_member_tax_number: '',
    })
  })

  test('lekérés: created_by_nav false (élőben ez a mező neve), módosítás teljes csere, törlés', async () => {
    const { call, billingo } = harness()
    await call('POST', '/spendings', SPENDING)
    const { comment: _comment, ...withoutComment } = SPENDING

    const shown = await call('GET', '/spendings/1')
    const updated = await call('PUT', '/spendings/1', { ...withoutComment, paid_at: '2026-11-15' })
    const invalid = await call('PUT', '/spendings/1', { ...SPENDING, invoice_date: '' })
    const deleted = await call('DELETE', '/spendings/1')
    const gone = await call('GET', '/spendings/1')
    const malformed = await call('GET', '/spendings/abc')

    expect(shown.body).toEqual({ ...CREATED, created_by_nav: false })
    expect(updated.body).toEqual({ ...CREATED, comment: '', paid_at: '2026-11-15' })
    expect(deleted.status).toBe(204)
    expect(invalid.body).toEqual({
      message: 'Validation Failed',
      errors: [{ field: 'invoice_date', message: 'The invoice date field is required.' }],
    })
    expect(gone).toMatchObject({ status: 404, body: { error: { message: SPENDING_NOT_FOUND } } })
    expect(malformed).toMatchObject({
      status: 404,
      body: { error: { message: SPENDING_NOT_FOUND } },
    })
    expect(billingo.data.spendings.size).toBe(0)
  })

  test('lista szűrőkkel: dátumtípus és tartomány, fizetési állapot, kategória, pénznem, fizetési mód', async () => {
    const { call } = harness()
    await call('POST', '/spendings', SPENDING)
    await call('POST', '/spendings', {
      ...SPENDING,
      invoice_number: 'S2',
      category: 'advertisement',
      currency: 'EUR',
      conversion_rate: 390,
      invoice_date: '2026-10-01',
      due_date: '2026-10-08',
      payment_method: 'wire_transfer',
    })
    await call('POST', '/spendings', {
      ...SPENDING,
      invoice_number: 'S3',
      due_date: '2026-11-30',
      paid_at: '2026-11-10',
    })
    const ids = async (query: string) => {
      const response = await call('GET', `/spendings${query}`)
      return (response.body as { data: { id: number }[] }).data.map((item) => item.id)
    }

    expect(await ids('')).toEqual([3, 2, 1])
    expect(
      await ids(
        '?spending_date=invoice_date&start_date=2026-11-15&end_date=2026-11-15&categories=other&payment_status=unpaid',
      ),
    ).toEqual([1])
    expect(await ids('?start_date=2026-10-01&end_date=2026-10-31')).toEqual([2])
    expect(await ids('?spending_date=due_date&start_date=2026-11-16')).toEqual([3])
    expect(await ids('?payment_status=paid')).toEqual([3])
    expect(await ids('?payment_status=expired')).toEqual([2])
    expect(await ids('?payment_status=all&currencies=EUR')).toEqual([2])
    expect(await ids('?categories=advertisement')).toEqual([2])
    expect(await ids('?payment_methods=cash')).toEqual([3, 1])
    expect(await ids('?spending_type=manual')).toEqual([3, 2, 1])
    expect(await ids('?spending_type=nav')).toEqual([])
    expect(await ids('?q=TARCA-PROBE-S1')).toEqual([])
    const listed = await call('GET', '/spendings?per_page=1')
    expect(listed.body).toMatchObject({
      total: 3,
      last_page: 3,
      data: [{ id: 3, created_by_nav: false }],
    })
    expect((listed.body as { data: object[] }).data[0]).not.toHaveProperty('items')
  })

  test('lista: a q a partner nevében keres, a számlaszámra nem talál (élőben 0 találat)', async () => {
    const { call } = harness()
    const partner = await call('POST', '/partners', PARTNER)
    await call('POST', '/spendings', SPENDING)
    await call('POST', '/spendings', {
      ...SPENDING,
      partner_id: (partner.body as { id: number }).id,
    })

    const found = await call('GET', '/spendings?q=nyomda')

    expect(found.body).toMatchObject({ total: 1, data: [{ id: 2 }] })
  })

  test('lista: hibás szűrőértékekre 422', async () => {
    const { call } = harness()

    const response = await call(
      'GET',
      '/spendings?spending_date=paid_at&start_date=2026-13-01&payment_status=open&spending_type=x&categories=y&currencies=z&payment_methods=w',
    )

    expect(response.status).toBe(422)
    expect((response.body as { errors: { field: string }[] }).errors.map((e) => e.field)).toEqual([
      'spending_date',
      'start_date',
      'payment_status',
      'spending_type',
      'categories',
      'currencies',
      'payment_methods',
    ])
  })

  test('a kliens a hamis Billingón: Date dátumok budapesti napra, lista, lekérés, törlés', async () => {
    const { tarca } = harness()

    const created = await tarca.spendings.create({
      category: 'other',
      currency: 'HUF',
      conversionRate: 1,
      totalGross: 1270,
      totalGrossHuf: 1270,
      totalVatAmount: 270,
      totalVatAmountHuf: 270,
      fulfillmentDate: new Date('2026-11-14T23:30:00Z'),
      invoiceNumber: 'SZ-1',
      invoiceDate: NOW,
      dueDate: '2026-11-22',
      paymentMethod: 'cash',
    })
    const page = await tarca.spendings.list({
      spendingDate: 'fulfillment_date',
      startDate: NOW,
      endDate: NOW,
    })
    const shown = await tarca.spendings.get(created.id ?? 0)
    await tarca.spendings.delete(created.id ?? 0)

    expect(created).toMatchObject({ fulfillmentDate: '2026-11-15', partner: null, paidAt: null })
    expect(page.data.map((item) => item.id)).toEqual([created.id])
    expect(shown.createdByNav).toBe(false)
    await expect(tarca.spendings.get(created.id ?? 0)).rejects.toMatchObject({
      category: 'not_found',
    })
  })
})

describe.skipIf(!SPEC_AVAILABLE)('hamis Billingo: költségek a friss spec ellen', () => {
  test('a kategória- és fizetésimód-lista azonos a spec enumjaival', () => {
    const schemas = loadMergedSpec()?.components.schemas
    expect([...SPENDING_CATEGORIES].sort()).toEqual([...(schemas?.Category?.enum ?? [])].sort())
    expect([...SPENDING_PAYMENT_METHODS].sort()).toEqual(
      [...(schemas?.SpendingPaymentMethod?.enum ?? [])].sort(),
    )
  })

  test('a fenti tesztek minden válasza megfelel a spec válaszsémájának', () => {
    expect(log.exchanges.length).toBeGreaterThan(25)
    expect(log.exchanges.flatMap(fakeExchangeSpecErrors)).toEqual([])
  })

  test('minden költségművelet legalább egy sikeres válasza át lett vizsgálva', () => {
    const succeeded = succeededOperations(log.exchanges)
    const operations = Object.keys(spendingRoutes)

    expect(operations).toHaveLength(5)
    expect(operations.filter((operation) => !succeeded.has(operation))).toEqual([])
  })
})
