import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, vi } from 'vitest'
import {
  billingPeriod,
  billingPeriodAt,
  billingPeriodsBetween,
  runBatch,
  todayPeriod,
} from '../../src/batch/index'
import type { CliIo } from '../../src/cli/io'
import { runCli } from '../../src/cli/run'
import { createTarca, type KeyValueStore, type Tarca } from '../../src/index'
import { createJournal, kvJournal, memoryJournal } from '../../src/journal/index'
import { createTarcaMcpHandler, createTarcaMcpServer } from '../../src/mcp/index'
import { NodeBodyError, toNodeHandler } from '../../src/node/index'
import {
  combineHooks,
  createMetricsRegistry,
  type ObserveSpan,
  type ObserveTracer,
  observe,
} from '../../src/observe/index'
import { issueForPayment } from '../../src/payments/index'
import { stripeWebhook } from '../../src/payments/stripe'
import { fsStorage } from '../../src/storage/fs'
import {
  documentPdfKey,
  memoryStorage,
  StorageError,
  s3FetchStorage,
  sanitizeKeySegment,
  storeDocumentPdf,
} from '../../src/storage/index'
import {
  cloudflareKvStore,
  type DurableObjectStorageLike,
  type DurableObjectStoreEntry,
  diagnoseStore,
  durableObjectStore,
  handleDurableObjectStoreRequest,
  memoryStore,
  storeCapabilities,
  upstashRedisStore,
} from '../../src/stores/index'
import {
  DELETE_IF_EQUALS_SCRIPT,
  INCREMENT_SCRIPT,
  SET_IF_ABSENT_SCRIPT,
} from '../../src/stores/scripts'
import {
  createFakeBillingoFetch,
  createMockTarca,
  type FakeBillingo,
} from '../../src/testing/index'
import { TEST_API_KEY } from '../helpers'
import { BUYER, docsClient, docsExample, ITEMS, pinDocsClock } from './helpers'

pinDocsClock()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const SZAMLA = { vendorId: 'ORDER-1001', partner: BUYER, items: ITEMS }

interface CliRun {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

async function cli(
  argv: readonly string[],
  billingo: FakeBillingo,
  options: { files?: Record<string, string>; lines?: readonly string[] } = {},
): Promise<CliRun> {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    argv,
    env: { BILLINGO_API_KEY: 'k'.repeat(40) },
    nodeVersion: '24.11.0',
    stdout: (text) => {
      out.push(text)
    },
    stderr: (text) => {
      err.push(text)
    },
    readFile: async (path) => {
      const content = options.files?.[path]
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
    },
    readStdin: async () => '',
    stdinLines: async function* () {
      for (const line of options.lines ?? []) yield line
    },
    fetch: billingo.fetch,
  }
  const code = await runCli(io)
  return { code, stdout: out.join(''), stderr: err.join('') }
}

class FakeUpstash {
  readonly data = new Map<string, string>()

  async get(key: string) {
    return this.data.get(key) ?? null
  }
  async set(key: string, value: string) {
    this.data.set(key, value)
    return 'OK'
  }
  async del(key: string) {
    return this.data.delete(key) ? 1 : 0
  }
  async eval(script: string, keys: string[], args: string[]) {
    const key = keys[0] ?? ''
    if (script === SET_IF_ABSENT_SCRIPT) {
      if (this.data.has(key)) return 0
      this.data.set(key, args[0] ?? '')
      return 1
    }
    if (script === INCREMENT_SCRIPT) {
      const next = Number(this.data.get(key) ?? '0') + 1
      this.data.set(key, String(next))
      return next
    }
    if (script === DELETE_IF_EQUALS_SCRIPT) {
      if (this.data.get(key) !== args[0]) return 0
      this.data.delete(key)
      return 1
    }
    throw new Error('ismeretlen szkript')
  }
}

function durableObjectStorage(): DurableObjectStorageLike {
  const data = new Map<string, DurableObjectStoreEntry>()
  return {
    get: async (key) => data.get(key),
    put: async (key, value) => {
      data.set(key, value)
    },
    delete: async (key) => data.delete(key),
  }
}

