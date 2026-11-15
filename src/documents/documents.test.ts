import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockBillingo, type Reply, TEST_API_KEY } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { createTarca, type TarcaOptions } from '../client'
import { BillingoError } from '../core/errors'
import type { KeyValueStore } from '../core/store'
import type { DocumentInput } from './input'

function setup(options: Omit<TarcaOptions, 'apiKey' | 'fetch'>, ...replies: Reply[]) {
  const mock = mockBillingo(...replies)
  const tarca = createTarca({
    apiKey: TEST_API_KEY,
    fetch: mock.fetch,
    retryDelayMs: 0,
    ...options,
  })
  return { mock, documents: tarca.documents }
}

function documentJson(id: number, fields: Record<string, unknown> = {}) {
  return {
    id,
    invoice_number: `2026-${id}`,
    type: 'invoice',
    block_id: 7,
    payment_status: 'outstanding',
    gross_total: 1270,
    ...fields,
  }
}

function created(id: number, fields: Record<string, unknown> = {}): Reply {
  return { status: 201, json: documentJson(id, fields) }
}

function found(id: number, fields: Record<string, unknown> = {}): Reply {
  return { status: 200, json: documentJson(id, fields) }
}

const NOT_FOUND: Reply = { status: 404, json: { error: { message: 'Document is not found.' } } }

function page(data: readonly unknown[], currentPage = 1, lastPage = 1): Reply {
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

const INVOICE_BLOCK = {
  id: 7,
  name: 'Számlák',
  prefix: '',
  custom_field1: '',
  custom_field2: '',
  type: 'invoice',
}

function described(request: { method: string; url: URL }): string {
  return `${request.method} ${request.url.pathname}${request.url.search}`
}

const ITEM = { name: 'Webfejlesztés', quantity: 2, netUnitPrice: 15_000, vat: 27 } as const

const INPUT: DocumentInput = { partner: 12, items: [ITEM] }

const SENT_ITEM = {
  name: 'Webfejlesztés',
  quantity: 2,
  unit: 'db',
  vat: '27%',
  unit_price: 15_000,
  unit_price_type: 'net',
}

describe('documents: kiállítás az alapértelmezésekkel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('create: az első számlatömb, a mai budapesti nap és +8 nap, a defaults értékei', async () => {
    const { mock, documents } = setup({}, page([INVOICE_BLOCK]), created(1))

    const invoice = await documents.create(INPUT)

    expect(invoice).toMatchObject({ id: 1, invoiceNumber: '2026-1', grossTotal: 1270 })
    expect(mock.requests.map(described)).toEqual([
      'GET /v3/document-blocks?per_page=100&type=invoice',
      'POST /v3/documents',
    ])
    expect(mock.requests[1]?.body).toEqual({
      partner_id: 12,
      block_id: 7,
      type: 'invoice',
      fulfillment_date: '2027-01-01',
      due_date: '2027-01-09',
      payment_method: 'wire_transfer',
      language: 'hu',
      currency: 'HUF',
      electronic: false,
      items: [SENT_ITEM],
      settings: { should_send_email: false },
    })
  })

  test('a defaults felülírja a beépített alapértékeket, a bemenet pedig a defaults-ot', async () => {
    const { mock, documents } = setup(
      {
        defaults: {
          blockId: 3,
          bankAccountId: 4,
          paymentMethod: 'bankcard',
          language: 'en',
          currency: 'EUR',
          dueInDays: 15,
          electronic: true,
          sendEmail: true,
        },
      },
      created(1),
      created(2),
    )

    await documents.create({ ...INPUT, conversionRate: 389.17 })
    await documents.create({
      ...INPUT,
      blockId: 9,
      bankAccountId: 5,
      paymentMethod: 'cash',
      language: 'de',
      currency: 'HUF',
      dueInDays: 0,
      electronic: false,
      sendEmail: false,
    })

    expect(mock.requests.map((request) => request.operation)).toEqual([
      'CreateDocument',
      'CreateDocument',
    ])
    expect(mock.requests[0]?.body).toMatchObject({
      block_id: 3,
      bank_account_id: 4,
      payment_method: 'bankcard',
      language: 'en',
      currency: 'EUR',
      conversion_rate: 389.17,
      due_date: '2027-01-16',
      electronic: true,
      settings: { should_send_email: true },
    })
    expect(mock.requests[1]?.body).toMatchObject({
      block_id: 9,
      bank_account_id: 5,
      payment_method: 'cash',
      language: 'de',
      currency: 'HUF',
      due_date: '2027-01-01',
      electronic: false,
      settings: { should_send_email: false },
    })
  })
})

