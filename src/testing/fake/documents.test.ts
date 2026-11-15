import { describe, expect, test } from 'vitest'
import {
  createFakeExchangeLog,
  fakeExchangeSpecErrors,
  succeededOperations,
} from '../../../tests/fake-exchanges'
import { loadMergedSpec, SPEC_AVAILABLE } from '../../../tests/openapi'
import { DOCUMENT_LANGUAGES, PAYMENT_METHODS, RECEIPT_VATS, VATS } from '../../documents/enums'
import {
  CONVERSION_RATE_REQUIRED,
  DOCUMENT_NOT_FOUND,
  documentRoutes,
  ONLY_DRAFT_DELETABLE,
  ONLY_DRAFT_FINALIZABLE,
  PRIVATE_PERSON_NAME,
} from './documents'
import { FAKE_BILLINGO_MESSAGES } from './http'
import { receiptRoutes } from './receipts'

const log = createFakeExchangeLog()

const NOW = new Date('2026-11-15T14:06:11Z')

const PARTNER = {
  name: 'TARCA-PROBE Béta Bt',
  address: { country_code: 'HU', post_code: '1011', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['beta@example.com'],
}

function item(name: string, unitPrice: number, quantity: number, vat: string, type = 'net') {
  return { name, unit_price: unitPrice, unit_price_type: type, quantity, unit: 'db', vat }
}

const INVOICE = {
  partner_id: 1,
  block_id: 1,
  type: 'invoice',
  fulfillment_date: '2026-11-15',
  due_date: '2026-11-23',
  payment_method: 'wire_transfer',
  language: 'hu',
  currency: 'HUF',
  electronic: false,
  comment: 'TARCA-PROBE',
  settings: { should_send_email: false },
  items: [item('alap tétel', 1000, 1, '27%')],
}

const RECEIPT = {
  block_id: 2,
  type: 'receipt',
  payment_method: 'cash',
  currency: 'HUF',
  electronic: false,
  name: 'nyugta vevő',
  items: [{ name: 'nyugta tétel', unit_price: 1270, vat: '27%', quantity: 1, unit: 'db' }],
}

const BLANK_ITEM = {
  product_id: null,
  entitlement: null,
  comment: '',
  sku: null,
  data_eraser_codes: null,
  is_deposit_fee: false,
  ean: null,
  is_connect_product: false,
  connected_item: null,
  connect_document_item_setting: null,
}

const LIVE_SETTINGS = {
  mediated_service: false,
  without_financial_fulfillment: false,
  online_payment: 'no',
  should_send_email: false,
  round: 'none',
  no_send_onlineszamla_by_user: false,
  order_number: '',
  place_id: null,
  instant_payment: true,
  selected_type: null,
  dont_send_to_nav_reason: null,
  instant_payment_request: null,
  is_waybill_hide_prices: false,
}

async function harnessWithPartner(options: { readonly now?: () => Date } = {}) {
  const harness = log.harness({ now: options.now ?? (() => NOW) })
  const partner = await harness.call('POST', '/partners', PARTNER)
  expect(partner.status).toBe(201)
  return harness
}

describe('hamis Billingo: bizonylatok', () => {
  test('minimális számla: 201, ugyanazok a mezők és értékek, mint élőben (P:064)', async () => {
    const { call } = await harnessWithPartner()

    const created = await call('POST', '/documents', INVOICE)

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      id: 1,
      invoice_number: '2026-1',
      type: 'invoice',
      correction_type: 'invoice',
      cancelled: false,
      block_id: 1,
      payment_status: 'outstanding',
      payment_method: 'wire_transfer',
      gross_total: 1270,
      currency: 'HUF',
      conversion_rate: 1,
      invoice_date: '2026-11-15',
      fulfillment_date: '2026-11-15',
      due_date: '2026-11-23',
      paid_date: '2026-11-15',
      electronic: false,
      comment: 'TARCA-PROBE',
      tags: [],
      notification_status: 'none',
      language: 'hu',
      items: [
        {
          ...BLANK_ITEM,
          name: 'alap tétel',
          net_unit_amount: 1000,
          quantity: 1,
          unit: 'db',
          net_amount: 1000,
          gross_amount: 1270,
          vat: '27%',
          vat_amount: 270,
        },
      ],
      summary: {
        net_amount: 1000,
        net_amount_local: 1000,
        gross_amount_local: 1270,
        vat_amount: 270,
        vat_amount_local: 270,
        vat_rate_summary: [
          {
            vat_name: '27%',
            vat_percentage: 0.27,
            vat_rate_net_amount: 1000,
            vat_rate_vat_amount: 270,
            vat_rate_vat_amount_local: 270,
            vat_rate_gross_amount: 1270,
          },
        ],
      },
      settings: LIVE_SETTINGS,
      related_documents: [],
      online_szamla_status: 'processing',
      kobak_receipt_status: null,
      kobak_receipt_message: null,
      discount: null,
      recurring_id: null,
      partner: {
        id: 1,
        name: PARTNER.name,
        emails: PARTNER.emails,
        partner_show_type: null,
      },
      document_partner: { id: 1, name: PARTNER.name, address: PARTNER.address },
      organization: {
        tax_number: '00000000-0-00',
        bank_account: { id: null, name: '', account_number: '' },
      },
    })
    expect(Object.keys(created.body as object).sort()).toEqual(
      Object.keys(loadMergedSpec()?.components.schemas.Document?.properties ?? {}).sort(),
    )
  })

  test('kerekítés forintban: kulcsonkénti összesítés, bruttó egységárnál 1000.000001 (P:088)', async () => {
    const { call } = await harnessWithPartner()

    const created = await call('POST', '/documents', {
      ...INVOICE,
      items: [
        item('27% nettó 10000 x 1', 10000, 1, '27%'),
        item('5% nettó 1000 x 3', 1000, 3, '5%'),
        item('27% bruttó 1270 x 3', 1270, 3, '27%', 'gross'),
      ],
    })

    expect(created.body).toMatchObject({
      gross_total: 19660,
      items: [
        { net_unit_amount: 10000, net_amount: 10000, vat_amount: 2700, gross_amount: 12700 },
        { net_unit_amount: 1000, net_amount: 3000, vat_amount: 150, gross_amount: 3150 },
        { net_unit_amount: 1000.000001, net_amount: 3000, vat_amount: 810, gross_amount: 3810 },
      ],
      summary: {
        net_amount: 16000,
        net_amount_local: 16000,
        gross_amount_local: 19660,
        vat_amount: 3660,
        vat_amount_local: 3660,
        vat_rate_summary: [
          {
            vat_name: '27%',
            vat_percentage: 0.27,
            vat_rate_net_amount: 13000,
            vat_rate_vat_amount: 3510,
            vat_rate_vat_amount_local: 3510,
            vat_rate_gross_amount: 16510,
          },
          {
            vat_name: '5%',
            vat_percentage: 0.05,
            vat_rate_net_amount: 3000,
            vat_rate_vat_amount: 150,
            vat_rate_vat_amount_local: 150,
            vat_rate_gross_amount: 3150,
          },
        ],
      },
    })
  })

  test('kerekítés euróban: a forint áfa kulcsonként 3890 + 135, összesen mégis 4024 (P:092)', async () => {
    const { call } = await harnessWithPartner()

    const created = await call('POST', '/documents', {
      ...INVOICE,
      currency: 'EUR',
      conversion_rate: 389.17,
      items: [item('EUR 27%', 12.34, 3, '27%'), item('EUR 5%', 0.99, 7, '5%')],
    })

    expect(created.body).toMatchObject({
      gross_total: 54.29,
      conversion_rate: 389.17,
      currency: 'EUR',
      items: [
        {
          net_unit_amount: 12.34,
          quantity: 3,
          net_amount: 37.02,
          vat_amount: 10,
          gross_amount: 47.02,
        },
        {
          net_unit_amount: 0.99,
          quantity: 7,
          net_amount: 6.93,
          vat_amount: 0.35,
          gross_amount: 7.28,
        },
      ],
      summary: {
        net_amount: 43.95,
        net_amount_local: 17104.0215,
        gross_amount_local: 21128.0393,
        vat_amount: 10.34,
        vat_amount_local: 4024,
        vat_rate_summary: [
          {
            vat_name: '27%',
            vat_percentage: 0.27,
            vat_rate_net_amount: 37.02,
            vat_rate_vat_amount: 10,
            vat_rate_vat_amount_local: 3890,
            vat_rate_gross_amount: 47.02,
          },
          {
            vat_name: '5%',
            vat_percentage: 0.05,
            vat_rate_net_amount: 6.93,
            vat_rate_vat_amount: 0.35,
            vat_rate_vat_amount_local: 135,
            vat_rate_gross_amount: 7.28,
          },
        ],
      },
    })
  })

  test('a tizedesvesszős áfakulcs (5,5%) is számol: 100 nettóra 5,5 áfa, 105,5 bruttó', async () => {
    const { call } = await harnessWithPartner()

    const created = await call('POST', '/documents', {
      ...INVOICE,
      items: [item('vesszős kulcs', 100, 1, '5,5%')],
    })

    expect(created).toMatchObject({
      status: 201,
      body: {
        gross_total: 105.5,
        items: [{ net_amount: 100, vat_amount: 5.5, gross_amount: 105.5, vat: '5,5%' }],
        summary: {
          vat_rate_summary: [{ vat_name: '5,5%', vat_percentage: 0.055, vat_rate_vat_amount: 5.5 }],
        },
      },
    })
  })

  test('sorszámozás tömbönként, típusonként és évenként, az élő formátumokkal', async () => {
    let now = NOW
    const { call } = await harnessWithPartner({ now: () => now })
    const block = await call('POST', '/document-blocks', {
      name: 'TARCA E2E',
      prefix: 'TRCE',
      type: 'invoice',
    })
    const blockId = (block.body as { id: number }).id
    const number = async (body: Record<string, unknown>) =>
      ((await call('POST', '/documents', body)).body as { invoice_number: string }).invoice_number

    const numbers = [
      await number(INVOICE),
      await number({ ...INVOICE, type: 'proforma' }),
      await number({ ...INVOICE, type: 'advance' }),
      await number({ ...INVOICE, type: 'draft' }),
      await number({ ...INVOICE, block_id: blockId }),
      await number({ ...INVOICE, type: 'proforma', block_id: blockId }),
      ((await call('POST', '/documents/receipt', RECEIPT)).body as { invoice_number: string })
        .invoice_number,
    ]
    now = new Date('2027-01-02T10:00:00Z')
    const nextYear = await number(INVOICE)

    expect(numbers).toEqual([
      '2026-1',
      '000001',
      '2026-2',
      '',
      'TRCE / 2026-000001',
      'TRCE / 000001',
      'NYT-2026-1',
    ])
    expect(nextYear).toBe('2027-1')
  })

  test('a duplikált vendor_id 400 az élő üzenettel, és nem jön létre második bizonylat (P:067)', async () => {
    const { call, billingo } = await harnessWithPartner()

    const first = await call('POST', '/documents', { ...INVOICE, vendor_id: 'RENDELES-1' })
    const second = await call('POST', '/documents', { ...INVOICE, vendor_id: 'RENDELES-1' })
    const receipt = await call('POST', '/documents/receipt', {
      ...RECEIPT,
      vendor_id: 'RENDELES-1',
    })

    expect(first.status).toBe(201)
    expect(second).toMatchObject({
      status: 400,
      body: { error: { message: 'Duplicate vendor id. (id:RENDELES-1)' } },
    })
    expect(receipt.status).toBe(400)
    expect([...billingo.data.documents.keys()]).toEqual([1])
    expect(billingo.data.documents.get(1)?.vendorId).toBe('RENDELES-1')
  })

  test('a piszkozat véglegesítése foglalt vendor_id-val 400 az élő üzenettel, a piszkozat változatlan', async () => {
    const { call, billingo } = await harnessWithPartner()
    await call('POST', '/documents', { ...INVOICE, vendor_id: 'V-1' })
    await call('POST', '/documents', { ...INVOICE, type: 'draft' })

    const finalized = await call('PUT', '/documents/2', { ...INVOICE, vendor_id: 'V-1' })

    expect(finalized).toMatchObject({
      status: 400,
      body: { error: { message: 'Duplicate vendor id. (id:V-1)' } },
    })
    expect(billingo.data.documents.get(2)?.document.type).toBe('draft')
    expect(billingo.data.documents.get(2)?.vendorId).toBeUndefined()
    expect(
      [...billingo.data.documents.values()].filter((record) => record.vendorId === 'V-1'),
    ).toHaveLength(1)
  })

  test('vendor_id szerint ismeretlenre 404 „Document is not found.”, id szerint 403, mint élőben', async () => {
    const { call } = await harnessWithPartner()
    await call('POST', '/documents', { ...INVOICE, vendor_id: 'A/B 1' })

    const found = await call('GET', `/documents/vendor/${encodeURIComponent('A/B 1')}`)
    const missing = await call('GET', '/documents/vendor/nincs')
    const byId = await call('GET', '/documents/1')
    const unknown = await call('GET', '/documents/99')

    expect(found).toMatchObject({ status: 200, body: { id: 1 } })
    expect(byId).toMatchObject({ status: 200, body: { id: 1, invoice_number: '2026-1' } })
    expect(missing).toMatchObject({ status: 404, body: { error: { message: DOCUMENT_NOT_FOUND } } })
    expect(unknown).toMatchObject({
      status: 403,
      body: { error: { message: FAKE_BILLINGO_MESSAGES.forbidden } },
    })
  })

  test('üres törzsre 422 ugyanazokkal a mezőkkel és sorrendben, mint élőben (P:083)', async () => {
    const { call } = await harnessWithPartner()
    const draft = await call('POST', '/documents', { ...INVOICE, type: 'draft' })

    const empty = await call('PUT', '/documents/1', {})
    const created = await call('POST', '/documents', {})

    expect(draft.status).toBe(201)
    const expected = {
      message: 'Validation Failed',
      errors: [
        { field: 'partner_id', message: 'The partner id field is required.' },
        { field: 'block_id', message: 'The block id field is required.' },
        { field: 'type', message: 'The type field is required.' },
        { field: 'fulfillment_date', message: 'The fulfillment date field is required.' },
        { field: 'due_date', message: 'The due date field is required.' },
        { field: 'payment_method', message: 'The payment method field is required.' },
        { field: 'language', message: 'The language field is required.' },
        { field: 'currency', message: 'The currency field is required.' },
        { field: 'conversion_rate', message: CONVERSION_RATE_REQUIRED },
        { field: 'items', message: 'The items field is required.' },
      ],
    }
    expect(CONVERSION_RATE_REQUIRED).toBe(
      'The conversion rate field is required unless currency is in HUF.',
    )
    expect(empty).toEqual(expect.objectContaining({ status: 422, body: expected }))
    expect(created).toEqual(expect.objectContaining({ status: 422, body: expected }))
  })

  test('hibás értékek: ismeretlen hivatkozás, rossz enum és dátum, hiányzó árfolyam, tételhibák', async () => {
    const { call, billingo } = await harnessWithPartner()

    const wrong = await call('POST', '/documents', {
      ...INVOICE,
      type: 'receipt',
      due_date: '2026-02-30',
      payment_method: 'kartya',
      currency: 'EUR',
      items: [
        {
          name: 'x',
          unit_price: '10',
          unit_price_type: 'brutto',
          quantity: 1,
          unit: 'db',
          vat: '28%',
        },
        { product_id: 77, quantity: 1 },
      ],
    })
    const references = await call('POST', '/documents', {
      ...INVOICE,
      partner_id: 99,
      block_id: 2,
      bank_account_id: 5,
      advance_invoice: [42],
    })

    expect(wrong.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'type', message: 'The selected type is invalid.' },
        { field: 'due_date', message: 'The due date does not match the format Y-m-d.' },
        { field: 'payment_method', message: 'The selected payment method is invalid.' },
        { field: 'conversion_rate', message: CONVERSION_RATE_REQUIRED },
        { field: 'items.0.unit_price', message: 'The items 0 unit price must be a number.' },
        {
          field: 'items.0.unit_price_type',
          message: 'The selected items.0.unit price type is invalid.',
        },
        { field: 'items.0.vat', message: 'The selected items.0.vat is invalid.' },
        { field: 'items.1.product_id', message: 'The selected items.1.product id is invalid.' },
      ],
    })
    expect(references.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'block_id', message: 'The selected block id is invalid.' },
        { field: 'partner_id', message: 'The selected partner id is invalid.' },
        { field: 'bank_account_id', message: 'The selected bank account id is invalid.' },
        { field: 'advance_invoice.0', message: 'The selected advance invoice.0 is invalid.' },
      ],
    })
    expect(billingo.data.documents.size).toBe(0)
  })

  test('termékes tétel a termék adataival, bankszámla a szervezet adataiban', async () => {
    const { call } = await harnessWithPartner()
    await call('POST', '/products', {
      name: 'Kávé 250 g',
      currency: 'HUF',
      vat: '5%',
      net_unit_price: 2000,
      unit: 'csomag',
      sku: 'KAVE-250',
    })
    await call('POST', '/bank-accounts', {
      name: 'Főszámla',
      account_number: '11773016-11111018',
      currency: 'HUF',
    })

    const created = await call('POST', '/documents', {
      ...INVOICE,
      bank_account_id: 1,
      items: [{ product_id: 1, quantity: 2, comment: 'ajándék' }],
    })

    expect(created.body).toMatchObject({
      gross_total: 4200,
      items: [
        {
          product_id: 1,
          name: 'Kávé 250 g',
          unit: 'csomag',
          vat: '5%',
          quantity: 2,
          net_unit_amount: 2000,
          net_amount: 4000,
          vat_amount: 200,
          sku: 'KAVE-250',
          comment: 'ajándék',
        },
      ],
      organization: {
        bank_account: { id: 1, name: 'Főszámla', account_number: '11773016-11111018' },
      },
    })
  })

  test('végszámla az előleggel: negatív előlegsor a sorszámmal, kapcsolódó bizonylat (P:094)', async () => {
    const { call } = await harnessWithPartner()
    await call('POST', '/documents', {
      ...INVOICE,
      type: 'advance',
      items: [item('előleg', 1000, 1, '27%')],
    })

    const final = await call('POST', '/documents', {
      ...INVOICE,
      items: [item('végszámla', 3000, 1, '27%')],
      advance_invoice: [1],
    })

    expect(final.body).toMatchObject({
      gross_total: 2540,
      related_documents: [{ id: 1, invoice_number: '2026-1' }],
      items: [
        {
          name: 'végszámla',
          net_unit_amount: 3000,
          net_amount: 3000,
          vat_amount: 810,
          gross_amount: 3810,
          comment: '',
        },
        {
          name: 'előleg',
          net_unit_amount: -1000,
          quantity: 1,
          net_amount: -1000,
          vat_amount: -270,
          gross_amount: -1270,
          comment: '(2026-1)',
        },
      ],
      summary: { net_amount: 2000, vat_amount: 540, gross_amount_local: 2540 },
    })
  })

  test('beállítások és kedvezmény: a megadott mezők felülírják az élő alapértékeket', async () => {
    const { call } = await harnessWithPartner()

    const created = await call('POST', '/documents', {
      ...INVOICE,
      electronic: true,
      language: 'en',
      settings: { should_send_email: true, order_number: 'R-1', round: 'five', ismeretlen: 1 },
      discount: { type: 'percent', value: 10 },
    })

    expect(created.body).toMatchObject({
      electronic: true,
      language: 'en',
      settings: { ...LIVE_SETTINGS, should_send_email: true, order_number: 'R-1', round: 'five' },
      discount: { type: 'percent', value: 10 },
      gross_total: 1270,
    })
    expect((created.body as { settings: object }).settings).not.toHaveProperty('ismeretlen')
  })

  test('piszkozat: 201 sorszám nélkül, véglegesítés 201 ugyanazzal az id-val, törlés csak piszkozatra', async () => {
    const { call, billingo } = await harnessWithPartner()
    const draft = await call('POST', '/documents', { ...INVOICE, type: 'draft', vendor_id: 'P-1' })

    const finalized = await call('PUT', '/documents/1', INVOICE)
    const again = await call('PUT', '/documents/1', INVOICE)
    const notDeletable = await call('DELETE', '/documents/1')
    const second = await call('POST', '/documents', { ...INVOICE, type: 'draft' })
    const deleted = await call('DELETE', '/documents/2')
    const gone = await call('GET', '/documents/2')

    expect(draft.body).toMatchObject({
      type: 'draft',
      correction_type: 'draft',
      invoice_number: '',
      payment_status: 'none',
      online_szamla_status: 'not_checked',
    })
    expect(finalized).toMatchObject({
      status: 201,
      body: { id: 1, type: 'invoice', invoice_number: '2026-1', payment_status: 'outstanding' },
    })
    expect(billingo.data.documents.get(1)?.vendorId).toBe('P-1')
    expect(again).toMatchObject({
      status: 400,
      body: { error: { message: ONLY_DRAFT_FINALIZABLE } },
    })
    expect(notDeletable).toMatchObject({
      status: 400,
      body: { error: { message: ONLY_DRAFT_DELETABLE } },
    })
    expect([second.status, deleted.status, gone.status]).toEqual([201, 204, 403])
  })

  test('lista: legújabb elöl, szűrők, hibás szűrőre 422', async () => {
    let now = NOW
    const { call } = await harnessWithPartner({ now: () => now })
    await call('POST', '/partners', { ...PARTNER, name: 'Gamma Kft.' })
    await call('POST', '/documents', INVOICE)
    now = new Date('2026-11-16T09:00:00Z')
    await call('POST', '/documents', {
      ...INVOICE,
      partner_id: 2,
      payment_method: 'cash',
      fulfillment_date: '2026-11-16',
    })
    await call('POST', '/documents/receipt', RECEIPT)
    const ids = async (query: string) =>
      ((await call('GET', `/documents${query}`)).body as { data: { id: number }[] }).data.map(
        (document) => document.id,
      )

    expect(await ids('')).toEqual([3, 2, 1])
    expect(await ids('?partner_id=1')).toEqual([1])
    expect(await ids('?type=receipt')).toEqual([3])
    expect(await ids('?type=invoice')).toEqual([2, 1])
    expect(await ids('?block_id=2')).toEqual([3])
    expect(await ids('?payment_method=cash')).toEqual([3, 2])
    expect(await ids('?payment_status=paid')).toEqual([3])
    expect(await ids('?start_date=2026-11-16')).toEqual([3, 2])
    expect(await ids('?end_date=2026-11-15')).toEqual([1])
    expect(await ids('?fulfillment_start_date=2026-11-16&fulfillment_end_date=2026-11-16')).toEqual(
      [3, 2],
    )
    expect(await ids('?paid_start_date=2026-11-15&paid_end_date=2026-11-15')).toEqual([1])
    expect(await ids('?start_number=2&end_number=2')).toEqual([2])
    expect(await ids('?start_year=2026&end_year=2026')).toEqual([3, 2, 1])
    expect(await ids('?start_year=2027')).toEqual([])
    expect(await ids('?query=gamma')).toEqual([2])
    expect(await ids('?query=NYT-2026')).toEqual([3])
    expect(await ids(`?last_modified_date=${encodeURIComponent('2026-11-16 10:00:00')}`)).toEqual([
      3, 2,
    ])
    expect(await ids(`?last_modified_date=${encodeURIComponent('2026-11-16 10:00:01')}`)).toEqual(
      [],
    )
    const invalid = await call(
      'GET',
      '/documents?type=proforma&start_date=2026-13-01&last_modified_date=2026-11-16&partner_id=x&payment_method=kartya',
    )
    expect(invalid.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'partner_id', message: 'The partner id must be an integer.' },
        { field: 'payment_method', message: 'The selected payment method is invalid.' },
        { field: 'type', message: 'The selected type is invalid.' },
        { field: 'start_date', message: 'The start date does not match the format Y-m-d.' },
        {
          field: 'last_modified_date',
          message: 'The last modified date does not match the format Y-m-d H:i:s.',
        },
      ],
    })
  })
})