describe('kiegeszitok/parancssor', () => {
  docsExample('kiegeszitok/parancssor', 'doctor a hamis Billingo ellen, adószámmal', async () => {
    const billingo = createFakeBillingoFetch({ taxCode: '12345678-2-42' })

    const futas = await cli(['doctor', '--tax-code', '12345678-2-42'], billingo)

    expect(futas.code).toBe(0)
    expect(futas.stdout).toContain('✓ API kulcs: 40 karakter.')
    expect(futas.stdout).toContain('Az adószám egyezik a megadottal.')
    expect(futas.stdout).toContain('! Bankszámlák: 0.')
    expect(futas.stdout).toContain('Összegzés: 0 hiba, 1 figyelmeztetés.')
    expect(futas.stdout).not.toContain('12345678-2-42')
    expect(billingo.count()).toBe(3)
  })

  docsExample('kiegeszitok/parancssor', 'json, report és defaults', async () => {
    const billingo = createFakeBillingoFetch()

    const json = await cli(['doctor', '--json'], billingo)
    const report = await cli(['doctor', '--report'], billingo)
    const rossz = await cli(['doctor', '--defaults', 'tarca.json'], billingo, {
      files: { 'tarca.json': '{"blokk":1}' },
    })
    const jo = await cli(['doctor', '--defaults', 'tarca.json'], billingo, {
      files: { 'tarca.json': '{"blockId":1,"receiptBlockId":2}' },
    })

    expect(JSON.parse(json.stdout).checks[0]).toEqual(
      expect.objectContaining({ id: 'node', status: 'ok', message: expect.any(String) }),
    )
    expect(report.stdout).toContain('| api-key | ok |')
    expect(report.stdout).not.toContain('k'.repeat(40))
    expect(rossz.code).toBe(1)
    expect(rossz.stderr).toContain('ismeretlen mezőt tartalmaz: blokk')
    expect(jo.code).toBe(0)
  })

  docsExample(
    'kiegeszitok/parancssor',
    'verify, document get, súgó és használati hiba',
    async () => {
      const billingo = createFakeBillingoFetch()
      const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch })
      await tarca.documents.createOnce(SZAMLA)

      const verify = await cli(['verify'], billingo)
      const azonositoval = await cli(['document', 'get', '1'], billingo)
      const vendorral = await cli(['document', 'get', '--vendor', 'ORDER-1001'], billingo)
      const nincs = await cli(['document', 'get', '--vendor', 'NINCS'], billingo)
      const sugo = await cli(['doctor', '--help'], billingo)
      const ismeretlen = await cli(['szamla'], billingo)
      const elott = billingo.count()
      await cli(['help'], billingo)

      expect([verify.code, verify.stdout]).toEqual([
        0,
        'Az API kulcs érvényes: a Billingo elfogadta.\n',
      ])
      expect(JSON.parse(azonositoval.stdout)).toMatchObject({ invoiceNumber: '2026-1' })
      expect(JSON.parse(vendorral.stdout)).toMatchObject({ id: 1 })
      expect([nincs.code, nincs.stderr]).toEqual([
        1,
        'Nincs bizonylat ezzel a vendorId-val ebben a Billingo cégben.\n',
      ])
      expect(sugo.code).toBe(0)
      expect(sugo.stdout).toContain('Használat: tarcajs <parancs> [kapcsolók]')
      expect(ismeretlen.code).toBe(2)
      expect(billingo.count()).toBe(elott)
    },
  )

  docsExample('kiegeszitok/parancssor', 'mcp stdio-n, a --defaults - használati hiba', async () => {
    const billingo = createFakeBillingoFetch()
    const futas = await cli(['mcp'], billingo, {
      lines: [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })],
    })
    const stdin = await cli(['mcp', '--defaults', '-'], billingo)

    expect(futas.code).toBe(0)
    expect(futas.stderr).toContain('csak olvasás')
    expect(JSON.parse(futas.stdout)).toMatchObject({ id: 1 })
    expect(stdin.code).toBe(2)
  })
})

function toolCall(name: string, args: Record<string, unknown>, id = 1) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  })
}

function structured(line: string | undefined): Record<string, unknown> {
  const result = JSON.parse(line ?? '{}').result
  return result.isError
    ? { isError: true, ...JSON.parse(result.content[1].text) }
    : result.structuredContent
}

