function reply(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function runSmoke(modules) {
  const { createTarca, isBillingoError, BILLINGO_OPERATIONS, toBillingoDate } = modules.root

  const checks = []
  const assert = (condition, message) => {
    if (!condition) throw new Error(`Smoke hiba: ${message}`)
    checks.push(message)
  }

  const seen = []
  const fetch = async (input, init) => {
    const url = new URL(String(input))
    seen.push(`${init.method} ${url.pathname}${url.search}`)
    assert(new Headers(init.headers).get('x-api-key') === 'smoke-kulcs', 'X-API-KEY fejléc')
    if (url.pathname === '/v3/organization') {
      return reply(200, { tax_code: '12345678', has_nav_connection: false })
    }
    if (url.pathname === '/v3/bank-accounts' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      assert(body.account_number === '11773016-11111018', 'snake_case kéréstörzs')
      return reply(201, { id: 1, ...body })
    }
    if (url.pathname === '/v3/utils/time') return reply(503, { error: { message: 'down' } })
    return reply(404, { error: { message: '' } })
  }

  const tarca = createTarca({ apiKey: 'smoke-kulcs', fetch, retryDelayMs: 0, maxAttempts: 2 })
  const organization = await tarca.organization.get()
  assert(organization.hasNavConnection === false, 'camelCase válasz')
  const account = await tarca.bankAccounts.create({
    name: 'Smoke',
    accountNumber: '11773016-11111018',
    currency: 'HUF',
  })
  assert(account.accountNumber === '11773016-11111018', 'bankszámla létrehozása')

  try {
    await tarca.utils.serverTime()
    assert(false, 'a szerverhiba hibát dob')
  } catch (error) {
    assert(isBillingoError(error) && error.category === 'server', 'szerverhiba magyarul')
  }
  assert(seen.filter((line) => line === 'GET /v3/utils/time').length === 2, 'GET újrapróbálás')
  assert(Object.keys(BILLINGO_OPERATIONS).length >= 57, 'teljes művelettábla')
  assert(
    toBillingoDate(new Date('2026-07-14T22:30:00Z')) === '2026-07-15',
    'budapesti dátum (Intl)',
  )
  await smokeTesting(modules, assert)
  await smokeBatch(modules, assert)
  await smokeObserve(modules, assert)
  await smokeStorage(modules, assert)
  await smokeStores(modules, assert)
  await smokeJournal(modules, assert)
  await smokeMcp(modules, assert)
  await smokePayments(modules, assert)
  await smokePaymentProviders(modules, assert)
  if (modules.node) await smokeNode(modules, assert)
  return checks
}

async function smokeTesting(modules, assert) {
  const { createTarca, isBillingoError } = modules.root
  const { createFakeBillingoFetch, createMockTarca, FAKE_BILLINGO_MESSAGES } = modules.testing

  const billingo = createFakeBillingoFetch({ taxCode: '12345676-2-42' })
  const client = createTarca({ apiKey: 'smoke-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  const organization = await client.organization.get()
  assert(
    organization.taxCode === '12345676-2-42' && organization.hasNavConnection === false,
    'tarca/testing: hamis Billingo szervezet',
  )
  const account = await client.bankAccounts.create({
    name: 'Smoke',
    accountNumber: '11773016-11111018',
    currency: 'HUF',
  })
  const page = await client.bankAccounts.list({ perPage: 1 })
  assert(
    account.id === 1 && page.data[0]?.id === 1 && page.total === 1,
    'tarca/testing: bankszámla a hamis Billingóban',
  )
  billingo.fail('network', { operation: 'GetServerTime' })
  const time = await client.utils.serverTime()
  assert(
    time.timezone === 'Europe/Budapest' && billingo.count('GetServerTime') === 2,
    'tarca/testing: hibainjektálás és GET újrapróbálás',
  )
  const unauthorized = await billingo.fetch('https://api.billingo.hu/v3/organization')
  const body = await unauthorized.json()
  assert(
    unauthorized.status === 401 && body.error.message === FAKE_BILLINGO_MESSAGES.unauthorized,
    'tarca/testing: 401 a Billingo hibaformájában',
  )

  await smokeResources(client, billingo, assert)

  const mock = createMockTarca()
  mock.failNext('organization.get')
  try {
    await mock.organization.get()
    assert(false, 'tarca/testing: a failNext hibát dob')
  } catch (error) {
    assert(
      isBillingoError(error) && error.category === 'network',
      'tarca/testing: createMockTarca failNext, közös BillingoError osztály',
    )
  }
  assert(
    (await mock.verifyCredentials()) === true && mock.calls.length === 2,
    'tarca/testing: createMockTarca hívásnapló',
  )
}

async function smokeResources(client, billingo, assert) {
  const today = new Date()
  const { data: blocks } = await client.documentBlocks.list({ type: 'invoice' })
  assert(blocks.length > 0 && blocks[0].type === 'invoice', 'tarca/testing: számlatömbök')
  const { partner } = await client.partners.findOrCreate({
    name: 'Smoke Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  })
  const product = await client.products.create({
    name: 'Smoke termék',
    currency: 'HUF',
    vat: '27%',
    unit: 'db',
    netUnitPrice: 1000,
  })
  assert(
    product.grossUnitPrice === 1270,
    'tarca/testing: termék, a bruttó árat a Billingo számolja',
  )
  try {
    await client.inventory.quantity(product.id)
    assert(false, 'tarca/testing: készletkezelés nélkül a készlet hibát ad')
  } catch (error) {
    assert(error.status === 400 && error.category === 'validation', 'tarca/testing: készlet 400')
  }
  const { document, created } = await client.documents.createOnce({
    vendorId: 'SMOKE-1',
    partner: partner.id,
    items: [{ productId: product.id, quantity: 2 }],
  })
  const again = await client.documents.createOnce({
    vendorId: 'SMOKE-1',
    partner: partner.id,
    items: [{ productId: product.id, quantity: 2 }],
  })
  assert(
    created && !again.created && again.document.id === document.id && document.grossTotal === 2540,
    'tarca/testing: createOnce egyszer állít ki, a Billingo kerekítésével',
  )
  const payments = await client.documents.payments.add(document.id, {
    date: today,
    price: 2540,
    paymentMethod: 'wire_transfer',
  })
  const paid = await client.documents.get(document.id)
  assert(payments.length === 1 && paid.paymentStatus === 'paid', 'tarca/testing: befizetés')
  const pdf = await client.documents.pdf(document.id)
  assert(
    String.fromCharCode(...pdf.bytes.slice(0, 5)) === '%PDF-' && pdf.filename?.endsWith('.pdf'),
    'tarca/testing: PDF letöltés bájtokként',
  )
  const cancellation = await client.documents.cancel(document.id, { reason: 'Smoke' })
  assert(cancellation.type === 'cancellation', 'tarca/testing: sztornó')
  const receipt = await client.receipts.create({
    items: [{ name: 'Smoke kávé', grossUnitPrice: 600, vat: 27 }],
  })
  assert(
    receipt.type === 'receipt' && receipt.paymentMethod === 'cash',
    'tarca/testing: nyugta készpénzzel',
  )
  const spending = await client.spendings.create({
    category: 'other',
    currency: 'HUF',
    conversionRate: 1,
    totalGross: 1270,
    totalGrossHuf: 1270,
    totalVatAmount: 270,
    totalVatAmountHuf: 270,
    invoiceNumber: 'SMOKE-1',
    invoiceDate: today,
    fulfillmentDate: today,
    dueDate: today,
    paymentMethod: 'cash',
  })
  assert(spending.invoiceNumber === 'SMOKE-1', 'tarca/testing: költség')
  const rate = await client.currencies.rate({ from: 'EUR', to: 'HUF' })
  assert(rate.rate > 0, 'tarca/testing: árfolyam')
  const job = await client.exports.create({
    queryType: 'invoice_date',
    startDate: today,
    endDate: today,
    exportType: 'simple_csv',
  })
  await client.exports.poll(job.id)
  const status = await client.exports.poll(job.id)
  const file = await client.exports.download(job.id)
  assert(
    status.state === 'success' &&
      file.bytes[0] === 0xef &&
      file.contentType?.startsWith('text/csv'),
    'tarca/testing: export CSV, BOM-mal',
  )
  assert(
    billingo.count('CreateDocument') === 1 && billingo.count('GetDocumentByVendorId') === 2,
    'tarca/testing: kéréstábla',
  )
}

const SMOKE_BUYER = {
  name: 'Smoke Bérlő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['smoke@pelda.hu'],
}

async function smokeBatch(modules, assert) {
  const { createTarca } = modules.root
  const { createFakeBillingoFetch } = modules.testing
  const { billingPeriodAt, runBatch } = modules.batch
  const billingo = createFakeBillingoFetch()
  const tarca = createTarca({ apiKey: 'smoke-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  let time = Date.now()
  const now = () => {
    time += 60_000
    return new Date(time)
  }
  const period = billingPeriodAt({ interval: 'month', anchor: '2026-01-31' }, '2026-03-30')
  const items = ['SMOKE-B1', 'SMOKE-B2'].map((customer) => ({
    key: `${customer}-${period.key}`,
    document: () => ({
      kind: 'invoice',
      input: {
        partner: SMOKE_BUYER,
        items: [{ name: 'Havidíj', grossUnitPrice: 12_700, quantity: 1, vat: 27 }],
      },
    }),
  }))
  const first = await runBatch(tarca, { items, now, recoveryDelayMs: 0 })
  const again = await runBatch(tarca, { items, now, recoveryDelayMs: 0 })
  assert(period.start === '2026-02-28', 'tarca/batch: hónap végi időszak csúszás nélkül')
  assert(
    first.created.length === 2 &&
      first.grossTotals.HUF === 25_400 &&
      billingo.count('CreatePartner') === 1,
    'tarca/batch: két tétel a hamis Billingón, egy partnerrel',
  )
  assert(
    again.existing.length === 2 &&
      again.created.length === 0 &&
      billingo.count('CreateDocument') === 2,
    'tarca/batch: újrafuttatás után existing, nincs dupla',
  )
}

async function smokeObserve(modules, assert) {
  const { createTarca } = modules.root
  const { createFakeBillingoFetch } = modules.testing
  const { combineHooks, createMetricsRegistry, observe } = modules.observe
  const metrics = createMetricsRegistry()
  const lines = []
  const logger = { info: (data) => lines.push(data), warn: (data) => lines.push(data) }
  const seen = []
  const billingo = createFakeBillingoFetch()
  const tarca = createTarca({
    apiKey: 'smoke-kulcs',
    fetch: billingo.fetch,
    retryDelayMs: 0,
    hooks: combineHooks(observe({ metrics, logger, refSalt: 'smoke' }), {
      onComplete: (event) => seen.push(event.operation),
    }),
  })
  await tarca.documents.createOnce({
    vendorId: 'SMOKE-O1',
    partner: SMOKE_BUYER,
    items: [{ name: 'Havidíj', grossUnitPrice: 12_700, quantity: 1, vat: 27 }],
  })
  const text = metrics.renderPrometheus()
  assert(
    text.includes('tarca_requests_total{operation="CreateDocument",outcome="success"} 1') &&
      text.includes('# TYPE tarca_request_duration_ms histogram') &&
      seen.at(-1) === 'CreateDocument',
    'tarca/observe: Prometheus kimenet és combineHooks',
  )
  const serialized = JSON.stringify(lines)
  assert(
    lines.length > 0 &&
      !serialized.includes('smoke-kulcs') &&
      !serialized.includes('SMOKE-O1') &&
      !serialized.includes('smoke@pelda.hu'),
    'tarca/observe: napló kulcs, vendorId és e-mail nélkül',
  )
}

async function smokeNode(modules, assert) {
  const { toWebRequest } = modules.node
  const request = toWebRequest({
    method: 'POST',
    url: '/hook?x=1',
    headers: { host: 'shop.hu' },
    body: new TextEncoder().encode('nyers'),
  })
  assert(
    request.url === 'http://shop.hu/hook?x=1' && (await request.text()) === 'nyers',
    'tarca/node: Node kérésből Web Request, nyers törzzsel',
  )
}

async function smokeStorage(modules, assert) {
  const { createTarca } = modules.root
  const { createFakeBillingoFetch } = modules.testing
  const { documentPdfKey, memoryStorage, storeDocumentPdf, StorageError } = modules.storage
  const billingo = createFakeBillingoFetch({ now: () => new Date('2026-09-16T10:00:00Z') })
  const tarca = createTarca({ apiKey: 'smoke-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  const storage = memoryStorage()
  const invoice = await tarca.documents.create({
    partner: SMOKE_BUYER,
    items: [{ name: 'Smoke', grossUnitPrice: 12_700, quantity: 1, vat: 27 }],
  })
  const stored = await storeDocumentPdf(tarca, storage, invoice)
  const bytes = await storage.get(stored.key)
  assert(
    stored.key === documentPdfKey(invoice) && stored.key.startsWith('szamlak/2026/09/'),
    'tarca/storage: a számla kulcsa szamlak/ÉÉÉÉ/HH/<sorszám>.pdf',
  )
  assert(
    new TextDecoder().decode(bytes?.slice(0, 5)) === '%PDF-',
    'tarca/storage: storeDocumentPdf a hamis Billingo PDF-jét menti',
  )
  try {
    await storage.put('../kivul.pdf', bytes, { contentType: 'application/pdf' })
    assert(false, 'tarca/storage: a kifelé mutató kulcsot elutasítja')
  } catch (error) {
    assert(error instanceof StorageError, 'tarca/storage: a kifelé mutató kulcsot elutasítja')
  }
  if (modules.storageFs) {
    const { fsStorage } = modules.storageFs
    try {
      fsStorage({ directory: '.' }).pathFor('../kivul.pdf')
      assert(false, 'tarca/storage/fs: a gyökéren kívüli útvonalat elutasítja')
    } catch (error) {
      assert(
        error?.name === 'StorageError',
        'tarca/storage/fs: a gyökéren kívüli útvonalat elutasítja',
      )
    }
  }
}

async function smokeStores(modules, assert) {
  const { diagnoseStore, memoryStore, storeCapabilities } = modules.stores
  const store = memoryStore()
  const diagnosis = await diagnoseStore(store)
  assert(
    diagnosis.ok && diagnosis.suitableFor.createOnceLock && diagnosis.suitableFor.journal,
    'tarca/stores: a memoryStore mindenre alkalmas a diagnoseStore szerint',
  )
  assert(storeCapabilities(store).setIfAbsent, 'tarca/stores: storeCapabilities')
}

async function smokeJournal(modules, assert) {
  const { createTarca } = modules.root
  const { createFakeBillingoFetch } = modules.testing
  const { createJournal, memoryJournal } = modules.journal
  const now = () => new Date('2026-10-02T10:00:00Z')
  const journal = createJournal(memoryJournal(), { now })
  const billingo = createFakeBillingoFetch({ now })
  const tarca = createTarca({
    apiKey: 'smoke-kulcs',
    fetch: billingo.fetch,
    retryDelayMs: 0,
    hooks: { onDocument: (event) => journal.record(event), onDocumentError: 'throw' },
  })
  const input = {
    vendorId: 'SMOKE-J1',
    partner: SMOKE_BUYER,
    items: [{ name: 'Napló', grossUnitPrice: 12_700, quantity: 1, vat: 27 }],
  }
  const first = await tarca.documents.createOnce(input)
  await tarca.documents.createOnce(input)
  const entries = await journal.entries({ from: '2026-10-02', to: '2026-10-02' })
  assert(
    entries.length === 1 &&
      entries[0].id === first.document.id &&
      entries[0].vendorId === 'SMOKE-J1' &&
      entries[0].source === 'hook',
    'tarca/journal: az onDocument hook egyszer naplózza a createOnce bizonylatát',
  )
}

async function smokeMcp(modules, assert) {
  const { createFakeBillingoFetch } = modules.testing
  const { createTarcaMcpServer } = modules.mcp
  const billingo = createFakeBillingoFetch({ now: () => new Date('2026-10-02T10:00:00Z') })
  const connection = createTarcaMcpServer({
    apiKey: 'smoke-kulcs',
    fetch: billingo.fetch,
    retryDelayMs: 0,
    confirmationSecret: 'smoke-teszt-titok-0123456789',
    now: () => new Date('2026-10-02T10:00:00Z'),
  }).connect()
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
  }
  const request = (id, method, params = {}) =>
    connection.handle({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } })
  const discover = await request(1, 'server/discover')
  assert(
    discover.result?.supportedVersions?.includes('2026-07-28') &&
      discover.result._meta['io.modelcontextprotocol/serverInfo'].name === 'tarca',
    'tarca/mcp: server/discover',
  )
  const list = await request(2, 'tools/list')
  const names = list.result.tools.map((tool) => tool.name)
  assert(
    names.includes('preview_document') && !names.includes('create_document'),
    'tarca/mcp: tools/list csak olvasó eszközökkel',
  )
  const preview = await request(3, 'tools/call', {
    name: 'preview_document',
    arguments: {
      partner: SMOKE_BUYER,
      items: [{ name: 'Smoke', quantity: 2, netUnitPrice: 1000, vat: 27 }],
    },
  })
  assert(
    preview.result?.isError === false &&
      preview.result.structuredContent.totals.grossAmount === 2540 &&
      /^[0-9a-z]+\.[0-9a-f]{32}$/.test(preview.result.structuredContent.confirmation) &&
      billingo.requests.every((entry) => entry.method === 'GET'),
    'tarca/mcp: preview_document becslés és megerősítő kód írás nélkül (WebCrypto HMAC)',
  )
}

async function stripeTestSignature(secret, message) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function smokePayments(modules, assert) {
  const { createTarca } = modules.root
  const { createFakeBillingoFetch } = modules.testing
  const { issueForPayment } = modules.payments
  const { stripeWebhook } = modules.paymentsStripe

  const billingo = createFakeBillingoFetch()
  const client = createTarca({ apiKey: 'smoke-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  const secret = 'whsec_smoke'
  const results = []
  const handler = stripeWebhook({
    secret,
    onError: () => undefined,
    onPayment: async (payment) => {
      results.push(await issueForPayment(client, payment, { vat: 27, recoveryDelayMs: 0 }))
    },
  })
  const created = Math.floor(Date.now() / 1000)
  const payload = JSON.stringify({
    id: 'evt_smoke',
    object: 'event',
    type: 'checkout.session.completed',
    created,
    data: {
      object: {
        id: 'cs_smoke',
        object: 'checkout.session',
        payment_intent: 'pi_smoke',
        payment_status: 'paid',
        amount_total: 127_000,
        currency: 'huf',
      },
    },
  })
  const signature = await stripeTestSignature(secret, `${created}.${payload}`)
  const deliver = (header) =>
    handler(
      new Request('https://smoke.example/stripe', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': header },
      }),
    )
  const first = await deliver(`t=${created},v1=${signature}`)
  const again = await deliver(`t=${created},v1=${signature}`)
  const forged = await deliver(`t=${created},v1=${'0'.repeat(64)}`)
  assert(
    first.status === 200 &&
      results[0]?.kind === 'receipt' &&
      results[0].created === true &&
      results[0].document.grossTotal === 1270,
    'tarca/payments: Web Crypto-val aláírt Stripe webhookból egy nyugta a hamis Billingóban',
  )
  assert(
    again.status === 200 && results[1]?.created === false && billingo.count('CreateReceipt') === 1,
    'tarca/payments: az újraküldés created: false, második nyugta nélkül',
  )
  assert(forged.status === 400 && results.length === 2, 'tarca/payments: hamis aláírásra 400')
}

async function rejection(promise) {
  try {
    await promise
    return undefined
  } catch (error) {
    return error
  }
}

async function smokePaymentProviders(modules, assert) {
  const { simplePaySignature, verifySimplePaySignature } = modules.paymentsSimplePay
  const simplePayBody = '{"orderRef":"smoke-1","status":"FINISHED"}'
  const simplePayKey = 'simplepay-smoke-titok'
  const simplePaySigned = await simplePaySignature(simplePayBody, simplePayKey)
  await verifySimplePaySignature(simplePayBody, simplePaySigned, simplePayKey)
  const simplePayForged = await rejection(
    verifySimplePaySignature(`${simplePayBody} `, simplePaySigned, simplePayKey),
  )
  assert(
    simplePayForged?.reason === 'invalid_signature',
    'tarca/payments/simplepay: HMAC-SHA384 aláírás Web Cryptóval, a módosított törzs elutasítva',
  )

  const { verifyRevolutSignature } = modules.paymentsRevolut
  const revolutSecret = 'wsk_smoke'
  const revolutPayload = '{"event":"ORDER_COMPLETED","order_id":"smoke"}'
  const timestamp = String(Date.now())
  const revolutSigned = `v1=${await stripeTestSignature(revolutSecret, `v1.${timestamp}.${revolutPayload}`)}`
  await verifyRevolutSignature(revolutPayload, revolutSigned, timestamp, revolutSecret)
  const revolutForged = await rejection(
    verifyRevolutSignature(`${revolutPayload} `, revolutSigned, timestamp, revolutSecret),
  )
  assert(
    revolutForged?.reason === 'invalid_signature',
    'tarca/payments/revolut: v1 aláírás ezredmásodperces időbélyeggel, a módosított törzs elutasítva',
  )

  const { barionWebhook } = modules.paymentsBarion
  const barionCalls = []
  const barion = barionWebhook({
    posKey: 'barion-smoke-pos',
    sandbox: true,
    fetch: async () => {
      barionCalls.push(1)
      return reply(500, {})
    },
    onError: () => undefined,
    onPayment: () => undefined,
  })
  const barionResponse = await barion(
    new Request('https://smoke.example/barion', { method: 'POST', body: '' }),
  )
  assert(
    barionResponse.status === 400 && barionCalls.length === 0,
    'tarca/payments/barion: paymentId nélküli callbackre 400, a Barion API hívása nélkül',
  )

  const { verifyPayPalWebhook } = modules.paymentsPayPal
  const payPalHeaders = new Headers({
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/smoke',
    'paypal-transmission-id': 'smoke-transmission',
    'paypal-transmission-sig': 'smoke-signature',
    'paypal-transmission-time': new Date().toISOString(),
  })
  const payPalAnswers = []
  const payPalApi = (status) => ({
    post: async (path, body) => {
      payPalAnswers.push(JSON.parse(body).webhook_id === 'smoke-webhook' ? path : 'rossz törzs')
      return { verification_status: status }
    },
  })
  const payPalEvent = '{"id":"WH-smoke","event_type":"PAYMENT.CAPTURE.COMPLETED"}'
  await verifyPayPalWebhook(payPalEvent, payPalHeaders, 'smoke-webhook', payPalApi('SUCCESS'))
  const payPalFailure = await rejection(
    verifyPayPalWebhook(payPalEvent, payPalHeaders, 'smoke-webhook', payPalApi('FAILURE')),
  )
  assert(
    payPalFailure?.reason === 'invalid_signature' &&
      payPalAnswers.every((path) => path === '/v1/notifications/verify-webhook-signature'),
    'tarca/payments/paypal: az aláírást a PayPal verify-webhook-signature végpontja dönti el',
  )
}
