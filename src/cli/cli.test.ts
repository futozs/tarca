import { afterEach, describe, expect, test, vi } from 'vitest'
import { TEST_API_KEY } from '../../tests/helpers'
import { MCP_NOW, MODERN_META } from '../../tests/mcp'
import { createTarca } from '../client'
import { TARCA_VERSION } from '../core/version'
import { createFakeBillingoFetch, type FakeBillingo, type FakeBillingoOptions } from '../testing'
import type { CliIo } from './io'
import { runCli } from './run'

interface CliRun {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface CliOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly files?: Readonly<Record<string, string>>
  readonly stdin?: string
  readonly lines?: readonly string[]
  readonly fetch?: typeof globalThis.fetch
  readonly nodeVersion?: string
}

const TAX_CODE = '12345678-2-42'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function run(argv: readonly string[], options: CliOptions = {}): Promise<CliRun> {
  const out: string[] = []
  const err: string[] = []
  const files = options.files ?? {}
  const io: CliIo = {
    argv,
    env: { BILLINGO_API_KEY: TEST_API_KEY, ...options.env },
    nodeVersion: options.nodeVersion ?? '22.11.0',
    stdout: (text) => {
      out.push(text)
    },
    stderr: (text) => {
      err.push(text)
    },
    readFile: async (path) => {
      const content = files[path]
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
    },
    readStdin: async () => options.stdin ?? '',
    stdinLines: async function* () {
      for (const line of options.lines ?? []) yield line
    },
    fetch: options.fetch,
    now: MCP_NOW,
  }
  const code = await runCli(io)
  return { code, stdout: out.join(''), stderr: err.join('') }
}

function fake(options: FakeBillingoOptions = {}): FakeBillingo {
  return createFakeBillingoFetch({ now: MCP_NOW, taxCode: TAX_CODE, ...options })
}

function withHeaders(
  billingo: FakeBillingo,
  headers: Readonly<Record<string, string>>,
): typeof globalThis.fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await billingo.fetch(input, init)
    const merged = new Headers(response.headers)
    for (const [name, value] of Object.entries(headers)) merged.set(name, value)
    return new Response(await response.arrayBuffer(), { status: response.status, headers: merged })
  }
  return wrapped as typeof globalThis.fetch
}

function serverDate(offsetSeconds: number): string {
  return new Date(MCP_NOW().getTime() + offsetSeconds * 1000).toUTCString()
}

function clientOf(billingo: FakeBillingo) {
  return createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch, retryDelayMs: 0 })
}

const INVOICE = {
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Tanácsadás', quantity: 1, netUnitPrice: 10_000, vat: 27 }],
}

