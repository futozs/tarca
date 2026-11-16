import { describe, expect, vi } from 'vitest'
import {
  addBudapestDays,
  BILLINGO_OPERATIONS,
  type Billingo,
  createTarca,
  type DocumentInput,
  isBillingoError,
  isDocumentHookError,
  MAX_PER_PAGE,
  nullIfNotFound,
  type PartnerInput,
  toBillingoDate,
  toBudapestTimestamp,
  todayInBudapest,
} from '../../src/index'
import { upstashRedisStore } from '../../src/stores/index'
import { createFakeBillingoFetch } from '../../src/testing/index'
import { TEST_API_KEY } from '../helpers'
import { BUYER, docsClient, docsExample, ITEMS, pinDocsClock, sentBodies } from './helpers'

pinDocsClock()

describe('alapok', () => {
  docsExample('alapok/mi-a-tarca', 'számla createOnce-szal', async () => {
    const { tarca } = docsClient()

    const { document } = await tarca.documents.createOnce({
      vendorId: 'ORDER-1001',
      partner: BUYER,
      items: ITEMS,
    })

    expect(document.invoiceNumber).toBe('2026-1')
  })

  docsExample('alapok/hogyan-mukodik', 'egy create() négy kérése és az átalakítás', async () => {
    const { tarca, billingo } = docsClient()

    await tarca.documents.create({ partner: BUYER, items: ITEMS })

    expect(billingo.requests.map((request) => request.operation)).toEqual([
      'ListDocumentBlock',
      'ListPartner',
      'CreatePartner',
      'CreateDocument',
    ])
    expect(sentBodies(billingo, 'CreateDocument')).toEqual([
      expect.objectContaining({
        payment_method: 'wire_transfer',
        language: 'hu',
        currency: 'HUF',
        items: [expect.objectContaining({ unit_price_type: 'net', vat: '27%' })],
      }),
    ])
  })

  docsExample('alapok/hogyan-mukodik', 'a lekérdezés ismétlődik, az írás nem', async () => {
    const { tarca, billingo } = docsClient()
    billingo.fail({ status: 500 }, { operation: 'GetOrganizationData' })
    billingo.fail({ status: 500 }, { operation: 'CreatePartner' })

    await tarca.organization.get()
    const error = await tarca.partners.create(BUYER).catch((caught: unknown) => caught)

    expect(billingo.count('GetOrganizationData')).toBe(2)
    expect(billingo.count('CreatePartner')).toBe(1)
    expect(isBillingoError(error) && error.category).toBe('server')
  })

  docsExample('alapok/telepites', 'kulcs nélkül configuration hiba', async () => {
    vi.stubEnv('BILLINGO_API_KEY', '')
    try {
      expect(() => createTarca()).toThrowError(
        expect.objectContaining({ category: 'configuration' }),
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  docsExample('alapok/telepites', 'az első számla', async () => {
    const { tarca, billingo } = docsClient()

    const szamla = await tarca.documents.create({
      partner: { ...BUYER, emails: ['vevo@ceg.hu'] },
      items: ITEMS,
    })

    expect([szamla.invoiceNumber, szamla.grossTotal]).toEqual(['2026-1', 190_500])
    expect(billingo.requests).toHaveLength(4)
  })

  docsExample('alapok/telepites', 'verifyCredentials és a Workers handler', async () => {
    const billingo = createFakeBillingoFetch({ apiKeys: [TEST_API_KEY] })
    const jo = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch })
    const rossz = createTarca({ apiKey: 'rossz-kulcs', fetch: billingo.fetch })
    const worker = {
      async fetch(_request: Request, env: { BILLINGO_API_KEY: string }) {
        const tarca = createTarca({ apiKey: env.BILLINGO_API_KEY, fetch: billingo.fetch })
        return Response.json(await tarca.utils.serverTime())
      },
    }

    const valasz = await worker.fetch(new Request('https://example.hu/'), {
      BILLINGO_API_KEY: TEST_API_KEY,
    })

    expect(await jo.verifyCredentials()).toBe(true)
    expect(await rossz.verifyCredentials()).toBe(false)
    expect(await valasz.json()).toHaveProperty('timezone')
  })
})

describe('alapok/hitelesites', () => {
  docsExample('alapok/hitelesites', 'két fiók két klienssel', async () => {
    const kulcsok = { bolt: 'bolt-kulcs', etterem: 'etterem-kulcs' }
    const boltFiok = createFakeBillingoFetch({ apiKeys: [kulcsok.bolt] })
    const etteremFiok = createFakeBillingoFetch({ apiKeys: [kulcsok.bolt] })
    const bolt = createTarca({ apiKey: kulcsok.bolt, fetch: boltFiok.fetch })
    const etterem = createTarca({ apiKey: kulcsok.etterem, fetch: etteremFiok.fetch })

    const [boltRendben, etteremRendben] = await Promise.all([
      bolt.verifyCredentials(),
      etterem.verifyCredentials(),
    ])

    expect([boltRendben, etteremRendben]).toEqual([true, false])
  })

  docsExample('alapok/hitelesites', 'a kulcs nem kerül a kérésnaplóba', async () => {
    const { tarca, billingo } = docsClient()

    await tarca.organization.get()

    expect(JSON.stringify(billingo.requests)).not.toContain(TEST_API_KEY)
  })

  docsExample('alapok/hitelesites', 'a NAV hiba nem auth', async () => {
    const { tarca } = docsClient()

    const error = await tarca.utils
      .checkTaxNumber('12345678-2-42')
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && [error.status, error.category]).toEqual([
      401,
      'nav_unavailable',
    ])
  })
})

describe('alapok/teszt-profil', () => {
  docsExample('alapok/teszt-profil', 'az őr a hasNavConnection és az adószám alapján', async () => {
    const { tarca } = docsClient()
    const BILLINGO_TEST_TAX_CODE = '00000000-0-00'

    const { hasNavConnection, taxCode } = await tarca.organization.get()
    const tesztProfil = hasNavConnection === false && taxCode === BILLINGO_TEST_TAX_CODE

    expect(tesztProfil).toBe(true)
  })

  docsExample('alapok/teszt-profil', 'éles profilon az őr megállít', async () => {
    const { tarca } = docsClient({}, { hasNavConnection: true, taxCode: '12345678-2-42' })

    const { hasNavConnection, taxCode } = await tarca.organization.get()

    expect(hasNavConnection !== false || taxCode !== '00000000-0-00').toBe(true)
  })

  docsExample('alapok/teszt-profil', 'a teszt profilon másképp válaszoló végpontok', async () => {
    const { tarca } = docsClient()
    const termek = await tarca.products.create({
      name: 'Póló',
      currency: 'HUF',
      vat: '27%',
      unit: 'db',
      grossUnitPrice: 6_350,
    })

    const keszlet = await tarca.inventory
      .quantity(termek.id ?? 0)
      .catch((caught: unknown) => caught)
    const nyugta = await tarca.receipts.create({
      items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 27 }],
    })
    const blokkok = await tarca.documentBlocks.list()

    expect(isBillingoError(keszlet) && keszlet.apiMessage).toBe(
      'Automatic order processing is disabled',
    )
    expect(nyugta.kobakReceiptStatus).toBe('pending')
    expect(blokkok.data.map((blokk) => [blokk.name, blokk.type, blokk.prefix])).toEqual([
      ['Számlák', 'invoice', ''],
      ['Nyugták', 'receipt', 'NYT'],
    ])
  })
})