describe('documents: a számlatömb keresése', () => {
  test('a megtalált tömböt kliensenként egyszer kéri le, a sikertelen keresést nem jegyzi meg', async () => {
    const forbidden: Reply = {
      status: 403,
      json: { error: { message: 'You do not have permission for this operation.' } },
    }
    const { mock, documents } = setup(
      {},
      forbidden,
      page([
        { ...INVOICE_BLOCK, id: 5, type: 'receipt' },
        INVOICE_BLOCK,
        { ...INVOICE_BLOCK, id: 9 },
      ]),
      created(1),
      created(2),
    )

    await expect(documents.create(INPUT)).rejects.toMatchObject({ category: 'forbidden' })
    await documents.create(INPUT)
    await documents.create(INPUT)

    expect(mock.requests.map((request) => request.operation)).toEqual([
      'ListDocumentBlock',
      'ListDocumentBlock',
      'CreateDocument',
      'CreateDocument',
    ])
    expect(mock.requests.slice(2).map((request) => request.body)).toMatchObject([
      { block_id: 7 },
      { block_id: 7 },
    ])
  })

  test('egyidejű kiállításoknál a tömböt egyetlen kéréssel keresi meg', async () => {
    const { mock, documents } = setup({}, page([INVOICE_BLOCK]), created(1), created(2))

    await Promise.all([documents.create(INPUT), documents.create(INPUT)])

    expect(
      mock.requests.filter((request) => request.operation === 'ListDocumentBlock'),
    ).toHaveLength(1)
  })

  test('a hívó megszakítása a közös tömbkeresés alatt azonnal érvényesül, a keresés a többieknek fut tovább', async () => {
    const mock = mockBillingo(page([INVOICE_BLOCK]), created(1))
    let releaseBlocks = (): void => {}
    const blocksHeld = new Promise<void>((resolve) => {
      releaseBlocks = resolve
    })
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input).includes('/document-blocks')) await blocksHeld
      return mock.fetch(input, init)
    }
    const tarca = createTarca({ apiKey: TEST_API_KEY, fetch, retryDelayMs: 0 })
    const controller = new AbortController()
    const reason = new Error('a hívó megszakította')

    const aborted = tarca.documents
      .create(INPUT, { signal: controller.signal })
      .catch((caught: unknown) => caught)
    const other = tarca.documents.create(INPUT)
    await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort(reason)

    expect(await aborted).toBe(reason)
    releaseBlocks()
    expect((await other).id).toBe(1)
    expect(mock.requests.map((request) => request.operation)).toEqual([
      'ListDocumentBlock',
      'CreateDocument',
    ])
  })

  test('számlatömb nélküli fióknál configuration hiba tippel, kiállítás nélkül', async () => {
    const { mock, documents } = setup({}, page([]))

    const error = await documents.create(INPUT).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({ category: 'configuration', operation: 'ListDocumentBlock' })
    expect((error as BillingoError).hint).toContain('defaults: { blockId }')
    expect(mock.requests).toHaveLength(1)
  })
})

describe('documents: partner', () => {
  test('partner objektummal a findOrCreate adja az azonosítót, utána jön a bizonylat', async () => {
    const stored = {
      id: 33,
      name: 'Vevő Kft.',
      address: { country_code: 'HU', post_code: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    }
    const { mock, documents } = setup(
      { defaults: { blockId: 3 } },
      page([]),
      { status: 201, json: stored },
      created(1),
    )

    await documents.create({
      ...INPUT,
      partner: {
        name: 'Vevő Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
    })

    expect(mock.requests.map((request) => request.operation)).toEqual([
      'ListPartner',
      'CreatePartner',
      'CreateDocument',
    ])
    expect(mock.requests[2]?.body).toMatchObject({ partner_id: 33, block_id: 3 })
  })

  test('azonosító nélküli partnerválasz unexpected_response, bizonylat nélkül', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, page([]), {
      status: 201,
      json: { name: 'Vevő Kft.', address: { post_code: '1', city: 'B', address: 'F' } },
    })

    await expect(
      documents.create({
        ...INPUT,
        partner: { name: 'Vevő Kft.', address: { postCode: '1', city: 'B', address: 'F' } },
      }),
    ).rejects.toMatchObject({ category: 'unexpected_response', operation: 'CreatePartner' })
    expect(mock.requests.map((request) => request.operation)).not.toContain('CreateDocument')
  })
})

