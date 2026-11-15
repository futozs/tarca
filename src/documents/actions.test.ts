import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mockBillingo, type Reply, TEST_API_KEY } from '../../tests/helpers'
import { requestErrors, SPEC_AVAILABLE } from '../../tests/openapi'
import { createTarca, type TarcaOptions } from '../client'
import { BillingoError } from '../core/errors'
import type { PaymentMethod } from '../generated/billingo'
import type { ModificationInput } from './actions'

const ID = 141703673

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

function sent(mock: ReturnType<typeof mockBillingo>): string[] {
  return mock.requests.map((request) => `${request.method} ${request.url.pathname}`)
}

function documentJson(id: number, fields: Record<string, unknown> = {}) {
  return {
    id,
    invoice_number: `2026-${id}`,
    type: 'invoice',
    block_id: 7,
    payment_status: 'outstanding',
    gross_total: 1270,
    related_documents: [],
    ...fields,
  }
}

function clientError(status: number, message: string): Reply {
  return { status, json: { error: { message } } }
}

const CANNOT_CANCEL = `Cannot cancel the document (id:${ID}).`

describe('documents.send és reminders', () => {
  test('send: a megadott címekre küld, a Billingo válaszát adja vissza', async () => {
    const emails = ['vevo@example.com', 'konyveles@example.hu']
    const { mock, documents } = setup({}, { status: 200, json: { emails } })

    expect(await documents.send(ID, { emails })).toEqual({ emails })
    expect(sent(mock)).toEqual([`POST /v3/documents/${ID}/send`])
    expect(mock.requests[0]?.operation).toBe('SendDocument')
    expect(mock.requests[0]?.body).toEqual({ emails })
  })

  test('send: üres lista vagy hibás cím esetén kérés nélkül validation hiba, mezőnként', async () => {
    const { mock, documents } = setup({})

    const empty = await documents.send(ID, { emails: [] }).catch((caught: unknown) => caught)
    const single = await documents
      .send(ID, { emails: 'vevo@example.com' as unknown as string[] })
      .catch((caught: unknown) => caught)
    const invalid = await documents
      .send(ID, {
        emails: [
          'jo@example.com',
          'rossz cim',
          'a@b',
          'x@y.hu,z@w.hu',
          'a,b@example.com',
          'a;b@example.com',
        ],
      })
      .catch((caught: unknown) => caught)

    expect(empty).toBeInstanceOf(BillingoError)
    expect(empty).toMatchObject({
      category: 'validation',
      operation: 'SendDocument',
      fieldErrors: [{ field: 'emails', message: 'Legalább egy e-mail cím kell.' }],
    })
    expect(single).toMatchObject({ fieldErrors: [{ field: 'emails' }] })
    expect((invalid as BillingoError).fieldErrors.map((error) => error.field)).toEqual([
      'emails.1',
      'emails.2',
      'emails.3',
      'emails.4',
      'emails.5',
    ])
    expect((invalid as BillingoError).fieldErrors[0]?.message).toContain('„rossz cim”')
    expect(mock.requests).toEqual([])
  })

  test('reminders: a három lista camelCase alakban', async () => {
    const { mock, documents } = setup(
      {},
      {
        status: 200,
        json: {
          sent_reminders: [{ type: 'invoice', subject: 'Számla', recipients: ['a@example.com'] }],
          upcoming_reminders: [],
          sent_postal_mail: [],
        },
      },
    )

    expect(await documents.reminders(ID)).toEqual({
      sentReminders: [{ type: 'invoice', subject: 'Számla', recipients: ['a@example.com'] }],
      upcomingReminders: [],
      sentPostalMail: [],
    })
    expect(sent(mock)).toEqual([`GET /v3/documents/${ID}/reminders`])
  })
})