describe('alapok/kliens-beallitasa', () => {
  docsExample('alapok/kliens-beallitasa', 'opciókkal és onError hookkal', async () => {
    const hibak: unknown[] = []
    const billingo = createFakeBillingoFetch()
    const tarca = createTarca({
      apiKey: TEST_API_KEY,
      fetch: billingo.fetch,
      timeoutMs: 20_000,
      maxAttempts: 3,
      retryDelayMs: 0,
      defaults: { dueInDays: 15, sendEmail: true },
      hooks: {
        onError: (event) => hibak.push([event.operation, event.error.category, event.willRetry]),
      },
    })
    billingo.fail('network', { operation: 'GetOrganizationData' })

    await tarca.organization.get()

    expect(hibak).toEqual([['GetOrganizationData', 'network', true]])
  })

  docsExample('alapok/kliens-beallitasa', 'hibás opció azonnal configuration hiba', async () => {
    expect(() => createTarca({ apiKey: TEST_API_KEY, timeoutMs: -1 })).toThrowError(
      expect.objectContaining({ category: 'configuration' }),
    )
    expect(() => createTarca({ apiKey: TEST_API_KEY, maxAttempts: 1.5 })).toThrowError(
      expect.objectContaining({ category: 'configuration' }),
    )
    expect(() =>
      createTarca({ apiKey: TEST_API_KEY, defaults: { currency: 'XYZ' as never } }),
    ).toThrowError(expect.objectContaining({ category: 'configuration' }))
  })

  docsExample('alapok/kliens-beallitasa', 'a maxAttempts legfeljebb 5', async () => {
    const billingo = createFakeBillingoFetch()
    const tarca = createTarca({
      apiKey: TEST_API_KEY,
      fetch: billingo.fetch,
      maxAttempts: 9,
      retryDelayMs: 0,
    })
    billingo.fail({ status: 503 }, { operation: 'GetOrganizationData', times: 9 })

    await expect(tarca.organization.get()).rejects.toMatchObject({ category: 'server' })
    expect(billingo.count('GetOrganizationData')).toBe(5)
  })

  docsExample('alapok/kliens-beallitasa', 'lista signal-lal', async () => {
    const { tarca } = docsClient()

    const oldal = await tarca.partners.list(
      { query: 'Vevő' },
      { signal: AbortSignal.timeout(5_000) },
    )

    expect(oldal.total).toBe(0)
  })

  docsExample('alapok/kliens-beallitasa', 'a hamis Billingo mint fetch', async () => {
    const billingo = createFakeBillingoFetch()
    const tarca = createTarca({ apiKey: 'teszt-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })

    const { taxCode } = await tarca.organization.get()

    expect([taxCode, billingo.count('GetOrganizationData')]).toEqual(['00000000-0-00', 1])
  })
})

describe('alapok/alapertekek', () => {
  docsExample('alapok/alapertekek', 'minden alapérték a dróton', async () => {
    const { tarca, billingo } = docsClient({
      defaults: {
        blockId: 1,
        receiptBlockId: 2,
        bankAccountId: 1,
        paymentMethod: 'wire_transfer',
        language: 'hu',
        currency: 'HUF',
        dueInDays: 15,
        electronic: false,
        sendEmail: true,
      },
    })
    await tarca.partners.create(BUYER)
    await tarca.bankAccounts.create({
      name: 'Fő számla',
      accountNumber: '11773016-11111018',
      currency: 'HUF',
    })

    const szamla = await tarca.documents.create({ partner: 1, items: ITEMS })
    await tarca.receipts.create({ items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 27 }] })

    expect(billingo.count('ListDocumentBlock')).toBe(0)
    expect(szamla.dueDate).toBe(addBudapestDays(new Date(), 15))
    expect(sentBodies(billingo, 'CreateDocument')).toEqual([
      expect.objectContaining({
        block_id: 1,
        bank_account_id: 1,
        settings: { should_send_email: true },
      }),
    ])
    expect(sentBodies(billingo, 'CreateReceipt')).toEqual([
      expect.objectContaining({ block_id: 2, payment_method: 'wire_transfer' }),
    ])
  })

  docsExample('alapok/alapertekek', 'a tömböt egyszer keresi ki', async () => {
    const { tarca, billingo } = docsClient()

    await tarca.documents.create({ partner: BUYER, items: ITEMS })
    await tarca.documents.create({ partner: BUYER, items: ITEMS })
    await tarca.receipts.create({ items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 27 }] })

    expect(
      billingo.requests.filter((request) => request.operation === 'ListDocumentBlock'),
    ).toHaveLength(2)
    expect(sentBodies(billingo, 'CreateReceipt')).toEqual([
      expect.objectContaining({ block_id: 2, payment_method: 'cash' }),
    ])
  })

  docsExample('alapok/alapertekek', 'negatív dueInDays configuration hiba', async () => {
    let kategoria: string | undefined

    try {
      createTarca({ apiKey: TEST_API_KEY, defaults: { dueInDays: -1 } })
    } catch (error) {
      if (!isBillingoError(error)) throw error
      kategoria = error.category
    }

    expect(kategoria).toBe('configuration')
  })
})