describe('documents: a kéréstörzs leképezése', () => {
  test('minden ergonomikus mező a helyére kerül: típus, tételfajták, deviza, beállítások, előleg, kedvezmény', async () => {
    const { mock, documents } = setup({}, created(1))

    await documents.create({
      type: 'advance',
      vendorId: '  ORDER-1001  ',
      partner: 12,
      blockId: 3,
      bankAccountId: 4,
      items: [
        { ...ITEM, unit: 'óra', comment: 'november', entitlement: 'AAM', sku: 'WEB-1' },
        { name: 'Könyv', quantity: 1, grossUnitPrice: 1050, vat: 5 },
        { name: 'Szolgáltatás', quantity: 1, netUnitPrice: 100, vat: 5.5 },
        { name: 'Szállás', quantity: 1, netUnitPrice: 100, vat: 13.5 },
        { name: 'Export', quantity: 1, netUnitPrice: 100, vat: 'EUK' },
        { name: 'Mentes', quantity: 1, netUnitPrice: 100, vat: 0 },
        { productId: 77, quantity: 3, comment: 'raktárról' },
      ],
      fulfillmentDate: '2026-11-10',
      dueDate: new Date('2026-11-30T23:30:00Z'),
      paymentMethod: 'cash',
      language: 'en',
      currency: 'EUR',
      conversionRate: 389.17,
      electronic: true,
      comment: 'Megjegyzés',
      sendEmail: true,
      orderNumber: 'R-1001',
      settings: { round: 'five', shouldSendEmail: false, mediatedService: true },
      advanceInvoiceIds: [101, 102],
      discountPercent: 10,
    })

    const body = mock.requests[0]?.body
    expect(body).toEqual({
      vendor_id: 'ORDER-1001',
      partner_id: 12,
      block_id: 3,
      bank_account_id: 4,
      type: 'advance',
      fulfillment_date: '2026-11-10',
      due_date: '2026-12-01',
      payment_method: 'cash',
      language: 'en',
      currency: 'EUR',
      conversion_rate: 389.17,
      electronic: true,
      comment: 'Megjegyzés',
      items: [
        {
          ...SENT_ITEM,
          unit: 'óra',
          comment: 'november',
          entitlement: 'AAM',
          sku: 'WEB-1',
        },
        {
          name: 'Könyv',
          quantity: 1,
          unit: 'db',
          vat: '5%',
          unit_price: 1050,
          unit_price_type: 'gross',
        },
        { ...SENT_ITEM, name: 'Szolgáltatás', quantity: 1, unit_price: 100, vat: '5,5%' },
        { ...SENT_ITEM, name: 'Szállás', quantity: 1, unit_price: 100, vat: '13,5%' },
        { ...SENT_ITEM, name: 'Export', quantity: 1, unit_price: 100, vat: 'EUK' },
        { ...SENT_ITEM, name: 'Mentes', quantity: 1, unit_price: 100, vat: '0%' },
        { product_id: 77, quantity: 3, comment: 'raktárról' },
      ],
      settings: {
        round: 'five',
        should_send_email: true,
        mediated_service: true,
        order_number: 'R-1001',
      },
      advance_invoice: [101, 102],
      discount: { type: 'percent', value: 10 },
    })
    if (SPEC_AVAILABLE) expect(requestErrors('CreateDocument', body)).toEqual([])
  })

  test('a nyers settings.shouldSendEmail érvényes, ha a sendEmail nincs megadva', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3, sendEmail: true } }, created(1))

    await documents.create({ ...INPUT, settings: { shouldSendEmail: false } })

    expect(mock.requests[0]?.body).toMatchObject({ settings: { should_send_email: false } })
  })

  test('createRaw a generált DocumentInsert-et változtatás nélkül küldi', async () => {
    const { mock, documents } = setup({}, created(1))
    const insert = {
      partnerId: 12,
      blockId: 3,
      type: 'invoice',
      fulfillmentDate: '2026-11-15',
      dueDate: '2026-11-23',
      paymentMethod: 'wire_transfer',
      language: 'hu',
      currency: 'HUF',
      paid: true,
      instantPayment: false,
      items: [{ productId: 77, quantity: 1 }],
    } as const

    await documents.createRaw(insert)

    expect(mock.requests[0]?.body).toEqual({
      partner_id: 12,
      block_id: 3,
      type: 'invoice',
      fulfillment_date: '2026-11-15',
      due_date: '2026-11-23',
      payment_method: 'wire_transfer',
      language: 'hu',
      currency: 'HUF',
      paid: true,
      instant_payment: false,
      items: [{ product_id: 77, quantity: 1 }],
    })
  })
})

