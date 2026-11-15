import { describe, expect, test } from 'vitest'
import { mockBillingo, type Reply, TEST_API_KEY } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { createTarca, type TarcaOptions } from '../client'
import { BillingoError } from '../core/errors'
import type { ReceiptInput } from './receipts'

function setup(options: Omit<TarcaOptions, 'apiKey' | 'fetch'>, ...replies: Reply[]) {
  const mock = mockBillingo(...replies)
  const tarca = createTarca({
    apiKey: TEST_API_KEY,
    fetch: mock.fetch,
    retryDelayMs: 0,
    ...options,
  })
  return { mock, receipts: tarca.receipts }
}

function receiptJson(id: number, fields: Record<string, unknown> = {}) {
  return { id, invoice_number: `NYT-2026-${id}`, type: 'receipt', block_id: 8, ...fields }
}

const RECEIPT_BLOCK = {
  id: 8,
  name: 'Nyugták',
  prefix: 'NYT',
  custom_field1: '',
  custom_field2: '',
  type: 'receipt',
}

function page(data: readonly unknown[]): Reply {
  return {
    status: 200,
    json: {
      total: data.length,
      per_page: 100,
      current_page: 1,
      last_page: 1,
      prev_page_url: null,
      next_page_url: null,
      data,
    },
  }
}

const NOT_FOUND: Reply = { status: 404, json: { error: { message: 'Document is not found.' } } }

const INPUT: ReceiptInput = { items: [{ name: 'Kávé', grossUnitPrice: 1270, vat: 27 }] }

const SENT_ITEM = { name: 'Kávé', unit_price: 1270, vat: '27%', quantity: 1, unit: 'db' }