describe('documents.navStatus', () => {
  test('a teszt profil 200-as válasza camelCase alakban (P:072)', async () => {
    const { mock, documents } = setup(
      {},
      {
        status: 200,
        json: {
          transaction_id: '',
          status: 'no_online_szamla_settings',
          messages: [
            {
              validation_result_code: '',
              validation_error_code: '',
              human_readable_message: 'NAV Online Számla összeköttetés nincs beállítva.',
            },
          ],
        },
      },
    )

    expect(await documents.navStatus(ID)).toEqual({
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
    expect(sent(mock)).toEqual([`GET /v3/documents/${ID}/online-szamla`])
  })

  test('„NavOnlineSzamla is not found.”: nincs NAV rekord, ez null, nem hiba', async () => {
    const { documents } = setup({}, clientError(404, 'NavOnlineSzamla is not found.'))

    expect(await documents.navStatus(ID)).toBeNull()
  })

  test('minden más hiba tovább megy, a más üzenetű 404 is', async () => {
    const { documents } = setup(
      { maxAttempts: 1 },
      clientError(404, 'Document is not found.'),
      { status: 404 },
      clientError(403, 'You do not have permission for this operation.'),
      { status: 500, json: { error: { message: 'Internal Server Error.' } } },
    )

    await expect(documents.navStatus(ID)).rejects.toMatchObject({ category: 'not_found' })
    await expect(documents.navStatus(ID)).rejects.toMatchObject({
      category: 'not_found',
      apiMessage: undefined,
    })
    await expect(documents.navStatus(ID)).rejects.toMatchObject({ category: 'forbidden' })
    await expect(documents.navStatus(ID)).rejects.toMatchObject({ category: 'server' })
  })
})

describe('documents.cancel', () => {
  test('beállítás nélkül törzs nélküli POST, a sztornó bizonylatot adja vissza', async () => {
    const storno = documentJson(141703800, {
      type: 'cancellation',
      gross_total: -1270,
      related_documents: [{ id: ID, invoice_number: '2026-1' }],
    })
    const { mock, documents } = setup({}, { status: 200, json: storno })

    const result = await documents.cancel(ID)

    expect(sent(mock)).toEqual([`POST /v3/documents/${ID}/cancel`])
    expect(mock.requests[0]?.operation).toBe('CancelDocument')
    expect(mock.requests[0]?.body).toBeUndefined()
    expect(result).toMatchObject({
      id: 141703800,
      type: 'cancellation',
      grossTotal: -1270,
      relatedDocuments: [{ id: ID, invoiceNumber: '2026-1' }],
    })
  })

  test('indok és címzettek: a címek vesszővel egy szövegben (DocumentCancellation)', async () => {
    const { mock, documents } = setup(
      {},
      { status: 200, json: documentJson(1) },
      { status: 200, json: documentJson(2) },
    )

    await documents.cancel(ID, {
      reason: 'Hibás tétel',
      recipients: ['vevo@example.com', 'konyveles@example.hu'],
    })
    await documents.cancel(ID, { reason: 'Csak indok' })

    expect(mock.requests[0]?.body).toEqual({
      cancellation_reason: 'Hibás tétel',
      cancellation_recipients: 'vevo@example.com,konyveles@example.hu',
    })
    expect(mock.requests[1]?.body).toEqual({ cancellation_reason: 'Csak indok' })
  })

  test('„Cannot cancel the document”: a hiba magyar tippet kap a módosító számláról', async () => {
    const { documents } = setup({}, clientError(400, CANNOT_CANCEL))

    const error = await documents.cancel(ID).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      category: 'validation',
      status: 400,
      operation: 'CancelDocument',
      apiMessage: CANNOT_CANCEL,
      retryable: false,
    })
    expect((error as BillingoError).message).toContain(CANNOT_CANCEL)
    expect((error as BillingoError).hint).toContain('módosító számla után')
    expect((error as BillingoError).hint).toContain('documents.createModification')
    const cause = (error as BillingoError).cause as BillingoError
    expect(cause).toMatchObject({ apiMessage: CANNOT_CANCEL, hint: undefined })
    expect((error as BillingoError).requestId).toEqual(expect.any(String))
    expect((error as BillingoError).requestId).toBe(cause.requestId)
  })

  test('a tippel bővített hiba minden mezőt megtart: trace_id, mezőhibák, Retry-After, rate limit', async () => {
    const { documents } = setup(
      {},
      {
        status: 400,
        json: {
          error: { message: CANNOT_CANCEL, trace_id: 'abc123' },
          errors: [{ field: 'id', message: 'x' }],
        },
        headers: { 'retry-after': '7', 'x-ratelimit-limit': '300', 'x-ratelimit-remaining': '12' },
      },
    )

    const error = (await documents.cancel(ID).catch((caught: unknown) => caught)) as BillingoError

    expect(error.hint).toContain('módosító számla után')
    expect(error).toMatchObject({
      traceId: 'abc123',
      fieldErrors: [{ field: 'id', message: 'x' }],
      retryAfterMs: 7000,
      rateLimit: { limit: 300, remaining: 12 },
    })
  })

  test('más 400-as és más státuszú hiba változatlanul, tipp nélkül megy tovább', async () => {
    const { documents } = setup(
      {},
      clientError(400, 'Duplicate vendor id. (id:x)'),
      clientError(403, CANNOT_CANCEL),
      { status: 400 },
    )

    const other = await documents.cancel(ID).catch((caught: unknown) => caught)
    const forbidden = await documents.cancel(ID).catch((caught: unknown) => caught)

    expect(other).toMatchObject({ category: 'validation', status: 400, hint: undefined })
    expect(forbidden).toMatchObject({ category: 'forbidden', status: 403, hint: undefined })
    await expect(documents.cancel(ID)).rejects.toMatchObject({
      status: 400,
      apiMessage: undefined,
      hint: undefined,
    })
  })

  test('üres indok, üres címlista vagy hibás cím: kérés nélkül validation hiba', async () => {
    const { mock, documents } = setup({})

    const reason = await documents.cancel(ID, { reason: ' ' }).catch((caught: unknown) => caught)
    const empty = await documents.cancel(ID, { recipients: [] }).catch((caught: unknown) => caught)
    const invalid = await documents
      .cancel(ID, { recipients: ['nem-cim'] })
      .catch((caught: unknown) => caught)

    expect(reason).toMatchObject({
      category: 'validation',
      operation: 'CancelDocument',
      fieldErrors: [{ field: 'reason' }],
    })
    expect(empty).toMatchObject({ fieldErrors: [{ field: 'recipients' }] })
    expect(invalid).toMatchObject({ fieldErrors: [{ field: 'recipients.0' }] })
    expect(mock.requests).toEqual([])
  })
})

