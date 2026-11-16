import { describe, expect } from 'vitest'
import { BillingoError, createTarca, isBillingoError, type Tarca } from '../../src/index'
import { createFakeBillingoFetch, createMockTarca } from '../../src/testing/index'
import { TEST_API_KEY } from '../helpers'
import { docsExample, ITEMS, pinDocsClock } from './helpers'

pinDocsClock()

const VEVO = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
}

describe('tesztek', () => {
  docsExample('tesztek', 'createOnce a mock kliensen', async () => {
    const tarca = createMockTarca()

    const { document } = await tarca.documents.createOnce({
      vendorId: 'ORDER-1001',
      partner: VEVO,
      items: ITEMS,
    })

    expect(document.invoiceNumber).toBe('2026-1')
    expect(document.grossTotal).toBe(190_500)
    expect(tarca.billingo.count('CreateDocument')).toBe(1)
  })
})

describe('tesztek/mock-tarca', () => {
  docsExample('tesztek/mock-tarca', 'hívásnapló, kérésszámláló és elveszett válasz', async () => {
    const tarca = createMockTarca({ defaults: { dueInDays: 8 } })
    async function fizetesKezelo(rendelesId: number): Promise<void> {
      await tarca.documents.createOnce({
        vendorId: `RENDELES-${rendelesId}`,
        partner: VEVO,
        items: [{ name: 'Póló', quantity: 2, grossUnitPrice: 6_350, vat: 27 }],
      })
    }

    await fizetesKezelo(1001)
    await fizetesKezelo(1001)

    expect(tarca.billingo.count('CreateDocument')).toBe(1)
    expect(tarca.calls.map((call) => call.method)).toEqual([
      'documents.createOnce',
      'documents.createOnce',
    ])

    tarca.failNext('documents.createOnce', undefined, { afterSuccess: true })
    const hiba = await fizetesKezelo(1002).catch((error: unknown) => error)
    expect(isBillingoError(hiba) && hiba.category).toBe('network')
    await fizetesKezelo(1002)

    expect(tarca.billingo.data.documents.size).toBe(2)
  })

  docsExample('tesztek/mock-tarca', 'egy rendelésre egy számla, újrafuttatáskor is', async () => {
    async function rendelesSzamlaja(tarca: Pick<Tarca, 'documents'>, rendelesId: number) {
      const { document } = await tarca.documents.createOnce({
        vendorId: `ORDER-${rendelesId}`,
        partner: VEVO,
        items: [{ name: 'Póló', quantity: 2, grossUnitPrice: 6_350, vat: 27 }],
      })
      return document.invoiceNumber
    }
    const tarca = createMockTarca({ defaults: { dueInDays: 8 } })

    expect(await rendelesSzamlaja(tarca, 1001)).toBe('2026-1')
    expect(await rendelesSzamlaja(tarca, 1001)).toBe('2026-1')
    expect(tarca.billingo.count('CreateDocument')).toBe(1)
    expect(tarca.calls.map((call) => call.method)).toEqual([
      'documents.createOnce',
      'documents.createOnce',
    ])
  })

  docsExample('tesztek/mock-tarca', 'saját hiba, ismeretlen metódus, reset', async () => {
    const tarca = createMockTarca()
    tarca.failNext(
      'organization.get',
      new BillingoError('Lejárt előfizetés.', { category: 'subscription', status: 402 }),
    )

    const hiba = await tarca.organization.get().catch((error: unknown) => error)
    expect(isBillingoError(hiba) && hiba.category).toBe('subscription')
    expect(tarca.billingo.count()).toBe(0)
    expect(() => tarca.failNext('documents.nincs' as never)).toThrow(TypeError)

    await tarca.organization.get()
    tarca.reset()
    expect(tarca.calls).toEqual([])
    expect(tarca.billingo.requests).toEqual([])
  })

  docsExample('tesztek/mock-tarca', 'credentialsValid: false esetén minden kérés 401', async () => {
    const tarca = createMockTarca({ credentialsValid: false })

    expect(await tarca.verifyCredentials()).toBe(false)
    const hiba = await tarca.organization.get().catch((error: unknown) => error)
    expect(isBillingoError(hiba) && hiba.category).toBe('auth')
  })
})

describe('tesztek/hamis-billingo', () => {
  docsExample('tesztek/hamis-billingo', 'saját kliens a hamis Billingón', async () => {
    const billingo = createFakeBillingoFetch({
      taxCode: '12345678-2-42',
      hufRates: { EUR: 390 },
      stock: { POLO: 25 },
    })
    const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch, retryDelayMs: 0 })

    const profil = await tarca.organization.get()
    const arfolyam = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' })

    expect([profil.taxCode, profil.hasNavConnection, arfolyam.rate]).toEqual([
      '12345678-2-42',
      false,
      390,
    ])
    expect(
      billingo.requests.map((request) => `${request.method} ${request.path} ${request.status}`),
    ).toEqual(['GET /organization 200', 'GET /currencies 200'])
  })

  docsExample('tesztek/hamis-billingo', 'útválasztás és alapállapot, ahogy élesben', async () => {
    const billingo = createFakeBillingoFetch()
    const kulcsNelkul = await billingo.fetch('https://api.billingo.hu/v3/organization')
    const ismeretlen = await billingo.fetch('https://api.billingo.hu/v3/nincs-ilyen')
    const rosszMetodus = await billingo.fetch('https://api.billingo.hu/v3/organization', {
      method: 'PATCH',
    })
    const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch, retryDelayMs: 0 })

    expect(kulcsNelkul.status).toBe(401)
    expect(await ismeretlen.json()).toEqual({ error: { message: '' } })
    expect(ismeretlen.status).toBe(404)
    expect(rosszMetodus.status).toBe(405)
    expect(await tarca.documents.get(99).catch((error: BillingoError) => error.status)).toBe(403)
    expect(await tarca.partners.get(99).catch((error: BillingoError) => error.status)).toBe(404)
    expect((await tarca.organization.get()).taxCode).toBe('00000000-0-00')
    const tombok = await tarca.documentBlocks.list()
    expect(tombok.data.map((block) => [block.id, block.name, block.type, block.prefix])).toEqual([
      [1, 'Számlák', 'invoice', ''],
      [2, 'Nyugták', 'receipt', 'NYT'],
    ])
  })
})

