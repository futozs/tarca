import { afterEach, describe, expect, test, vi } from 'vitest'
import { TEST_API_KEY } from '../../tests/helpers'
import {
  MCP_NOW,
  MCP_SECRET,
  MCP_TODAY,
  MODERN_META,
  mcpHarness,
  toolResultOf,
} from '../../tests/mcp'
import { createTarcaMcpServer } from './index'

const ADDRESS = { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' }

const PARTNER = { name: 'Példa Kft.', address: ADDRESS, taxcode: '12345678-2-42' }

const INVOICE = {
  partner: PARTNER,
  items: [{ name: 'Tanácsadás', quantity: 3, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
}

const RECEIPT = {
  electronic: false,
  items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 890, vat: 27 }],
}

afterEach(() => {
  vi.unstubAllEnvs()
})

type Harness = ReturnType<typeof mcpHarness>

function callThrough(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const connection = createTarcaMcpServer({
    apiKey: TEST_API_KEY,
    fetch: fetch as typeof globalThis.fetch,
    retryDelayMs: 0,
    recoveryDelayMs: 0,
    now: MCP_NOW,
    confirmationSecret: MCP_SECRET,
    allowWrite: true,
  }).connect()
  return async (name: string, args: Record<string, unknown>) =>
    toolResultOf(
      (await connection.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args, _meta: MODERN_META },
      })) as Parameters<typeof toolResultOf>[0],
    )
}

async function issue(harness: Harness, input: Record<string, unknown> = INVOICE) {
  const preview = await harness.call('preview_document', input)
  expect(preview.isError).toBe(false)
  return harness.call('create_document', { ...input, confirmation: preview.data.confirmation })
}

function documentId(result: { readonly data: Record<string, unknown> }): number {
  const document = result.data.document as { readonly id: number }
  return document.id
}

