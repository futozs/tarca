import { describe, expect, vi } from 'vitest'
import {
  type BillingoError,
  createTarca,
  isBillingoError,
  type KeyValueStore,
  nullIfNotFound,
} from '../../src/index'
import { memoryStore } from '../../src/stores/index'
import { createFakeBillingoFetch, FAKE_BILLINGO_MESSAGES } from '../../src/testing/index'
import { TEST_API_KEY } from '../helpers'
import { BUYER, docsClient, docsExample, pinDocsClock } from './helpers'

pinDocsClock()

const ITEM = [{ name: 'Webfejlesztés', quantity: 10, netUnitPrice: 15_000, vat: 27 }]
const SZAMLA = { vendorId: 'ORDER-1001', partner: BUYER, items: ITEM }

async function caught(run: () => Promise<unknown>): Promise<BillingoError> {
  const error = await run().then(
    () => undefined,
    (reason: unknown) => reason,
  )
  if (!isBillingoError(error)) throw new Error(`BillingoError helyett: ${String(error)}`)
  return error
}

describe('hibak', () => {
  docsExample('hibak', 'minden hiba BillingoError kategóriával', async () => {
    const { tarca } = docsClient({}, { apiKeys: ['masik-kulcs'] })

    const error = await caught(() => tarca.organization.get())

    expect([error.category, error.status, error.retryable]).toEqual(['auth', 401, false])
  })
})

describe('hibak/auth', () => {
  docsExample('hibak/auth', 'érvénytelen kulcsra a verifyCredentials false-t ad', async () => {
    const { tarca, billingo } = docsClient({}, { apiKeys: ['masik-kulcs'] })

    expect(await tarca.verifyCredentials()).toBe(false)
    const error = await caught(() => tarca.organization.get())
    expect(error).toMatchObject({
      category: 'auth',
      status: 401,
      apiMessage: FAKE_BILLINGO_MESSAGES.unauthorized,
      message: `A Billingo nem fogadta el az API kulcsot. (${FAKE_BILLINGO_MESSAGES.unauthorized})`,
    })
    expect(error.hint).toContain('app.billingo.hu/api-key')
    expect(billingo.count('GetOrganizationData')).toBe(2)
  })
})

describe('hibak/nav-unavailable', () => {
  docsExample(
    'hibak/nav-unavailable',
    'teszt profilon az adószám-ellenőrzés 401, nem auth',
    async () => {
      const { tarca } = docsClient()
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})

      try {
        console.log(await tarca.utils.checkTaxNumber('12345678-2-42'))
      } catch (error) {
        if (!isBillingoError(error) || error.category !== 'nav_unavailable') throw error
        console.log('Az adószám-ellenőrzés ezen a profilon nem érhető el.')
      }

      expect(log).toHaveBeenCalledWith('Az adószám-ellenőrzés ezen a profilon nem érhető el.')
      log.mockRestore()
      const error = await caught(() => tarca.utils.checkTaxNumber('12345678-2-42'))
      expect([error.status, error.apiMessage]).toEqual([
        401,
        FAKE_BILLINGO_MESSAGES.navConnectionRequired,
      ])
      expect((await caught(() => tarca.utils.checkTaxNumber('12345678'))).category).toBe(
        'validation',
      )
    },
  )
})

describe('hibak/subscription', () => {
  docsExample('hibak/subscription', '402 a kiállításra, a createOnce nem keres utána', async () => {
    const { tarca, billingo } = docsClient()
    billingo.fail(
      { status: 402, message: FAKE_BILLINGO_MESSAGES.subscription },
      { operation: 'CreateDocument' },
    )

    const error = await caught(() => tarca.documents.createOnce(SZAMLA))
    const profil = await tarca.organization.get()

    expect([error.category, error.status, error.retryable]).toEqual(['subscription', 402, false])
    expect(billingo.count('GetDocumentByVendorId')).toBe(1)
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(profil.subscription?.features).toEqual([])
  })
})