describe('receipts', () => {
  test('create partner nélkül: a nyugtatömb, készpénz, az electronic mindig megy, bruttó egységár', async () => {
    const { mock, receipts } = setup({}, page([RECEIPT_BLOCK]), {
      status: 201,
      json: receiptJson(1),
    })

    const receipt = await receipts.create(INPUT)

    expect(receipt).toMatchObject({ id: 1, invoiceNumber: 'NYT-2026-1' })
    expect(
      mock.requests.map(
        (request) => `${request.method} ${request.url.pathname}${request.url.search}`,
      ),
    ).toEqual(['GET /v3/document-blocks?per_page=100&type=receipt', 'POST /v3/documents/receipt'])
    expect(mock.requests[1]?.body).toEqual({
      block_id: 8,
      type: 'receipt',
      payment_method: 'cash',
      currency: 'HUF',
      electronic: false,
      items: [SENT_ITEM],
    })
    if (SPEC_AVAILABLE) expect(requestErrors('CreateReceipt', mock.requests[1]?.body)).toEqual([])
  })

  test('a defaults-ból a nyugtatömb, a fizetési mód, a pénznem és az electronic', async () => {
    const { mock, receipts } = setup(
      {
        defaults: {
          blockId: 3,
          receiptBlockId: 9,
          paymentMethod: 'bankcard',
          currency: 'EUR',
          electronic: true,
        },
      },
      { status: 201, json: receiptJson(1) },
    )

    await receipts.create({ ...INPUT, conversionRate: 389.17 })

    expect(mock.requests[0]?.body).toMatchObject({
      block_id: 9,
      payment_method: 'bankcard',
      currency: 'EUR',
      conversion_rate: 389.17,
      electronic: true,
    })
  })

  test('minden mező: partner, név, e-mail, vendorId, termék- és kódos áfájú tételek', async () => {
    const { mock, receipts } = setup({}, { status: 201, json: receiptJson(1) })

    await receipts.create({
      type: 'draft',
      vendorId: ' NYUGTA-1 ',
      partner: 12,
      name: 'Vevő Béla',
      emails: ['vevo@example.com'],
      blockId: 8,
      paymentMethod: 'szep_card',
      currency: 'HUF',
      electronic: true,
      items: [
        { name: 'Ötös', grossUnitPrice: 105, vat: 5, quantity: 2, unit: 'kg' },
        { name: 'Tizennyolcas', grossUnitPrice: 118, vat: 18 },
        { name: 'Alanyi mentes', grossUnitPrice: 100, vat: 'AAM' },
        { name: 'Tárgyi mentes', grossUnitPrice: 100, vat: 'TAM' },
        { name: 'Áfa nélkül', grossUnitPrice: 100, vat: 'none' },
        { productId: 77 },
        { productId: 78, quantity: 3 },
      ],
    })

    const body = mock.requests[0]?.body
    expect(body).toEqual({
      vendor_id: 'NYUGTA-1',
      partner_id: 12,
      name: 'Vevő Béla',
      emails: ['vevo@example.com'],
      block_id: 8,
      type: 'draft',
      payment_method: 'szep_card',
      currency: 'HUF',
      electronic: true,
      items: [
        { name: 'Ötös', unit_price: 105, vat: '5%', quantity: 2, unit: 'kg' },
        { name: 'Tizennyolcas', unit_price: 118, vat: '18%', quantity: 1, unit: 'db' },
        { name: 'Alanyi mentes', unit_price: 100, vat: 'AAM', quantity: 1, unit: 'db' },
        { name: 'Tárgyi mentes', unit_price: 100, vat: 'TAM', quantity: 1, unit: 'db' },
        { name: 'Áfa nélkül', unit_price: 100, vat: 'none', quantity: 1, unit: 'db' },
        { product_id: 77, quantity: 1 },
        { product_id: 78, quantity: 3 },
      ],
    })
    if (SPEC_AVAILABLE) expect(requestErrors('CreateReceipt', body)).toEqual([])
  })

  test('nyugtatömb nélküli fióknál configuration hiba a receiptBlockId tippjével', async () => {
    const { mock, receipts } = setup({ defaults: { blockId: 3 } }, page([]))

    const error = await receipts.create(INPUT).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ category: 'configuration', operation: 'ListDocumentBlock' })
    expect((error as BillingoError).message).toContain('nyugta típusú („receipt”)')
    expect((error as BillingoError).hint).toContain('defaults: { receiptBlockId }')
    expect(mock.requests.map((request) => request.url.search)).toEqual([
      '?per_page=100&type=receipt',
    ])
  })

  test('partner objektummal a findOrCreate adja az azonosítót', async () => {
    const { mock, receipts } = setup(
      { defaults: { receiptBlockId: 8 } },
      page([]),
      {
        status: 201,
        json: { id: 44, name: 'Vevő Béla', address: { post_code: '1', city: 'B', address: 'F' } },
      },
      { status: 201, json: receiptJson(1) },
    )

    await receipts.create({
      ...INPUT,
      partner: { name: 'Vevő Béla', address: { postCode: '1', city: 'B', address: 'F' } },
    })

    expect(mock.requests.map((request) => request.operation)).toEqual([
      'ListPartner',
      'CreatePartner',
      'CreateReceipt',
    ])
    expect(mock.requests[2]?.body).toMatchObject({ partner_id: 44, block_id: 8 })
  })

  test('helyi ellenőrzés kérés nélkül: csak a nyugta áfakulcsai, típus, tételek, partner', async () => {
    const { mock, receipts } = setup({})

    const error = await receipts
      .create({
        type: 'invoice' as 'receipt',
        vendorId: '',
        partner: -3,
        blockId: 0,
        paymentMethod: 'kartya' as never,
        currency: 'USD',
        electronic: 'nem' as never,
        items: [
          { name: '', grossUnitPrice: Number.NaN, vat: 0 },
          { name: 'Huszonhét', grossUnitPrice: 1, vat: 13.5, quantity: Number.NaN },
          { productId: 1.5 },
          'tétel' as never,
        ],
      })
      .catch((caught: unknown) => caught)
    const empty = await receipts.create({ items: [] }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({ category: 'validation', operation: 'CreateReceipt' })
    expect((error as BillingoError).message).toMatch(/^Hibás nyugtaadatok: /)
    expect((error as BillingoError).fieldErrors.map((item) => item.field)).toEqual([
      'type',
      'vendorId',
      'partner',
      'blockId',
      'paymentMethod',
      'conversionRate',
      'electronic',
      'items.0.name',
      'items.0.grossUnitPrice',
      'items.0.vat',
      'items.1.quantity',
      'items.1.vat',
      'items.2.productId',
      'items.3',
    ])
    expect((error as BillingoError).fieldErrors[9]?.message).toContain(
      'none, 5%, 18%, 27%, AAM, TAM',
    )
    expect((empty as BillingoError).fieldErrors).toEqual([
      { field: 'items', message: 'Legalább egy tétel kell.' },
    ])
    expect(mock.requests).toEqual([])
  })

  test('createOnce: meglévőre created: false, hiányzóra kiállít, duplikált vendorId-ra visszakeres', async () => {
    const duplicate: Reply = {
      status: 400,
      json: { error: { message: 'Duplicate vendor id. (id:NY-3)' } },
    }
    const { mock, receipts } = setup(
      { defaults: { receiptBlockId: 8 } },
      { status: 200, json: receiptJson(1) },
      NOT_FOUND,
      { status: 201, json: receiptJson(2) },
      NOT_FOUND,
      duplicate,
      { status: 200, json: receiptJson(3) },
    )
    const options = { recoveryDelayMs: 0 }

    const existing = await receipts.createOnce({ ...INPUT, vendorId: 'NY-1' }, options)
    const issued = await receipts.createOnce({ ...INPUT, vendorId: 'NY-2' }, options)
    const raced = await receipts.createOnce({ ...INPUT, vendorId: 'NY-3' }, options)
    const missing = await receipts
      .createOnce({ ...INPUT, vendorId: '' }, options)
      .catch((caught: unknown) => caught)

    expect([existing.created, existing.document.id]).toEqual([false, 1])
    expect([issued.created, issued.document.id]).toEqual([true, 2])
    expect([raced.created, raced.document.id]).toEqual([false, 3])
    expect((missing as BillingoError).fieldErrors[0]?.field).toBe('vendorId')
    expect(mock.requests.map((request) => request.operation)).toEqual([
      'GetDocumentByVendorId',
      'GetDocumentByVendorId',
      'CreateReceipt',
      'GetDocumentByVendorId',
      'CreateReceipt',
      'GetDocumentByVendorId',
    ])
    expect(mock.requests[2]?.body).toMatchObject({ vendor_id: 'NY-2', block_id: 8 })
  })

  test('finalizeDraft: PUT a nyugta végpontra a teljes törzzsel; piszkozat típusra validation hiba', async () => {
    const { mock, receipts } = setup(
      { defaults: { receiptBlockId: 8 } },
      { status: 201, json: receiptJson(5) },
    )

    const receipt = await receipts.finalizeDraft(5, { items: INPUT.items })
    const draft = await receipts
      .finalizeDraft(5, { items: INPUT.items, type: 'draft' as 'receipt' })
      .catch((caught: unknown) => caught)

    expect(receipt.id).toBe(5)
    expect(mock.requests.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      'PUT /v3/documents/receipt/5',
    ])
    expect(mock.requests[0]?.operation).toBe('CreateReceiptFromDraft')
    expect(mock.requests[0]?.body).toEqual({
      block_id: 8,
      type: 'receipt',
      payment_method: 'cash',
      currency: 'HUF',
      electronic: false,
      items: [SENT_ITEM],
    })
    expect(draft).toMatchObject({ category: 'validation', operation: 'CreateReceiptFromDraft' })
    if (SPEC_AVAILABLE) {
      expect(requestErrors('CreateReceiptFromDraft', mock.requests[0]?.body)).toEqual([])
    }
  })
})