describe('tarca CLI: általános', () => {
  test('súgó, verzió és ismeretlen parancs', async () => {
    const help = await run(['help'])
    const empty = await run([])
    const version = await run(['--version'])
    const unknown = await run(['nincs-ilyen'])

    expect(help).toMatchObject({ code: 0, stdout: expect.stringContaining('doctor [--tax-code') })
    expect(help.stdout).toContain('TARCA_MCP_ALLOW_WRITE')
    expect(empty).toMatchObject({ code: 2, stderr: expect.stringContaining('Használat') })
    expect(version).toEqual({ code: 0, stdout: `${TARCA_VERSION}\n`, stderr: '' })
    expect(unknown).toMatchObject({
      code: 2,
      stderr: expect.stringContaining('Ismeretlen parancs'),
    })
  })

  test('a parancs utáni --help és -h a súgót adja kérés és kulcs nélkül, a -- utáni nem', async () => {
    const requests: string[] = []
    const fetch: typeof globalThis.fetch = async (input) => {
      requests.push(String(input))
      return new Response('{}', { status: 500 })
    }
    const doctor = await run(['doctor', '--help'], { env: { BILLINGO_API_KEY: '' }, fetch })
    const document = await run(['document', 'get', '-h'], { fetch })
    const mcp = await run(['mcp', '--allow-write', '--help'], { fetch })
    const vendor = await run(['document', 'get', '--vendor', 'x', '--', '--help'], { fetch })

    for (const help of [doctor, document, mcp]) {
      expect(help).toMatchObject({ code: 0, stderr: '' })
      expect(help.stdout).toContain('doctor [--tax-code')
    }
    expect(vendor).toMatchObject({ code: 2, stderr: expect.stringContaining('Pontosan egyet') })
    expect(requests).toEqual([])
  })

  test('ismeretlen kapcsolóra, hiányzó értékre és fölösleges argumentumra használati hibát ad', async () => {
    const unknownFlag = await run(['verify', '--gyors'])
    const missingValue = await run(['document', 'get', '--vendor'])
    const extra = await run(['verify', 'plusz'])
    const booleanValue = await run(['doctor', '--json=igen'])
    const both = await run(['doctor', '--json', '--report'])
    const flagAsValue = await run(['doctor', '--tax-code', '--json'])

    expect(unknownFlag).toMatchObject({ code: 2, stderr: expect.stringContaining('--gyors') })
    expect(missingValue).toMatchObject({ code: 2, stderr: expect.stringContaining('érték kell') })
    expect(extra).toMatchObject({ code: 2, stderr: expect.stringContaining('Fölösleges') })
    expect(booleanValue).toMatchObject({ code: 2, stderr: expect.stringContaining('nincs értéke') })
    expect(both).toMatchObject({ code: 2, stderr: expect.stringContaining('tarcajs help') })
    expect(flagAsValue).toMatchObject({
      code: 2,
      stderr: expect.stringContaining('--tax-code kapcsolóhoz érték kell'),
    })
  })

  test('a -- után minden pozicionális, így a kötőjellel kezdődő vendorId is lekérdezhető', async () => {
    const billingo = fake()
    const created = await clientOf(billingo).documents.create({ ...INVOICE, vendorId: '--WEB-1' })

    const found = await run(['document', 'get', '--vendor=--WEB-1'], { fetch: billingo.fetch })
    const positional = await run(['document', 'get', '--', '--json'], { fetch: billingo.fetch })

    expect(found.code).toBe(0)
    expect(JSON.parse(found.stdout)).toMatchObject({ id: created.id })
    expect(billingo.requests.at(-1)?.path).toContain('/documents/vendor/--WEB-1')
    expect(positional).toMatchObject({
      code: 2,
      stderr: expect.stringContaining('pozitív egész szám, kapott: --json'),
    })
  })
})