describe('documents.copy, archive', () => {
  test('copy: törzs nélküli POST, a piszkozatot adja vissza (200, P:080)', async () => {
    const draft = documentJson(141703695, { type: 'draft', invoice_number: '' })
    const { mock, documents } = setup({}, { status: 200, json: draft })

    expect(await documents.copy(ID)).toMatchObject({
      id: 141703695,
      type: 'draft',
      invoiceNumber: '',
    })
    expect(sent(mock)).toEqual([`POST /v3/documents/${ID}/copy`])
    expect(mock.requests[0]?.body).toBeUndefined()
  })

  test('archive: törzs nélküli PUT, a 204-re undefined', async () => {
    const { mock, documents } = setup({}, { status: 204 })

    expect(await documents.archive(ID)).toBeUndefined()
    expect(sent(mock)).toEqual([`PUT /v3/documents/${ID}/archive`])
    expect(mock.requests[0]?.operation).toBe('ArchiveDocument')
    expect(mock.requests[0]?.body).toBeUndefined()
  })
})

describe('documents.createFromProforma', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const invoice: Reply = {
    status: 201,
    json: documentJson(141703711, {
      payment_status: 'paid',
      related_documents: [{ id: ID, invoice_number: '000001' }],
    }),
  }

  test('alapból a mai budapesti teljesítés és a defaults.dueInDays szerinti határidő megy', async () => {
    const { mock, documents } = setup({}, invoice)

    const result = await documents.createFromProforma(ID)

    expect(sent(mock)).toEqual([`POST /v3/documents/${ID}/create-from-proforma`])
    expect(mock.requests[0]?.operation).toBe('CreateDocumentFromProforma')
    expect(mock.requests[0]?.body).toEqual({
      fulfillment_date: '2027-01-01',
      due_date: '2027-01-09',
    })
    expect(result).toMatchObject({ paymentStatus: 'paid', relatedDocuments: [{ id: ID }] })
  })

  test('a createTarca defaults.dueInDays értéke és a hívás dueInDays-e is számít', async () => {
    const { mock, documents } = setup({ defaults: { dueInDays: 15 } }, invoice, invoice)

    await documents.createFromProforma(ID)
    await documents.createFromProforma(ID, { dueInDays: 0 })

    expect(mock.requests[0]?.body).toMatchObject({ due_date: '2027-01-16' })
    expect(mock.requests[1]?.body).toMatchObject({ due_date: '2027-01-01' })
  })

  test('megadott dátumok, megjegyzés és formátum: a teljes InvoiceSettings törzs', async () => {
    const { mock, documents } = setup({}, invoice)

    await documents.createFromProforma(ID, {
      fulfillmentDate: new Date('2026-11-14T23:30:00Z'),
      dueDate: '2026-11-23',
      comment: 'Díjbekérőből',
      documentFormat: 'electronic',
      documentType: 'invoice',
    })

    expect(mock.requests[0]?.body).toEqual({
      fulfillment_date: '2026-11-15',
      due_date: '2026-11-23',
      comment: 'Díjbekérőből',
      document_format: 'electronic',
      document_type: 'invoice',
    })
  })

  test('hibás dátum, dueDate és dueInDays együtt, vagy negatív napszám: kérés nélkül validation', async () => {
    const { mock, documents } = setup({})

    const errors = await Promise.all(
      [
        { fulfillmentDate: '2026-02-30' },
        { dueDate: '2026-11-23', dueInDays: 3 },
        { dueInDays: -1 },
        { dueInDays: 1.5 },
      ].map((input) => documents.createFromProforma(ID, input).catch((caught: unknown) => caught)),
    )

    expect(
      errors.map((error) => (error as BillingoError).fieldErrors.map((item) => item.field)),
    ).toEqual([['fulfillmentDate'], ['dueDate'], ['dueInDays'], ['dueInDays']])
    expect(errors[0]).toMatchObject({
      category: 'validation',
      operation: 'CreateDocumentFromProforma',
    })
    expect((errors[3] as BillingoError).fieldErrors[0]?.message).toBe(
      'A dueInDays nemnegatív egész szám legyen, kapott: 1.5',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('documents.createModification', () => {
  const modification: Reply = {
    status: 201,
    json: documentJson(141703717, {
      type: 'modification',
      gross_total: -1270,
      related_documents: [{ id: ID, invoice_number: '2026-4' }],
    }),
  }

  const FULL: ModificationInput = {
    comment: 'Helyesbítés',
    dueDate: '2026-11-30',
    paymentMethod: 'cash',
    withoutFinancialFulfillment: true,
    items: [
      { name: 'Jóváírás', netUnitPrice: -1000, quantity: 1, vat: 27 },
      { name: 'Bruttó jóváírás', grossUnitPrice: -127, quantity: 2, unit: 'óra', vat: 5.5 },
      { productId: 29217099, quantity: -1, comment: 'termék' },
    ],
  }

  test('a különbözeti tételek a számlával azonos alakban, a módosító bizonylatot adja vissza', async () => {
    const { mock, documents } = setup({}, modification)

    const result = await documents.createModification(ID, FULL)

    expect(sent(mock)).toEqual([`POST /v3/documents/${ID}/create-modification-document`])
    expect(mock.requests[0]?.operation).toBe('CreateModificationDocument')
    expect(mock.requests[0]?.body).toEqual({
      comment: 'Helyesbítés',
      due_date: '2026-11-30',
      payment_method: 'cash',
      without_financial_fulfillment: true,
      items: [
        {
          name: 'Jóváírás',
          unit_price: -1000,
          unit_price_type: 'net',
          quantity: 1,
          unit: 'db',
          vat: '27%',
        },
        {
          name: 'Bruttó jóváírás',
          unit_price: -127,
          unit_price_type: 'gross',
          quantity: 2,
          unit: 'óra',
          vat: '5,5%',
        },
        { product_id: 29217099, quantity: -1, comment: 'termék' },
      ],
    })
    expect(result).toMatchObject({ type: 'modification', grossTotal: -1270 })
  })

  test('csak tételekkel: a többi mező kimarad a törzsből', async () => {
    const { mock, documents } = setup({}, modification)

    await documents.createModification(ID, {
      items: [{ name: 'Jóváírás', netUnitPrice: -1000, quantity: 1, vat: 27 }],
    })

    expect(Object.keys(mock.requests[0]?.body as object)).toEqual(['items'])
  })

  test('tétel nélkül, hibás tétellel, dátummal, fizetési móddal vagy jelzővel: kérés nélkül validation', async () => {
    const { mock, documents } = setup({})
    const item = { name: 'x', netUnitPrice: 1, quantity: 1, vat: 27 } as const

    const cases: ModificationInput[] = [
      { items: [] },
      { items: undefined as unknown as ModificationInput['items'] },
      { items: [{ name: 'x', quantity: 1, vat: 27 } as unknown as ModificationInput['items'][0]] },
      { items: [item], dueDate: '2026-13-01' },
      { items: [item], paymentMethod: 'kartya' as PaymentMethod },
      { items: [item], withoutFinancialFulfillment: 'igen' as unknown as boolean },
    ]
    const errors = await Promise.all(
      cases.map((input) =>
        documents.createModification(ID, input).catch((caught: unknown) => caught),
      ),
    )

    expect(
      errors.map((error) => (error as BillingoError).fieldErrors.map((item) => item.field)),
    ).toEqual([
      ['items'],
      ['items'],
      ['items.0'],
      ['dueDate'],
      ['paymentMethod'],
      ['withoutFinancialFulfillment'],
    ])
    expect(errors[0]).toMatchObject({
      category: 'validation',
      operation: 'CreateModificationDocument',
    })
    expect(mock.requests).toEqual([])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('a bizonylatműveletek kérései a friss Billingo spec ellen', () => {
  test('send, cancel, createFromProforma és createModification teljes törzse megfelel a spec-nek', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'))
    const document: Reply = { status: 200, json: documentJson(1) }
    const created: Reply = { status: 201, json: documentJson(2) }
    const { mock, documents } = setup(
      {},
      { status: 200, json: { emails: ['a@example.com'] } },
      document,
      created,
      created,
    )

    await documents.send(ID, { emails: ['a@example.com'] })
    await documents.cancel(ID, { reason: 'Hiba', recipients: ['a@example.com', 'b@example.com'] })
    await documents.createFromProforma(ID, {
      comment: 'x',
      documentFormat: 'traditional',
      documentType: 'invoice',
    })
    await documents.createModification(ID, {
      comment: 'x',
      dueDate: '2026-11-30',
      paymentMethod: 'cash',
      withoutFinancialFulfillment: false,
      items: [
        { name: 'x', netUnitPrice: -1000, quantity: 1, vat: 27, comment: 'c', sku: 'S1' },
        { productId: 5, quantity: 1 },
      ],
    })
    vi.useRealTimers()

    const operations = mock.requests.map((request) => request.operation)
    expect(operations).toEqual([
      'SendDocument',
      'CancelDocument',
      'CreateDocumentFromProforma',
      'CreateModificationDocument',
    ])
    for (const request of mock.requests) {
      expect(request.operation && requestErrors(request.operation, request.body)).toEqual([])
    }
  })
})
