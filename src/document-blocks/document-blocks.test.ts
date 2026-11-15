import { describe, expect, test } from 'vitest'
import { createTestContext, mockBillingo, type Reply } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { toApiCase } from '../core/case'
import { BillingoError } from '../core/errors'
import { createDocumentBlocksApi, type DocumentBlockInput } from './document-blocks'

function setup(...replies: Reply[]) {
  const mock = mockBillingo(...replies)
  return { mock, blocks: createDocumentBlocksApi(createTestContext(mock)) }
}

function storedBlock(fields: Record<string, unknown> = {}) {
  return {
    id: 348455,
    name: 'TARCA E2E',
    prefix: 'TRCE',
    type: 'invoice',
    custom_field1: '',
    custom_field2: '',
    template_id: 0,
    pic_path: null,
    normal_notification_id: 0,
    proforma_notification_id: 0,
    generated: false,
    invoice_number_format: 'default',
    sender_email: null,
    sender_name: '',
    bcc_email: null,
    create_invoice_from_paid_proforma: false,
    fulfillment_date_from_proforma_payment_date: false,
    attach_xml_to_invoice_pdf: false,
    advance_paid_instant: false,
    financial_fulfillment_highlight: 'basic',
    entitlements_in_document_comment: false,
    bank_account_id: null,
    ...fields,
  }
}

const LIST_ITEMS = [
  {
    id: 348451,
    name: 'Számlák',
    prefix: '',
    custom_field1: '',
    custom_field2: '',
    type: 'invoice',
  },
  {
    id: 348452,
    name: 'Nyugták',
    prefix: 'NYT',
    custom_field1: '',
    custom_field2: '',
    type: 'receipt',
  },
]

function page(data: readonly unknown[], currentPage = 1, lastPage = 1) {
  return {
    status: 200,
    json: {
      total: data.length,
      per_page: 100,
      current_page: currentPage,
      last_page: lastPage,
      prev_page_url: null,
      next_page_url: null,
      data,
    },
  }
}

const FULL_BLOCK: DocumentBlockInput = {
  name: 'Webshop 2026',
  prefix: 'WEB',
  type: 'invoice',
  invoiceNumberFormat: 'short_with_hyphen',
  senderEmail: 'szamla@webshop.example',
  senderName: 'Webshop',
  bccEmail: 'archiv@webshop.example',
  createInvoiceFromPaidProforma: true,
  fulfillmentDateFromProformaPaymentDate: true,
  attachXmlToInvoicePdf: false,
  advancePaidInstant: false,
  financialFulfillmentHighlight: 'highlighted',
  entitlementsInDocumentComment: true,
  bankAccountId: 12,
}

function described(request: { method: string; url: URL }): string {
  return `${request.method} ${request.url.pathname}${request.url.search}`
}