describe('documents: helyi ellenőrzés kérés nélkül', () => {
  test('minden hibát egyszerre ad vissza magyar validation hibában, mezőnként', async () => {
    const { mock, documents } = setup({})

    const error = await documents
      .create({
        type: 'receipt' as 'invoice',
        partner: 0,
        blockId: 1.5,
        bankAccountId: -1,
        items: [
          { name: ' ', quantity: Number.NaN, netUnitPrice: 1, vat: 28 },
          { name: 'Két ár', quantity: 1, netUnitPrice: 1, grossUnitPrice: 2, vat: 27 } as never,
          { name: 'Ár nélkül', quantity: 1, vat: 27 } as never,
          {
            name: 'Végtelen',
            quantity: 1,
            grossUnitPrice: Number.POSITIVE_INFINITY,
            vat: 'XY' as never,
          },
          { productId: 0, quantity: 1 },
        ],
        fulfillmentDate: '2026-02-30',
        dueDate: '2026-11-30',
        dueInDays: 5,
        paymentMethod: 'kartya' as never,
        language: 'xx' as never,
        currency: 'EUR',
        electronic: 'igen' as never,
        sendEmail: 1 as never,
        advanceInvoiceIds: [3, 0],
        discountPercent: 150,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({ category: 'validation', operation: 'CreateDocument' })
    expect((error as BillingoError).fieldErrors.map((item) => item.field)).toEqual([
      'type',
      'partner',
      'blockId',
      'bankAccountId',
      'items.0.quantity',
      'items.0.name',
      'items.0.vat',
      'items.1',
      'items.2',
      'items.3.grossUnitPrice',
      'items.3.vat',
      'items.4.productId',
      'fulfillmentDate',
      'dueDate',
      'paymentMethod',
      'language',
      'conversionRate',
      'electronic',
      'sendEmail',
      'advanceInvoiceIds.1',
      'discountPercent',
    ])
    expect((error as BillingoError).message).toMatch(/^Hibás bizonylatadatok: type: /)
    expect((error as BillingoError).message).toContain('items.0.vat: Ismeretlen áfakulcs: 28.')
    expect((error as BillingoError).hint).toContain('el sem küldte')
    expect(mock.requests).toEqual([])
  })

  test('üres tétellista, objektum nélküli tétel, üres nevű és cím nélküli partner', async () => {
    const { mock, documents } = setup({})

    const empty = await documents
      .create({ partner: 1, items: [] })
      .catch((caught: unknown) => caught)
    const broken = await documents
      .create({
        partner: { name: '  ' } as never,
        items: [null as never],
        dueInDays: -1,
        conversionRate: 0,
      })
      .catch((caught: unknown) => caught)

    expect((empty as BillingoError).fieldErrors).toEqual([
      { field: 'items', message: 'Legalább egy tétel kell.' },
    ])
    expect((broken as BillingoError).fieldErrors.map((item) => item.field)).toEqual([
      'partner.name',
      'partner.address',
      'items.0',
      'dueInDays',
      'conversionRate',
    ])
    expect(mock.requests).toEqual([])
  })

  test('ismeretlen pénznem kérés nélkül validation hiba, árfolyam-hiba nélkül', async () => {
    const { mock, documents } = setup({})

    const error = await documents
      .create({ ...INPUT, currency: 'huf' as 'HUF' })
      .catch((caught: unknown) => caught)

    expect((error as BillingoError).fieldErrors).toEqual([
      { field: 'currency', message: 'Ismeretlen pénznem: „huf”.' },
    ])
    expect(mock.requests).toEqual([])
  })

  test('a forintos bizonylat árfolyam nélkül is jó, megadott árfolyam pozitív kell legyen', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, created(1))

    await documents.create(INPUT)
    const negative = await documents
      .create({ ...INPUT, conversionRate: -1 })
      .catch((caught: unknown) => caught)

    expect(mock.requests).toHaveLength(1)
    expect((negative as BillingoError).fieldErrors).toEqual([
      { field: 'conversionRate', message: 'Pozitív szám kell, kapott: -1.' },
    ])
  })
})