describe('MCP eszközök: számla', () => {
  test('az előnézet ellenőriz, becsül, megerősítő kódot ad, és csak olvas', async () => {
    const harness = mcpHarness({ allowWrite: true })

    const preview = await harness.call('preview_document', INVOICE)

    expect(preview.isError).toBe(false)
    expect(preview.data).toMatchObject({
      document: 'invoice',
      invoiceDate: MCP_TODAY,
      fulfillmentDate: MCP_TODAY,
      dueDate: '2026-11-24',
      paymentMethod: 'wire_transfer',
      currency: 'HUF',
      sendEmail: false,
      block: { id: 1, name: 'Számlák', prefix: '' },
      partner: { action: 'create', id: null, name: 'Példa Kft.' },
      vendorId: expect.stringMatching(/^MCP-[0-9A-F]{20}$/),
      vendorIdSource: 'automatic',
      existingDocument: null,
      items: [{ name: 'Tanácsadás', quantity: 3, vat: '27%', grossAmount: 76_200 }],
      totals: { netAmount: 60_000, vatAmount: 16_200, grossAmount: 76_200, estimate: true },
      confirmation: expect.stringMatching(/^[0-9a-z]+\.[0-9a-f]{32}$/),
    })
    expect(preview.summary).toContain('még NEM készült el')
    expect(preview.summary).toContain('a végleges összeget a Billingo számolja')
    expect(preview.summary).toContain('A vevő nem kap e-mailt')
    expect(preview.summary).toContain('új partner jön létre')
    expect(harness.writes()).toBe(0)
    expect(harness.billingo.data.documents.size).toBe(0)
  })

  test('a megerősítő kóddal pontosan az előnézetet állítja ki, e-mail nélkül', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const preview = await harness.call('preview_document', INVOICE)

    const created = await harness.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })

    expect(created).toMatchObject({
      isError: false,
      data: {
        created: true,
        recovered: false,
        vendorId: preview.data.vendorId,
        document: { id: 1, invoiceNumber: '2026-1', grossTotal: 76_200, partner: 'Példa Kft.' },
      },
    })
    const post = harness.billingo.requests.find((entry) => entry.operation === 'CreateDocument')
    expect(post?.body).toMatchObject({
      vendor_id: preview.data.vendorId,
      block_id: 1,
      fulfillment_date: MCP_TODAY,
      due_date: '2026-11-24',
      settings: { should_send_email: false },
    })
    expect(harness.billingo.count('CreateDocument')).toBe(1)
  })

  test('ugyanazzal a megerősítéssel vagy újabb előnézettel sem állít ki második számlát', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const preview = await harness.call('preview_document', INVOICE)
    const args = { ...INVOICE, confirmation: preview.data.confirmation }

    await harness.call('create_document', args)
    const again = await harness.call('create_document', args)
    const repreviewed = await harness.call('preview_document', INVOICE)
    const third = await harness.call('create_document', {
      ...INVOICE,
      confirmation: repreviewed.data.confirmation,
    })

    expect(again.data).toMatchObject({ created: false, document: { invoiceNumber: '2026-1' } })
    expect(again.summary).toContain('Nem állítottam ki újra')
    expect(repreviewed.data).toMatchObject({ existingDocument: { invoiceNumber: '2026-1' } })
    expect(repreviewed.summary).toContain('már létezik bizonylat')
    expect(third.data).toMatchObject({ created: false })
    expect(harness.billingo.count('CreateDocument')).toBe(1)
  })

  test('saját vendorId-t és e-mail küldést is átvesz', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const input = { ...INVOICE, vendorId: 'WEB-42', orderNumber: 'WEB-42', sendEmail: true }
    const preview = await harness.call('preview_document', input)

    const created = await harness.call('create_document', {
      ...input,
      confirmation: preview.data.confirmation,
    })

    expect(preview.data).toMatchObject({ vendorId: 'WEB-42', vendorIdSource: 'given' })
    expect(preview.summary).toContain('e-mailben elküldi')
    expect(created.data).toMatchObject({ created: true, vendorId: 'WEB-42' })
    expect(harness.billingo.requests.at(-1)?.body).toMatchObject({
      vendor_id: 'WEB-42',
      settings: { should_send_email: true, order_number: 'WEB-42' },
    })
  })

  test('hiányzó, módosított adatokhoz tartozó, hamis vagy lejárt megerősítő kódra eszközhibát ad', async () => {
    let current = MCP_NOW()
    const harness = mcpHarness({ allowWrite: true, now: () => current })
    const preview = await harness.call('preview_document', INVOICE)

    const missing = await harness.call('create_document', INVOICE)
    const malformed = await harness.call('create_document', { ...INVOICE, confirmation: 'kod' })
    const tampered = await harness.call('create_document', {
      ...INVOICE,
      items: [{ ...INVOICE.items[0], quantity: 30 }],
      confirmation: preview.data.confirmation,
    })
    const foreign = mcpHarness({ allowWrite: true, confirmationSecret: `${MCP_SECRET}-masik` })
    const otherSecret = await foreign.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })
    current = new Date(current.getTime() + 16 * 60_000)
    const expired = await harness.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })

    expect(missing).toMatchObject({ isError: true, summary: expect.stringContaining('Hiányzik') })
    expect(malformed).toMatchObject({
      isError: true,
      summary: expect.stringContaining('formátuma'),
    })
    expect(tampered).toMatchObject({ isError: true, summary: expect.stringContaining('eltérnek') })
    expect(otherSecret).toMatchObject({
      isError: true,
      summary: expect.stringContaining('eltérnek'),
    })
    expect(expired).toMatchObject({ isError: true, summary: expect.stringContaining('lejárt') })
    for (const result of [missing, malformed, tampered, expired]) {
      expect(result.error).toMatchObject({ category: 'confirmation', fields: ['confirmation'] })
      expect(result.summary).toContain('preview_document')
    }
    expect(harness.billingo.count('CreateDocument')).toBe(0)
    expect(foreign.billingo.count('CreateDocument')).toBe(0)
  })

  test('éjfél után a korábbi előnézet kódja nem állít ki második, más dátumú számlát', async () => {
    let current = new Date('2026-11-16T22:55:00.000Z')
    const harness = mcpHarness({ allowWrite: true, now: () => current })
    const preview = await harness.call('preview_document', INVOICE)
    const args = { ...INVOICE, confirmation: preview.data.confirmation }

    current = new Date('2026-11-16T22:58:00.000Z')
    const first = await harness.call('create_document', args)
    current = new Date('2026-11-16T23:05:00.000Z')
    const afterMidnight = await harness.call('create_document', args)
    const late = mcpHarness({ allowWrite: true, now: () => current })
    const fixed = {
      ...INVOICE,
      vendorId: 'WEB-9',
      fulfillmentDate: '2026-11-16',
      dueDate: '2026-11-30',
    }
    current = new Date('2026-11-16T22:55:00.000Z')
    const latePreview = await late.call('preview_document', fixed)
    current = new Date('2026-11-16T23:05:00.000Z')
    const lateCreate = await late.call('create_document', {
      ...fixed,
      confirmation: latePreview.data.confirmation,
    })

    expect(preview.data).toMatchObject({ fulfillmentDate: '2026-11-16', dueDate: '2026-11-24' })
    expect(first.data).toMatchObject({ created: true, vendorId: preview.data.vendorId })
    expect(afterMidnight).toMatchObject({ isError: true, error: { category: 'confirmation' } })
    expect(lateCreate).toMatchObject({ isError: true, error: { category: 'confirmation' } })
    expect(lateCreate.summary).toContain('preview_document')
    expect(harness.billingo.count('CreateDocument')).toBe(1)
    expect(late.billingo.count('CreateDocument')).toBe(0)
  })

  test('más alapbeállítású szerverpéldány nem fogadja el a kódot, mert a bizonylat eltérne az előnézettől', async () => {
    const preview = await mcpHarness({ defaults: { dueInDays: 8 } }).call(
      'preview_document',
      INVOICE,
    )
    const otherDue = mcpHarness({ allowWrite: true, defaults: { dueInDays: 30 } })
    const otherBlock = mcpHarness({ allowWrite: true, defaults: { blockId: 3, dueInDays: 8 } })
    const same = mcpHarness({ allowWrite: true, defaults: { dueInDays: 8 } })
    const receiptPreview = await mcpHarness({ defaults: { paymentMethod: 'cash' } }).call(
      'preview_receipt',
      RECEIPT,
    )
    const otherMethod = mcpHarness({ allowWrite: true, defaults: { paymentMethod: 'bankcard' } })
    const otherReceiptBlock = mcpHarness({
      allowWrite: true,
      defaults: { paymentMethod: 'cash', receiptBlockId: 3 },
    })
    const eurReceipt = { ...RECEIPT, conversionRate: 400 }
    const eurPreview = await mcpHarness({ defaults: { currency: 'EUR' } }).call(
      'preview_receipt',
      eurReceipt,
    )
    const otherCurrency = mcpHarness({ allowWrite: true, defaults: { currency: 'USD' } })
    const args = { ...INVOICE, confirmation: preview.data.confirmation }

    const due = await otherDue.call('create_document', args)
    const block = await otherBlock.call('create_document', args)
    const accepted = await same.call('create_document', args)
    const method = await otherMethod.call('create_receipt', {
      ...RECEIPT,
      confirmation: receiptPreview.data.confirmation,
    })
    const receiptBlock = await otherReceiptBlock.call('create_receipt', {
      ...RECEIPT,
      confirmation: receiptPreview.data.confirmation,
    })
    const currency = await otherCurrency.call('create_receipt', {
      ...eurReceipt,
      confirmation: eurPreview.data.confirmation,
    })

    expect(due).toMatchObject({ isError: true, error: { category: 'confirmation' } })
    expect(block).toMatchObject({ isError: true, error: { category: 'confirmation' } })
    expect(accepted.data).toMatchObject({ created: true, vendorId: preview.data.vendorId })
    expect(eurPreview.isError).toBe(false)
    for (const result of [method, receiptBlock, currency]) {
      expect(result).toMatchObject({ isError: true, error: { category: 'confirmation' } })
    }
    expect(
      [otherDue, otherBlock, otherMethod, otherReceiptBlock, otherCurrency].reduce(
        (sum, harness) => sum + harness.writes(),
        0,
      ),
    ).toBe(0)
  })

  test('a válasz elvesztésekor a vendorId alapján visszakeresi, és ezt az összegzés kimondja', async () => {
    const onError = vi.fn()
    const harness = mcpHarness({ allowWrite: true, hooks: { onError } })
    const preview = await harness.call('preview_document', INVOICE)
    harness.billingo.fail('network', { operation: 'CreateDocument', afterSuccess: true })

    const created = await harness.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })

    expect(created).toMatchObject({
      isError: false,
      data: { created: true, recovered: true, document: { invoiceNumber: '2026-1' } },
    })
    expect(created.summary).toContain('visszakereste')
    expect(harness.billingo.count('CreateDocument')).toBe(1)
    expect(harness.billingo.data.documents.size).toBe(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CreateDocument',
        error: expect.objectContaining({ category: 'network' }),
      }),
    )
  })

  test('párhuzamos kiállításnál a meglévőt adja vissza, és ezt kimondja', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const preview = await harness.call('preview_document', INVOICE)
    const vendorId = String(preview.data.vendorId)
    const call = callThrough(async (input, init) => {
      if (init?.method === 'POST' && new URL(String(input)).pathname.endsWith('/documents')) {
        await harness.tarca.documents.create({ ...INVOICE, vendorId })
      }
      return harness.billingo.fetch(input, init)
    })

    const result = await call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })

    expect(result).toMatchObject({
      isError: false,
      data: { created: false, recovered: false, vendorId },
    })
    expect(result.summary).toContain('párhuzamos hívás')
    expect(harness.billingo.data.documents.size).toBe(1)
  })

  test('a vendorId-keresés újrapróbált hibája nem minősül elveszett kiállításnak', async () => {
    const onError = vi.fn()
    const harness = mcpHarness({ allowWrite: true, hooks: { onError } })
    const preview = await harness.call('preview_document', INVOICE)
    harness.billingo.fail({ status: 503 }, { operation: 'GetDocumentByVendorId' })

    const created = await harness.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })

    expect(created).toMatchObject({ isError: false, data: { created: true, recovered: false } })
    expect(created.summary).not.toContain('visszakereste')
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'GetDocumentByVendorId', willRetry: true }),
    )
  })

  test('sztornózott bizonylat vendorId-jára az előnézet és a kiállítás is figyelmeztet', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    await harness.tarca.documents.cancel(id)

    const preview = await harness.call('preview_document', INVOICE)
    const again = await harness.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })

    expect(preview.summary).toContain('már sztornózva van; újra kiállítani csak új vendorId-val')
    expect(again.data).toMatchObject({ created: false })
    expect(again.summary).toContain('A bizonylat sztornózva van')
    expect(harness.billingo.count('CreateDocument')).toBe(1)
  })

  test('elveszett kérés után sem küld második POST-ot: a hiba megy tovább', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const preview = await harness.call('preview_document', INVOICE)
    harness.billingo.fail('network', { operation: 'CreateDocument' })

    const result = await harness.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { category: 'network', retryable: true },
    })
    expect(harness.billingo.count('CreateDocument')).toBe(1)
    expect(harness.billingo.data.documents.size).toBe(0)
  })

  test('a Billingo hibáját tippel, gépi hibakóddal és traceId-val adja vissza', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const preview = await harness.call('preview_document', INVOICE)
    harness.billingo.fail({ status: 402 }, { operation: 'CreateDocument' })

    const result = await harness.call('create_document', {
      ...INVOICE,
      confirmation: preview.data.confirmation,
    })
    const server = mcpHarness({ allowWrite: true })
    server.billingo.fail(
      { status: 500, message: 'Belső hiba' },
      { operation: 'ListDocumentBlock', times: 3 },
    )
    const failed = await server.call('preview_document', INVOICE)

    expect(result).toMatchObject({
      isError: true,
      structured: false,
      error: { category: 'subscription', status: 402, retryable: false, fields: [] },
    })
    expect(result.summary).toContain('Tipp:')
    expect(failed.error).toMatchObject({
      category: 'server',
      status: 500,
      retryable: true,
      traceId: expect.any(String),
    })
    expect(result.text).not.toContain(TEST_API_KEY)
  })

  test('a tárca saját ellenőrzése kérés nélkül, magyar mezőhibákkal utasít el', async () => {
    const harness = mcpHarness({ allowWrite: true })

    const result = await harness.call('preview_document', { ...INVOICE, currency: 'EUR' })

    expect(result).toMatchObject({
      isError: true,
      error: { category: 'validation', fields: ['conversionRate'] },
    })
    expect(result.summary).toContain('árfolyam')
    expect(result.summary).toContain('Tipp:')
    expect(harness.billingo.requests).toHaveLength(0)
  })

  test('egyező meglévő partnert újrahasznosít, eltérő adatnál újat jelez', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const existing = await harness.tarca.partners.create(PARTNER)

    const same = await harness.call('preview_document', INVOICE)
    const differs = await harness.call('preview_document', {
      ...INVOICE,
      partner: { ...PARTNER, address: { ...ADDRESS, address: 'Fő utca 2.' } },
    })
    const byId = await harness.call('preview_document', {
      partnerId: existing.id,
      items: INVOICE.items,
    })

    expect(same.data.partner).toEqual({ action: 'reuse', id: existing.id, name: 'Példa Kft.' })
    expect(same.summary).toContain('azt használja')
    expect(differs.data.partner).toMatchObject({ action: 'create', id: null })
    expect(byId.data.partner).toEqual({ action: 'existing', id: existing.id, name: 'Példa Kft.' })
    const abroad = await harness.tarca.partners.create({
      name: 'Külföldi GmbH',
      address: { ...ADDRESS, countryCode: 'AT' },
    })
    const implicitCountry = await harness.call('preview_document', {
      partner: { name: 'Külföldi GmbH', address: ADDRESS },
      items: INVOICE.items,
    })
    const explicitCountry = await harness.call('preview_document', {
      partner: { name: 'Külföldi GmbH', address: { ...ADDRESS, countryCode: 'at' } },
      items: INVOICE.items,
    })
    expect(implicitCountry.data.partner).toMatchObject({ action: 'create' })
    expect(explicitCountry.data.partner).toMatchObject({ action: 'reuse', id: abroad.id })
  })

  test('az e-mail címeket kisbetűsen veti össze, a hiányzó címet eltérésnek veszi', async () => {
    const harness = mcpHarness()
    const stored = await harness.tarca.partners.create({
      ...PARTNER,
      emails: ['Penzugy@Pelda.hu', 'iroda@pelda.hu'],
    })

    const sameEmails = await harness.call('preview_document', {
      ...INVOICE,
      partner: { ...PARTNER, emails: ['penzugy@pelda.hu', 'IRODA@pelda.hu'] },
    })
    const fewerEmails = await harness.call('preview_document', {
      ...INVOICE,
      partner: { ...PARTNER, emails: ['penzugy@pelda.hu'] },
    })

    expect(sameEmails.data.partner).toMatchObject({ action: 'reuse', id: stored.id })
    expect(fewerEmails.data.partner).toMatchObject({ action: 'create', id: null })
  })

  test('ismeretlen partnert, tömböt, terméket és rossz típusú tömböt előre jelez', async () => {
    const harness = mcpHarness({ allowWrite: true })

    const partner = await harness.call('preview_document', { partnerId: 99, items: INVOICE.items })
    const block = await harness.call('preview_document', { ...INVOICE, blockId: 99 })
    const receiptBlock = await harness.call('preview_document', { ...INVOICE, blockId: 2 })
    const product = await harness.call('preview_document', {
      partner: PARTNER,
      items: [{ productId: 7, quantity: 1 }],
    })

    expect(partner).toMatchObject({ isError: true, error: { fields: ['partnerId'] } })
    expect(block).toMatchObject({ isError: true, summary: expect.stringContaining('get_profile') })
    expect(receiptBlock).toMatchObject({
      isError: true,
      summary: expect.stringContaining('receipt típusú'),
    })
    expect(product).toMatchObject({ isError: true, error: { fields: ['productId'] } })
    expect(harness.writes()).toBe(0)
  })

  test('termékes tételnél a nettó árból számol, mint a Billingo, és a terméket egyszer kéri le', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const product = await harness.tarca.products.create({
      name: 'Csavar',
      currency: 'HUF',
      vat: '27%',
      netUnitPrice: 1000.01,
      unit: 'db',
    })
    const input = {
      partner: PARTNER,
      items: [
        { productId: product.id, quantity: 3 },
        { productId: product.id, quantity: 1 },
      ],
    }

    const preview = await harness.call('preview_document', input)
    const created = await harness.call('create_document', {
      ...input,
      confirmation: preview.data.confirmation,
    })

    expect(preview.data).toMatchObject({
      items: [{ grossAmount: 3810.04 }, { grossAmount: 1270.01 }],
      totals: { grossAmount: 5080.05 },
    })
    expect(created.data).toMatchObject({ document: { grossTotal: 5080.05 } })
    expect(
      harness.billingo.requests.filter(
        (entry) => entry.operation === 'GetProduct' && entry.path.endsWith(`/${product.id}`),
      ),
    ).toHaveLength(1)
  })

  test('termékes tétel összegét a termék nettó árából becsli', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const product = await harness.tarca.products.create({
      name: 'Doboz',
      currency: 'HUF',
      vat: '27%',
      netUnitPrice: 1000,
      unit: 'db',
    })
    const input = { partner: PARTNER, items: [{ productId: product.id, quantity: 2 }] }

    const preview = await harness.call('preview_document', input)
    const created = await harness.call('create_document', {
      ...input,
      confirmation: preview.data.confirmation,
    })

    expect(preview.data).toMatchObject({
      items: [{ name: 'Doboz', quantity: 2, grossAmount: 2540 }],
      totals: { grossAmount: 2540 },
    })
    expect(created.data).toMatchObject({ document: { grossTotal: 2540 } })
  })

  test('díjbekérő és előlegszámla előnézete és kiállítása', async () => {
    const harness = mcpHarness({ allowWrite: true })

    const proforma = await issue(harness, { ...INVOICE, type: 'proforma' })
    const advance = await issue(harness, { ...INVOICE, type: 'advance' })

    const proformaPreview = await harness.call('preview_document', {
      ...INVOICE,
      type: 'proforma',
    })

    expect(proforma.data).toMatchObject({ created: true, document: { type: 'proforma' } })
    expect(proforma.summary).toContain('Díjbekérő')
    expect(proformaPreview.data.warnings).toEqual([expect.stringContaining('Basic csomag')])
    expect(advance.data).toMatchObject({ created: true, document: { type: 'advance' } })
  })

  test('a devizás számla becslése az árfolyamot használja, végszámlánál figyelmeztet', async () => {
    const harness = mcpHarness({ allowWrite: true })

    const foreign = await harness.call('preview_document', {
      ...INVOICE,
      currency: 'EUR',
      conversionRate: 390,
      language: 'en',
    })
    const final = await harness.call('preview_document', { ...INVOICE, advanceInvoiceIds: [5] })

    expect(foreign.data).toMatchObject({
      currency: 'EUR',
      conversionRate: 390,
      language: 'en',
      totals: { grossAmount: 76_200 },
    })
    expect(final.data.warnings).toEqual([expect.stringContaining('előlegszámlák levonását')])
  })
})