describe('kiegeszitok/mcp-szerver', () => {
  docsExample('kiegeszitok/mcp-szerver', 'initialize és az eszközök listája', async () => {
    vi.stubEnv('BILLINGO_API_KEY', TEST_API_KEY)
    const server = createTarcaMcpServer({ apiKey: process.env.BILLINGO_API_KEY, allowWrite: false })
    const connection = server.connect()

    const valasz = await connection.handleLine(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'teszt', version: '1' },
        },
      }),
    )

    expect(JSON.parse(valasz ?? '{}').result.protocolVersion).toBe('2025-06-18')
    expect([server.tools.length, server.allowWrite]).toEqual([21, false])
    expect(server.tools.filter((tool) => tool.write).map((tool) => tool.name)).toEqual([
      'create_document',
      'create_receipt',
      'cancel_document',
      'mark_document_paid',
      'send_document',
    ])
    const lista = JSON.parse(
      (await connection.handleLine(
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      )) ?? '{}',
    )
    expect(lista.result.tools).toHaveLength(16)
  })

  docsExample(
    'kiegeszitok/mcp-szerver',
    'előnézet, kiállítás egyszer, eltérő bemenetre confirmation',
    async () => {
      const billingo = createFakeBillingoFetch()
      const server = createTarcaMcpServer({
        apiKey: TEST_API_KEY,
        fetch: billingo.fetch,
        allowWrite: true,
      })
      const connection = server.connect()
      const szamla = {
        partner: {
          name: 'Vevő Kft.',
          address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
        },
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
      }

      const elonezet = structured(await connection.handleLine(toolCall('preview_document', szamla)))
      expect(elonezet).toMatchObject({ totals: { grossAmount: 190_500, estimate: true } })
      expect(billingo.count('CreateDocument')).toBe(0)

      const confirmation = elonezet.confirmation
      const elso = structured(
        await connection.handleLine(toolCall('create_document', { ...szamla, confirmation })),
      )
      const masodik = structured(
        await connection.handleLine(toolCall('create_document', { ...szamla, confirmation })),
      )
      const mas = structured(
        await connection.handleLine(
          toolCall('create_document', { ...szamla, comment: 'más', confirmation }),
        ),
      )

      expect(elso).toMatchObject({ created: true })
      expect(masodik).toMatchObject({ created: false })
      expect(mas).toMatchObject({ isError: true, error: { category: 'confirmation' } })
      expect(billingo.count('CreateDocument')).toBe(1)
    },
  )

  docsExample(
    'kiegeszitok/mcp-szerver',
    'allowWrite nélkül write_disabled, ismeretlen bizonylat found: false',
    async () => {
      const billingo = createFakeBillingoFetch()
      const connection = createTarcaMcpServer({
        apiKey: TEST_API_KEY,
        fetch: billingo.fetch,
      }).connect()

      const iras = structured(await connection.handleLine(toolCall('cancel_document', { id: 1 })))
      const olvasas = structured(await connection.handleLine(toolCall('get_document', { id: 999 })))

      expect(iras).toMatchObject({
        isError: true,
        error: { category: 'write_disabled', fields: [] },
      })
      expect(olvasas).toEqual({ found: false })
      expect(billingo.count('CancelDocument')).toBe(0)
    },
  )
})