describe('tarca CLI: doctor', () => {
  test('teszt profilon minden ellenőrzés rendben, legfeljebb 3 GET-tel, kulcs és adószám nélkül', async () => {
    const billingo = fake()
    await clientOf(billingo).bankAccounts.create({
      name: 'Fő számla',
      accountNumber: '11773016-11111018',
      currency: 'HUF',
    })
    const before = billingo.requests.length

    const result = await run(['doctor', '--tax-code', TAX_CODE], {
      fetch: withHeaders(billingo, { date: serverDate(0) }),
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`tarcajs doctor ${TARCA_VERSION}`)
    expect(result.stdout).toContain('✓ Node.js 22.11.0')
    expect(result.stdout).toContain('✓ Időzóna-adatok: Europe/Budapest elérhető.')
    expect(result.stdout).toContain(`✓ API kulcs: ${TEST_API_KEY.length} karakter.`)
    expect(result.stdout).toContain('✓ Hitelesítés: a Billingo elfogadta az API kulcsot.')
    expect(result.stdout).toContain('✓ Óra: legfeljebb')
    expect(result.stdout).toContain('✓ Profil: valószínűleg fejlesztői teszt profil')
    expect(result.stdout).toContain('Az adószám egyezik a megadottal.')
    expect(result.stdout).toContain('✓ NAV: nincs kapcsolat')
    expect(result.stdout).toContain('✓ Előfizetés: érvényes 2026-11-17-ig.')
    expect(result.stdout).toContain('✓ Számlatömbök: 1 számla- és 1 nyugtatömb.')
    expect(result.stdout).toContain('✓ Bankszámlák: 1 (HUF).')
    expect(result.stdout).toContain('Összegzés: 0 hiba, 0 figyelmeztetés.')
    expect(result.stdout).toContain('template=used-by.yml')
    expect(result.stdout).not.toContain(TEST_API_KEY)
    expect(result.stdout).not.toContain('12345678')
    expect(result.stdout).not.toContain('11773016')
    const requests = billingo.requests.slice(before)
    expect(requests.map((entry) => entry.operation)).toEqual([
      'GetOrganizationData',
      'ListDocumentBlock',
      'ListBankAccount',
    ])
    expect(requests.every((entry) => entry.method === 'GET')).toBe(true)
  })

  test('siető órára figyelmeztet, késő órára hibát ad, Date fejléc nélkül kihagyja', async () => {
    const billingo = fake()

    const fast = await run(['doctor'], { fetch: withHeaders(billingo, { date: serverDate(-10) }) })
    const slow = await run(['doctor'], { fetch: withHeaders(billingo, { date: serverDate(120) }) })
    const none = await run(['doctor'], { fetch: billingo.fetch })

    expect(fast.code).toBe(0)
    expect(fast.stdout).toContain('! Óra: a gép órája 9,5 mp-et siet')
    expect(fast.stdout).toContain('budapesti naptári napként')
    expect(slow.code).toBe(1)
    expect(slow.stdout).toContain('✗ Óra: a gép órája 120,5 mp-et késik')
    expect(none.stdout).toContain('- Óra: a Billingo válaszában nem volt Date fejléc.')
  })

  test('hiányzó és szóközös API kulcsot jelez, a kulcsot nem írja ki', async () => {
    const billingo = fake()

    const missing = await run(['doctor'], { env: { BILLINGO_API_KEY: undefined } })
    const spaced = await run(['doctor'], {
      env: { BILLINGO_API_KEY: ` ${TEST_API_KEY} ` },
      fetch: billingo.fetch,
    })

    expect(missing).toMatchObject({
      code: 1,
      stdout: expect.stringContaining('✗ API kulcs: hiányzik a BILLINGO_API_KEY'),
    })
    expect(missing.stdout).toContain('- Hitelesítés: API kulcs nélkül nem próbálható.')
    expect(missing.stdout).toContain('Beállítások → API kulcsok')
    expect(spaced.stdout).toContain(
      `! API kulcs: ${TEST_API_KEY.length} karakter, de az elején vagy a végén szóköz van`,
    )
    expect(spaced.stdout).not.toContain(TEST_API_KEY)
  })

  test('elutasított kulcsnál és régi Node.js-nél hibát ad, a többit kihagyja', async () => {
    const strict = fake({ apiKeys: ['masik-kulcs'] })

    const rejected = await run(['doctor'], { fetch: strict.fetch })
    const oldNode = await run(['doctor'], { fetch: strict.fetch, nodeVersion: '20.18.0' })

    expect(rejected).toMatchObject({ code: 1, stdout: expect.stringContaining('elutasította') })
    expect(rejected.stdout).toContain('V3 API kulcs kell')
    expect(rejected.stdout).toContain('- Profil: sikertelen hitelesítés miatt kimaradt.')
    expect(rejected.stdout).toContain('- Számlatömbök: sikertelen hitelesítés miatt kimaradt.')
    expect(strict.requests).toHaveLength(2)
    expect(oldNode.stdout).toContain('✗ Node.js 20.18.0: a tárcához legalább Node.js 22 kell.')
  })

  test('hálózati hibánál a hitelesítési próba hibát ad, és nem ismétel', async () => {
    const billingo = fake()
    billingo.fail('network', { operation: 'GetOrganizationData', times: 3 })

    const result = await run(['doctor'], { fetch: billingo.fetch })

    expect(result).toMatchObject({
      code: 1,
      stdout: expect.stringContaining('✗ Hitelesítés: a próba nem sikerült'),
    })
    expect(billingo.count('GetOrganizationData')).toBe(1)
  })

  test('eltérő adószámra hibát ad, de egyik adószámot sem írja ki', async () => {
    const result = await run(['doctor', '--tax-code', '87654321-2-42'], { fetch: fake().fetch })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain('✗ Profil: a kulcs cégének adószáma nem egyezik')
    expect(result.stdout).not.toContain('87654321')
    expect(result.stdout).not.toContain('12345678')
  })

  test('éles profilt NAV-kapcsolatból ismer fel, NODE_ENV=test esetén figyelmeztet', async () => {
    const billingo = fake({
      hasNavConnection: true,
      subscription: { expirationDate: '2027-06-30', features: ['api_limit_standard'] },
    })

    const result = await run(['doctor'], { fetch: billingo.fetch, env: { NODE_ENV: 'test' } })
    const development = await run(['doctor'], {
      fetch: billingo.fetch,
      env: { NODE_ENV: 'development' },
    })
    const production = await run(['doctor'], {
      fetch: billingo.fetch,
      env: { NODE_ENV: 'production' },
    })

    expect(result.stdout).toContain('✓ Profil: éles profil NAV-kapcsolattal')
    expect(result.stdout).toContain('API-keret: api_limit_standard')
    expect(result.stdout).toContain('! Környezet: NODE_ENV=test')
    expect(development.stdout).toContain('! Környezet: NODE_ENV=development')
    expect(production.stdout).not.toContain('Környezet')
  })

  test('lejárt előfizetésre hibát, hiányzó API-keretre és NAV nélküli éles profilra figyelmeztetést ad', async () => {
    const expired = fake({
      hasNavConnection: true,
      subscription: { expirationDate: '2026-11-01', features: ['api_limit_basic'] },
    })
    const noLimit = fake({
      subscription: { expirationDate: '2027-06-30', features: ['subscription_basic'] },
    })

    const expiredRun = await run(['doctor'], { fetch: expired.fetch })
    const noLimitRun = await run(['doctor'], { fetch: noLimit.fetch })

    expect(expiredRun.code).toBe(1)
    expect(expiredRun.stdout).toContain('✗ Előfizetés: 2026-11-01-n lejárt')
    expect(noLimitRun.code).toBe(0)
    expect(noLimitRun.stdout).toContain('! Profil: vannak előfizetett funkciók')
    expect(noLimitRun.stdout).toContain('! NAV: éles profilnak látszik')
    expect(noLimitRun.stdout).toContain(
      '„API + Tömeges” kiegészítő meglétét olvasással nem lehet bizonyítani',
    )
  })

  test('számlatömb nélkül hibát, nyugtatömb és bankszámla nélkül figyelmeztetést ad', async () => {
    const noReceipt = fake()
    await clientOf(noReceipt).documentBlocks.delete(2)
    const noInvoice = fake()
    await clientOf(noInvoice).documentBlocks.delete(1)

    const receiptRun = await run(['doctor'], { fetch: noReceipt.fetch })
    const invoiceRun = await run(['doctor'], { fetch: noInvoice.fetch })

    expect(receiptRun.code).toBe(0)
    expect(receiptRun.stdout).toContain('! Számlatömbök: 1 számla- és 0 nyugtatömb')
    expect(receiptRun.stdout).toContain('! Bankszámlák: 0.')
    expect(invoiceRun.code).toBe(1)
    expect(invoiceRun.stdout).toContain('✗ Számlatömbök: 0 számla- és 1 nyugtatömb')
  })

  test('a --defaults tömb- és bankszámla-azonosítóit a fiókban keresi', async () => {
    const billingo = fake()
    const account = await clientOf(billingo).bankAccounts.create({
      name: 'Euró',
      accountNumber: '11773016-22222222',
      currency: 'EUR',
    })
    const files = {
      'jo.json': JSON.stringify({ blockId: 1, receiptBlockId: 2, bankAccountId: account.id }),
      'rossz.json': JSON.stringify({ blockId: 2, receiptBlockId: 9, bankAccountId: 77 }),
    }

    const good = await run(['doctor', '--defaults', 'jo.json'], { fetch: billingo.fetch, files })
    const bad = await run(['doctor', '--defaults', 'rossz.json'], { fetch: billingo.fetch, files })

    expect(good.code).toBe(0)
    expect(good.stdout).toContain('✓ Bankszámlák: 1 (EUR).')
    expect(bad.code).toBe(1)
    expect(bad.stdout).toContain('a defaults.blockId (2) receipt típusú, nem invoice')
    expect(bad.stdout).toContain('a defaults.receiptBlockId (9) nincs a fiók tömbjei között')
    expect(bad.stdout).toContain('a defaults.bankAccountId (77) nincs köztük')
    expect(bad.stdout).not.toContain('22222222')
  })

  test('a lista lekérdezésének hibája figyelmeztetés, nem összeomlás', async () => {
    const billingo = fake()
    billingo.fail({ status: 500 }, { operation: 'ListBankAccount' })

    const result = await run(['doctor'], { fetch: billingo.fetch })

    expect(result.stdout).toContain('! Bankszámlák: a lekérdezés nem sikerült.')
    expect(billingo.count('ListBankAccount')).toBe(1)
  })

  test('a --json gépi kimenetet, a --report titokmentes Markdown jelentést ad', async () => {
    const billingo = fake()

    const json = await run(['doctor', '--json'], { fetch: billingo.fetch })
    const report = await run(['doctor', '--report', '--tax-code', TAX_CODE], {
      fetch: billingo.fetch,
    })

    expect(JSON.parse(json.stdout)).toMatchObject({
      checks: expect.arrayContaining([
        { id: 'auth', status: 'ok', message: expect.any(String) },
        { id: 'profile', status: 'ok', message: expect.stringContaining('teszt profil') },
      ]),
    })
    expect(report.stdout).toContain('## tarcajs doctor jelentés')
    expect(report.stdout).toContain(`- tarca: ${TARCA_VERSION}`)
    expect(report.stdout).toContain('| auth | ok |')
    expect(report.stdout).not.toContain(TEST_API_KEY)
    expect(report.stdout).not.toContain('12345678')
  })

  test('hibás futás után nem kéri a Ki használja? visszajelzést', async () => {
    const result = await run(['doctor'], { env: { BILLINGO_API_KEY: '' } })

    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('template=used-by.yml')
  })

  test('a --check-update az npm legfrissebb verzióját nézi', async () => {
    const billingo = fake()
    const withNpm = (version: string | undefined, status = 200) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith('https://registry.npmjs.org/')) {
          return new Response(JSON.stringify(version === undefined ? {} : { version }), { status })
        }
        return billingo.fetch(input, init)
      }) as typeof globalThis.fetch

    const newer = await run(['doctor', '--check-update'], { fetch: withNpm('99.0.0') })
    const same = await run(['doctor', '--check-update'], { fetch: withNpm(TARCA_VERSION) })
    const broken = await run(['doctor', '--check-update'], { fetch: withNpm(undefined) })
    const down = await run(['doctor', '--check-update'], { fetch: withNpm('1.0.0', 503) })
    const keyless = await run(['doctor', '--check-update'], {
      fetch: withNpm('99.0.0'),
      env: { BILLINGO_API_KEY: '' },
    })

    expect(newer.stdout).toContain('! Frissítés: elérhető a tarca 99.0.0')
    expect(same.stdout).toContain('✓ Frissítés: a tarca')
    expect(broken.stdout).toContain('- Frissítés: az npm nem volt elérhető')
    expect(down.stdout).toContain('HTTP 503')
    expect(keyless.stdout).toContain('! Frissítés: elérhető a tarca 99.0.0')
  })
})