describe('alapok/hookok', () => {
  docsExample('alapok/hookok', 'a kérés hookok és az onDocument', async () => {
    const naplo: string[] = []
    const { tarca } = docsClient({
      hooks: {
        onRequest: (event) => naplo.push(`→ ${event.operation} ${event.path} ${event.attempt}`),
        onResponse: (event) => naplo.push(`← ${event.operation} ${event.status}`),
        onDocument: (event) => {
          naplo.push(`${event.action} ${event.document.invoiceNumber} ${event.vendorId}`)
        },
      },
    })

    await tarca.documents.createOnce({ vendorId: 'ORDER-1001', partner: BUYER, items: ITEMS })

    expect(naplo).toEqual([
      '→ GetDocumentByVendorId /documents/vendor/{vendor_id} 1',
      '← GetDocumentByVendorId 404',
      '→ ListDocumentBlock /document-blocks 1',
      '← ListDocumentBlock 200',
      '→ ListPartner /partners 1',
      '← ListPartner 200',
      '→ CreatePartner /partners 1',
      '← CreatePartner 201',
      '→ CreateDocument /documents 1',
      '← CreateDocument 201',
      'created 2026-1 ORDER-1001',
    ])
  })

  docsExample(
    'alapok/hookok',
    'ismétlésnél ugyanaz a requestId, a hook hibája onWarning',
    async () => {
      const kerelmek: { requestId: string; attempt: number }[] = []
      const figyelmeztetesek: string[] = []
      const { tarca, billingo } = docsClient({
        hooks: {
          onRequest: (event) => {
            kerelmek.push({ requestId: event.requestId, attempt: event.attempt })
            throw new Error('hibás hook')
          },
          onWarning: (warning) => figyelmeztetesek.push(warning.hook),
        },
      })
      billingo.fail('timeout', { operation: 'GetOrganizationData' })

      await tarca.organization.get()

      expect(kerelmek.map((item) => item.attempt)).toEqual([1, 2])
      expect(kerelmek[0]?.requestId).toBe(kerelmek[1]?.requestId)
      expect(figyelmeztetesek).toEqual(['onRequest', 'onRequest'])
    },
  )

  docsExample('alapok/hookok', 'a helyi ellenőrzésre nem fut hook', async () => {
    const hookok: string[] = []
    const { tarca } = docsClient({
      hooks: {
        onRequest: () => hookok.push('onRequest'),
        onError: () => hookok.push('onError'),
      },
    })

    await tarca.documents.create({ partner: BUYER, items: [] }).catch(() => undefined)

    expect(hookok).toEqual([])
  })

  docsExample('alapok/hookok', 'az onDocument akciói', async () => {
    const akciok: string[] = []
    const { tarca } = docsClient({
      hooks: {
        onDocument: (event) => {
          akciok.push(`${event.action}:${event.sourceId ?? '-'}`)
        },
      },
    })
    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
    const id = szamla.id ?? 0

    await tarca.documents.copy(id)
    await tarca.documents.payments.add(id, {
      date: '2026-11-16',
      price: 1_000,
      paymentMethod: 'cash',
    })
    await tarca.documents.cancel(id)
    const again = await tarca.documents.createOnce({
      vendorId: 'ORDER-1001',
      partner: BUYER,
      items: ITEMS,
    })
    await tarca.documents.createOnce({ vendorId: 'ORDER-1001', partner: BUYER, items: ITEMS })

    expect(again.created).toBe(true)
    expect(akciok).toEqual([`created:-`, `copied:${id}`, `cancelled:${id}`, 'created:-'])
  })

  docsExample('alapok/hookok', 'onDocumentError: throw esetén DocumentHookError', async () => {
    const naploz = vi.fn(async (_szam: string) => {
      throw new Error('a napló nem érhető el')
    })
    const { tarca, billingo } = docsClient({
      hooks: {
        onDocument: async (event) => naploz(event.document.invoiceNumber ?? ''),
        onDocumentError: 'throw',
      },
    })
    await tarca.partners.create(BUYER)
    let szam: string | undefined

    try {
      await tarca.documents.createOnce({
        vendorId: 'ORDER-1001',
        partner: 1,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
      })
    } catch (error) {
      if (!isDocumentHookError(error)) throw error
      szam = error.number
    }
    const ujra = await tarca.documents.createOnce({
      vendorId: 'ORDER-1001',
      partner: 1,
      items: ITEMS,
    })

    expect(szam).toBe('2026-1')
    expect(naploz).toHaveBeenCalledWith('2026-1')
    expect(ujra.created).toBe(false)
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(naploz).toHaveBeenCalledTimes(1)
  })

  docsExample('alapok/hookok', 'onDocumentError: warn esetén a hívás sikeres', async () => {
    const figyelmeztetesek: string[] = []
    const { tarca } = docsClient({
      hooks: {
        onDocument: () => {
          throw new Error('hiba')
        },
        onWarning: (warning) => figyelmeztetesek.push(warning.hook),
      },
    })

    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })

    expect(szamla.invoiceNumber).toBe('2026-1')
    expect(figyelmeztetesek).toEqual(['onDocument'])
  })

  docsExample('alapok/hookok', 'a rateLimit csak bináris válaszon', async () => {
    const limitek: unknown[] = []
    const { tarca } = docsClient({
      hooks: { onResponse: (event) => limitek.push(event.rateLimit) },
    })
    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })

    await tarca.documents.pdf(szamla.id ?? 0)

    expect(limitek.slice(0, -1)).toEqual([undefined, undefined, undefined, undefined])
    expect(limitek.at(-1)).toMatchObject({ limit: 300 })
  })
})