describe('kiegeszitok/mcp-http', () => {
  docsExample(
    'kiegeszitok/mcp-http',
    'a Workers kezelő: 405, 401, 415, 403 és a válasz',
    async () => {
      const billingo = createFakeBillingoFetch()
      vi.stubGlobal('fetch', billingo.fetch)
      const env = { BILLINGO_API_KEY: TEST_API_KEY, MCP_SECRET: 'm'.repeat(32), MCP_TOKEN: 'titok' }
      let handler: ReturnType<typeof createTarcaMcpHandler> | undefined
      const worker = {
        fetch(request: Request) {
          handler ??= createTarcaMcpHandler(
            createTarcaMcpServer({
              apiKey: env.BILLINGO_API_KEY,
              confirmationSecret: env.MCP_SECRET,
            }),
            {
              authorize: (incoming) =>
                Boolean(env.MCP_TOKEN) &&
                incoming.headers.get('authorization') === `Bearer ${env.MCP_TOKEN}`,
            },
          )
          return handler(request)
        },
      }
      const post = (
        headers: Record<string, string>,
        body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      ) =>
        worker.fetch(new Request('https://mcp.example.hu/mcp', { method: 'POST', headers, body }))
      const json = { 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' }

      const get = await worker.fetch(new Request('https://mcp.example.hu/mcp'))
      const nevtelen = await post(json)
      const undefinedToken = await post({ ...json, authorization: 'Bearer undefined' })
      const szoveg = await post({ authorization: 'Bearer titok', 'content-type': 'text/plain' })
      const origin = await post({
        ...json,
        authorization: 'Bearer titok',
        origin: 'https://gonosz.example',
      })
      const jo = await post({ ...json, authorization: 'Bearer titok' })
      const ertesites = await post(
        { ...json, authorization: 'Bearer titok' },
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      )

      expect([get.status, get.headers.get('allow')]).toEqual([405, 'POST'])
      expect([nevtelen.status, undefinedToken.status, szoveg.status, origin.status]).toEqual([
        401, 401, 415, 403,
      ])
      expect(jo.status).toBe(200)
      expect((await jo.json()).result.tools).toHaveLength(16)
      expect([ertesites.status, await ertesites.text()]).toEqual([202, ''])
    },
  )

  docsExample(
    'kiegeszitok/mcp-http',
    'titok vagy authorize nélkül configuration hiba',
    async () => {
      expect(() =>
        createTarcaMcpHandler(createTarcaMcpServer({ apiKey: TEST_API_KEY }), {
          authorize: () => true,
        }),
      ).toThrow(expect.objectContaining({ category: 'configuration' }))
      expect(() =>
        createTarcaMcpHandler(
          createTarcaMcpServer({ apiKey: TEST_API_KEY, confirmationSecret: 'm'.repeat(32) }),
          {} as never,
        ),
      ).toThrow(expect.objectContaining({ category: 'configuration' }))
    },
  )
})

describe('kiegeszitok/pdf-tarhely', () => {
  docsExample(
    'kiegeszitok/pdf-tarhely',
    'a számla PDF-je memóriás tárhelyre, dátum szerinti kulccsal',
    async () => {
      const { tarca } = docsClient()
      const tarhely = memoryStorage()
      const { document } = await tarca.documents.createOnce({
        vendorId: 'RENDELES-1003',
        partner: BUYER,
        items: ITEMS,
      })

      const fajl = await storeDocumentPdf(tarca, tarhely, document)

      expect([fajl.key, fajl.contentType]).toEqual([
        'szamlak/2026/11/2026-1.pdf',
        'application/pdf',
      ])
      expect(fajl.size).toBeGreaterThan(0)
      expect(documentPdfKey(document, { prefix: 'bolt' })).toBe('bolt/szamlak/2026/11/2026-1.pdf')
      expect(sanitizeKeySegment('PREFIX / 2026-000001')).toBe('PREFIX-2026-000001')
    },
  )

  docsExample(
    'kiegeszitok/pdf-tarhely',
    'R2 kulccsal: útvonal stílusú cím, aláírt link',
    async () => {
      const billingo = createFakeBillingoFetch()
      const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch })
      await tarca.documents.createOnce(SZAMLA)
      const feltoltesek: string[] = []
      const r2 = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        feltoltesek.push(`${request.method} ${request.url}`)
        expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /)
        return new Response(null, { status: 200 })
      }) as typeof globalThis.fetch
      const storage = s3FetchStorage({
        bucket: 'szamlak',
        region: 'auto',
        endpoint: 'https://fiok.r2.cloudflarestorage.com',
        accessKeyId: 'kulcs',
        secretAccessKey: 'titok',
        fetch: r2,
      })

      const fajl = await storeDocumentPdf(tarca, storage, 1)
      const link = await storage.getUrl(fajl.key, { expiresInSeconds: 3_600 })

      expect(feltoltesek).toEqual([
        'PUT https://fiok.r2.cloudflarestorage.com/szamlak/szamlak/2026/11/2026-1.pdf',
      ])
      expect(link).toContain('X-Amz-Expires=3600')
      expect(billingo.count('GetDocument')).toBe(1)
    },
  )

  docsExample('kiegeszitok/pdf-tarhely', 'lemezre, a mappán kívül nem ír', async () => {
    const billingo = createFakeBillingoFetch()
    const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch })
    await tarca.documents.createOnce(SZAMLA)
    const mappa = mkdtempSync(join(tmpdir(), 'tarca-pdf-'))
    try {
      const storage = fsStorage({ directory: mappa })

      const fajl = await storeDocumentPdf(tarca, storage, 1)

      expect(readFileSync(storage.pathFor(fajl.key)).subarray(0, 4).toString()).toBe('%PDF')
      await expect(
        storage.put('../kint.pdf', new Uint8Array([37]), { contentType: 'application/pdf' }),
      ).rejects.toBeInstanceOf(StorageError)
    } finally {
      rmSync(mappa, { recursive: true, force: true })
    }
  })
})