describe('tarca CLI: verify és document get', () => {
  test('verify sikeres, elutasított és hiányzó kulccsal', async () => {
    const billingo = fake()
    const strict = fake({ apiKeys: ['masik-kulcs'] })

    const ok = await run(['verify'], { fetch: billingo.fetch })
    const rejected = await run(['verify'], { fetch: strict.fetch })
    const missing = await run(['verify'], { env: { BILLINGO_API_KEY: '' } })

    expect(ok).toMatchObject({ code: 0, stdout: expect.stringContaining('érvényes') })
    expect(rejected).toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Beállítások → API kulcsok'),
    })
    expect(missing).toMatchObject({ code: 1, stderr: expect.stringContaining('BILLINGO_API_KEY') })
    expect(missing.stderr).toContain('Tipp:')
  })

  test('bizonylat azonosító és vendorId alapján; ismeretlenre érthető hiba, kilépési kód 1', async () => {
    const billingo = fake()
    const document = await clientOf(billingo).documents.create({ ...INVOICE, vendorId: 'WEB-1' })

    const byId = await run(['document', 'get', String(document.id)], { fetch: billingo.fetch })
    const byVendor = await run(['document', 'get', '--vendor', 'WEB-1'], { fetch: billingo.fetch })
    const byVendorInline = await run(['document', 'get', '--vendor=WEB-1'], {
      fetch: billingo.fetch,
    })
    const unknownId = await run(['document', 'get', '999'], { fetch: billingo.fetch })
    const unknownVendor = await run(['document', 'get', '--vendor', 'NINCS'], {
      fetch: billingo.fetch,
    })

    for (const result of [byId, byVendor, byVendorInline]) {
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ id: document.id, invoiceNumber: '2026-1' })
    }
    expect(unknownId).toMatchObject({
      code: 1,
      stderr: expect.stringContaining('nem ehhez a céghez tartozik'),
    })
    expect(unknownVendor).toMatchObject({ code: 1, stderr: expect.stringContaining('vendorId') })
  })

  test('hibás bizonylat-hivatkozásra használati hibát ad', async () => {
    const none = await run(['document', 'get'])
    const both = await run(['document', 'get', '1', '--vendor', 'A'])
    const text = await run(['document', 'get', 'abc'])
    const zero = await run(['document', 'get', '0'])
    const blank = await run(['document', 'get', '--vendor', ' '])

    for (const result of [none, both, text, zero, blank]) expect(result.code).toBe(2)
    expect(both.stderr).toContain('Pontosan egyet')
    expect(text.stderr).toContain('pozitív egész')
  })

  test('a Billingo hibáját tippel és trace ID-val írja ki', async () => {
    const billingo = fake()
    billingo.fail({ status: 500 }, { operation: 'GetDocument', times: 3 })

    const result = await run(['document', 'get', '1'], { fetch: billingo.fetch })

    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining('Trace ID:') })
    expect(result.stderr).not.toContain(TEST_API_KEY)
  })
})