describe('MCP eszközök: nyugta', () => {
  test('a nyugtatömbbel, bruttó árral és készpénzzel számol, ismétlésnél nem duplikál', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const preview = await harness.call('preview_receipt', RECEIPT)
    const args = { ...RECEIPT, confirmation: preview.data.confirmation }

    const created = await harness.call('create_receipt', args)
    const again = await harness.call('create_receipt', args)

    expect(preview.data).toMatchObject({
      document: 'receipt',
      paymentMethod: 'cash',
      electronic: false,
      block: { id: 2, name: 'Nyugták', prefix: 'NYT' },
      partner: null,
      vendorId: expect.stringMatching(/^MCP-[0-9A-F]{20}$/),
      items: [{ name: 'Kávé', quantity: 2, grossAmount: 1780 }],
    })
    expect(preview.summary).toContain('Magánszemély')
    expect(created.data).toMatchObject({
      created: true,
      document: { type: 'receipt', invoiceNumber: 'NYT-2026-1', paymentStatus: 'paid' },
    })
    expect(again.data).toMatchObject({ created: false })
    expect(harness.billingo.count('CreateReceipt')).toBe(1)
    expect(
      harness.billingo.requests.find((entry) => entry.operation === 'CreateReceipt')?.body,
    ).toMatchObject({
      block_id: 2,
      electronic: false,
      payment_method: 'cash',
    })
  })

  test('éjfél után a korábbi előnézet kódja nem állít ki második nyugtát', async () => {
    let current = new Date('2026-11-16T22:55:00.000Z')
    const harness = mcpHarness({ allowWrite: true, now: () => current })
    const preview = await harness.call('preview_receipt', RECEIPT)
    const args = { ...RECEIPT, confirmation: preview.data.confirmation }

    const first = await harness.call('create_receipt', args)
    current = new Date('2026-11-16T23:05:00.000Z')
    const afterMidnight = await harness.call('create_receipt', args)

    expect(first.data).toMatchObject({ created: true, vendorId: preview.data.vendorId })
    expect(afterMidnight).toMatchObject({ isError: true, error: { category: 'confirmation' } })
    expect(harness.billingo.count('CreateReceipt')).toBe(1)
  })

  test('saját vendorId-val egy rendeléshez egy nyugta készül, eltérő tartalommal sem kettő', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const first = { ...RECEIPT, vendorId: 'RENDELES-1' }
    const changed = {
      ...first,
      items: [{ name: 'Tea', quantity: 1, grossUnitPrice: 650, vat: 27 }],
    }
    const firstPreview = await harness.call('preview_receipt', first)
    const created = await harness.call('create_receipt', {
      ...first,
      confirmation: firstPreview.data.confirmation,
    })

    const changedPreview = await harness.call('preview_receipt', changed)
    const { grossAmount } = firstPreview.data.totals as { readonly grossAmount: number }
    const again = await harness.call('create_receipt', {
      ...changed,
      confirmation: changedPreview.data.confirmation,
    })

    expect(created.data).toMatchObject({ created: true, vendorId: 'RENDELES-1' })
    expect(changedPreview.data).toMatchObject({
      vendorIdSource: 'given',
      existingDocument: { grossTotal: grossAmount },
    })
    expect(again.data).toMatchObject({
      created: false,
      document: { grossTotal: grossAmount },
    })
    expect(again.summary).toContain('Nem állítottam ki újra')
    expect(harness.billingo.count('CreateReceipt')).toBe(1)
  })

  test('a nyugta becslése egyezik azzal, amit a Billingo kiállít', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const input = {
      electronic: true,
      emails: ['vevo@example.com'],
      paymentMethod: 'bankcard',
      items: [
        { name: 'A', grossUnitPrice: 1270, vat: '27%' },
        { name: 'B', grossUnitPrice: 105, vat: 5, quantity: 3 },
        { name: 'C', grossUnitPrice: 500, vat: 'AAM' },
      ],
    }
    const preview = await harness.call('preview_receipt', input)

    const created = await harness.call('create_receipt', {
      ...input,
      confirmation: preview.data.confirmation,
    })

    const totals = preview.data.totals as { readonly grossAmount: number }
    expect(created.data).toMatchObject({ document: { grossTotal: totals.grossAmount } })
    expect(preview.data).toMatchObject({ paymentMethod: 'bankcard', electronic: true })
  })

  test('termékes nyugtatételnél a megadott mennyiséget, különben 1-et küld; a none áfa 0%', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const product = await harness.tarca.products.create({
      name: 'Tea',
      currency: 'HUF',
      vat: '27%',
      grossUnitPrice: 635,
      unit: 'db',
    })
    const input = {
      electronic: false,
      items: [{ productId: product.id, quantity: 3 }, { productId: product.id }],
    }

    const preview = await harness.call('preview_receipt', input)
    const created = await harness.call('create_receipt', {
      ...input,
      confirmation: preview.data.confirmation,
    })
    const exempt = await harness.call('preview_receipt', {
      electronic: false,
      items: [{ name: 'Belépő', grossUnitPrice: 1000, vat: 'none' }],
    })

    expect(preview.data).toMatchObject({
      items: [
        { name: 'Tea', quantity: 3, grossAmount: 1905 },
        { name: 'Tea', quantity: 1, grossAmount: 635 },
      ],
      totals: { grossAmount: 2540 },
    })
    expect(created.data).toMatchObject({ created: true, document: { grossTotal: 2540 } })
    const body = harness.billingo.requests.find((entry) => entry.operation === 'CreateReceipt')
      ?.body as { readonly items: readonly { readonly quantity: number }[] }
    expect(body.items.map((item) => item.quantity)).toEqual([3, 1])
    expect(exempt.data).toMatchObject({
      items: [{ netAmount: 1000, vatAmount: 0, grossAmount: 1000 }],
      totals: { netAmount: 1000, vatAmount: 0, grossAmount: 1000 },
    })
  })

  test('a nyugtatömb alapbeállítását, a meglévő vendorId-t és a devizás árfolyamot is nézi', async () => {
    const harness = mcpHarness({ allowWrite: true, defaults: { receiptBlockId: 3 } })
    const block = await harness.tarca.documentBlocks.create({
      name: 'Webshop nyugtak',
      prefix: 'WEB',
      type: 'receipt',
    })
    const preview = await harness.call('preview_receipt', RECEIPT)
    await harness.call('create_receipt', { ...RECEIPT, confirmation: preview.data.confirmation })

    const repreviewed = await harness.call('preview_receipt', RECEIPT)
    const foreign = await harness.call('preview_receipt', { ...RECEIPT, currency: 'EUR' })

    expect(block.id).toBe(3)
    expect(preview.data).toMatchObject({ block: { id: 3, prefix: 'WEB' } })
    expect(repreviewed.data).toMatchObject({ existingDocument: { type: 'receipt' } })
    expect(repreviewed.summary).toContain('már létezik bizonylat')
    expect(foreign).toMatchObject({
      isError: true,
      error: { category: 'validation', fields: ['conversionRate'] },
    })
  })

  test('az electronic mező kötelező, a nem nyugta áfa hibát ad', async () => {
    const harness = mcpHarness()

    const missing = await harness.call('preview_receipt', { items: RECEIPT.items })
    const vat = await harness.call('preview_receipt', {
      ...RECEIPT,
      items: [{ name: 'A', grossUnitPrice: 100, vat: 13 }],
    })

    expect(missing).toMatchObject({ isError: true, error: { fields: ['electronic'] } })
    expect(vat).toMatchObject({
      isError: true,
      summary: expect.stringContaining('none, 5%, 18%, 27%, AAM, TAM'),
    })
  })
})