describe('kiegeszitok/tarolok', () => {
  docsExample('kiegeszitok/tarolok', 'Upstash adapter: zárra és naplóra is alkalmas', async () => {
    const redis = new FakeUpstash()
    const billingo = createFakeBillingoFetch()

    const store = upstashRedisStore(redis, { prefix: 'bolt:', timeoutMs: 2_000 })
    const tarca = createTarca({
      apiKey: TEST_API_KEY,
      fetch: billingo.fetch,
      createOnceLock: store,
    })
    const allapot = await diagnoseStore(store)

    expect(allapot).toMatchObject({
      ok: true,
      suitableFor: { createOnceLock: true, journal: true, webhookDedupe: true, refundLedger: true },
      problems: [],
    })
    expect((await tarca.documents.createOnce(SZAMLA)).created).toBe(true)
    expect([...redis.data.keys()].every((key) => key.startsWith('bolt:'))).toBe(true)
  })

  docsExample(
    'kiegeszitok/tarolok',
    'eval nélkül és Cloudflare KV-vel nincs atomikus írás',
    async () => {
      const { eval: _nincs, ...egyszeru } = new FakeUpstash()
      void _nincs
      const kv = cloudflareKvStore({
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      })

      expect(storeCapabilities(kv)).toEqual({
        setIfAbsent: false,
        increment: false,
        deleteIfEquals: false,
      })
      expect(storeCapabilities(memoryStore())).toEqual({
        setIfAbsent: true,
        increment: true,
        deleteIfEquals: true,
      })
      expect(egyszeru).toBeDefined()
    },
  )

  docsExample('kiegeszitok/tarolok', 'Durable Object tároló a Workerben', async () => {
    const billingo = createFakeBillingoFetch()
    vi.stubGlobal('fetch', billingo.fetch)
    class TarcaStore {
      constructor(private readonly state: { storage: DurableObjectStorageLike }) {}

      fetch(request: Request): Promise<Response> {
        return handleDurableObjectStoreRequest(this.state.storage, request)
      }
    }
    const objektum = new TarcaStore({ storage: durableObjectStorage() })
    const env = {
      BILLINGO_API_KEY: TEST_API_KEY,
      TARCA_STORE: {
        idFromName: (name: string) => name,
        get: (_id: unknown) => ({
          fetch: (input: string, init: RequestInit) => objektum.fetch(new Request(input, init)),
        }),
      },
    }
    const worker = {
      async fetch(request: Request): Promise<Response> {
        const store = durableObjectStore(env.TARCA_STORE.get(env.TARCA_STORE.idFromName('tarca')))
        const tarca = createTarca({ apiKey: env.BILLINGO_API_KEY, createOnceLock: store })
        const profil = await tarca.organization.get()
        return Response.json({ taxCode: profil.taxCode, url: request.url })
      },
    }

    const valasz = await worker.fetch(new Request('https://bolt.example.hu/'))
    const store = durableObjectStore(env.TARCA_STORE.get('tarca'))

    expect(await valasz.json()).toEqual({
      taxCode: '00000000-0-00',
      url: 'https://bolt.example.hu/',
    })
    expect((await diagnoseStore(store)).suitableFor).toEqual({
      createOnceLock: true,
      journal: true,
      webhookDedupe: true,
      refundLedger: true,
    })
  })
})

describe('kiegeszitok/bizonylatnaplo', () => {
  docsExample('kiegeszitok/bizonylatnaplo', 'track, egy bejegyzés, egyeztetés', async () => {
    const journal = createJournal(memoryJournal())
    const { tarca } = docsClient({
      hooks: { onDocument: (event) => journal.record(event), onDocumentError: 'throw' },
    })
    const vendorId = 'ORDER-1001'

    await journal.track(vendorId, () =>
      tarca.documents.createOnce({
        vendorId,
        partner: BUYER,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
      }),
    )
    const bejegyzesek = await journal.entries({ from: '2026-11-01', to: '2026-11-30' })
    const egyeztetes = await journal.reconcile(tarca, { from: '2026-11-01', to: '2026-11-30' })

    expect(
      bejegyzesek.map((bejegyzes) => [bejegyzes.number, bejegyzes.grossTotal, bejegyzes.source]),
    ).toEqual([['2026-1', 190_500, 'hook']])
    expect([egyeztetes.matched, egyeztetes.missing.length]).toEqual([1, 0])
    expect(await journal.pending()).toEqual([])
  })

  docsExample(
    'kiegeszitok/bizonylatnaplo',
    'kvJournal: settle a függő foglalásra, reconcile pótol',
    async () => {
      const store: KeyValueStore = memoryStore()
      const journal = createJournal(kvJournal(store))
      const { tarca, billingo } = docsClient({
        hooks: { onDocument: (event) => journal.record(event), onDocumentError: 'throw' },
      })
      await journal.reserve('ORDER-1001')
      billingo.fail('network', { operation: 'CreateDocument', afterSuccess: true })
      await tarca.documents.create(SZAMLA).catch(() => undefined)

      const lezaras = await journal.settle(tarca)
      const kezzel = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch })
      await kezzel.documents.create({ ...SZAMLA, vendorId: 'ORDER-1002' })
      const egyeztetes = await journal.reconcile(tarca, { from: '2026-10-01', to: '2026-11-30' })

      expect(lezaras.recorded.map((entry) => entry.vendorId)).toEqual(['ORDER-1001'])
      expect((await journal.entries({ from: '2026-11-01', to: '2026-11-30' }))[0]?.source).toBe(
        'settle',
      )
      expect(egyeztetes.added.map((entry) => entry.number)).toEqual(['2026-2'])
      expect(egyeztetes.matched).toBe(1)
      expect(() =>
        kvJournal({ get: async () => undefined, set: async () => {}, delete: async () => {} }),
      ).toThrow(expect.objectContaining({ category: 'configuration' }))
    },
  )
})

