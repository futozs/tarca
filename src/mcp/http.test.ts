import { describe, expect, test } from 'vitest'
import { TEST_API_KEY } from '../../tests/helpers'
import { MCP_NOW, MCP_SECRET, MODERN_META } from '../../tests/mcp'
import { createFakeBillingoFetch } from '../testing'
import { createTarcaMcpHandler, createTarcaMcpServer, DEFAULT_MAX_BODY_BYTES } from './index'

const TOKEN = 'Bearer helyes-token'

function setup(
  options: { readonly allowedOrigins?: readonly string[]; readonly maxBodyBytes?: number } = {},
) {
  const billingo = createFakeBillingoFetch({ now: MCP_NOW })
  const server = createTarcaMcpServer({
    apiKey: TEST_API_KEY,
    fetch: billingo.fetch,
    retryDelayMs: 0,
    now: MCP_NOW,
    confirmationSecret: MCP_SECRET,
  })
  const seen: Request[] = []
  const handler = createTarcaMcpHandler(server, {
    authorize: (request) => {
      seen.push(request)
      return request.headers.get('authorization') === TOKEN
    },
    ...options,
  })
  return { billingo, handler, seen }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://mcp.example.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: TOKEN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const DISCOVER = {
  jsonrpc: '2.0',
  id: 1,
  method: 'server/discover',
  params: { _meta: MODERN_META },
}