describe('MCP eszközök: sztornó', () => {
  test('sztornó előnézettel, ismétléskor nem sztornóz újra, az előnézet utána elutasít', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))

    const preview = await harness.call('preview_cancellation', { id, reason: 'Hibás tétel' })
    const cancelled = await harness.call('cancel_document', {
      id,
      reason: 'Hibás tétel',
      confirmation: preview.data.confirmation,
    })
    const again = await harness.call('cancel_document', {
      id,
      reason: 'Hibás tétel',
      confirmation: preview.data.confirmation,
    })
    const previewAgain = await harness.call('preview_cancellation', { id })

    expect(preview.data).toMatchObject({
      document: { id, invoiceNumber: '2026-1' },
      reason: 'Hibás tétel',
    })
    expect(preview.summary).toContain('még NEM készült el')
    expect(cancelled.data).toMatchObject({
      cancelled: true,
      cancellation: { type: 'cancellation', invoiceNumber: '2026-2' },
    })
    expect(again.data).toMatchObject({ cancelled: false })
    expect(again.summary).toContain('már sztornózva volt')
    expect(previewAgain).toMatchObject({
      isError: true,
      error: { category: 'refused' },
      summary: expect.stringContaining('már sztornózva'),
    })
    expect(harness.billingo.count('CancelDocument')).toBe(1)
    expect(
      harness.billingo.requests.find((entry) => entry.operation === 'CancelDocument')?.body,
    ).toEqual({
      cancellation_reason: 'Hibás tétel',
    })
  })

  test('a kód csak ugyanarra a bizonylatra és okra érvényes', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_cancellation', { id })

    const other = await harness.call('cancel_document', {
      id: id + 1,
      confirmation: preview.data.confirmation,
    })
    const reason = await harness.call('cancel_document', {
      id,
      reason: 'Más',
      confirmation: preview.data.confirmation,
    })

    expect(other).toMatchObject({ isError: true, summary: expect.stringContaining('eltérnek') })
    expect(reason).toMatchObject({ isError: true, summary: expect.stringContaining('eltérnek') })
    expect(harness.billingo.count('CancelDocument')).toBe(0)
  })

  test('módosított számlát, módosítót, sztornót, piszkozatot és díjbekérőt nem enged sztornózni', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const original = documentId(await issue(harness))
    const modification = await harness.tarca.documents.createModification(original, {
      items: [{ name: 'Engedmény', quantity: 1, netUnitPrice: -1000, vat: 27 }],
    })
    const cancelledSource = documentId(await issue(harness, { ...INVOICE, vendorId: 'MASIK' }))
    const cancellation = await harness.tarca.documents.cancel(cancelledSource)
    const draft = await harness.tarca.documents.create({ ...INVOICE, type: 'draft' })
    const proforma = documentId(await issue(harness, { ...INVOICE, type: 'proforma' }))

    const results = await Promise.all(
      [original, modification.id, cancellation.id, draft.id, proforma].map((id) =>
        harness.call('preview_cancellation', { id }),
      ),
    )

    expect(results.map((result) => result.error?.category)).toEqual([
      'refused',
      'refused',
      'refused',
      'refused',
      'refused',
    ])
    expect(results[0]?.summary).toContain('módosító számla készült')
    expect(results[1]?.summary).toContain('módosító számla')
    expect(results[2]?.summary).toContain('sztornó bizonylat')
    expect(results[3]?.summary).toContain('piszkozat')
    expect(results[4]?.summary).toContain('díjbekérő')
    expect(harness.billingo.count('CancelDocument')).toBe(1)
  })

  test('előlegszámlánál a sorrendre figyelmeztet, ismeretlen id-re 403 helyett érthető hibát ad', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const advance = documentId(await issue(harness, { ...INVOICE, type: 'advance' }))

    const preview = await harness.call('preview_cancellation', { id: advance })
    const unknown = await harness.call('preview_cancellation', { id: 404 })

    expect(preview.data.warnings).toEqual([expect.stringContaining('előbb a végszámlát')])
    expect(unknown).toMatchObject({
      isError: true,
      summary: expect.stringContaining('nem ehhez a céghez tartozik'),
      error: { fields: ['id'] },
    })
  })

  test('ha az előnézet óta módosító számla készült, írás előtt újra elutasít', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_cancellation', { id })
    await harness.tarca.documents.createModification(id, {
      items: [{ name: 'Engedmény', quantity: 1, netUnitPrice: -1000, vat: 27 }],
    })

    const result = await harness.call('cancel_document', {
      id,
      confirmation: preview.data.confirmation,
    })

    expect(result).toMatchObject({ isError: true, error: { category: 'refused' } })
    expect(result.summary).toContain('módosító számla készült')
    expect(harness.billingo.count('CancelDocument')).toBe(0)
  })

  test('fizetett, díjbekérőből készült számlánál a kapcsolódó bizonylatokra és a befizetésekre figyelmeztet', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const proforma = documentId(await issue(harness, { ...INVOICE, type: 'proforma' }))
    const invoice = await harness.tarca.documents.createFromProforma(proforma)

    const preview = await harness.call('preview_cancellation', { id: invoice.id })

    expect(preview.data.warnings).toEqual([
      expect.stringContaining('Kapcsolódó bizonylatok'),
      expect.stringContaining('befizetéseit törli'),
    ])
  })

  test('nyugtát is sztornóz, elveszett válasz után sem küld második kérést', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const receiptPreview = await harness.call('preview_receipt', RECEIPT)
    const receipt = documentId(
      await harness.call('create_receipt', {
        ...RECEIPT,
        confirmation: receiptPreview.data.confirmation,
      }),
    )
    const preview = await harness.call('preview_cancellation', { id: receipt })
    const args = { id: receipt, confirmation: preview.data.confirmation }
    harness.billingo.fail('network', { operation: 'CancelDocument', afterSuccess: true })

    const cancelled = await harness.call('cancel_document', args)
    const again = await harness.call('cancel_document', args)

    expect(preview.isError).toBe(false)
    expect(cancelled).toMatchObject({ isError: false, data: { cancelled: true, recovered: true } })
    expect(again.data).toMatchObject({ cancelled: false })
    expect(harness.billingo.count('CancelDocument')).toBe(1)
    expect(
      [...harness.billingo.data.documents.values()].filter(
        (record) => record.document.type === 'receipt_cancellation',
      ),
    ).toHaveLength(1)
  })

  test('elveszett válasz után újraolvas: ha sztornózott, nem küld második kérést', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_cancellation', { id })
    harness.billingo.fail('network', { operation: 'CancelDocument', afterSuccess: true })

    const result = await harness.call('cancel_document', {
      id,
      confirmation: preview.data.confirmation,
    })

    expect(result).toMatchObject({ isError: false, data: { cancelled: true, recovered: true } })
    expect(result.summary).toContain('Nem küldtem második kérést')
    expect(harness.billingo.count('CancelDocument')).toBe(1)
  })

  test('elveszett kérés után, ha nem sztornózott, a hibát adja tovább, második kérés nélkül', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_cancellation', { id })
    harness.billingo.fail('timeout', { operation: 'CancelDocument' })

    const result = await harness.call('cancel_document', {
      id,
      confirmation: preview.data.confirmation,
    })

    expect(result).toMatchObject({ isError: true, error: { category: 'timeout' } })
    expect(harness.billingo.count('CancelDocument')).toBe(1)
    expect(harness.billingo.data.documents.get(id)?.document.cancelled).toBe(false)
  })

  test('ha az újraolvasás is elbukik, a bizonytalan hibát tippel adja tovább', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_cancellation', { id })
    let cancelSent = false
    const call = callThrough(async (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/cancel')) {
        cancelSent = true
        throw new TypeError('fetch failed')
      }
      if (cancelSent) return Response.json({ error: { message: 'down' } }, { status: 503 })
      return harness.billingo.fetch(input, init)
    })

    const result = await call('cancel_document', { id, confirmation: preview.data.confirmation })

    expect(cancelSent).toBe(true)
    expect(result).toMatchObject({ isError: true, error: { category: 'network' } })
    expect(result.summary).toContain('get_document')
    expect(harness.billingo.count('CancelDocument')).toBe(0)
  })

  test('ha közben máshonnan sztornózták (400), nem sztornóz újra, és ezt jelzi', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_cancellation', { id })
    const call = callThrough(async (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/cancel')) {
        await harness.tarca.documents.cancel(id)
        return Response.json(
          { error: { message: `Cannot cancel the document (id:${id})` } },
          { status: 400 },
        )
      }
      return harness.billingo.fetch(input, init)
    })

    const result = await call('cancel_document', { id, confirmation: preview.data.confirmation })

    expect(result).toMatchObject({ isError: false, data: { cancelled: false, recovered: false } })
    expect(result.summary).toContain('máshonnan sztornózták')
    expect(harness.billingo.count('CancelDocument')).toBe(1)
  })

  test('a 400-as elutasítás, ha a bizonylat nem lett sztornózott, hibaként megy tovább', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_cancellation', { id })
    harness.billingo.fail({ status: 400, message: 'Valami más' }, { operation: 'CancelDocument' })

    const result = await harness.call('cancel_document', {
      id,
      confirmation: preview.data.confirmation,
    })

    expect(result).toMatchObject({ isError: true, error: { category: 'validation', status: 400 } })
    expect(harness.billingo.count('CancelDocument')).toBe(1)
  })
})