describe('tarca CLI: mcp', () => {
  function discover(id: number): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/list',
      params: { _meta: MODERN_META },
    })
  }

  test('stdio-n soronként válaszol, csak olvasó módban', async () => {
    const billingo = fake()

    const result = await run(['mcp'], {
      fetch: billingo.fetch,
      lines: [
        discover(1),
        '',
        '{rossz',
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      ],
    })
    const responses = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

    expect(result.code).toBe(0)
    expect(result.stderr).toContain('csak olvasás')
    expect(responses).toHaveLength(2)
    expect(responses[0]).toMatchObject({ id: 1, result: { resultType: 'complete' } })
    expect(responses[0].result.tools.map((tool: { name: string }) => tool.name)).not.toContain(
      'create_document',
    )
    expect(responses[1]).toMatchObject({ id: null, error: { code: -32700 } })
  })

  test('írás engedélyezhető kapcsolóval és környezeti változóval, kulcs nélkül figyelmeztet', async () => {
    const byFlag = await run(['mcp', '--allow-write'], { lines: [discover(1)] })
    const byEnv = await run(['mcp'], {
      env: { TARCA_MCP_ALLOW_WRITE: 'igen', BILLINGO_API_KEY: '' },
      lines: [discover(2)],
    })
    const notTruthy = await run(['mcp'], {
      env: { TARCA_MCP_ALLOW_WRITE: 'nem' },
      lines: [discover(3)],
    })

    expect(byFlag.stderr).toContain('írás engedélyezve')
    expect(byFlag.stdout).toContain('"name":"create_document"')
    expect(byEnv.stderr).toContain('írás engedélyezve')
    expect(byEnv.stderr).toContain('hiányzik a BILLINGO_API_KEY')
    expect(notTruthy.stderr).toContain('csak olvasás')
    expect(notTruthy.stdout).not.toContain('"name":"create_document"')
  })

  test('alapbeállításokat fájlból olvas és ellenőriz', async () => {
    const billingo = fake()
    const preview = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'preview_receipt',
        arguments: { electronic: false, items: [{ name: 'Kávé', grossUnitPrice: 890, vat: 27 }] },
        _meta: MODERN_META,
      },
    })
    const files = {
      'alap.json': JSON.stringify({ paymentMethod: 'bankcard', receiptBlockId: 2 }),
      'ismeretlen.json': JSON.stringify({ prefix: 'NYGT' }),
      'tipus.json': JSON.stringify({ blockId: '1' }),
      'ertek.json': JSON.stringify({ paymentMethod: 'kartya' }),
      'tartomany.json': JSON.stringify({ dueInDays: -1 }),
      'tomb.json': '[]',
      'rossz.json': '{nem json',
    }

    const result = await run(['mcp', '--defaults', 'alap.json'], {
      fetch: billingo.fetch,
      files,
      lines: [preview],
    })
    const failures = await Promise.all(
      [
        'ismeretlen.json',
        'tipus.json',
        'ertek.json',
        'tartomany.json',
        'tomb.json',
        'rossz.json',
        'nincs.json',
      ].map((file) => run(['mcp', '--defaults', file], { files })),
    )

    expect(JSON.parse(result.stdout)).toMatchObject({
      result: {
        isError: false,
        structuredContent: { paymentMethod: 'bankcard', block: { id: 2 } },
      },
    })
    expect(failures.map((entry) => entry.code)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(failures[0]?.stderr).toContain('ismeretlen mezőt tartalmaz: prefix')
    expect(failures[1]?.stderr).toContain('blockId mezője szám')
    expect(failures[2]?.stderr).toContain('paymentMethod')
    expect(failures[3]?.stderr).toContain('dueInDays')
    expect(failures[4]?.stderr).toContain('TarcaDefaults objektumot')
    expect(failures[5]?.stderr).toContain('nem érvényes JSON')
    expect(failures[6]?.stderr).toContain('nem olvasható')
  })

  test('a doctor a hibás alapbeállítást is jelzi, mielőtt a Billingót hívná', async () => {
    const billingo = fake()

    const result = await run(['doctor', '--defaults', 'alap.json'], {
      fetch: billingo.fetch,
      files: { 'alap.json': JSON.stringify({ dueInDays: -1, blockId: 0 }) },
    })

    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining('dueInDays') })
    expect(billingo.requests).toHaveLength(0)
  })

  test('a --defaults stdin-ről is olvasható', async () => {
    const result = await run(['doctor', '--defaults', '-', '--json'], {
      fetch: fake().fetch,
      stdin: JSON.stringify({ blockId: 1 }),
    })

    expect(result.code).toBe(0)
  })

  test('az mcp a stdin-t a protokollnak tartja meg: a --defaults - használati hiba', async () => {
    const readStdin = vi.fn(async () => JSON.stringify({ blockId: 1 }))
    const io: CliIo = {
      argv: ['mcp', '--defaults', '-'],
      env: { BILLINGO_API_KEY: TEST_API_KEY },
      nodeVersion: '22.11.0',
      stdout: () => {},
      stderr: (text) => {
        errors.push(text)
      },
      readFile: async () => '',
      readStdin,
      stdinLines: async function* () {},
    }
    const errors: string[] = []

    const code = await runCli(io)

    expect(code).toBe(2)
    expect(errors.join('')).toContain('--defaults -')
    expect(readStdin).not.toHaveBeenCalled()
  })
})