describe('alapok/hibakezeles', () => {
  docsExample('alapok/hibakezeles', 'mezőhibák, kategória és tipp', async () => {
    const { tarca } = docsClient()
    const szamla: DocumentInput = {
      partner: BUYER,
      items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 1_000, vat: 12.5 }],
    }
    let mezok: string[] = []
    let kategoria: string | undefined
    let tipp: string | undefined

    try {
      await tarca.documents.create(szamla)
    } catch (error) {
      if (!isBillingoError(error)) throw error
      mezok = error.fieldErrors.map(({ field }) => field)
      kategoria = error.category
      tipp = error.hint
    }

    expect(mezok).toEqual(['items.0.vat'])
    expect(kategoria).toBe('validation')
    expect(tipp).toBe('A tárca a kérést el sem küldte a Billingónak, így semmi nem jött létre.')
  })

  docsExample('alapok/hibakezeles', 'a sandbox példája', async () => {
    const { tarca } = docsClient()
    const partner = BUYER

    const ures = await tarca.documents
      .create({ partner, items: [{ name: '', quantity: 1, netUnitPrice: 1_000, vat: 27 }] })
      .catch((caught: unknown) => caught)
    const euro = await tarca.documents
      .create({
        partner,
        currency: 'EUR',
        items: [{ name: 'Consulting', quantity: 1, netUnitPrice: 120, vat: 27 }],
      })
      .catch((caught: unknown) => caught)
    const nincs = await tarca.documents.get(999_999).catch((caught: unknown) => caught)

    expect(isBillingoError(ures) && ures.fieldErrors[0]?.field).toBe('items.0.name')
    expect(isBillingoError(euro) && euro.fieldErrors[0]?.field).toBe('conversionRate')
    expect(isBillingoError(nincs) && [nincs.status, nincs.category]).toEqual([403, 'forbidden'])
  })

  docsExample('alapok/hibakezeles', 'a Billingo három hibaformája', async () => {
    const { tarca, billingo } = docsClient()
    await tarca.documents.create({ vendorId: 'ORDER-1001', partner: BUYER, items: ITEMS })
    billingo.fail({ status: 500 }, { operation: 'GetOrganizationData', times: 3 })

    const duplikalt = await tarca.documents
      .create({ vendorId: 'ORDER-1001', partner: BUYER, items: ITEMS })
      .catch((caught: unknown) => caught)
    const szerver = await tarca.organization.get().catch((caught: unknown) => caught)
    const mezo = await tarca.documents
      .create({ partner: 999, items: ITEMS })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(duplikalt) && [duplikalt.status, duplikalt.apiMessage]).toEqual([
      400,
      'Duplicate vendor id. (id:ORDER-1001)',
    ])
    expect(isBillingoError(szerver) && [szerver.category, szerver.apiMessage]).toEqual([
      'server',
      'Internal Server Error.',
    ])
    expect(isBillingoError(szerver) && szerver.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(isBillingoError(mezo) && [mezo.status, mezo.fieldErrors]).toEqual([
      422,
      [{ field: 'partner_id', message: 'The selected partner id is invalid.' }],
    ])
  })

  docsExample('alapok/hibakezeles', 'rossz argumentum RangeError', async () => {
    const { tarca, billingo } = docsClient()

    await expect(tarca.documents.list({ page: 0 })).rejects.toBeInstanceOf(RangeError)
    await expect(tarca.documents.pdf(1, { maxWaitMs: -1 })).rejects.toBeInstanceOf(RangeError)
    await expect(tarca.documents.getByVendorId(' ')).rejects.toBeInstanceOf(RangeError)
    expect(billingo.requests).toEqual([])
  })

  docsExample('alapok/hibakezeles', 'nullIfNotFound partnerre igen, bizonylatra nem', async () => {
    const { tarca } = docsClient()

    const partner = await nullIfNotFound(tarca.partners.get(1234))
    const bizonylat = await nullIfNotFound(tarca.documents.get(1234)).catch(
      (caught: unknown) => caught,
    )

    expect(partner).toBeNull()
    expect(isBillingoError(bizonylat) && bizonylat.category).toBe('forbidden')
  })
})