describe('MCP eszközök: befizetés', () => {
  test('a hátralékot rögzíti, utána nincs teendő és nem ír', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))

    const preview = await harness.call('preview_payment', { id })
    const paid = await harness.call('mark_document_paid', {
      id,
      confirmation: preview.data.confirmation,
    })
    const again = await harness.call('mark_document_paid', {
      id,
      confirmation: preview.data.confirmation,
    })
    const previewAgain = await harness.call('preview_payment', { id })

    expect(preview.data).toMatchObject({
      paid: 0,
      outstanding: 76_200,
      payment: { date: MCP_TODAY, price: 76_200, paymentMethod: 'wire_transfer' },
    })
    expect(paid.data).toMatchObject({ recorded: true })
    expect(again.data).toMatchObject({ recorded: false, outstanding: 0 })
    expect(again.summary).toContain('nincs teendő')
    expect(previewAgain.data).toMatchObject({ recorded: false })
    expect(previewAgain.data.confirmation).toBeUndefined()
    expect(harness.billingo.count('UpdatePayment')).toBe(1)
    expect(harness.billingo.data.documents.get(id)?.document.paymentStatus).toBe('paid')
  })

  test('a meglévő befizetést megtartja, csak a maradékot rögzíti', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    await harness.tarca.documents.payments.add(id, {
      date: '2026-11-10',
      price: 20_000,
      paymentMethod: 'cash',
      voucherNumber: 'P-1',
    })

    const preview = await harness.call('preview_payment', {
      id,
      paymentMethod: 'bankcard',
      voucherNumber: 'B-2',
    })
    const paid = await harness.call('mark_document_paid', {
      id,
      paymentMethod: 'bankcard',
      voucherNumber: 'B-2',
      confirmation: preview.data.confirmation,
    })

    expect(preview.data).toMatchObject({ paid: 20_000, outstanding: 56_200, existingPayments: 1 })
    expect(paid.data.payments).toMatchObject([
      { date: '2026-11-10', price: 20_000, paymentMethod: 'cash', voucherNumber: 'P-1' },
      { date: MCP_TODAY, price: 56_200, paymentMethod: 'bankcard', voucherNumber: 'B-2' },
    ])
  })

  test('ha az előnézet óta változott a hátralék, új előnézetet kér, és nem ír', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_payment', { id })
    await harness.tarca.documents.payments.add(id, {
      date: MCP_TODAY,
      price: 1000,
      paymentMethod: 'cash',
    })

    const result = await harness.call('mark_document_paid', {
      id,
      confirmation: preview.data.confirmation,
    })

    expect(result).toMatchObject({ isError: true, error: { category: 'confirmation' } })
    expect(harness.billingo.count('UpdatePayment')).toBe(1)
  })

  test('devizás számlán a számla árfolyamával rögzít, a meglévő befizetés árfolyama megmarad', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const eur = documentId(
      await issue(harness, { ...INVOICE, currency: 'EUR', conversionRate: 390 }),
    )
    await harness.tarca.documents.payments.add(eur, {
      date: '2026-11-10',
      price: 100,
      paymentMethod: 'cash',
      conversionRate: 385,
    })
    const huf = documentId(await issue(harness))

    const eurPreview = await harness.call('preview_payment', { id: eur })
    const hufPreview = await harness.call('preview_payment', { id: huf })
    await harness.call('mark_document_paid', {
      id: eur,
      confirmation: eurPreview.data.confirmation,
    })

    expect(eurPreview.data.payment).toEqual({
      date: MCP_TODAY,
      price: 76_100,
      paymentMethod: 'wire_transfer',
      conversionRate: 390,
    })
    expect(hufPreview.data.payment).not.toHaveProperty('conversionRate')
    expect(
      harness.billingo.requests.filter((entry) => entry.operation === 'UpdatePayment').at(-1)?.body,
    ).toMatchObject([
      { date: '2026-11-10', price: 100, payment_method: 'cash', conversion_rate: 385 },
      { date: MCP_TODAY, price: 76_100, payment_method: 'wire_transfer', conversion_rate: 390 },
    ])
  })

  test('módosító számlára rögzít, díjbekérőre nem', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const original = documentId(await issue(harness))
    const modification = await harness.tarca.documents.createModification(original, {
      items: [{ name: 'Pótdíj', quantity: 1, netUnitPrice: 1000, vat: 27 }],
    })
    const proforma = documentId(await issue(harness, { ...INVOICE, type: 'proforma' }))

    const onModification = await harness.call('preview_payment', { id: modification.id })
    const onProforma = await harness.call('preview_payment', { id: proforma })

    expect(onModification).toMatchObject({ isError: false, data: { outstanding: 1270 } })
    expect(onProforma).toMatchObject({
      isError: true,
      error: { category: 'refused' },
      summary: expect.stringContaining('befizetést csak számlán'),
    })
  })

  test('bizonytalan hiba után a korábbi, azonos befizetést nem veszi az új rögzítésének', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    await harness.tarca.documents.payments.add(id, {
      date: MCP_TODAY,
      price: 38_100,
      paymentMethod: 'wire_transfer',
    })
    const preview = await harness.call('preview_payment', { id })
    harness.billingo.fail('network', { operation: 'UpdatePayment' })

    const result = await harness.call('mark_document_paid', {
      id,
      confirmation: preview.data.confirmation,
    })

    expect(preview.data.payment).toMatchObject({ price: 38_100, date: MCP_TODAY })
    expect(result).toMatchObject({ isError: true, error: { category: 'network' } })
    expect(harness.billingo.data.documents.get(id)?.document.paymentStatus).toBe('partially_paid')
  })

  test('ha a befizetések újraolvasása is elbukik, a bizonytalan hibát tippel adja tovább', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_payment', { id })
    let writeSent = false
    const call = callThrough(async (input, init) => {
      if (init?.method === 'PUT' && String(input).endsWith('/payments')) {
        writeSent = true
        throw new TypeError('fetch failed')
      }
      if (writeSent) return Response.json({ error: { message: 'down' } }, { status: 503 })
      return harness.billingo.fetch(input, init)
    })

    const result = await call('mark_document_paid', { id, confirmation: preview.data.confirmation })

    expect(writeSent).toBe(true)
    expect(result).toMatchObject({ isError: true, error: { category: 'network' } })
    expect(result.summary).toContain('get_document')
    expect(harness.billingo.count('UpdatePayment')).toBe(0)
  })

  test('nyugtára és sztornózott számlára nem rögzít befizetést', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const receiptPreview = await harness.call('preview_receipt', RECEIPT)
    const receipt = await harness.call('create_receipt', {
      ...RECEIPT,
      confirmation: receiptPreview.data.confirmation,
    })
    const invoice = documentId(await issue(harness))
    await harness.tarca.documents.cancel(invoice)

    const onReceipt = await harness.call('preview_payment', { id: documentId(receipt) })
    const onCancelled = await harness.call('preview_payment', { id: invoice })

    expect(onReceipt).toMatchObject({
      isError: true,
      summary: expect.stringContaining('mindig fizetett'),
    })
    expect(onCancelled).toMatchObject({ isError: true, error: { category: 'refused' } })
  })

  test('elveszett válasz után a befizetések újraolvasásával dönt', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const preview = await harness.call('preview_payment', { id })
    harness.billingo.fail('network', { operation: 'UpdatePayment', afterSuccess: true })

    const recovered = await harness.call('mark_document_paid', {
      id,
      confirmation: preview.data.confirmation,
    })

    const second = mcpHarness({ allowWrite: true })
    const other = documentId(await issue(second))
    const otherPreview = await second.call('preview_payment', { id: other })
    second.billingo.fail('network', { operation: 'UpdatePayment' })
    const lost = await second.call('mark_document_paid', {
      id: other,
      confirmation: otherPreview.data.confirmation,
    })

    expect(recovered).toMatchObject({ isError: false, data: { recorded: true, recovered: true } })
    expect(lost).toMatchObject({ isError: true, error: { category: 'network' } })
    expect(second.billingo.count('UpdatePayment')).toBe(1)
  })
})