describe('tesztek/hibak-szimulalasa', () => {
  docsExample(
    'tesztek/hibak-szimulalasa',
    'GET ismétlés, írás egyszer, elveszett válasz createOnce-szal',
    async () => {
      const tarca = createMockTarca()
      const szamla = {
        partner: VEVO,
        items: [
          { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
        ],
      }

      tarca.billingo.fail('network', { operation: 'GetOrganizationData', times: 2 })
      const szervezet = await tarca.organization.get()
      expect(szervezet.taxCode).toBe('00000000-0-00')
      expect(tarca.billingo.count('GetOrganizationData')).toBe(3)

      tarca.billingo.fail({ status: 500 }, { operation: 'CreateDocument' })
      const hiba = await tarca.documents.create(szamla).catch((error: unknown) => error)
      expect(isBillingoError(hiba) && [hiba.category, hiba.status, hiba.retryable]).toEqual([
        'server',
        500,
        true,
      ])
      expect(tarca.billingo.count('CreateDocument')).toBe(1)

      tarca.billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })
      const { created, document } = await tarca.documents.createOnce({
        ...szamla,
        vendorId: 'ORDER-1001',
      })
      expect([created, document.invoiceNumber]).toEqual([true, '2026-1'])
      expect(tarca.billingo.count('CreateDocument')).toBe(2)
    },
  )

  docsExample('tesztek/hibak-szimulalasa', 'a PDF két 202 után megjön', async () => {
    const billingo = createFakeBillingoFetch()
    const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch, retryDelayMs: 0 })
    const { document } = await tarca.documents.createOnce({
      vendorId: 'ORDER-1001',
      partner: VEVO,
      items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
    })

    billingo.fail('notReady', { operation: 'DownloadDocument', times: 2 })
    const pdf = await tarca.documents.pdf(document.id ?? 0, { maxWaitMs: 10_000 })

    expect(pdf.filename).toBe('2026-1.pdf')
    expect(billingo.count('DownloadDocument')).toBe(3)
  })

  docsExample(
    'tesztek/hibak-szimulalasa',
    'státusz szerinti kategória, és a tiltott kombináció',
    async () => {
      const billingo = createFakeBillingoFetch({
        faults: [{ fault: { status: 429 }, operation: 'GetDocument' }],
      })
      const tarca = createTarca({
        apiKey: TEST_API_KEY,
        fetch: billingo.fetch,
        retryDelayMs: 0,
        maxAttempts: 1,
      })

      const hiba = await tarca.documents.get(1).catch((error: unknown) => error)

      expect(isBillingoError(hiba) && hiba.category).toBe('rate_limit')
      expect(() => billingo.fail('notReady', { afterSuccess: true })).toThrow(TypeError)
      expect(() => billingo.fail('network', { operation: 'Nincs' as never })).toThrow(TypeError)
    },
  )
})

describe('tesztek/keresek-es-allapot', () => {
  docsExample('tesztek/keresek-es-allapot', 'napló, számlálók és állapot', async () => {
    const tarca = createMockTarca()

    await tarca.documents.createOnce({
      vendorId: 'ORDER-1001',
      partner: VEVO,
      items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
    })
    const kiallitas = tarca.billingo.requests.find(
      (request) => request.operation === 'CreateDocument',
    )

    expect(tarca.billingo.counts()).toEqual({
      GetDocumentByVendorId: 1,
      ListDocumentBlock: 1,
      ListPartner: 1,
      CreatePartner: 1,
      CreateDocument: 1,
    })
    expect(kiallitas).toMatchObject({
      method: 'POST',
      path: '/documents',
      status: 201,
      faulted: false,
      body: {
        vendor_id: 'ORDER-1001',
        partner_id: 1,
        block_id: 1,
        items: [expect.objectContaining({ unit_price: 15_000, unit_price_type: 'net' })],
      },
    })
    expect(tarca.billingo.data.documents.get(1)?.vendorId).toBe('ORDER-1001')

    await tarca.documents.cancel(1)
    expect(tarca.billingo.data.documents.get(1)?.document.cancelled).toBe(true)
    expect(tarca.billingo.data.documents.get(2)?.document.type).toBe('cancellation')

    tarca.billingo.reset()
    expect(tarca.billingo.count()).toBe(0)
    expect(tarca.billingo.data.documents.size).toBe(0)
  })
})