describe('documents: createOnce', () => {
  const ONCE = { ...INPUT, vendorId: 'ORDER 1001' }
  const OPTIONS = { recoveryDelayMs: 0 }

  test('létező vendorId-ra a meglévő bizonylatot adja, POST nélkül', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, found(5))

    const result = await documents.createOnce({ ...ONCE, vendorId: '  ORDER 1001 ' }, OPTIONS)

    expect([result.created, result.document.id]).toEqual([false, 5])
    expect(mock.requests.map(described)).toEqual(['GET /v3/documents/vendor/ORDER%201001'])
  })

  test('404 után kiállít, a vendorId a törzsben van', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, NOT_FOUND, created(6))

    const result = await documents.createOnce(ONCE, OPTIONS)

    expect([result.created, result.document.id]).toEqual([true, 6])
    expect(mock.requests.map((request) => request.operation)).toEqual([
      'GetDocumentByVendorId',
      'CreateDocument',
    ])
    expect(mock.requests[1]?.body).toMatchObject({ vendor_id: 'ORDER 1001', block_id: 3 })
  })

  test.each([
    ['network', new TypeError('fetch failed')],
    ['server', { status: 500, json: { error: { message: 'Internal Server Error.' } } }],
    ['unexpected_response', { status: 201 }],
  ] as const)(
    'bizonytalan hiba (%s) után visszakeres, és ha megvan, created: true',
    async (_, failure) => {
      const { mock, documents } = setup(
        { defaults: { blockId: 3 } },
        NOT_FOUND,
        failure,
        NOT_FOUND,
        found(7),
      )

      const result = await documents.createOnce(ONCE, OPTIONS)

      expect([result.created, result.document.id]).toEqual([true, 7])
      expect(mock.requests.map((request) => request.operation)).toEqual([
        'GetDocumentByVendorId',
        'CreateDocument',
        'GetDocumentByVendorId',
        'GetDocumentByVendorId',
      ])
    },
  )

  test('bizonytalan hiba után, ha a visszakeresés sem találja, az eredeti hiba megy tovább', async () => {
    const { mock, documents } = setup(
      { defaults: { blockId: 3 } },
      NOT_FOUND,
      new TypeError('fetch failed'),
      NOT_FOUND,
      NOT_FOUND,
    )

    const error = await documents.createOnce(ONCE, OPTIONS).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ category: 'network', operation: 'CreateDocument' })
    expect(mock.requests).toHaveLength(4)
  })

  test('a visszakeresés nem ismételhető hibája leállítja a keresést, az eredeti hiba megy tovább', async () => {
    const forbidden: Reply = { status: 403, json: { error: { message: 'nincs jog' } } }
    const { mock, documents } = setup(
      { defaults: { blockId: 3 } },
      NOT_FOUND,
      new TypeError('fetch failed'),
      forbidden,
    )

    const error = await documents.createOnce(ONCE, OPTIONS).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ category: 'network' })
    expect(mock.requests).toHaveLength(3)
  })

  test('a visszakeresés közbeni megszakítás azonnal érvényesül, nem az eredeti hiba megy tovább', async () => {
    const mock = mockBillingo(NOT_FOUND, new TypeError('fetch failed'))
    const controller = new AbortController()
    let calls = 0
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls += 1
      if (calls < 3) return mock.fetch(input, init)
      controller.abort(new Error('a hívó megszakította'))
      throw new TypeError('megszakítva')
    }
    const tarca = createTarca({
      apiKey: TEST_API_KEY,
      fetch,
      retryDelayMs: 0,
      defaults: { blockId: 3 },
    })

    const error = await tarca.documents
      .createOnce(ONCE, { ...OPTIONS, signal: controller.signal })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ message: 'a hívó megszakította' })
    expect(error).not.toBeInstanceOf(BillingoError)
  })

  test('a visszakeresés ismételhető hibája után még egyszer keres', async () => {
    const { mock, documents } = setup(
      { defaults: { blockId: 3 }, maxAttempts: 1 },
      NOT_FOUND,
      new TypeError('fetch failed'),
      { status: 503, json: { error: { message: 'Service Unavailable' } } },
      found(8),
    )

    const result = await documents.createOnce(ONCE, OPTIONS)

    expect([result.created, result.document.id]).toEqual([true, 8])
    expect(mock.requests).toHaveLength(4)
  })

  test('400 „Duplicate vendor id.” után visszakeres, és created: false', async () => {
    const duplicate: Reply = {
      status: 400,
      json: { error: { message: 'Duplicate vendor id. (id:ORDER 1001)' } },
    }
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, NOT_FOUND, duplicate, found(9))

    const result = await documents.createOnce(ONCE, OPTIONS)

    expect([result.created, result.document.id]).toEqual([false, 9])
    expect(mock.requests).toHaveLength(3)
  })

  test.each([
    [
      'más 400 (például napi kvóta)',
      { status: 400, json: { error: { message: 'Daily limit reached.' } } },
    ],
    [
      '422',
      {
        status: 422,
        json: { message: 'Validation Failed', errors: [{ field: 'items', message: 'x' }] },
      },
    ],
    ['401', { status: 401, json: { error: { message: 'Unauthorized' } } }],
    ['üzenet nélküli 400', { status: 400 }],
  ] as const)('%s változatlanul megy tovább, visszakeresés nélkül', async (_, failure) => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, NOT_FOUND, failure)

    const error = await documents.createOnce(ONCE, OPTIONS).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect((error as BillingoError).status).toBe(failure.status)
    expect(mock.requests).toHaveLength(2)
  })

  test('a duplikált vendorId-ra, ha a visszakeresés sem találja, a 400 megy tovább', async () => {
    const duplicate: Reply = {
      status: 400,
      json: { error: { message: 'Duplicate vendor id. (id:ORDER 1001)' } },
    }
    const { documents } = setup(
      { defaults: { blockId: 3 } },
      NOT_FOUND,
      duplicate,
      NOT_FOUND,
      NOT_FOUND,
    )

    await expect(documents.createOnce(ONCE, OPTIONS)).rejects.toMatchObject({
      status: 400,
      apiMessage: 'Duplicate vendor id. (id:ORDER 1001)',
    })
  })

  test('a . és .. vendorId kérés nélkül validation hiba: a lista lenne belőle, nem a bizonylat', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } })

    const errors = await Promise.all(
      ['..', ' . ', '.'].map((vendorId) =>
        documents.createOnce({ ...INPUT, vendorId }, OPTIONS).catch((caught: unknown) => caught),
      ),
    )
    const plain = await documents
      .create({ ...INPUT, vendorId: '..' })
      .catch((caught: unknown) => caught)

    for (const error of [...errors, plain]) {
      expect(error).toMatchObject({ category: 'validation', operation: 'CreateDocument' })
      expect((error as BillingoError).fieldErrors.map((item) => item.field)).toEqual(['vendorId'])
    }
    expect(mock.requests).toEqual([])
  })

  test.each([
    ['503', { status: 503, json: { error: { message: 'Service Unavailable' } } }, 'server', true],
    ['401', { status: 401, json: { error: { message: 'Unauthorized' } } }, 'auth', false],
  ] as const)(
    'a duplikált vendorId-nál, ha a visszakeresés %s hibát ad, a keresés hibája megy tovább: a bizonylat létezik',
    async (_, failure, category, retryable) => {
      const duplicate: Reply = {
        status: 400,
        json: { error: { message: 'Duplicate vendor id. (id:ORDER 1001)' } },
      }
      const { mock, documents } = setup(
        { defaults: { blockId: 3 }, maxAttempts: 1 },
        NOT_FOUND,
        duplicate,
        failure,
        failure,
      )

      const error = await documents.createOnce(ONCE, OPTIONS).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(BillingoError)
      expect(error).toMatchObject({
        category,
        retryable,
        status: failure.status,
        operation: 'GetDocumentByVendorId',
      })
      expect((error as BillingoError).message).toContain('ORDER 1001')
      expect((error as BillingoError).message).toContain('Duplicate vendor id.')
      expect((error as BillingoError).hint).toContain('createOnce')
      expect((error as BillingoError).cause).toMatchObject({
        category,
        operation: 'GetDocumentByVendorId',
      })
      expect(mock.requests.map((request) => request.operation)).toEqual([
        'GetDocumentByVendorId',
        'CreateDocument',
        ...Array.from({ length: retryable ? 2 : 1 }, () => 'GetDocumentByVendorId'),
      ])
    },
  )

  test('a kiállítás előtti lépés (számlatömb) hibája után nem keres vissza, és nem mond created: true-t', async () => {
    const down: Reply = { status: 503, json: { error: { message: 'Service Unavailable' } } }
    const { mock, documents } = setup({}, NOT_FOUND, down, down, down, found(77))

    const error = await documents.createOnce(ONCE, OPTIONS).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ category: 'server', operation: 'ListDocumentBlock' })
    expect(mock.requests.map((request) => request.operation)).toEqual([
      'GetDocumentByVendorId',
      'ListDocumentBlock',
      'ListDocumentBlock',
      'ListDocumentBlock',
    ])
  })

  test('vendorId nélkül és rossz recoveryDelayMs-sel kérés nélkül hibázik', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } })

    const missing = await documents
      .createOnce({ ...INPUT, vendorId: ' ' })
      .catch((caught: unknown) => caught)
    const delay = await documents
      .createOnce(ONCE, { recoveryDelayMs: -1 })
      .catch((caught: unknown) => caught)

    expect(missing).toMatchObject({ category: 'validation' })
    expect((missing as BillingoError).fieldErrors[0]?.field).toBe('vendorId')
    expect(delay).toMatchObject({ category: 'configuration' })
    expect(mock.requests).toEqual([])
  })

  test('ugyanarra a (szóközökkel együtt is azonos) vendorId-ra párhuzamosan egy kiállítás, a második created: false', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, NOT_FOUND, created(10))

    const [first, second] = await Promise.all([
      documents.createOnce(ONCE, OPTIONS),
      documents.createOnce({ ...ONCE, vendorId: ` ${ONCE.vendorId} ` }, OPTIONS),
    ])

    expect([first.created, second.created]).toEqual([true, false])
    expect(second.document.id).toBe(10)
    expect(mock.requests).toHaveLength(2)
  })

  test('ugyanazzal a kulccsal és fetch-csel létrehozott másik kliens is csatlakozik', async () => {
    const mock = mockBillingo(NOT_FOUND, created(13))
    const make = () =>
      createTarca({
        apiKey: TEST_API_KEY,
        fetch: mock.fetch,
        retryDelayMs: 0,
        defaults: { blockId: 3 },
      })

    const results = await Promise.all([
      make().documents.createOnce(ONCE, OPTIONS),
      make().documents.createOnce(ONCE, OPTIONS),
    ])

    expect(results.map((result) => [result.created, result.document.id])).toEqual([
      [true, 13],
      [false, 13],
    ])
    expect(mock.requests).toHaveLength(2)
  })

  test('ugyanazzal a kulccsal, de más fetch-csel (például két hamis Billingo) nem csatlakozik', async () => {
    const first = mockBillingo(NOT_FOUND, created(14))
    const second = mockBillingo(NOT_FOUND, created(15))
    const make = (fetch: typeof globalThis.fetch) =>
      createTarca({ apiKey: TEST_API_KEY, fetch, retryDelayMs: 0, defaults: { blockId: 3 } })

    const results = await Promise.all([
      make(first.fetch).documents.createOnce(ONCE, OPTIONS),
      make(second.fetch).documents.createOnce(ONCE, OPTIONS),
    ])

    expect(results.map((result) => [result.created, result.document.id])).toEqual([
      [true, 14],
      [true, 15],
    ])
  })

  test('más kulcsú kliens ugyanarra a vendorId-ra nem csatlakozik', async () => {
    const mock = mockBillingo(NOT_FOUND, NOT_FOUND, created(11), created(12))
    const make = (apiKey: string) =>
      createTarca({ apiKey, fetch: mock.fetch, retryDelayMs: 0, defaults: { blockId: 3 } })

    const results = await Promise.all([
      make('kulcs-egy').documents.createOnce(ONCE, OPTIONS),
      make('kulcs-ketto').documents.createOnce(ONCE, OPTIONS),
    ])

    expect(results.map((result) => result.created)).toEqual([true, true])
    expect(mock.requests.filter((request) => request.operation === 'CreateDocument')).toHaveLength(
      2,
    )
  })

  test('a createOnceLock zárat a vendorId hash-ével veszi fel és engedi el, a kulcs nem kerül bele', async () => {
    const values = new Map<string, string>()
    const calls: string[] = []
    const lock: KeyValueStore = {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value)
      },
      delete: (key) => {
        values.delete(key)
      },
      setIfAbsent: (key, value, ttl) => {
        calls.push(`setIfAbsent ${ttl}`)
        if (values.has(key)) return false
        values.set(key, value)
        return true
      },
      deleteIfEquals: (key, value) => {
        calls.push('deleteIfEquals')
        if (values.get(key) !== value) return false
        values.delete(key)
        return true
      },
    }
    const seen: string[] = []
    const watched: KeyValueStore = {
      ...lock,
      setIfAbsent: (key, value, ttl) => {
        seen.push(key)
        return lock.setIfAbsent?.(key, value, ttl) ?? false
      },
    }
    const { documents } = setup({ defaults: { blockId: 3 }, createOnceLock: watched }, found(5))

    await documents.createOnce(ONCE, OPTIONS)

    expect(calls).toEqual(['setIfAbsent 600', 'deleteIfEquals'])
    expect(seen[0]).toMatch(/^tarca:once:[0-9a-f]{64}$/)
    expect(seen[0]).not.toContain(TEST_API_KEY)
    expect(values.size).toBe(0)
  })
})