describe('MCP eszközök: kiküldés', () => {
  test('a címzetteket megmutatja, egy kóddal egyszer küld', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const emails = ['penzugy@pelda.hu']

    const preview = await harness.call('preview_send', { id, emails })
    const sent = await harness.call('send_document', {
      id,
      emails,
      confirmation: preview.data.confirmation,
    })
    const again = await harness.call('send_document', {
      id,
      emails,
      confirmation: preview.data.confirmation,
    })

    expect(preview.summary).toContain('penzugy@pelda.hu')
    expect(preview.summary).toContain('még NEM ment el')
    expect(sent.data).toMatchObject({ sent: true, id, emails })
    expect(again).toMatchObject({ isError: false, data: { sent: false } })
    expect(again.summary).toContain('kétszer nem küld')
    expect(harness.billingo.count('SendDocument')).toBe(1)
  })

  test('végleges hiba után ugyanaz a kód újra használható, bizonytalan után nem', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const id = documentId(await issue(harness))
    const emails = ['penzugy@pelda.hu']
    const preview = await harness.call('preview_send', { id, emails })
    const args = { id, emails, confirmation: preview.data.confirmation }
    harness.billingo.fail({ status: 422 }, { operation: 'SendDocument' })

    const rejected = await harness.call('send_document', args)
    const retried = await harness.call('send_document', args)
    const second = await harness.call('preview_send', { id, emails: ['masik@pelda.hu'] })
    harness.billingo.fail('network', { operation: 'SendDocument' })
    const uncertain = await harness.call('send_document', {
      id,
      emails: ['masik@pelda.hu'],
      confirmation: second.data.confirmation,
    })
    const blocked = await harness.call('send_document', {
      id,
      emails: ['masik@pelda.hu'],
      confirmation: second.data.confirmation,
    })

    expect(rejected).toMatchObject({
      isError: true,
      error: { category: 'validation', status: 422 },
    })
    expect(retried.data).toMatchObject({ sent: true })
    expect(uncertain).toMatchObject({ isError: true, error: { category: 'network' } })
    expect(blocked.data).toMatchObject({ sent: false })
    expect(harness.billingo.count('SendDocument')).toBe(3)
  })

  test('piszkozatot nem enged kiküldeni', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const draft = await harness.tarca.documents.create({ ...INVOICE, type: 'draft' })

    const result = await harness.call('preview_send', { id: draft.id, emails: ['a@pelda.hu'] })

    expect(result).toMatchObject({
      isError: true,
      error: { category: 'refused' },
      summary: expect.stringContaining('piszkozat'),
    })
  })

  test('érvénytelen címre hibát ad, a címet nem írja vissza', async () => {
    const harness = mcpHarness()

    const result = await harness.call('preview_send', { id: 1, emails: ['nem-cim', 'titkos@'] })

    expect(result).toMatchObject({ isError: true, error: { fields: ['emails.0'] } })
    expect(result.text).not.toContain('nem-cim')
    expect(harness.billingo.requests).toHaveLength(0)
  })
})