describe('hibak/forbidden', () => {
  docsExample('hibak/forbidden', 'ismeretlen bizonylat 403, a vendorId keresés null', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.findByVendorId('ORDER-1001')
    const error = await caught(() => tarca.documents.get(999_999))

    expect(szamla).toBeNull()
    expect([error.category, error.status, error.apiMessage]).toEqual([
      'forbidden',
      403,
      FAKE_BILLINGO_MESSAGES.forbidden,
    ])
    await expect(nullIfNotFound(tarca.documents.get(999_999))).rejects.toMatchObject({
      category: 'forbidden',
    })
  })
})

describe('hibak/not-found', () => {
  docsExample('hibak/not-found', 'nullIfNotFound és findByVendorId null-t ad', async () => {
    const { tarca } = docsClient()

    const partner = await nullIfNotFound(tarca.partners.get(1234))
    const szamla = await tarca.documents.findByVendorId('ORDER-1001')

    expect([partner, szamla]).toEqual([null, null])
    const error = await caught(() => tarca.documents.getByVendorId('ORDER-1001'))
    expect(error).toMatchObject({
      category: 'not_found',
      status: 404,
      apiMessage: 'Document is not found.',
      isNotFound: true,
    })
    expect((await caught(() => tarca.partners.get(1234))).apiMessage).toBe('Partner is not found.')
  })
})

describe('hibak/validation', () => {
  docsExample(
    'hibak/validation',
    'lehetetlen dátum kérés nélkül, duplikált vendorId 400',
    async () => {
      const { tarca, billingo } = docsClient()

      const helyi = await caught(() =>
        tarca.documents.create({ partner: BUYER, items: ITEM, dueDate: '2026-02-30' }),
      )
      expect(helyi.category).toBe('validation')
      expect(helyi.fieldErrors.map((item) => item.field)).toEqual(['dueDate'])
      expect(billingo.requests).toEqual([])

      await tarca.documents.create(SZAMLA)
      const duplikalt = await caught(() => tarca.documents.create(SZAMLA))
      expect(duplikalt).toMatchObject({
        category: 'validation',
        status: 400,
        apiMessage: 'Duplicate vendor id. (id:ORDER-1001)',
      })
      expect(await tarca.documents.createOnce(SZAMLA)).toMatchObject({ created: false })
    },
  )
})

describe('hibak/rate-limit', () => {
  docsExample('hibak/rate-limit', 'a GET háromszor megy ki, utána rate_limit', async () => {
    const { tarca, billingo } = docsClient({ maxAttempts: 3, retryDelayMs: 0 })
    billingo.fail({ status: 429 }, { operation: 'ListDocument', times: 3 })

    const error = await caught(() => tarca.documents.list({ perPage: 100 }))

    expect([error.category, error.status, error.retryable]).toEqual(['rate_limit', 429, true])
    expect(billingo.count('ListDocument')).toBe(3)

    billingo.fail({ status: 429 }, { operation: 'CreateDocument' })
    expect((await caught(() => tarca.documents.create(SZAMLA))).category).toBe('rate_limit')
    expect(billingo.count('CreateDocument')).toBe(1)
  })
})