describe('documents: lekérdezés', () => {
  test('getByVendorId és findByVendorId a . és .. vendorId-ra kérés nélkül RangeError', async () => {
    const { mock, documents } = setup({})

    await expect(documents.getByVendorId('..')).rejects.toThrow(RangeError)
    await expect(documents.findByVendorId(' . ')).rejects.toThrow(RangeError)
    expect(mock.requests).toEqual([])
  })

  test('get, getByVendorId (kódolt útvonal) és findByVendorId (404-re null, másra hiba)', async () => {
    const { mock, documents } = setup(
      {},
      found(5),
      found(6),
      NOT_FOUND,
      { status: 403, json: { error: { message: 'nincs jog' } } },
      NOT_FOUND,
    )

    expect((await documents.get(5)).invoiceNumber).toBe('2026-5')
    expect((await documents.getByVendorId('A/B 1')).id).toBe(6)
    expect(await documents.findByVendorId('nincs')).toBeNull()
    await expect(documents.findByVendorId('tilos')).rejects.toMatchObject({ category: 'forbidden' })
    await expect(documents.getByVendorId('nincs')).rejects.toMatchObject({
      category: 'not_found',
      status: 404,
      apiMessage: 'Document is not found.',
    })
    await expect(documents.getByVendorId('  ')).rejects.toThrow(RangeError)
    expect(mock.requests.map(described)).toEqual([
      'GET /v3/documents/5',
      'GET /v3/documents/vendor/A%2FB%201',
      'GET /v3/documents/vendor/nincs',
      'GET /v3/documents/vendor/tilos',
      'GET /v3/documents/vendor/nincs',
    ])
  })

  test('list: minden szűrő a spec nevén, dátumok budapesti napként, a módosítás ideje másodpercre', async () => {
    const { mock, documents } = setup({}, page([documentJson(1)]))

    const result = await documents.list({
      page: 2,
      perPage: 50,
      blockId: 3,
      partnerId: 12,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      startDate: new Date('2026-10-31T23:30:00Z'),
      endDate: '2026-11-30',
      startNumber: 1,
      endNumber: 99,
      startYear: 2026,
      endYear: 2027,
      type: 'invoice',
      query: '2026-1',
      paidStartDate: '2026-11-01',
      paidEndDate: '2026-11-02',
      fulfillmentStartDate: '2026-11-03',
      fulfillmentEndDate: '2026-11-04',
      lastModifiedDate: new Date('2026-07-01T10:04:05Z'),
    })

    expect(result.data[0]).toMatchObject({ id: 1, invoiceNumber: '2026-1' })
    expect(Object.fromEntries(mock.requests[0]?.url.searchParams ?? [])).toEqual({
      page: '2',
      per_page: '50',
      block_id: '3',
      partner_id: '12',
      payment_method: 'cash',
      payment_status: 'paid',
      start_date: '2026-11-01',
      end_date: '2026-11-30',
      start_number: '1',
      end_number: '99',
      start_year: '2026',
      end_year: '2027',
      type: 'invoice',
      query: '2026-1',
      paid_start_date: '2026-11-01',
      paid_end_date: '2026-11-02',
      fulfillment_start_date: '2026-11-03',
      fulfillment_end_date: '2026-11-04',
      last_modified_date: '2026-07-01 12:04:05',
    })
  })

  test('list: szöveges módosítási idő csak pontos alakban, hibás dátum és lapozás kérés nélkül hibázik', async () => {
    const { mock, documents } = setup({}, page([]))

    await documents.list({ lastModifiedDate: '2026-11-15 15:04:24' })
    await expect(documents.list({ lastModifiedDate: '2026-11-15' })).rejects.toThrow(
      'YYYY-MM-DD HH:MM:SS',
    )
    await expect(documents.list({ lastModifiedDate: '2026-11-15T15:04:24' })).rejects.toThrow(
      RangeError,
    )
    await expect(documents.list({ startDate: '2026-02-30' })).rejects.toThrow(RangeError)
    await expect(documents.list({ perPage: 101 })).rejects.toThrow('perPage')
    expect(mock.requests.map((request) => request.url.search)).toEqual([
      '?last_modified_date=2026-11-15+15%3A04%3A24',
    ])
  })

  test('all: minden oldalt bejár, a szűrőt minden oldalnak továbbadja', async () => {
    const { mock, documents } = setup(
      {},
      page([documentJson(1)], 1, 2),
      page([documentJson(2)], 2, 2),
    )

    const ids: number[] = []
    for await (const document of documents.all({ type: 'receipt' })) ids.push(document.id ?? 0)

    expect(ids).toEqual([1, 2])
    expect(mock.requests.map((request) => request.url.search)).toEqual([
      '?page=1&per_page=100&type=receipt',
      '?page=2&per_page=100&type=receipt',
    ])
  })
})