describe('kiegeszitok/tomeges-szamlazas', () => {
  docsExample(
    'kiegeszitok/tomeges-szamlazas',
    'próbafutás, kiállítás, újrafuttatás dupla nélkül',
    async () => {
      const { tarca, billingo } = docsClient()
      const elofizetesek = [
        { id: 1, ar: 15_000 },
        { id: 2, ar: 25_000 },
      ]
      const idoszak = billingPeriodAt({ interval: 'month', anchor: '2026-01-01' }, '2026-11-16')
      const tetelek = elofizetesek.map((elofizetes) => ({
        key: `SUB-${elofizetes.id}-${idoszak.start}`,
        document: () => ({
          kind: 'invoice' as const,
          input: {
            partner: BUYER,
            items: [{ name: 'Havi előfizetés', quantity: 1, netUnitPrice: elofizetes.ar, vat: 27 }],
            fulfillmentDate: idoszak.end,
          },
        }),
      }))

      const proba = await runBatch(tarca, { items: tetelek, dryRun: true, ratePerMinute: 60 })
      expect(billingo.count('CreateDocument')).toBe(0)
      const eles = await runBatch(tarca, { items: tetelek, ratePerMinute: 60 })
      const ujra = await runBatch(tarca, { items: tetelek, ratePerMinute: 60 })

      expect([proba.validated.length, proba.grossTotals]).toEqual([2, { HUF: 50_800 }])
      expect(eles.created.map((tetel) => tetel.number)).toEqual(['2026-1', '2026-2'])
      expect(ujra.items.map((tetel) => tetel.status)).toEqual(['existing', 'existing'])
      expect(billingo.count('CreateDocument')).toBe(2)
      expect(billingo.count('CreatePartner')).toBe(1)
      expect(tetelek[0]?.key).toBe('SUB-1-2026-11-01')
    },
  )

  docsExample(
    'kiegeszitok/tomeges-szamlazas',
    'nyugta a mock kliensen, haladásjelzéssel',
    async () => {
      vi.stubEnv('NODE_ENV', 'test')
      const tarca: Tarca = process.env.NODE_ENV === 'test' ? createMockTarca() : createTarca()
      const allapotok: string[] = []

      const eredmeny = await runBatch(tarca, {
        items: [
          {
            key: 'NAP-2026-11-16-1',
            document: () => ({
              kind: 'receipt',
              input: { items: [{ name: 'Kávé', grossUnitPrice: 890, vat: 27, quantity: 2 }] },
            }),
          },
        ],
        onProgress: (allapot) =>
          allapotok.push(`${allapot.done}/${allapot.total} ${allapot.status}`),
      })

      expect(eredmeny.created.length).toBe(1)
      expect(eredmeny.grossTotals.HUF).toBeGreaterThan(0)
      expect(allapotok).toEqual(['1/1 created'])
    },
  )

  docsExample(
    'kiegeszitok/tomeges-szamlazas',
    'ismétlődő kulcs és rate_limit megállás',
    async () => {
      const { tarca, billingo } = docsClient()
      const tetel = (key: string) => ({
        key,
        document: () => ({ kind: 'invoice' as const, input: { partner: BUYER, items: ITEMS } }),
      })

      await expect(runBatch(tarca, { items: [tetel('A'), tetel('A')] })).rejects.toMatchObject({
        category: 'validation',
      })
      billingo.fail({ status: 429 }, { operation: 'CreateDocument' })
      const eredmeny = await runBatch(tarca, { items: [tetel('A'), tetel('B')], ratePerMinute: 60 })

      expect(eredmeny.stopped?.reason).toContain('rate_limit')
      expect(eredmeny.stopped?.error).toMatchObject({ category: 'rate_limit' })
      expect(eredmeny.items.map((item) => item.status)).toEqual(['failed', 'skipped'])
    },
  )
})

describe('kiegeszitok/ismetlodo-idoszakok', () => {
  docsExample(
    'kiegeszitok/ismetlodo-idoszakok',
    'hónapvégek csúszás nélkül, negyedévek',
    async () => {
      const havi = { interval: 'month', anchor: '2026-01-31', paymentDueInDays: 8 } as const

      expect(billingPeriod(havi, 1)).toEqual({
        index: 1,
        interval: 'month',
        start: '2026-02-28',
        end: '2026-03-30',
        dueDate: '2026-03-08',
        key: 'month:2026-02-28',
      })
      expect(billingPeriod(havi, 2).start).toBe('2026-03-31')
      expect(billingPeriodAt(havi, new Date('2026-03-05T10:00:00Z')).index).toBe(1)
      expect(
        billingPeriodsBetween(
          { interval: 'quarter', anchor: '2026-01-01' },
          '2026-01-01',
          '2026-12-31',
        ).map((period) => period.key),
      ).toEqual([
        'quarter:2026-01-01',
        'quarter:2026-04-01',
        'quarter:2026-07-01',
        'quarter:2026-10-01',
      ])
      expect(billingPeriod({ interval: 'month', anchor: '2028-01-31' }, 1).start).toBe('2028-02-29')
      expect(() => billingPeriod({ interval: 'day' as never, anchor: '2026-01-01' }, 0)).toThrow(
        expect.objectContaining({ category: 'validation' }),
      )
    },
  )

  docsExample(
    'kiegeszitok/ismetlodo-idoszakok',
    'számla egy időszakra, a vendorId az időszakból',
    async () => {
      const { tarca, billingo } = docsClient()
      const honap = todayPeriod(
        { interval: 'month', anchor: '2026-01-01', paymentDueInDays: 8 },
        new Date('2026-11-16T09:00:00Z'),
      )
      const input = {
        vendorId: `SUB-41-${honap.start}`,
        partner: BUYER,
        items: [
          {
            name: `Havi díj (${honap.start} – ${honap.end})`,
            quantity: 1,
            netUnitPrice: 9_900,
            vat: 27,
          },
        ],
        fulfillmentDate: honap.end,
        dueDate: honap.dueDate ?? honap.end,
      }

      const { document } = await tarca.documents.createOnce(input)
      const ujra = await tarca.documents.createOnce(input)

      expect(document.invoiceNumber).toBe('2026-1')
      expect(ujra.created).toBe(false)
      expect(billingo.data.documents.get(1)?.vendorId).toBe('SUB-41-2026-11-01')
    },
  )
})