describe('hibak/server', () => {
  docsExample('hibak/server', 'GET ismétlés, írás egyszer, traceId', async () => {
    const { tarca, billingo } = docsClient()
    billingo.fail({ status: 500 }, { operation: 'GetOrganizationData', times: 2 })
    await tarca.organization.get()
    expect(billingo.count('GetOrganizationData')).toBe(3)

    billingo.fail({ status: 500 }, { operation: 'CreateDocument' })
    const error = await caught(() => tarca.documents.createOnce(SZAMLA, { recoveryDelayMs: 0 }))

    expect([error.category, error.status]).toEqual(['server', 500])
    expect(error.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(billingo.count('GetDocumentByVendorId')).toBe(3)
  })
})

describe('hibak/not-ready', () => {
  docsExample('hibak/not-ready', 'maxWaitMs: 0 mellett egy kérés, utána not_ready', async () => {
    const { tarca, billingo } = docsClient()
    await tarca.documents.create(SZAMLA)
    billingo.fail('notReady', { operation: 'DownloadDocument' })

    const error = await caught(() => tarca.documents.pdf(1, { maxWaitMs: 0 }))

    expect(error).toMatchObject({
      category: 'not_ready',
      status: 202,
      apiMessage: FAKE_BILLINGO_MESSAGES.notReady,
      retryable: true,
    })
    expect(billingo.count('DownloadDocument')).toBe(1)
    const pdf = await tarca.documents.pdf(1, { maxWaitMs: 10_000 })
    expect(pdf.filename).toBe('2026-1.pdf')
  })

  docsExample(
    'hibak/not-ready',
    'az export várakozási idő után not_ready, az azonosítóval',
    async () => {
      const { tarca } = docsClient()

      const error = await caught(() =>
        tarca.exports.run(
          {
            queryType: 'invoice_date',
            startDate: '2026-11-01',
            endDate: '2026-11-16',
            exportType: 'simple_csv',
          },
          { maxWaitMs: 0 },
        ),
      )

      expect(error.category).toBe('not_ready')
      expect(error.message).toMatch(/[0-9a-f-]{36}/)
    },
  )
})

describe('hibak/network', () => {
  docsExample('hibak/network', 'írás után a vendorId alapján kiderül, elkészült-e', async () => {
    const { tarca, billingo } = docsClient()
    billingo.fail('network', { operation: 'CreateDocument', afterSuccess: true })
    const vendorId = 'ORDER-1001'
    let eredmeny = ''

    try {
      await tarca.documents.create({ vendorId, partner: BUYER, items: ITEM })
    } catch (error) {
      if (!isBillingoError(error) || error.category !== 'network') throw error
      const meglevo = await tarca.documents.findByVendorId(vendorId)
      eredmeny = meglevo ? `Elkészült: ${meglevo.invoiceNumber}` : 'Nem készült el.'
    }

    expect(eredmeny).toBe('Elkészült: 2026-1')
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  docsExample('hibak/network', 'a megszakított kérés nem network hiba', async () => {
    const { tarca } = docsClient()
    const controller = new AbortController()
    controller.abort()

    const error = await tarca.organization
      .get({ signal: controller.signal })
      .catch((reason) => reason)

    expect(isBillingoError(error)).toBe(false)
    expect(error).toMatchObject({ name: 'AbortError' })
  })
})

describe('hibak/timeout', () => {
  docsExample(
    'hibak/timeout',
    'elveszett válasz időtúllépésnél, a createOnce megtalálja',
    async () => {
      const { tarca, billingo } = docsClient({ timeoutMs: 15_000 })
      billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })

      const { document, created } = await tarca.documents.createOnce(SZAMLA, { recoveryDelayMs: 0 })

      expect([document.invoiceNumber, created]).toEqual(['2026-1', true])
      billingo.fail('timeout', { operation: 'CreateDocument' })
      const error = await caught(() => tarca.documents.create({ partner: BUYER, items: ITEM }))
      expect([error.category, error.message]).toEqual([
        'timeout',
        'A Billingo nem válaszolt 15000 ms alatt.',
      ])
    },
  )
})

describe('hibak/configuration', () => {
  docsExample(
    'hibak/configuration',
    'érvénytelen beállítás már a createTarca() hívásakor',
    async () => {
      vi.stubEnv('BILLINGO_API_KEY', TEST_API_KEY)
      const hibak: string[] = []
      try {
        createTarca({ timeoutMs: 0 })
      } catch (error) {
        if (!isBillingoError(error) || error.category !== 'configuration') throw error
        hibak.push(error.message)
      }

      expect(hibak).toEqual([
        'A timeoutMs értéke 1 és 2147483647 közötti egész szám (ezredmásodperc) legyen, kapott: 0',
      ])
      expect(() => createTarca({ apiKey: 'x', maxAttempts: 0 })).toThrow(
        expect.objectContaining({ category: 'configuration' }),
      )
      vi.unstubAllEnvs()
      vi.stubEnv('BILLINGO_API_KEY', '')
      expect(() => createTarca()).toThrow(
        'Hiányzik a Billingo API kulcs. Add meg az apiKey opciót, vagy állítsd be a BILLINGO_API_KEY környezeti változót.',
      )
      vi.unstubAllEnvs()
    },
  )
})

describe('hibak/unexpected-response', () => {
  docsExample(
    'hibak/unexpected-response',
    'HTML válasz a kiállításra, a createOnce megtalálja',
    async () => {
      const billingo = createFakeBillingoFetch()
      const proxy = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await billingo.fetch(input, init)
        const request = new Request(input, init)
        if (request.method === 'POST' && new URL(request.url).pathname === '/v3/documents') {
          return new Response('<html>Bad Gateway</html>', { status: 200 })
        }
        return response
      }) as typeof globalThis.fetch
      const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: proxy, retryDelayMs: 0 })

      const { document, created } = await tarca.documents.createOnce(SZAMLA, { recoveryDelayMs: 0 })

      expect([document.invoiceNumber, created]).toEqual(['2026-1', true])
      const error = await caught(() => tarca.documents.create({ partner: BUYER, items: ITEM }))
      expect([error.category, error.status, error.message]).toEqual([
        'unexpected_response',
        200,
        'A Billingo válasza nem értelmezhető JSON. A művelet a Billingo oldalán ettől még végrehajtódhatott: ne ismételd meg vakon, előbb ellenőrizd (például listázással vagy a vendorId-val).',
      ])
    },
  )
})