describe('documentBlocks', () => {
  test('list típus szerinti szűréssel, all minden oldallal', async () => {
    const { mock, blocks } = setup(
      page([LIST_ITEMS[0]]),
      page([LIST_ITEMS[0]], 1, 2),
      page([LIST_ITEMS[1]], 2, 2),
    )

    const invoices = await blocks.list({ type: 'invoice', perPage: 50 })
    const all: string[] = []
    for await (const block of blocks.all()) all.push(`${block.name}:${block.type}`)

    expect(invoices.data).toEqual([
      {
        id: 348451,
        name: 'Számlák',
        prefix: '',
        customField1: '',
        customField2: '',
        type: 'invoice',
      },
    ])
    expect(all).toEqual(['Számlák:invoice', 'Nyugták:receipt'])
    expect(mock.requests.map(described)).toEqual([
      'GET /v3/document-blocks?per_page=50&type=invoice',
      'GET /v3/document-blocks?page=1&per_page=100',
      'GET /v3/document-blocks?page=2&per_page=100',
    ])
    expect(mock.requests[0]?.operation).toBe('ListDocumentBlock')
  })

  test('get: a teljes tömb, a null mezőkkel együtt', async () => {
    const { mock, blocks } = setup({ status: 200, json: storedBlock() })

    const block = await blocks.get(348455)

    expect(block).toMatchObject({
      id: 348455,
      invoiceNumberFormat: 'default',
      senderEmail: null,
      bccEmail: null,
      picPath: null,
      bankAccountId: null,
      financialFulfillmentHighlight: 'basic',
    })
    expect(described(mock.requests[0] ?? { method: '', url: new URL('x:') })).toBe(
      'GET /v3/document-blocks/348455',
    )
    expect(mock.requests[0]?.operation).toBe('GetDocumentBlock')
  })

  test('create: snake_case törzs, 201 a teljes tömbbel', async () => {
    const { mock, blocks } = setup({
      status: 201,
      json: storedBlock({ id: 9, name: 'Számlák 2026', prefix: 'SZ' }),
    })

    const created = await blocks.create({ name: 'Számlák 2026', prefix: 'SZ', type: 'invoice' })

    expect(created).toMatchObject({ id: 9, name: 'Számlák 2026', prefix: 'SZ' })
    expect(mock.requests[0]?.method).toBe('POST')
    expect(mock.requests[0]?.operation).toBe('CreateDocumentBlock')
    expect(mock.requests[0]?.body).toEqual({ name: 'Számlák 2026', prefix: 'SZ', type: 'invoice' })
  })

  test('a csak betűből, számból és szóközből álló nevet engedi, a többit kérés nélkül elutasítja', async () => {
    const { mock, blocks } = setup()

    for (const [name, message] of [
      ['TARCA-E2E', 'csak betűt, számot és szóközt'],
      ['Számlák_2026', 'csak betűt, számot és szóközt'],
      ['Web/Shop', 'csak betűt, számot és szóközt'],
      ['Tab\tnév', 'csak betűt, számot és szóközt'],
      ['', 'nem lehet üres'],
      ['   ', 'nem lehet üres'],
    ] as const) {
      const create = await blocks
        .create({ name, prefix: 'X', type: 'invoice' })
        .catch((caught: unknown) => caught)
      const update = await blocks
        .update(1, { name, prefix: 'X', type: 'invoice' })
        .catch((caught: unknown) => caught)
      expect(create).toBeInstanceOf(BillingoError)
      expect(create).toMatchObject({
        category: 'validation',
        operation: 'CreateDocumentBlock',
        status: undefined,
        fieldErrors: [{ field: 'name' }],
        message: expect.stringContaining(message),
      })
      expect(update).toMatchObject({ category: 'validation', operation: 'UpdateDocumentBlock' })
    }
    expect(mock.requests).toEqual([])
  })

  test('ékezetes betűk (felbontott alakban is) és számok rendben vannak', async () => {
    const decomposed = 'Sza\u0301mla\u0301k 2'
    const { mock, blocks } = setup(
      { status: 201, json: storedBlock({ name: 'Árvíztűrő Tükörfúrógép 2026' }) },
      { status: 200, json: storedBlock({ name: 'Nyugták 2' }) },
      { status: 201, json: storedBlock({ name: decomposed }) },
    )

    await blocks.create({ name: 'Árvíztűrő Tükörfúrógép 2026', prefix: 'AT', type: 'invoice' })
    await blocks.update(3, { name: 'Nyugták 2', prefix: 'NYT', type: 'receipt' })
    await blocks.create({ name: decomposed, prefix: 'SZ', type: 'invoice' })

    expect(mock.requests.map((request) => request.operation)).toEqual([
      'CreateDocumentBlock',
      'UpdateDocumentBlock',
      'CreateDocumentBlock',
    ])
  })

  test('update: a lekért tömb visszaírható, a null és a csak olvasható mezők kimaradnak', async () => {
    const fetched = storedBlock({ custom_field1: 'régi' })
    const { mock, blocks } = setup(
      { status: 200, json: fetched },
      { status: 200, json: storedBlock({ custom_field1: 'új' }) },
    )

    const block = await blocks.get(348455)
    const updated = await blocks.update(348455, { ...block, customField1: 'új' })

    expect(updated.customField1).toBe('új')
    expect(described(mock.requests[1] ?? { method: '', url: new URL('x:') })).toBe(
      'PUT /v3/document-blocks/348455',
    )
    expect(mock.requests[1]?.body).toEqual({
      name: 'TARCA E2E',
      prefix: 'TRCE',
      type: 'invoice',
      custom_field1: 'új',
      custom_field2: '',
      template_id: 0,
      normal_notification_id: 0,
      proforma_notification_id: 0,
      generated: false,
      invoice_number_format: 'default',
      sender_name: '',
      create_invoice_from_paid_proforma: false,
      fulfillment_date_from_proforma_payment_date: false,
      attach_xml_to_invoice_pdf: false,
      advance_paid_instant: false,
      financial_fulfillment_highlight: 'basic',
      entitlements_in_document_comment: false,
    })
  })

  test('update: a logóval rendelkező tömb pic_path mezője sem megy vissza', async () => {
    const { mock, blocks } = setup(
      { status: 200, json: storedBlock({ pic_path: 'logos/tarca.png' }) },
      { status: 200, json: storedBlock({ pic_path: 'logos/tarca.png' }) },
    )

    await blocks.update(348455, await blocks.get(348455))

    expect(mock.requests[1]?.body).not.toHaveProperty('pic_path')
    expect(mock.requests[1]?.body).not.toHaveProperty('id')
    expect(mock.requests[1]?.body).toHaveProperty('name', 'TARCA E2E')
  })

  test('update: a valódi e-mail címeket és a bankszámlát elküldi', async () => {
    const { mock, blocks } = setup({ status: 200, json: storedBlock() })

    await blocks.update(348455, {
      name: 'TARCA E2E',
      prefix: 'TRCE',
      type: 'invoice',
      senderEmail: 'szamla@webshop.example',
      bccEmail: 'archiv@webshop.example',
      bankAccountId: 12,
    })

    expect(mock.requests[0]?.body).toEqual({
      name: 'TARCA E2E',
      prefix: 'TRCE',
      type: 'invoice',
      sender_email: 'szamla@webshop.example',
      bcc_email: 'archiv@webshop.example',
      bank_account_id: 12,
    })
  })

  test('delete: 204, a törölt tömb lekérése 403 forbidden', async () => {
    const { mock, blocks } = setup(
      { status: 204 },
      {
        status: 403,
        json: {
          error: {
            message:
              'You do not have permission for this operation. Or any ID in request is invalid or you do not have permission.',
          },
        },
      },
    )

    await blocks.delete(348458)
    await expect(blocks.get(348458)).rejects.toMatchObject({ category: 'forbidden', status: 403 })
    expect(mock.requests.map(described)).toEqual([
      'DELETE /v3/document-blocks/348458',
      'GET /v3/document-blocks/348458',
    ])
    expect(mock.requests[0]?.operation).toBe('DeleteDocumentBlock')
  })
})