describe('kiegeszitok/megfigyelhetoseg', () => {
  docsExample(
    'kiegeszitok/megfigyelhetoseg',
    'napló és metrikák egy kiállítás közben',
    async () => {
      const metrikak = createMetricsRegistry()
      const naplo: string[] = []
      const logger = {
        info: (_adat: unknown, uzenet: string) => naplo.push(uzenet),
        warn: (_adat: unknown, uzenet: string) => naplo.push(uzenet),
      }
      const { tarca } = docsClient({ hooks: observe({ logger, metrics: metrikak }) })

      await tarca.documents.createOnce({
        vendorId: 'WEB-1001',
        partner: BUYER,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
      })
      const sorok = metrikak
        .renderPrometheus()
        .split('\n')
        .filter(
          (sor) =>
            sor.startsWith('tarca_requests_total') || sor.startsWith('tarca_documents_total'),
        )

      expect(naplo[0]).toBe('tarca: GetDocumentByVendorId sikertelen (not_found)')
      expect(sorok).toContain('tarca_documents_total{action="created",type="invoice"} 1')
      expect(sorok).toContain(
        'tarca_requests_total{operation="CreateDocument",outcome="success"} 1',
      )
    },
  )

  docsExample(
    'kiegeszitok/megfigyelhetoseg',
    'spanok, kitakart vendorId és a /metrics válasz',
    async () => {
      const spanok: string[] = []
      const tracer: ObserveTracer = {
        startSpan(name) {
          spanok.push(name)
          const span: ObserveSpan = {
            setAttribute: () => span,
            setStatus: () => span,
            recordException: () => {},
            end: () => {},
          }
          return span
        },
      }
      const naplo: unknown[] = []
      const logger = {
        info: (adat: unknown) => naplo.push(adat),
        warn: (adat: unknown) => naplo.push(adat),
      }
      const ujBizonylatok: unknown[] = []
      const metrics = createMetricsRegistry()
      const { tarca } = docsClient({
        hooks: combineHooks(observe({ logger, tracer, metrics, refSalt: 'teszt-so' }), {
          onDocument: (event) => {
            ujBizonylatok.push(event.document.invoiceNumber)
          },
        }),
      })
      function GET(): Response {
        return new Response(metrics.renderPrometheus(), {
          headers: { 'content-type': 'text/plain; version=0.0.4' },
        })
      }

      await tarca.documents.createOnce(SZAMLA)

      expect(spanok).toContain('billingo CreateDocument')
      expect(ujBizonylatok).toEqual(['2026-1'])
      expect(JSON.stringify(naplo)).not.toContain('ORDER-1001')
      expect(naplo).toContainEqual(
        expect.objectContaining({
          event: 'tarca.document',
          vendorRef: expect.stringMatching(/^hmac:[0-9a-f]{16}$/),
        }),
      )
      expect(await GET().text()).toContain('# HELP tarca_requests_total')
      expect(() => metrics.counter('le', {}, -1)).toThrow(TypeError)
    },
  )
})