describe('hibak/in-progress', () => {
  docsExample('hibak/in-progress', 'a zárat egy másik folyamat tartja, a válasz 503', async () => {
    const billingo = createFakeBillingoFetch()
    const store: KeyValueStore = memoryStore()
    let elengedes = (): void => {}
    const kapu = new Promise<void>((resolve) => {
      elengedes = resolve
    })
    let varakozik = false
    const lassu = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST' && new URL(request.url).pathname === '/v3/documents') {
        varakozik = true
        await kapu
      }
      return billingo.fetch(input, init)
    }) as typeof globalThis.fetch
    const masikFolyamat = createTarca({ apiKey: TEST_API_KEY, fetch: lassu, createOnceLock: store })
    const tarca = createTarca({
      apiKey: TEST_API_KEY,
      fetch: (input, init) => billingo.fetch(input, init),
      createOnceLock: store,
    })
    async function POST(request: Request): Promise<Response> {
      const rendeles: { id: string } = await request.json()
      try {
        await tarca.documents.createOnce(
          { vendorId: `ORDER-${rendeles.id}`, partner: BUYER, items: ITEM },
          { lockWaitMs: 0 },
        )
        return new Response('OK')
      } catch (error) {
        if (isBillingoError(error) && error.category === 'in_progress') {
          return new Response('Folyamatban', { status: 503, headers: { 'retry-after': '10' } })
        }
        throw error
      }
    }
    const keres = () =>
      POST(
        new Request('https://bolt.example.hu/rendeles', { method: 'POST', body: '{"id":"1001"}' }),
      )

    const elso = masikFolyamat.documents.createOnce(SZAMLA)
    await vi.waitFor(() => expect(varakozik).toBe(true))
    const valasz = await keres()
    elengedes()
    await elso

    expect(valasz.status).toBe(503)
    expect((await keres()).status).toBe(200)
    expect(billingo.count('CreateDocument')).toBe(1)
  })
})

describe('hibak/store-unavailable', () => {
  docsExample(
    'hibak/store-unavailable',
    'elérhetetlen zár: nincs kiállítás, proceed után van',
    async () => {
      const billingo = createFakeBillingoFetch()
      const elerhetetlen = async (): Promise<never> => {
        throw new Error('ECONNREFUSED')
      }
      const store: KeyValueStore = {
        get: elerhetetlen,
        set: elerhetetlen,
        delete: elerhetetlen,
        setIfAbsent: elerhetetlen,
      }
      const figyelmeztetesek: string[] = []
      const tarca = createTarca({
        apiKey: TEST_API_KEY,
        fetch: billingo.fetch,
        createOnceLock: store,
        hooks: { onWarning: (warning) => figyelmeztetesek.push(warning.hook) },
      })

      const error = await caught(() => tarca.documents.createOnce(SZAMLA))
      expect([error.category, billingo.count('CreateDocument')]).toEqual(['store_unavailable', 0])

      const { created } = await tarca.documents.createOnce(SZAMLA, { lockFailure: 'proceed' })
      expect(created).toBe(true)
      expect(figyelmeztetesek).toContain('createOnceLock')
    },
  )
})
