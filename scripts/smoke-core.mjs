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
  return checks
}