describe('kiegeszitok/node-express', () => {
  docsExample(
    'kiegeszitok/node-express',
    'Stripe webhook Node http szerveren, nyers törzzsel',
    async () => {
      const billingo = createFakeBillingoFetch()
      const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch })
      const secret = 'whsec_node'
      const hibak: unknown[] = []
      const webhook = toNodeHandler(
        stripeWebhook({
          secret,
          onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
        }),
        { onError: (error) => hibak.push(error) },
      )
      const server = createServer((request, response) => {
        if (request.url === '/webhooks/stripe') return void webhook(request, response)
        response.statusCode = 404
        response.end()
      })
      await new Promise<void>((resolve) => server.listen(0, resolve))
      const { port } = server.address() as AddressInfo
      const body = JSON.stringify({
        id: 'evt_node',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            object: 'checkout.session',
            payment_intent: 'pi_node',
            payment_status: 'paid',
            amount_total: 1_270_000,
            currency: 'huf',
          },
        },
      })
      const time = Math.floor(Date.now() / 1000)
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const signature = new Uint8Array(
        await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${body}`)),
      )
      const hex = [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')

      try {
        const valasz = await fetch(`http://127.0.0.1:${port}/webhooks/stripe`, {
          method: 'POST',
          headers: { 'stripe-signature': `t=${time},v1=${hex}` },
          body,
        })
        const nincs = await fetch(`http://127.0.0.1:${port}/mas`)
        expect([valasz.status, nincs.status]).toEqual([200, 404])
        expect(billingo.count('CreateReceipt')).toBe(1)
        expect(hibak).toEqual([])
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    },
  )

  docsExample(
    'kiegeszitok/node-express',
    'az express.json() után NodeBodyError és 500',
    async () => {
      const hibak: unknown[] = []
      const handler = toNodeHandler(async () => new Response('OK'), {
        onError: (error) => hibak.push(error),
      })
      const response = {
        statusCode: 0,
        headers: {} as Record<string, unknown>,
        body: undefined as Uint8Array | undefined,
        setHeader(name: string, value: string | readonly string[]) {
          this.headers[name] = value
        },
        end(chunk?: Uint8Array) {
          this.body = chunk
        },
      }

      await handler(
        {
          method: 'POST',
          url: '/webhooks/stripe',
          headers: { host: 'bolt.example.hu' },
          body: { id: 'evt' },
        },
        response,
      )

      expect(response.statusCode).toBe(500)
      expect(hibak[0]).toBeInstanceOf(NodeBodyError)
      const kovetkezo = vi.fn()
      await handler(
        { method: 'POST', url: '/x', headers: { host: 'bolt.example.hu' }, body: { id: 'evt' } },
        response,
        kovetkezo,
      )
      expect(kovetkezo).toHaveBeenCalledWith(expect.any(NodeBodyError))
    },
  )
})

describe('kiegeszitok/serverless-es-edge', () => {
  docsExample('kiegeszitok/serverless-es-edge', 'Upstash zár a közös kliensen', async () => {
    const redis = new FakeUpstash()
    const billingo = createFakeBillingoFetch()
    vi.stubEnv('BILLINGO_API_KEY', TEST_API_KEY)
    vi.stubGlobal('fetch', billingo.fetch)

    const tarca = createTarca({
      createOnceLock: upstashRedisStore(redis, { prefix: 'bolt:', timeoutMs: 2_000 }),
      timeoutMs: 15_000,
    })
    const { created } = await tarca.documents.createOnce(SZAMLA)

    expect(created).toBe(true)
    expect(redis.data.size).toBe(0)
  })

  docsExample(
    'kiegeszitok/serverless-es-edge',
    'Workers: Durable Object zár, dedupe és ledger',
    async () => {
      const billingo = createFakeBillingoFetch()
      vi.stubGlobal('fetch', billingo.fetch)
      const storage = durableObjectStorage()
      const env = {
        BILLINGO_API_KEY: TEST_API_KEY,
        STRIPE_WEBHOOK_SECRET: 'whsec_worker',
        TARCA_STORE: {
          idFromName: (name: string) => name,
          get: (_id: unknown) => ({
            fetch: (input: string, init: RequestInit) =>
              handleDurableObjectStoreRequest(storage, new Request(input, init)),
          }),
        },
      }
      let tarca: Tarca | undefined
      const worker = {
        fetch(request: Request): Promise<Response> {
          const store = durableObjectStore(env.TARCA_STORE.get(env.TARCA_STORE.idFromName('tarca')))
          tarca ??= createTarca({ apiKey: env.BILLINGO_API_KEY, createOnceLock: store })
          const kliens = tarca
          return stripeWebhook({
            secret: env.STRIPE_WEBHOOK_SECRET,
            dedupe: store,
            onPayment: (payment) => issueForPayment(kliens, payment, { vat: 27, ledger: store }),
          })(request)
        },
      }
      const body = JSON.stringify({
        id: 'evt_worker',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            object: 'checkout.session',
            payment_intent: 'pi_worker',
            payment_status: 'paid',
            amount_total: 1_270_000,
            currency: 'huf',
          },
        },
      })
      const time = Math.floor(Date.now() / 1000)
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const hex = [
        ...new Uint8Array(
          await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${body}`)),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      const keres = () =>
        worker.fetch(
          new Request('https://bolt.example.hu/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': `t=${time},v1=${hex}` },
            body,
          }),
        )

      expect((await keres()).status).toBe(200)
      expect((await keres()).status).toBe(200)
      expect(billingo.count('CreateReceipt')).toBe(1)
      expect(billingo.count('GetDocumentByVendorId')).toBe(2)
    },
  )
})