describe('documents: piszkozat', () => {
  test('finalizeDraft: PUT a teljes törzzsel, a 201-es választ adja vissza', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } }, created(5))

    const invoice = await documents.finalizeDraft(5, {
      partner: 12,
      items: [ITEM],
      dueDate: '2026-11-30',
    })

    expect(invoice.id).toBe(5)
    expect(described(mock.requests[0] ?? { method: '', url: new URL('x:') })).toBe(
      'PUT /v3/documents/5',
    )
    expect(mock.requests[0]?.operation).toBe('CreateDocumentFromDraft')
    expect(mock.requests[0]?.body).toMatchObject({
      partner_id: 12,
      block_id: 3,
      type: 'invoice',
      due_date: '2026-11-30',
      items: [SENT_ITEM],
    })
    if (SPEC_AVAILABLE) {
      expect(requestErrors('CreateDocumentFromDraft', mock.requests[0]?.body)).toEqual([])
    }
  })

  test('finalizeDraft piszkozat típusra kérés nélkül validation hibát ad', async () => {
    const { mock, documents } = setup({ defaults: { blockId: 3 } })

    const error = await documents
      .finalizeDraft(5, { partner: 12, items: [ITEM], type: 'draft' as 'invoice' })
      .catch((caught: unknown) => caught)

    expect(error).toMatchObject({ category: 'validation', operation: 'CreateDocumentFromDraft' })
    expect((error as BillingoError).fieldErrors[0]?.message).toContain('invoice, proforma, advance')
    expect(mock.requests).toEqual([])
  })

  test('deleteDraft: DELETE, törzs nélküli 204', async () => {
    const { mock, documents } = setup({}, { status: 204 })

    await documents.deleteDraft(5)

    expect(mock.requests.map(described)).toEqual(['DELETE /v3/documents/5'])
    expect(mock.requests[0]?.operation).toBe('DeleteDocument')
  })
})
