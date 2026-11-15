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