describe.skipIf(!SPEC_AVAILABLE)('a számlatömb kérések a friss Billingo spec ellen', () => {
  test('a teljes létrehozás és a visszaírt tömb törzse megfelel a javított spec-nek', async () => {
    const { mock, blocks } = setup(
      { status: 201, json: storedBlock() },
      { status: 200, json: storedBlock() },
      { status: 200, json: storedBlock({ custom_field1: 'egy' }) },
      { status: 200, json: storedBlock() },
    )

    await blocks.create(FULL_BLOCK)
    await blocks.update(348455, { ...FULL_BLOCK, customField1: 'egy', customField2: 'kettő' })
    await blocks.update(348455, await blocks.get(348455))

    expect(mock.requests.map((request) => request.operation)).toEqual([
      'CreateDocumentBlock',
      'UpdateDocumentBlock',
      'GetDocumentBlock',
      'UpdateDocumentBlock',
    ])
    expect(requestErrors('CreateDocumentBlock', mock.requests[0]?.body)).toEqual([])
    expect(requestErrors('UpdateDocumentBlock', mock.requests[1]?.body)).toEqual([])
    expect(requestErrors('UpdateDocumentBlock', mock.requests[3]?.body)).toEqual([])
    expect(mock.requests[0]?.body).toEqual(toApiCase(FULL_BLOCK))
  })

  test('a spec szerint a nyers GET válasz visszaküldése szerződésszegés, ezért kell a szűrés', () => {
    const errors = requestErrors('UpdateDocumentBlock', storedBlock()).join('\n')

    expect(errors).toContain('sender_email')
    expect(errors).toContain('bcc_email')
    expect(errors).toContain('pic_path')
    expect(requestErrors('CreateDocumentBlock', { name: 'X', type: 'invoice' })).toEqual([
      'DocumentBlockSchema.prefix: kötelező mező hiányzik',
    ])
  })
})