describe('createTarcaMcpHandler', () => {
  test('POST JSON-RPC kérésre JSON választ ad, gyorsítótárazás nélkül', async () => {
    const { handler } = setup()

    const response = await handler(post(DISCOVER))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ id: 1, result: { resultType: 'complete' } })
  })

  test('csak értesítésre 202-t ad törzs nélkül, a batchet tömbként adja vissza', async () => {
    const { handler } = setup()

    const notification = await handler(
      post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    )
    const batch = await handler(post([DISCOVER, { ...DISCOVER, id: 2 }]))

    expect(notification.status).toBe(202)
    expect(await notification.text()).toBe('')
    expect(await batch.json()).toMatchObject([{ id: 1 }, { id: 2 }])
  })

  test('GET, DELETE és más metódus 405, Allow: POST fejléccel, hitelesítés előtt', async () => {
    const { handler, seen } = setup()

    for (const method of ['GET', 'DELETE', 'PUT']) {
      const response = await handler(new Request('https://mcp.example.com/mcp', { method }))
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
      expect(await response.json()).toMatchObject({ error: { code: -32600 } })
    }
    expect(seen).toHaveLength(0)
  })

  test('az authorize nélküli vagy elutasított kérésre 401, dobó authorize-ra 500, és nem hívja a Billingót', async () => {
    const { handler, billingo } = setup()
    const throwing = createTarcaMcpHandler(
      createTarcaMcpServer({ confirmationSecret: MCP_SECRET }),
      {
        authorize: () => {
          throw new Error('adatbázis nem elérhető')
        },
      },
    )

    const truthy = createTarcaMcpHandler(createTarcaMcpServer({ confirmationSecret: MCP_SECRET }), {
      authorize: () => 'Bearer rossz' as unknown as boolean,
    })

    const missing = await handler(post(DISCOVER, { authorization: '' }))
    const wrong = await handler(post(DISCOVER, { authorization: 'Bearer rossz' }))
    const crashed = await throwing(post(DISCOVER))
    const notBoolean = await truthy(post(DISCOVER))

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(notBoolean.status).toBe(401)
    expect(crashed.status).toBe(500)
    expect(await crashed.text()).not.toContain('adatbázis')
    expect(billingo.requests).toHaveLength(0)
  })

  test('az Origin fejlécet az engedélyezett listával veti össze (DNS rebinding ellen)', async () => {
    const open = setup()
    const listed = setup({ allowedOrigins: ['https://app.example.com'] })

    const withoutOrigin = await open.handler(post(DISCOVER))
    const anyOrigin = await open.handler(post(DISCOVER, { origin: 'https://app.example.com' }))
    const allowed = await listed.handler(post(DISCOVER, { origin: 'https://app.example.com' }))
    const rebinding = await listed.handler(post(DISCOVER, { origin: 'http://evil.localhost:3000' }))

    expect(withoutOrigin.status).toBe(200)
    expect(anyOrigin.status).toBe(403)
    expect(allowed.status).toBe(200)
    expect(rebinding.status).toBe(403)
    expect(listed.seen).toHaveLength(1)
  })

  test('a túl nagy törzset 413-mal utasítja el, a deklarált és a ténylegesen olvasott méret alapján is', async () => {
    const { handler } = setup({ maxBodyBytes: 64 })
    const big = JSON.stringify({ ...DISCOVER, padding: 'x'.repeat(100) })
    const streamed = new Request('https://mcp.example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: TOKEN },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big))
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)

    const declared = await handler(post(big))
    const undeclared = await handler(streamed)
    const small = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const announced = await handler(post(small, { 'content-length': '65' }))
    const honest = await handler(post(small))

    expect(declared.status).toBe(413)
    expect(announced.status).toBe(413)
    expect(honest.status).toBe(200)
    expect(undeclared.status).toBe(413)
    expect(DEFAULT_MAX_BODY_BYTES).toBe(1_048_576)
  })

  test('nem JSON tartalomtípusra 415-öt, hibás JSON-ra 400-at és -32700-at ad', async () => {
    const { handler } = setup()

    const text = await handler(post(DISCOVER, { 'content-type': 'text/plain' }))
    const broken = await handler(post('{nem json'))
    const invalidUtf8 = await handler(
      new Request('https://mcp.example.com/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', authorization: TOKEN },
        body: new Uint8Array([
          ...new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"ping","x":"'),
          0xff,
          ...new TextEncoder().encode('"}'),
        ]),
      }),
    )

    expect(text.status).toBe(415)
    expect(broken.status).toBe(400)
    expect(await broken.json()).toMatchObject({ id: null, error: { code: -32700 } })
    expect(invalidUtf8.status).toBe(400)
    expect(await invalidUtf8.json()).toMatchObject({ error: { code: -32700 } })
  })

  test('kérésenként új kapcsolat; a legacy kliens az MCP-Protocol-Version fejléccel állapot nélkül is működik', async () => {
    const { handler } = setup()
    const legacyList = { jsonrpc: '2.0', id: 3, method: 'tools/list' }

    const initialize = await handler(
      post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
    )
    const withoutHeader = await handler(post(legacyList))
    const withHeader = await handler(post(legacyList, { 'mcp-protocol-version': '2025-06-18' }))

    expect(await initialize.json()).toMatchObject({ result: { protocolVersion: '2025-06-18' } })
    expect(await withoutHeader.json()).toMatchObject({ error: { code: -32602 } })
    expect(await withHeader.json()).toMatchObject({ id: 3, result: { tools: expect.any(Array) } })
  })

  test('megerősítő titok és authorize nélkül nem indul, rossz méretkorlátot nem fogad el', () => {
    const withSecret = createTarcaMcpServer({ confirmationSecret: MCP_SECRET })
    const withoutSecret = createTarcaMcpServer()
    const authorize = () => true

    expect(() => createTarcaMcpHandler(withoutSecret, { authorize })).toThrow('confirmationSecret')
    expect(() =>
      createTarcaMcpHandler(
        withSecret,
        {} as unknown as Parameters<typeof createTarcaMcpHandler>[1],
      ),
    ).toThrow('authorize')
    expect(() => createTarcaMcpHandler(withSecret, { authorize, maxBodyBytes: 0 })).toThrow(
      'maxBodyBytes',
    )
    expect(() => createTarcaMcpHandler(withSecret, { authorize, maxBodyBytes: 1.5 })).toThrow(
      'maxBodyBytes',
    )
  })

  test('két szerverpéldány ugyanazzal a titokkal elfogadja egymás megerősítő kódját', async () => {
    const billingo = createFakeBillingoFetch({ now: MCP_NOW })
    const instance = () =>
      createTarcaMcpHandler(
        createTarcaMcpServer({
          apiKey: TEST_API_KEY,
          fetch: billingo.fetch,
          retryDelayMs: 0,
          recoveryDelayMs: 0,
          now: MCP_NOW,
          confirmationSecret: MCP_SECRET,
          allowWrite: true,
        }),
        { authorize: () => true },
      )
    const input = {
      electronic: false,
      items: [{ name: 'Kávé', grossUnitPrice: 890, vat: 27 }],
    }
    const call = (name: string, args: Record<string, unknown>) =>
      post({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args, _meta: MODERN_META },
      })

    const preview = await (await instance()(call('preview_receipt', input))).json()
    const created = await (
      await instance()(
        call('create_receipt', {
          ...input,
          confirmation: preview.result.structuredContent.confirmation,
        }),
      )
    ).json()

    expect(created).toMatchObject({
      result: { isError: false, structuredContent: { created: true } },
    })
    expect(billingo.count('CreateReceipt')).toBe(1)
  })
})