describe('hamis Billingo: nyugták', () => {
  test('partner nélkül a „Magánszemély” partnert kapja és újrahasznosítja, bruttó egységár (P:095)', async () => {
    const { call, billingo } = await harnessWithPartner()

    const first = await call('POST', '/documents/receipt', RECEIPT)
    const second = await call('POST', '/documents/receipt', { ...RECEIPT, name: 'más vevő' })

    expect(first).toMatchObject({
      status: 201,
      body: {
        invoice_number: 'NYT-2026-1',
        type: 'receipt',
        correction_type: 'receipt',
        block_id: 2,
        payment_status: 'paid',
        gross_total: 1270,
        fulfillment_date: '2026-11-15',
        due_date: '2026-11-15',
        comment: '',
        language: 'hu',
        kobak_receipt_status: 'pending',
        online_szamla_status: 'processing',
        settings: { ...LIVE_SETTINGS, selected_type: 'receipt' },
        items: [
          {
            ...BLANK_ITEM,
            name: 'nyugta tétel',
            net_unit_amount: 1000.000001,
            quantity: 1,
            unit: 'db',
            net_amount: 1000,
            gross_amount: 1270,
            vat: '27%',
            vat_amount: 270,
          },
        ],
        partner: {
          id: 2,
          name: PRIVATE_PERSON_NAME,
          address: { country_code: '', post_code: '', city: '', address: '' },
          partner_show_type: null,
        },
      },
    })
    expect((second.body as { partner: { id: number } }).partner.id).toBe(2)
    expect([...billingo.data.partners.keys()]).toEqual([1, 2])
  })

  test('partnerrel, termékkel és alapértelmezett mennyiséggel; a számlatömbbe 422', async () => {
    const { call } = await harnessWithPartner()
    await call('POST', '/products', {
      name: 'Tea',
      currency: 'HUF',
      vat: '27%',
      gross_unit_price: 635,
      unit: 'doboz',
    })

    const created = await call('POST', '/documents/receipt', {
      ...RECEIPT,
      partner_id: 1,
      items: [{ product_id: 1 }, { unit_price: 100, vat: 'AAM' }],
    })
    const wrongBlock = await call('POST', '/documents/receipt', { ...RECEIPT, block_id: 1 })
    const noElectronic = await call('POST', '/documents/receipt', {
      ...RECEIPT,
      electronic: undefined,
      type: 'invoice',
    })
    const noneVat = await call('POST', '/documents/receipt', {
      ...RECEIPT,
      items: [{ unit_price: 100, vat: 'none' }],
    })

    expect(created.body).toMatchObject({
      partner: { id: 1, name: PARTNER.name },
      gross_total: 735,
      items: [
        {
          product_id: 1,
          name: 'Tea',
          unit: 'doboz',
          quantity: 1,
          gross_amount: 635,
          net_amount: 500,
        },
        {
          name: '',
          unit: 'db',
          quantity: 1,
          vat: 'AAM',
          net_amount: 100,
          vat_amount: 0,
          gross_amount: 100,
        },
      ],
    })
    expect(wrongBlock.body).toEqual({
      message: 'Validation Failed',
      errors: [{ field: 'block_id', message: 'The selected block id is invalid.' }],
    })
    expect(noElectronic.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'type', message: 'The selected type is invalid.' },
        { field: 'electronic', message: 'The electronic field is required.' },
      ],
    })
    expect(noneVat.status).toBe(501)
  })

  test('nyugta piszkozat: véglegesítés 201 a nyugta végponton, a számla végponton 400', async () => {
    const { call } = await harnessWithPartner()
    await call('POST', '/documents/receipt', { ...RECEIPT, type: 'draft' })

    const viaInvoice = await call('PUT', '/documents/1', INVOICE)
    const finalized = await call('PUT', '/documents/receipt/1', RECEIPT)
    const unknown = await call('PUT', '/documents/receipt/9', RECEIPT)

    expect(viaInvoice).toMatchObject({
      status: 400,
      body: { error: { message: ONLY_DRAFT_FINALIZABLE } },
    })
    expect(finalized).toMatchObject({
      status: 201,
      body: { id: 1, type: 'receipt', invoice_number: 'NYT-2026-1', payment_status: 'paid' },
    })
    expect(unknown.status).toBe(403)
  })
})