describe('MCP eszközök: lekérdezések', () => {
  test('a get_profile a teszt profilt, a tömböket és a bankszámlákat számlaszám és adószám nélkül adja', async () => {
    const harness = mcpHarness({ defaults: { dueInDays: 15 } }, { taxCode: '12345678-2-42' })
    await harness.tarca.bankAccounts.create({
      name: 'Fő számla',
      accountNumber: '11773016-11111018',
      currency: 'HUF',
    })

    const result = await harness.call('get_profile')

    expect(result.data).toMatchObject({
      profile: {
        kind: 'test',
        hasNavConnection: false,
        features: [],
        expirationDate: '2026-11-17',
        daysLeft: 1,
      },
      documentBlocks: [
        { id: 1, name: 'Számlák', prefix: '', type: 'invoice' },
        { id: 2, name: 'Nyugták', prefix: 'NYT', type: 'receipt' },
      ],
      bankAccounts: [{ id: 1, name: 'Fő számla', currency: 'HUF' }],
      defaults: { dueInDays: 15, currency: 'HUF', sendEmail: false },
    })
    expect(result.summary).toContain('valószínűleg fejlesztői teszt profil')
    expect(result.summary).toContain('Bankszámlák: 1 (HUF)')
    expect(result.text).not.toContain('11773016')
    expect(result.text).not.toContain('12345678')
    expect(harness.billingo.requests.map((entry) => entry.operation).sort()).toEqual([
      'CreateBankAccount',
      'GetOrganizationData',
      'ListBankAccount',
      'ListDocumentBlock',
    ])
  })

  test('a get_profile éles profilt is felismer', async () => {
    const harness = mcpHarness(
      {},
      {
        hasNavConnection: true,
        subscription: { expirationDate: '2027-01-31', features: ['api_limit_pro'] },
      },
    )

    const result = await harness.call('get_profile')

    expect(result.data).toMatchObject({ profile: { kind: 'live', apiLimit: 'api_limit_pro' } })
    expect(result.summary).toContain('a kiállított bizonylatok valódiak')
  })

  test('a bizonylatlista szűr és lapoz, a hibás lapméretet elutasítja', async () => {
    const harness = mcpHarness({ allowWrite: true })
    await issue(harness)
    const receipt = await harness.call('preview_receipt', RECEIPT)
    await harness.call('create_receipt', { ...RECEIPT, confirmation: receipt.data.confirmation })

    const receipts = await harness.call('list_documents', { type: 'receipt', perPage: 10 })
    const all = await harness.call('list_documents', { startDate: MCP_TODAY, endDate: MCP_TODAY })
    const tooMany = await harness.call('list_documents', { perPage: 101 })
    const badDate = await harness.call('list_documents', { startDate: '2026.11.16' })

    expect(receipts.data).toMatchObject({
      total: 1,
      perPage: 10,
      documents: [{ type: 'receipt', invoiceNumber: 'NYT-2026-1' }],
    })
    expect(
      harness.billingo.requests.find((entry) => entry.operation === 'ListDocument')?.query,
    ).toMatchObject({
      type: 'receipt',
      per_page: '10',
    })
    expect(all.data).toMatchObject({ total: 2 })
    expect(all.summary).toContain('2 bizonylat')
    expect(tooMany).toMatchObject({ isError: true, error: { fields: ['perPage'] } })
    expect(badDate).toMatchObject({ isError: true, error: { fields: ['startDate'] } })
  })

  test('bizonylat id és vendorId alapján, kiegészítő adatokkal; ismeretlenre nincs találat', async () => {
    const harness = mcpHarness({ allowWrite: true })
    const created = await issue(harness, { ...INVOICE, vendorId: 'WEB-7' })
    const id = documentId(created)

    const byId = await harness.call('get_document', {
      id,
      includePayments: true,
      includeNavStatus: true,
      includePublicUrl: true,
    })
    const byVendor = await harness.call('get_document', { vendorId: 'WEB-7' })
    const unknownId = await harness.call('get_document', { id: 999 })
    const unknownVendor = await harness.call('get_document', { vendorId: 'NINCS' })
    const both = await harness.call('get_document', { id, vendorId: 'WEB-7' })

    expect(byId.data).toMatchObject({
      found: true,
      document: { id, invoiceNumber: '2026-1' },
      payments: [],
      navStatus: null,
      publicUrl: expect.stringMatching(/^https:\/\/api\.billingo\.hu\/document-access\//),
    })
    expect(byId.summary).toContain('még nincs NAV rekord')
    expect(byVendor.data).toMatchObject({ found: true, document: { id } })
    expect(byVendor.data.payments).toBeUndefined()
    expect(unknownId).toMatchObject({ isError: false, data: { found: false } })
    expect(unknownId.summary).toContain('nem ehhez a céghez tartozik')
    expect(unknownVendor).toMatchObject({ isError: false, data: { found: false } })
    expect(both).toMatchObject({
      isError: true,
      summary: expect.stringContaining('Pontosan egyet'),
    })
  })

  test('partnerek, termékek és költségek listája és lekérdezése', async () => {
    const harness = mcpHarness({}, { stock: { 'DOB-1': 12 } })
    const partner = await harness.tarca.partners.create(PARTNER)
    const product = await harness.tarca.products.create({
      name: 'Doboz',
      currency: 'HUF',
      vat: '27%',
      netUnitPrice: 1000,
      unit: 'db',
      sku: 'DOB-1',
    })
    const spending = await harness.tarca.spendings.create({
      conversionRate: 1,
      currency: 'HUF',
      fulfillmentDate: MCP_TODAY,
      invoiceDate: MCP_TODAY,
      dueDate: MCP_TODAY,
      invoiceNumber: 'K-1',
      paymentMethod: 'cash',
      totalGross: 12_700,
      totalGrossHuf: 12_700,
      totalVatAmount: 2700,
      totalVatAmountHuf: 2700,
      category: 'stock',
    })

    const partners = await harness.call('list_partners', { query: 'Pél' })
    const onePartner = await harness.call('get_partner', { id: partner.id })
    const missingPartner = await harness.call('get_partner', { id: 99 })
    const products = await harness.call('list_products', { query: 'Dob' })
    const oneProduct = await harness.call('get_product', { id: product.id, includeStock: true })
    const spendings = await harness.call('list_spendings', { paymentStatus: 'all' })
    const unpaid = await harness.call('list_spendings', { paymentStatus: 'unpaid' })
    const oneSpending = await harness.call('get_spending', { id: spending.id })
    const missingSpending = await harness.call('get_spending', { id: 99 })

    expect(partners.data).toMatchObject({
      total: 1,
      partners: [{ id: partner.id, name: 'Példa Kft.' }],
    })
    expect(onePartner.data).toMatchObject({ found: true, partner: { taxcode: '12345678-2-42' } })
    expect(missingPartner.data).toEqual({ found: false })
    expect(products.data).toMatchObject({
      products: [{ name: 'Doboz', netUnitPrice: 1000, grossUnitPrice: 1270 }],
    })
    expect(oneProduct.data).toMatchObject({ found: true, stock: { availableQuantity: 12 } })
    expect(oneProduct.summary).toContain('Készlet: 12 db')
    expect(spendings.data).toMatchObject({ total: 1, spendings: [{ invoiceNumber: 'K-1' }] })
    expect(
      harness.billingo.requests
        .filter((entry) => entry.operation === 'SpendingList')
        .map((entry) => entry.query.payment_status),
    ).toEqual(['all', 'unpaid'])
    expect(unpaid.isError).toBe(false)
    expect(oneSpending.data).toMatchObject({ found: true, spending: { invoiceNumber: 'K-1' } })
    expect(missingSpending.data).toEqual({ found: false })
  })

  test('kikapcsolt készletkezelésnél a készlet null, nem hiba', async () => {
    const harness = mcpHarness()
    const product = await harness.tarca.products.create({
      name: 'Doboz',
      currency: 'HUF',
      vat: '27%',
      netUnitPrice: 1000,
      unit: 'db',
    })

    const result = await harness.call('get_product', { id: product.id, includeStock: true })

    expect(result).toMatchObject({ isError: false, data: { stock: null } })
    expect(result.summary).toContain('nincs bekapcsolva a készletkezelés')
  })

  test('adószám: teszt profilon nav_unavailable magyarázattal, NAV-kapcsolattal a cég adatai', async () => {
    const test_ = mcpHarness()
    const live = mcpHarness(
      {},
      {
        hasNavConnection: true,
        taxpayers: {
          '12345678': {
            name: 'PÉLDA KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG',
            addresses: [
              {
                type: 'HQ',
                countryCode: 'HU',
                postalCode: '1111',
                city: 'BUDAPEST',
                streetName: 'FŐ',
                publicPlaceCategory: 'UTCA',
                number: '1',
              },
            ],
          },
        },
      },
    )

    const unavailable = await test_.call('check_tax_number', { taxNumber: '12345678-2-42' })
    const valid = await live.call('check_tax_number', { taxNumber: '12345678-2-42' })
    const malformed = await live.call('check_tax_number', { taxNumber: 'abc' })

    expect(unavailable).toMatchObject({
      isError: true,
      error: { category: 'nav_unavailable', status: 401 },
    })
    expect(unavailable.summary).toContain('teszt profil')
    expect(valid.summary).toContain('PÉLDA KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG')
    expect(valid.summary).toContain('Székhely: 1111, BUDAPEST, FŐ UTCA 1')
    expect(malformed).toMatchObject({
      isError: true,
      error: { category: 'validation', fields: ['taxNumber'] },
    })
  })

  test('árfolyam a Billingótól', async () => {
    const harness = mcpHarness()

    const rate = await harness.call('get_conversion_rate', { from: 'EUR' })
    const missing = await harness.call('get_conversion_rate', { to: 'EUR' })

    expect(rate.data).toMatchObject({ from: 'EUR', to: 'HUF', rate: 390 })
    expect(rate.summary).toContain('1 EUR = 390 HUF')
    expect(missing).toMatchObject({ isError: true, error: { fields: ['from'] } })
  })
})

describe('MCP eszközök: bemenet-ellenőrzés és konfiguráció', () => {
  test.each([
    [{ ...INVOICE, color: 'kék' }, 'Ismeretlen mező a bemenetben: color', ['color']],
    [
      { ...INVOICE, partner: { ...PARTNER, iban: 'x' } },
      'partner objektumban: iban',
      ['partner.iban'],
    ],
    [{ ...INVOICE, items: [] }, 'items tömbben 1 és 100', ['items']],
    [
      { ...INVOICE, items: [{ name: 'A', vat: 27 }] },
      'pontosan az egyiket',
      ['items.0.netUnitPrice', 'items.0.grossUnitPrice'],
    ],
    [
      { ...INVOICE, items: [{ name: 'A', vat: 33, netUnitPrice: 1 }] },
      'Ismeretlen áfakulcs',
      ['items.0.vat'],
    ],
    [{ ...INVOICE, items: [{ productId: 1, name: 'A' }] }, 'termékes tétel', ['items.0.name']],
    [
      { ...INVOICE, items: [{ name: 'A', vat: 27, netUnitPrice: 1, quantity: 0 }] },
      'nem lehet 0',
      ['items.0.quantity'],
    ],
    [{ ...INVOICE, fulfillmentDate: '2026.11.16' }, 'ÉÉÉÉ-HH-NN', ['fulfillmentDate']],
    [{ ...INVOICE, dueDate: MCP_TODAY, dueInDays: 3 }, 'csak az egyiket', ['dueDate', 'dueInDays']],
    [{ ...INVOICE, electronic: 'igen' }, 'true vagy false', ['electronic']],
    [{ ...INVOICE, type: 'draft' }, 'Lehetséges értékek: invoice, proforma, advance', ['type']],
    [{ ...INVOICE, partner: 'Példa' }, 'partner mezőnek objektumnak', ['partner']],
    [{ ...INVOICE, partnerId: 1 }, 'csak az egyiket', ['partnerId', 'partner']],
    [{ items: INVOICE.items }, 'A vevő kötelező', ['partnerId', 'partner']],
    [
      { ...INVOICE, partner: { ...PARTNER, address: { ...ADDRESS, countryCode: 'HUN' } } },
      'kétbetűs országkód',
      ['partner.address.countryCode'],
    ],
    [{ ...INVOICE, currency: 'XYZ' }, 'Lehetséges értékek', ['currency']],
    [{ ...INVOICE, conversionRate: '400' }, 'véges számnak', ['conversionRate']],
    [{ ...INVOICE, blockId: 0 }, 'pozitív egész', ['blockId']],
    [{ ...INVOICE, advanceInvoiceIds: ['x'] }, 'pozitív egész', ['advanceInvoiceIds.0']],
    [{ ...INVOICE, advanceInvoiceIds: [0] }, 'pozitív egész', ['advanceInvoiceIds.0']],
    [{ ...INVOICE, dueInDays: -1 }, 'nemnegatív', ['dueInDays']],
    [{ ...INVOICE, blockId: 1.5 }, 'egész számnak', ['blockId']],
  ])(
    'hibás bemenetre mezőnévvel ellátott eszközhibát ad, kérés nélkül (%#)',
    async (args, message, fields) => {
      const harness = mcpHarness()

      const result = await harness.call('preview_document', args)

      expect(result).toMatchObject({
        isError: true,
        summary: expect.stringContaining(message),
        error: { category: 'invalid_input', fields },
      })
      expect(harness.billingo.requests).toHaveLength(0)
    },
  )

  test('a szövegeket levágja; a nyugta címlistáját, a tört azonosítót és a nem létező dátumot elutasítja', async () => {
    const harness = mcpHarness()
    const emails = Array.from({ length: 11 }, (_, index) => `vevo${index}@pelda.hu`)

    const trimmed = await harness.call('preview_document', { ...INVOICE, vendorId: '  WEB-7  ' })
    const tooMany = await harness.call('preview_receipt', { ...RECEIPT, emails })
    const fraction = await harness.call('get_document', { id: 1.5 })
    const impossibleDate = await harness.call('list_documents', { startDate: '2026-02-31' })

    expect(trimmed.data).toMatchObject({ vendorId: 'WEB-7', vendorIdSource: 'given' })
    expect(tooMany).toMatchObject({ isError: true, error: { fields: ['emails'] } })
    expect(fraction).toMatchObject({ isError: true, error: { fields: ['id'] } })
    expect(impossibleDate).toMatchObject({
      isError: true,
      summary: expect.stringContaining('Nem létező naptári dátum'),
      error: { category: 'invalid_input' },
    })
    expect(harness.billingo.requests.map((entry) => entry.operation)).toEqual([
      'ListDocumentBlock',
      'ListPartner',
      'GetDocumentByVendorId',
    ])
  })

  test('a szövegként küldött áfakulcsot és a kódokat is elfogadja', async () => {
    const harness = mcpHarness()

    const result = await harness.call('preview_document', {
      partner: PARTNER,
      items: [
        { name: 'A', netUnitPrice: 100, vat: '27' },
        { name: 'B', netUnitPrice: 100, vat: '5,5' },
        { name: 'C', netUnitPrice: 100, vat: 'AAM' },
        { name: 'D', grossUnitPrice: 100, vat: '27%' },
      ],
    })

    expect(result.isError).toBe(false)
    expect(result.data).toMatchObject({
      items: [{ vat: '27%' }, { vat: '5,5%' }, { vat: 'AAM' }, { vat: '27%' }],
    })
  })

  test('API kulcs nélkül a Billingót hívó eszköz beállítási hibát ad, a kulcsot nem találgatja', async () => {
    vi.stubEnv('BILLINGO_API_KEY', '')
    const connection = createTarcaMcpServer({ now: MCP_NOW }).connect()

    const response = await connection.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_profile', arguments: {}, _meta: MODERN_META },
    })
    const result = toolResultOf(response as Parameters<typeof toolResultOf>[0])

    expect(result).toMatchObject({
      isError: true,
      summary: expect.stringContaining('BILLINGO_API_KEY'),
      error: { category: 'configuration' },
    })
  })

  test('a szerver alapbeállításait (tömb, fizetési mód, határidő) az előnézet is használja', async () => {
    const harness = mcpHarness({
      defaults: { blockId: 1, paymentMethod: 'cash', dueInDays: 3, receiptBlockId: 2 },
    })

    const document = await harness.call('preview_document', INVOICE)
    const receipt = await harness.call('preview_receipt', RECEIPT)

    expect(document.data).toMatchObject({
      dueDate: '2026-11-19',
      paymentMethod: 'cash',
      block: { id: 1 },
    })
    expect(receipt.data).toMatchObject({ paymentMethod: 'cash', block: { id: 2 } })
  })

  test('az MCP alapból nem küld e-mailt akkor sem, ha a szerver alapbeállítása sendEmail: true', async () => {
    const harness = mcpHarness({ allowWrite: true, defaults: { sendEmail: true } })

    const created = await issue(harness)

    expect(created.isError).toBe(false)
    expect(
      harness.billingo.requests.find((entry) => entry.operation === 'CreateDocument')?.body,
    ).toMatchObject({
      settings: { should_send_email: false },
    })
  })
})
