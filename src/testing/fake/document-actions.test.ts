import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createFakeExchangeLog,
  FAKE_KEY,
  type FakeHarness,
  fakeExchangeSpecErrors,
  succeededOperations,
} from '../../../tests/fake-exchanges'
import { SPEC_AVAILABLE } from '../../../tests/openapi'
import { createTarca } from '../../client'
import { BillingoError } from '../../core/errors'
import { createFakeBillingoFetch } from '../fake-billingo'
import {
  cannotCancelMessage,
  cannotModifyMessage,
  documentActionRoutes,
  NAV_RECORD_NOT_FOUND,
  NAV_SETTINGS_MISSING,
  ONLY_PROFORMA_ARCHIVABLE,
  ONLY_PROFORMA_CONVERTIBLE,
} from './document-actions'
import { FAKE_BILLINGO_MESSAGES } from './http'
import { DEFAULT_NAV_RECORD_DELAY_MS } from './state'

const log = createFakeExchangeLog()

const NOW = new Date('2026-11-15T14:05:27Z')

const PARTNER = {
  name: 'TARCA-PROBE Béta Bt',
  address: { country_code: 'HU', post_code: '1011', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['beta@example.com'],
}

function item(name: string, unitPrice: number, quantity = 1) {
  return { name, unit_price: unitPrice, unit_price_type: 'net', quantity, unit: 'db', vat: '27%' }
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
  items: [item('alap tétel', 1000)],
}

const RECEIPT = {
  block_id: 2,
  type: 'receipt',
  payment_method: 'cash',
  currency: 'HUF',
  electronic: false,
  items: [{ name: 'nyugta tétel', unit_price: 1270, vat: '27%', quantity: 1, unit: 'db' }],
}

async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 1000 && !done(); round++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  expect(done()).toBe(true)
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function issued(fields: Record<string, unknown> = {}) {
  const harness = log.harness({ now: () => NOW })
  expect((await harness.call('POST', '/partners', PARTNER)).status).toBe(201)
  const invoice = await harness.call('POST', '/documents', { ...INVOICE, ...fields })
  expect(invoice.status).toBe(201)
  return harness
}

async function documentOf(harness: FakeHarness, id: number) {
  return (await harness.call('GET', `/documents/${id}`)).body as Record<string, unknown>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('hamis Billingo: PDF, POS, nyilvános hivatkozás', () => {
  test('a PDF application/pdf, %PDF-fel kezdődik, a fájlnév a sorszám (P:065)', async () => {
    const harness = await issued()

    const raw = await harness.call('GET', '/documents/1/download')
    const file = await harness.tarca.documents.pdf(1)

    expect(raw.status).toBe(200)
    expect(raw.contentType).toBe('application/pdf')
    expect(raw.headers.get('content-disposition')).toBe('attachment; filename=2026-1.pdf')
    expect(raw.headers.get('x-ratelimit-limit')).toBe('300')
    expect(raw.headers.get('x-ratelimit-remaining')).toBe('297')
    expect(raw.headers.get('x-ratelimit-reset')).toBeNull()
    expect(text(raw.bytes).startsWith('%PDF-1.4\n')).toBe(true)
    expect(file).toMatchObject({ contentType: 'application/pdf', filename: '2026-1.pdf' })
  })

  test('csak a bináris válaszok hoznak rate limit fejlécet, a perces ablak kéréseiből számolva (P:065, 069, 108)', async () => {
    let now = NOW.getTime()
    const harness = log.harness({ now: () => new Date(now) })
    await harness.call('POST', '/partners', PARTNER)
    const invoice = await harness.call('POST', '/documents', INVOICE)
    const rateLimits: unknown[] = []
    const tarca = createTarca({
      apiKey: FAKE_KEY,
      fetch: harness.billingo.fetch,
      hooks: { onResponse: (event) => rateLimits.push(event.rateLimit) },
    })

    await tarca.documents.posPdf(1, { size: 80 })
    now += 60_000
    await tarca.documents.pdf(1)
    await tarca.documents.get(1)

    expect(invoice.headers.get('x-ratelimit-limit')).toBeNull()
    expect(rateLimits).toEqual([
      { limit: 300, remaining: 297, resetAt: undefined },
      { limit: 300, remaining: 299, resetAt: undefined },
      undefined,
    ])
  })

  test('a szóközös, perjeles sorszám fájlneve idézőjelek között jön, a kliens kibontja', async () => {
    const harness = log.harness({ now: () => NOW })
    await harness.call('POST', '/partners', PARTNER)
    const block = await harness.call('POST', '/document-blocks', {
      name: 'TARCA E2E',
      prefix: 'TRCE',
      type: 'invoice',
    })
    await harness.call('POST', '/documents', {
      ...INVOICE,
      block_id: (block.body as { id: number }).id,
    })

    const raw = await harness.call('GET', '/documents/1/download')

    expect(raw.headers.get('content-disposition')).toBe(
      'attachment; filename="TRCE / 2026-000001.pdf"',
    )
    expect((await harness.tarca.documents.pdf(1)).filename).toBe('TRCE / 2026-000001.pdf')
  })

  test('a sorszám nélküli piszkozat PDF-jének fájlneve az azonosító (élőben nem mértük)', async () => {
    const harness = await issued({ type: 'draft' })

    expect((await harness.tarca.documents.pdf(1)).filename).toBe('1.pdf')
  })

  test('202 hibainjektálással: a pdf() 1 mp-et vár, és újra kéri', async () => {
    const harness = await issued()
    harness.billingo.fail('notReady', { operation: 'DownloadDocument' })
    const tarca = createTarca({ apiKey: FAKE_KEY, fetch: harness.billingo.fetch, maxAttempts: 1 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const running = tarca.documents.pdf(1)
    await until(() => vi.getTimerCount() === 1)
    expect(harness.billingo.count('DownloadDocument')).toBe(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(harness.billingo.count('DownloadDocument')).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    const file = await running

    expect(harness.billingo.count('DownloadDocument')).toBe(2)
    expect(harness.billingo.requests.at(-2)).toMatchObject({ status: 202, faulted: true })
    expect(text(file.bytes).startsWith('%PDF')).toBe(true)
  })

  test('202 hibainjektálással maxWaitMs: 0 mellett not_ready a Billingo üzenetével', async () => {
    const harness = await issued()
    harness.billingo.fail('notReady', { operation: 'DownloadDocument', times: 3 })

    const error = await harness.tarca.documents
      .pdf(1, { maxWaitMs: 0 })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({
      category: 'not_ready',
      status: 202,
      apiMessage: FAKE_BILLINGO_MESSAGES.notReady,
    })
  })

  test('POS: application/octet-stream PDF a size paraméterrel; hiányzó vagy rossz méretre 422', async () => {
    const harness = await issued()

    const pos = await harness.call('GET', '/documents/1/print/pos?size=80')
    const missing = await harness.call('GET', '/documents/1/print/pos')
    const wrong = await harness.call('GET', '/documents/1/print/pos?size=70')
    const file = await harness.tarca.documents.posPdf(1, { size: 58 })

    expect(pos.contentType).toBe('application/octet-stream')
    expect(text(pos.bytes)).toContain('POS 80 mm')
    expect(text(file.bytes)).toContain('POS 58 mm')
    expect(file).toMatchObject({ contentType: 'application/octet-stream', filename: '2026-1.pdf' })
    expect(missing).toMatchObject({
      status: 422,
      body: { errors: [{ field: 'size', message: 'The size field is required.' }] },
    })
    expect(wrong).toMatchObject({
      status: 422,
      body: { errors: [{ field: 'size', message: 'The selected size is invalid.' }] },
    })
  })

  test('a nyilvános hivatkozás az API hostján, 32 karakteres, bizonylatonként más tokennel (P:071)', async () => {
    const harness = await issued()
    await harness.call('POST', '/documents', INVOICE)

    const first = await harness.tarca.documents.publicUrl(1)
    const again = await harness.tarca.documents.publicUrl(1)
    const second = await harness.tarca.documents.publicUrl(2)

    expect(first).toMatch(/^https:\/\/api\.billingo\.hu\/document-access\/[A-Za-z0-9]{32}$/)
    expect(again).toBe(first)
    expect(second).not.toBe(first)
    expect(new Set(first.slice(-32)).size).toBeGreaterThan(10)
  })
})

describe('hamis Billingo: NAV állapot, emlékeztetők, küldés', () => {
  test('a friss bizonylatnak még nincs NAV rekordja (404), 10 mp után 200 no_online_szamla_settings (P:072)', async () => {
    let now = NOW
    const harness = log.harness({ now: () => now })
    await harness.call('POST', '/partners', PARTNER)
    await harness.call('POST', '/documents', INVOICE)

    const fresh = await harness.call('GET', '/documents/1/online-szamla')
    now = new Date(NOW.getTime() + DEFAULT_NAV_RECORD_DELAY_MS - 1)
    const almost = await harness.tarca.documents.navStatus(1)
    now = new Date(NOW.getTime() + DEFAULT_NAV_RECORD_DELAY_MS)
    const ready = await harness.call('GET', '/documents/1/online-szamla')

    expect(DEFAULT_NAV_RECORD_DELAY_MS).toBe(10_000)
    expect(fresh).toMatchObject({ status: 404, body: { error: { message: NAV_RECORD_NOT_FOUND } } })
    expect(almost).toBeNull()
    expect(ready).toMatchObject({
      status: 200,
      body: {
        transaction_id: '',
        status: 'no_online_szamla_settings',
        messages: [
          {
            validation_result_code: '',
            validation_error_code: '',
            human_readable_message: NAV_SETTINGS_MISSING,
          },
        ],
      },
    })
  })

  test('a piszkozatnak a késleltetés után sincs NAV rekordja: a navStatus null', async () => {
    const harness = log.harness({ now: () => NOW, navRecordDelayMs: 0 })
    await harness.call('POST', '/partners', PARTNER)
    await harness.call('POST', '/documents', { ...INVOICE, type: 'draft' })

    expect(await harness.tarca.documents.navStatus(1)).toBeNull()
  })

  test('navRecordDelayMs: 0 esetén azonnal van rekord; NAV kapcsolattal a saját állapot jön', async () => {
    const offline = log.harness({ now: () => NOW, navRecordDelayMs: 0 })
    const online = log.harness({ now: () => NOW, navRecordDelayMs: 0, hasNavConnection: true })
    for (const harness of [offline, online]) {
      await harness.call('POST', '/partners', PARTNER)
      await harness.call('POST', '/documents', INVOICE)
    }

    expect(await offline.tarca.documents.navStatus(1)).toMatchObject({
      status: 'no_online_szamla_settings',
    })
    expect(await online.tarca.documents.navStatus(1)).toEqual({
      transactionId: '',
      status: 'processing',
      messages: [],
    })
  })

  test('hibás navRecordDelayMs: TypeError a létrehozáskor', () => {
    for (const navRecordDelayMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createFakeBillingoFetch({ navRecordDelayMs })).toThrow(TypeError)
    }
  })

  test('emlékeztetők: három üres lista (P:073)', async () => {
    const harness = await issued()

    expect(await harness.tarca.documents.reminders(1)).toEqual({
      sentReminders: [],
      upcomingReminders: [],
      sentPostalMail: [],
    })
  })

  test('küldés: a megadott címek; cím nélkül a partner címei; hibás címre 422', async () => {
    const harness = await issued()

    const explicit = await harness.tarca.documents.send(1, { emails: ['vevo@example.com'] })
    const partners = await harness.call('POST', '/documents/1/send', {})
    const invalid = await harness.call('POST', '/documents/1/send', {
      emails: ['jo@example.com', 'rossz'],
    })
    const notArray = await harness.call('POST', '/documents/1/send', { emails: 'a@example.com' })

    expect(explicit).toEqual({ emails: ['vevo@example.com'] })
    expect(partners).toMatchObject({ status: 200, body: { emails: PARTNER.emails } })
    expect(invalid).toMatchObject({
      status: 422,
      body: {
        errors: [{ field: 'emails.1', message: 'The emails.1 must be a valid email address.' }],
      },
    })
    expect(notArray).toMatchObject({
      status: 422,
      body: { errors: [{ field: 'emails', message: 'The emails must be an array.' }] },
    })
  })

  test('küldés cím nélkül, e-mail nélküli partnerrel: 422 emails', async () => {
    const harness = log.harness({ now: () => NOW })
    await harness.call('POST', '/partners', { ...PARTNER, emails: [] })
    await harness.call('POST', '/documents', INVOICE)

    expect(await harness.call('POST', '/documents/1/send')).toMatchObject({
      status: 422,
      body: { errors: [{ field: 'emails', message: 'The emails field is required.' }] },
    })
  })
})

describe('hamis Billingo: sztornó', () => {
  test('a számla sztornója új sorszámú, negatív bizonylat, az eredeti cancelled lesz, az értesítési állapota marad (P:117, 118, 130)', async () => {
    const harness = await issued()

    const storno = await harness.call('POST', '/documents/1/cancel', {
      cancellation_reason: 'takarítás',
      cancellation_recipients: 'a@example.com, b@example.com',
    })
    const original = await documentOf(harness, 1)

    expect(storno).toMatchObject({
      status: 200,
      body: {
        id: 2,
        invoice_number: '2026-2',
        type: 'cancellation',
        correction_type: 'cancellation',
        cancelled: false,
        payment_status: 'none',
        gross_total: -1270,
        fulfillment_date: '2026-11-15',
        due_date: '2026-11-23',
        comment: 'TARCA-PROBE',
        online_szamla_status: 'processing',
        kobak_receipt_status: null,
        related_documents: [{ id: 1, invoice_number: '2026-1' }],
        items: [
          { net_unit_amount: -1000, net_amount: -1000, vat_amount: -270, gross_amount: -1270 },
        ],
        summary: { net_amount: -1000, vat_amount: -270, gross_amount_local: -1270 },
      },
    })
    expect(original).toMatchObject({
      cancelled: true,
      correction_type: 'canceled',
      payment_status: 'none',
      notification_status: 'none',
      online_szamla_status: 'no_online_szamla_settings',
    })
  })

  test('a már sztornózott, a piszkozat és a díjbekérő nem sztornózható: 400', async () => {
    const harness = await issued()
    await harness.call('POST', '/documents', { ...INVOICE, type: 'draft' })
    await harness.call('POST', '/documents', { ...INVOICE, type: 'proforma' })
    await harness.call('POST', '/documents/1/cancel')

    for (const id of [1, 2, 3, 4]) {
      expect(await harness.call('POST', `/documents/${id}/cancel`)).toMatchObject({
        status: 400,
        body: { error: { message: cannotCancelMessage(id) } },
      })
    }
  })

  test('a nyugta sztornója receipt_cancellation a nyugtatömb sorszámával, kobak pending (P:110)', async () => {
    const harness = log.harness({ now: () => NOW })
    await harness.call('POST', '/documents/receipt', RECEIPT)

    const storno = await harness.tarca.documents.cancel(1)

    expect(storno).toMatchObject({
      type: 'receipt_cancellation',
      correctionType: 'receipt_cancellation',
      invoiceNumber: 'NYT-2026-2',
      kobakReceiptStatus: 'pending',
      grossTotal: -1270,
      settings: { selectedType: 'receipt' },
    })
  })

  test('a végszámla sztornója az előleget és a végszámlát is hivatkozza (P:112)', async () => {
    const harness = await issued({ type: 'advance' })
    await harness.call('POST', '/documents', {
      ...INVOICE,
      items: [item('végszámla', 3000)],
      advance_invoice: [1],
    })

    const storno = await harness.tarca.documents.cancel(2, { reason: 'takarítás' })

    expect(storno.relatedDocuments).toEqual([
      { id: 1, invoiceNumber: '2026-1' },
      { id: 2, invoiceNumber: '2026-2' },
    ])
    expect(storno.grossTotal).toBe(-2540)
    expect(storno.items?.map((line) => line.grossAmount)).toEqual([-3810, 1270])
  })

  test('a fizetett számla sztornója törli a befizetéseket, a payment_status none', async () => {
    const harness = await issued()
    await harness.call('PUT', '/documents/1/payments', [
      { date: '2026-11-15', price: 1270, payment_method: 'wire_transfer' },
    ])

    await harness.call('POST', '/documents/1/cancel', { cancellation_reason: 'x' })

    expect((await harness.call('GET', '/documents/1/payments')).body).toEqual([])
    expect(await documentOf(harness, 1)).toMatchObject({ payment_status: 'none' })
  })

  test('az előleg a végszámla sztornója után sztornózható, a lánc nem tiltja (P:112, 113)', async () => {
    const harness = await issued({ type: 'advance' })
    await harness.call('POST', '/documents', { ...INVOICE, advance_invoice: [1] })
    await harness.call('POST', '/documents/2/cancel')

    const advance = await harness.call('POST', '/documents/1/cancel')

    expect(advance).toMatchObject({ status: 200, body: { type: 'cancellation' } })
  })

  test('hibás címzett vagy nem szöveges indok 422, ismeretlen bizonylat 403', async () => {
    const harness = await issued()

    const reason = await harness.call('POST', '/documents/1/cancel', { cancellation_reason: 5 })
    const invalid = await harness.call('POST', '/documents/1/cancel', {
      cancellation_recipients: 'a@example.com,rossz',
    })
    const unknown = await harness.call('POST', '/documents/9/cancel')

    expect(invalid).toMatchObject({
      status: 422,
      body: { errors: [{ field: 'cancellation_recipients' }] },
    })
    expect(reason).toMatchObject({
      status: 422,
      body: {
        errors: [
          { field: 'cancellation_reason', message: 'The cancellation reason must be a string.' },
        ],
      },
    })
    expect(unknown.status).toBe(403)
    expect(await documentOf(harness, 1)).toMatchObject({ cancelled: false })
  })
})

describe('hamis Billingo: másolat, archiválás, díjbekérőből számla, módosító', () => {
  test('a másolat piszkozat sorszám nélkül, ugyanazokkal a tételekkel, és törölhető (P:080, 081)', async () => {
    const harness = await issued()
    await harness.call('PUT', '/documents/1/payments', [
      { date: '2026-11-15', price: 1270, payment_method: 'cash' },
    ])

    const copy = await harness.tarca.documents.copy(1)
    const copyPayments = await harness.call('GET', `/documents/${copy.id}/payments`)
    const deleted = await harness.call('DELETE', `/documents/${copy.id}`)

    expect(copy).toMatchObject({
      id: 2,
      type: 'draft',
      correctionType: 'draft',
      invoiceNumber: '',
      paymentStatus: 'none',
      onlineSzamlaStatus: 'not_checked',
      comment: 'TARCA-PROBE',
      dueDate: '2026-11-23',
      relatedDocuments: [],
      items: [{ name: 'alap tétel', grossAmount: 1270 }],
    })
    expect(copyPayments.body).toEqual([])
    expect(deleted.status).toBe(204)
  })

  test('a sztornózott, a végszámla és a nyugta másolata is tiszta piszkozat, aznapi kelttel', async () => {
    let now = NOW
    const harness = log.harness({ now: () => now })
    await harness.call('POST', '/partners', PARTNER)
    await harness.call('POST', '/documents', { ...INVOICE, type: 'advance' })
    await harness.call('POST', '/documents', { ...INVOICE, advance_invoice: [1] })
    await harness.call('POST', '/documents/receipt', RECEIPT)
    await harness.call('POST', '/documents/1/cancel')
    now = new Date('2026-11-17T09:00:00Z')

    const cancelled = await harness.tarca.documents.copy(1)
    const final = await harness.tarca.documents.copy(2)
    const receipt = await harness.tarca.documents.copy(3)

    expect(cancelled).toMatchObject({
      type: 'draft',
      cancelled: false,
      notificationStatus: 'none',
      invoiceDate: '2026-11-17',
    })
    expect(final.relatedDocuments).toEqual([])
    expect(receipt).toMatchObject({ type: 'draft', kobakReceiptStatus: null })
  })

  test('a díjbekérő archiválása 204, utána nem látszik a listában; számlára 400', async () => {
    const harness = await issued({ type: 'proforma' })
    await harness.call('POST', '/documents', INVOICE)

    const archived = await harness.call('PUT', '/documents/1/archive')
    const invoice = await harness.call('PUT', '/documents/2/archive')
    const listed = await harness.tarca.documents.list()

    expect(archived.status).toBe(204)
    expect(invoice).toMatchObject({
      status: 400,
      body: { error: { message: ONLY_PROFORMA_ARCHIVABLE } },
    })
    expect(listed.data.map((document) => document.id)).toEqual([2])
  })

  test('díjbekérőből fizetett számla a fő sorozat számával, a díjbekérőre hivatkozva (P:086)', async () => {
    const harness = await issued({ type: 'proforma', comment: 'díjbekérő' })

    const invoice = await harness.call('POST', '/documents/1/create-from-proforma', {
      fulfillment_date: '2026-11-14',
      due_date: '2026-11-30',
    })
    const bare = await harness.call('POST', '/documents/1/create-from-proforma')
    const commented = await harness.tarca.documents.createFromProforma(1, {
      comment: '  díjbekérőből  ',
    })
    const navRecord = await harness.tarca.documents.navStatus(3)

    expect(invoice).toMatchObject({
      status: 201,
      body: {
        id: 2,
        invoice_number: '2026-1',
        type: 'invoice',
        correction_type: 'invoice',
        payment_status: 'paid',
        fulfillment_date: '2026-11-14',
        due_date: '2026-11-30',
        comment: 'díjbekérő',
        gross_total: 1270,
        related_documents: [{ id: 1, invoice_number: '000001' }],
      },
    })
    expect(bare).toMatchObject({
      status: 201,
      body: { invoice_number: '2026-2', fulfillment_date: '2026-11-15', due_date: '2026-11-23' },
    })
    expect(commented.comment).toBe('díjbekérőből')
    expect(navRecord).toBeNull()
  })

  test('díjbekérőből másnap, törzs nélkül: a teljesítés a mai nap, nem a díjbekérőé', async () => {
    let now = NOW
    const harness = log.harness({ now: () => now })
    await harness.call('POST', '/partners', PARTNER)
    await harness.call('POST', '/documents', { ...INVOICE, type: 'proforma' })
    now = new Date('2026-11-16T09:00:00Z')

    const invoice = await harness.call('POST', '/documents/1/create-from-proforma')

    expect(invoice.body).toMatchObject({
      fulfillment_date: '2026-11-16',
      invoice_date: '2026-11-16',
      due_date: '2026-11-23',
    })
  })

  test('díjbekérőből: nem díjbekérőre 400, hibás dátumra 422', async () => {
    const harness = await issued()
    await harness.call('POST', '/documents', { ...INVOICE, type: 'proforma' })

    const notProforma = await harness.call('POST', '/documents/1/create-from-proforma')
    const badDate = await harness.call('POST', '/documents/2/create-from-proforma', {
      due_date: '2026-02-30',
    })

    expect(notProforma).toMatchObject({
      status: 400,
      body: { error: { message: ONLY_PROFORMA_CONVERTIBLE } },
    })
    expect(badDate).toMatchObject({ status: 422, body: { errors: [{ field: 'due_date' }] } })
  })

  test('módosító: a különbözet tételei, utána sem az eredeti, sem a módosító nem sztornózható (P:089–091)', async () => {
    const harness = await issued()

    const modification = await harness.tarca.documents.createModification(1, {
      items: [{ name: 'módosítás', netUnitPrice: -1000, quantity: 1, vat: 27 }],
    })
    const cancelOriginal = await harness.tarca.documents
      .cancel(1)
      .catch((caught: unknown) => caught)
    const cancelModification = await harness.call('POST', `/documents/${modification.id}/cancel`)
    const original = await documentOf(harness, 1)

    expect(modification).toMatchObject({
      id: 2,
      invoiceNumber: '2026-2',
      type: 'modification',
      correctionType: 'modification',
      paymentStatus: 'outstanding',
      grossTotal: -1270,
      dueDate: '2026-11-23',
      paymentMethod: 'wire_transfer',
      comment: 'TARCA-PROBE',
      relatedDocuments: [{ id: 1, invoiceNumber: '2026-1' }],
      items: [{ name: 'módosítás', netAmount: -1000, vatAmount: -270, grossAmount: -1270 }],
    })
    expect(cancelOriginal).toMatchObject({
      category: 'validation',
      status: 400,
      apiMessage: cannotCancelMessage(1),
      hint: expect.stringContaining('módosító'),
    })
    expect(cancelModification).toMatchObject({
      status: 400,
      body: { error: { message: cannotCancelMessage(2) } },
    })
    expect(original).toMatchObject({ cancelled: false, correction_type: 'modified' })
  })

  test('módosító: a megadott határidő, fizetési mód, megjegyzés és jelző érvényesül', async () => {
    const harness = await issued()

    const modification = await harness.call('POST', '/documents/1/create-modification-document', {
      due_date: '2026-12-01',
      payment_method: 'cash',
      comment: 'helyesbítés',
      without_financial_fulfillment: true,
      items: [item('módosítás', -500, 2)],
    })

    expect(modification).toMatchObject({
      status: 201,
      body: {
        due_date: '2026-12-01',
        payment_method: 'cash',
        comment: 'helyesbítés',
        gross_total: -1270,
        settings: { without_financial_fulfillment: true },
      },
    })
  })

  test('módosító: tétel nélkül, rossz mezőkkel 422; sztornózott vagy díjbekérő alapra 400', async () => {
    const harness = await issued()
    await harness.call('POST', '/documents', { ...INVOICE, type: 'proforma' })
    await harness.call('POST', '/documents', INVOICE)
    await harness.call('POST', '/documents/3/cancel')

    const empty = await harness.call('POST', '/documents/1/create-modification-document', {})
    const wrong = await harness.call('POST', '/documents/1/create-modification-document', {
      items: [item('x', 1)],
      due_date: 'holnap',
      payment_method: 'kartya',
      without_financial_fulfillment: 'igen',
      comment: 5,
    })
    const proforma = await harness.call('POST', '/documents/2/create-modification-document', {
      items: [item('x', 1)],
    })
    const cancelled = await harness.call('POST', '/documents/3/create-modification-document', {
      items: [item('x', 1)],
    })

    expect(empty).toMatchObject({ status: 422, body: { errors: [{ field: 'items' }] } })
    expect(
      (wrong.body as { errors: { field: string }[] }).errors.map((error) => error.field),
    ).toEqual(['due_date', 'comment', 'payment_method', 'without_financial_fulfillment'])
    expect(proforma).toMatchObject({
      status: 400,
      body: { error: { message: cannotModifyMessage(2) } },
    })
    expect(cancelled).toMatchObject({
      status: 400,
      body: { error: { message: cannotModifyMessage(3) } },
    })
  })
})

describe('hamis Billingo: befizetések', () => {
  test('üres lista, részösszeg → partially_paid, teljes → paid, törlés → [] és outstanding (P:075–079)', async () => {
    const harness = await issued()

    const empty = await harness.call('GET', '/documents/1/payments')
    const partial = await harness.tarca.documents.payments.replace(1, [
      { date: '2026-11-15', price: 500, paymentMethod: 'wire_transfer' },
    ])
    const partialStatus = await documentOf(harness, 1)
    const full = await harness.tarca.documents.payments.add(1, {
      date: '2026-11-15',
      price: 770,
      paymentMethod: 'cash',
      voucherNumber: ' P-2 ',
      conversionRate: 1,
    })
    const paidStatus = await documentOf(harness, 1)
    const cleared = await harness.call('DELETE', '/documents/1/payments')
    const clearedStatus = await documentOf(harness, 1)

    expect(empty).toMatchObject({ status: 200, body: [] })
    expect(partial).toEqual([
      {
        date: '2026-11-15',
        price: 500,
        paymentMethod: 'wire_transfer',
        voucherNumber: '',
        conversionRate: 1,
      },
    ])
    expect(partialStatus).toMatchObject({ payment_status: 'partially_paid' })
    expect(full.map((payment) => [payment.price, payment.voucherNumber])).toEqual([
      [500, ''],
      [770, 'P-2'],
    ])
    expect(paidStatus).toMatchObject({ payment_status: 'paid' })
    expect(cleared).toMatchObject({ status: 200, body: [] })
    expect(clearedStatus).toMatchObject({ payment_status: 'outstanding' })
    expect(await harness.tarca.documents.payments.list(1)).toEqual([])
  })

  test('a befizetés frissíti a last_modified_date szerinti listát', async () => {
    let now = NOW
    const harness = log.harness({ now: () => now })
    await harness.call('POST', '/partners', PARTNER)
    await harness.call('POST', '/documents', INVOICE)
    now = new Date('2026-11-15T15:00:00Z')

    const before = await harness.tarca.documents.list({ lastModifiedDate: '2026-11-15 15:30:00' })
    await harness.call('PUT', '/documents/1/payments', [
      { date: '2026-11-15', price: 1, payment_method: 'cash' },
    ])
    const after = await harness.tarca.documents.list({ lastModifiedDate: '2026-11-15 15:30:00' })

    expect(before.data).toEqual([])
    expect(after.data.map((document) => document.id)).toEqual([1])
  })

  test('hibás befizetés 422 mezőnként, a tömb helyett objektum 422', async () => {
    const harness = await issued()

    const invalid = await harness.call('PUT', '/documents/1/payments', [
      { price: 'sok', payment_method: 'kartya', voucher_number: 7, conversion_rate: -1 },
      { date: '2026-13-01', price: 1, payment_method: 'cash' },
    ])
    const object = await harness.call('PUT', '/documents/1/payments', {
      date: '2026-11-15',
      price: 1,
      payment_method: 'cash',
    })

    expect(
      (invalid.body as { errors: { field: string }[] }).errors.map((error) => error.field),
    ).toEqual([
      '0.date',
      '0.price',
      '0.payment_method',
      '0.voucher_number',
      '0.conversion_rate',
      '1.date',
    ])
    expect(object).toMatchObject({ status: 422, body: { errors: [{ field: 'payments' }] } })
    expect((await harness.call('GET', '/documents/1/payments')).body).toEqual([])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('hamis Billingo: bizonylatműveletek a friss spec ellen', () => {
  test('a fenti tesztek minden válasza megfelel a spec válaszsémájának', () => {
    expect(log.exchanges.length).toBeGreaterThan(80)
    expect(log.exchanges.flatMap(fakeExchangeSpecErrors)).toEqual([])
  })

  test('minden bizonylatművelet legalább egy sikeres válasza át lett vizsgálva', () => {
    const succeeded = succeededOperations(log.exchanges)
    const operations = Object.keys(documentActionRoutes)

    expect(operations).toHaveLength(14)
    expect(operations.filter((operation) => !succeeded.has(operation))).toEqual([])
  })
})
