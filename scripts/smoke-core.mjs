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
  assert(Object.keys(BILLINGO_OPERATIONS).length >= 54, 'teljes művelettábla')
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