describe.skipIf(!SPEC_AVAILABLE)('hamis Billingo: bizonylatok a friss spec ellen', () => {
  test('a fizetési módok, nyelvek, áfakulcsok és nyugta áfakulcsok azonosak a spec enumjaival', () => {
    const schemas = loadMergedSpec()?.components.schemas
    expect([...PAYMENT_METHODS].sort()).toEqual([...(schemas?.PaymentMethod?.enum ?? [])].sort())
    expect([...DOCUMENT_LANGUAGES].sort()).toEqual(
      [...(schemas?.DocumentLanguage?.enum ?? [])].sort(),
    )
    expect([...VATS].sort()).toEqual([...(schemas?.Vat?.enum ?? [])].sort())
    expect([...RECEIPT_VATS].sort()).toEqual([...(schemas?.ReceiptVat?.enum ?? [])].sort())
  })

  test('a fenti tesztek minden válasza megfelel a spec válaszsémájának', () => {
    expect(log.exchanges.length).toBeGreaterThan(60)
    expect(log.exchanges.flatMap(fakeExchangeSpecErrors)).toEqual([])
  })

  test('minden bizonylat- és nyugtaművelet legalább egy sikeres válasza át lett vizsgálva', () => {
    const succeeded = succeededOperations(log.exchanges)
    const operations = Object.keys({ ...documentRoutes, ...receiptRoutes })

    expect(operations).toHaveLength(8)
    expect(operations.filter((operation) => !succeeded.has(operation))).toEqual([])
  })
})