describe('alapok/ujraprobalas-es-korlatok', () => {
  docsExample('alapok/ujraprobalas-es-korlatok', 'maxAttempts 5, 500 ms várakozással', async () => {
    const billingo = createFakeBillingoFetch()
    const tarca = createTarca({
      apiKey: TEST_API_KEY,
      fetch: billingo.fetch,
      maxAttempts: 5,
      retryDelayMs: 500,
    })
    billingo.fail('network', { operation: 'ListDocument' })

    const started = Date.now()
    const oldal = await tarca.documents.list({ paymentStatus: 'outstanding' })

    expect(oldal.total).toBe(0)
    expect(billingo.count('ListDocument')).toBe(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(400)
  })

  docsExample('alapok/ujraprobalas-es-korlatok', 'írást 429 után sem ismétel', async () => {
    const { tarca, billingo } = docsClient()
    billingo.fail({ status: 429 }, { operation: 'CreatePartner' })

    const error = await tarca.partners.create(BUYER).catch((caught: unknown) => caught)

    expect(isBillingoError(error) && [error.category, error.retryable]).toEqual([
      'rate_limit',
      true,
    ])
    expect(billingo.count('CreatePartner')).toBe(1)
  })

  docsExample(
    'alapok/ujraprobalas-es-korlatok',
    'a 202-t a szállítási réteg nem ismétli',
    async () => {
      const { tarca, billingo } = docsClient()
      const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
      billingo.fail('notReady', { operation: 'DownloadDocument' })

      const error = await tarca.documents
        .pdf(szamla.id ?? 0, { maxWaitMs: 0 })
        .catch((caught: unknown) => caught)

      expect(isBillingoError(error) && error.category).toBe('not_ready')
      expect(billingo.count('DownloadDocument')).toBe(1)
    },
  )
})

describe('alapok/pontosan-egyszer', () => {
  docsExample('alapok/pontosan-egyszer', 'kétszer ugyanarra a rendelésre', async () => {
    const { tarca, billingo } = docsClient()
    const input = {
      vendorId: 'RENDELES-1001',
      partner: BUYER,
      items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
    }

    const elso = await tarca.documents.createOnce(input)
    const masodik = await tarca.documents.createOnce(input)

    expect([elso.created, masodik.created]).toEqual([true, false])
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  docsExample('alapok/pontosan-egyszer', 'elveszett válasz', async () => {
    const { tarca, billingo } = docsClient()
    billingo.fail('network', { operation: 'CreateDocument', afterSuccess: true })

    const { created } = await tarca.documents.createOnce({
      vendorId: 'RENDELES-1002',
      partner: BUYER,
      items: [{ name: 'Konyhabútor', quantity: 1, netUnitPrice: 150_000, vat: 27 }],
    })

    expect(created).toBe(true)
    expect(billingo.data.documents.size).toBe(1)
  })

  docsExample('alapok/pontosan-egyszer', 'webhook kétszer, egy nyugta', async () => {
    const { tarca, billingo } = docsClient()

    async function POST(request: Request): Promise<Response> {
      const rendeles = (await request.json()) as { id: string; vevo: string; osszeg: number }
      await tarca.receipts.createOnce({
        vendorId: `ORDER-${rendeles.id}`,
        items: [{ name: 'Rendelés', grossUnitPrice: rendeles.osszeg, vat: 27 }],
        paymentMethod: 'bankcard',
      })
      return new Response(null, { status: 204 })
    }
    const esemeny = () =>
      new Request('https://example.hu/webhook', {
        method: 'POST',
        body: JSON.stringify({ id: '1001', vevo: 'Vevő Kft.', osszeg: 12_700 }),
      })

    const elso = await POST(esemeny())
    const masodik = await POST(esemeny())

    expect([elso.status, masodik.status]).toEqual([204, 204])
    expect(billingo.count('CreateReceipt')).toBe(1)
  })

  docsExample('alapok/pontosan-egyszer', 'Upstash zárral létrehozott kliens', async () => {
    const tarolo = new Map<string, string>()
    const redis = {
      get: async (key: string) => tarolo.get(key) ?? null,
      set: async (key: string, value: string) => {
        tarolo.set(key, value)
        return 'OK'
      },
      del: async (key: string) => Number(tarolo.delete(key)),
    }

    const tarca = createTarca({ apiKey: TEST_API_KEY, createOnceLock: upstashRedisStore(redis) })

    expect(typeof tarca.documents.createOnce).toBe('function')
  })

  docsExample('alapok/pontosan-egyszer', 'a vendorId sztornó után is foglalt', async () => {
    const { tarca } = docsClient()
    const input = { vendorId: 'ORDER-1001', partner: BUYER, items: ITEMS }
    const { document } = await tarca.documents.createOnce(input)
    await tarca.documents.cancel(document.id ?? 0)

    const ujra = await tarca.documents.createOnce(input)
    const uj = await tarca.documents.createOnce({ ...input, vendorId: 'ORDER-1001-2' })

    expect([ujra.created, ujra.document.cancelled]).toEqual([false, true])
    expect(uj.created).toBe(true)
  })
})

describe('alapok/lapozas', () => {
  docsExample('alapok/lapozas', 'egy oldal a Page borítékkal', async () => {
    const { tarca, billingo } = docsClient()

    const oldal = await tarca.partners.list({ query: 'Vevő', page: 2, perPage: 50 })

    expect(oldal).toMatchObject({ data: [], total: 0, currentPage: 2 })
    expect(billingo.requests[0]?.query).toEqual({ query: 'Vevő', page: '2', per_page: '50' })
    expect(MAX_PER_PAGE).toBe(100)
  })

  docsExample('alapok/lapozas', 'all() 100-as oldalakkal, a lastPage-ig', async () => {
    const { tarca, billingo } = docsClient()
    for (let index = 0; index < 3; index++) {
      await tarca.documents.create({ partner: BUYER, items: ITEMS })
    }
    const szamok: string[] = []

    for await (const invoice of tarca.documents.all({
      type: 'invoice',
      paymentStatus: 'outstanding',
    })) {
      szamok.push(invoice.invoiceNumber ?? '')
    }

    expect(szamok).toEqual(['2026-3', '2026-2', '2026-1'])
    expect(billingo.count('ListDocument')).toBe(1)
  })

  docsExample('alapok/lapozas', 'break után nincs több kérés', async () => {
    const { tarca, billingo } = docsClient()
    for (let index = 0; index < 3; index++) {
      await tarca.documents.create({ partner: BUYER, items: ITEMS })
    }

    for await (const invoice of tarca.documents.all({ perPage: 1 })) {
      if (invoice.invoiceNumber === '2026-3') break
    }

    expect(billingo.count('ListDocument')).toBe(1)
  })

  docsExample('alapok/lapozas', 'perPage 100 fölött RangeError', async () => {
    const { tarca, billingo } = docsClient()

    await expect(tarca.partners.list({ perPage: 101 })).rejects.toBeInstanceOf(RangeError)
    expect(billingo.requests).toEqual([])
  })
})

describe('alapok/datumok', () => {
  docsExample('alapok/datumok', 'Date a budapesti napra', async () => {
    expect(toBillingoDate(new Date('2026-11-15T23:30:00Z'))).toBe('2026-11-16')
    expect(new Date('2026-11-15T23:30:00Z').toISOString().slice(0, 10)).toBe('2026-11-15')
    expect(toBillingoDate('2026-11-16')).toBe('2026-11-16')
    expect(() => toBillingoDate('2026-02-30')).toThrowError(RangeError)
    expect(() => toBillingoDate('2026.11.16.')).toThrowError(RangeError)
  })

  docsExample('alapok/datumok', 'segédfüggvények', async () => {
    const ma = todayInBudapest()
    const hatarido = addBudapestDays(new Date(), 8)

    expect(ma).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(hatarido > ma).toBe(true)
    expect(toBudapestTimestamp(new Date('2026-11-15T23:30:00Z'))).toBe('2026-11-16T00:30:00+01:00')
    expect(addBudapestDays(new Date('2026-03-28T12:00:00Z'), 1)).toBe('2026-03-29')
    expect(addBudapestDays(new Date('2026-03-28T12:00:00Z'), 2)).toBe('2026-03-30')
    expect(() => addBudapestDays(new Date(), 1.5)).toThrowError(RangeError)
  })
})

describe('alapok/tipusok', () => {
  docsExample('alapok/tipusok', 'lejárt számlák a generált típusokkal', async () => {
    const { tarca } = docsClient()
    await tarca.documents.create({ partner: BUYER, items: ITEMS, dueDate: '2026-11-01' })
    await tarca.documents.create({ partner: BUYER, items: ITEMS, dueDate: '2026-12-31' })

    function lejart(szamla: Billingo.Document, ma: string): boolean {
      return szamla.paymentStatus !== 'paid' && (szamla.dueDate ?? '') < ma
    }
    const oldal = await tarca.documents.list({ paymentStatus: 'outstanding' })
    const lejartak = oldal.data.filter((szamla) => lejart(szamla, '2026-11-16'))

    expect(lejartak).toHaveLength(1)
  })

  docsExample('alapok/tipusok', 'a null cikkszám', async () => {
    const { tarca } = docsClient()

    const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
    const tetel = szamla.items?.[0]

    expect(tetel?.sku).toBeNull()
    expect(tetel?.sku != null).toBe(false)
  })

  docsExample('alapok/tipusok', 'saját bemeneti típus', async () => {
    const { tarca } = docsClient()
    const vevo: PartnerInput = BUYER

    function szamlaRendelesbol(osszeg: number): DocumentInput {
      return {
        partner: vevo,
        items: [{ name: 'Rendelés', quantity: 1, grossUnitPrice: osszeg, vat: 27 }],
      }
    }
    const szamla = await tarca.documents.create(szamlaRendelesbol(12_700))

    expect(szamla.grossTotal).toBe(12_700)
  })
})

describe('alapok/eles-elteresek', () => {
  docsExample('alapok/eles-elteresek', 'a mért státuszkódok a hamis Billingóban', async () => {
    const { tarca, billingo } = docsClient()
    const piszkozat = await tarca.documents.create({ type: 'draft', partner: BUYER, items: ITEMS })
    await tarca.documents.finalizeDraft(piszkozat.id ?? 0, { partner: BUYER, items: ITEMS })
    const id = piszkozat.id ?? 0
    await tarca.documents.copy(id)
    await tarca.documents.payments.clear(id)
    await tarca.documents.cancel(id)

    const statusz = (operation: string) =>
      billingo.requests.find((request) => request.operation === operation)?.status

    expect(statusz('CreateDocumentFromDraft')).toBe(201)
    expect(statusz('DocumentCopy')).toBe(200)
    expect(statusz('DeletePayment')).toBe(200)
    expect(statusz('CancelDocument')).toBe(200)
    expect(billingo.requests.find((r) => r.operation === 'CancelDocument')?.method).toBe('POST')
  })
})

describe('alapok/muveletek', () => {
  docsExample('alapok/muveletek', 'mind az 57 művelet, ebből 3 nem dokumentált', async () => {
    const muveletek = Object.values(BILLINGO_OPERATIONS)

    expect(muveletek).toHaveLength(57)
    expect(muveletek.filter((muvelet) => muvelet.spec === 'undocumented')).toHaveLength(3)
  })
})

describe('alapok/migracio-codingsans', () => {
  docsExample(
    'alapok/migracio-codingsans',
    'számla és összegzés a Billingo típusokkal',
    async () => {
      const { tarca } = docsClient()

      function osszeg(szamlak: readonly Billingo.Document[]): number {
        return szamlak.reduce((sum, szamla) => sum + (szamla.grossTotal ?? 0), 0)
      }
      const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })

      expect(szamla.invoiceNumber).toBe('2026-1')
      expect(osszeg((await tarca.documents.list()).data)).toBe(190_500)
    },
  )
})
