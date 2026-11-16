import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, vi } from 'vitest'
import { runBatch, todayPeriod } from '../../src/batch/index'
import { billingPeriod } from '../../src/batch/recurring'
import { addBudapestDays, todayInBudapest } from '../../src/core/dates'
import {
  type Billingo,
  createTarca,
  type DocumentItemInput,
  type FieldError,
  isBillingoError,
  type PartnerInput,
  type Tarca,
} from '../../src/index'
import { createTarcaMcpHandler, createTarcaMcpServer } from '../../src/mcp/index'
import { toNodeHandler, toWebRequest } from '../../src/node/index'
import {
  combineHooks,
  createMetricsRegistry,
  type MetricsRegistry,
  observe,
} from '../../src/observe/index'
import { type IssuedDocument, issueForPayment } from '../../src/payments/index'
import { stripeWebhook } from '../../src/payments/stripe'
import { fsStorage } from '../../src/storage/fs'
import {
  memoryStorage,
  r2BindingStorage,
  type StorageAdapter,
  storeDocumentPdf,
} from '../../src/storage/index'
import {
  durableObjectStore,
  handleDurableObjectStoreRequest,
  memoryStore,
} from '../../src/stores/index'
import { createFakeBillingoFetch, createMockTarca } from '../../src/testing/index'
import { BUYER, docsClient, docsExample, ITEMS, pinDocsClock, sentBodies } from './helpers'

pinDocsClock()

vi.setConfig({ testTimeout: 30_000 })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const KLIENS_ALAPERTEKEI = {
  dueInDays: 8,
  paymentMethod: 'wire_transfer',
  electronic: true,
} as const

const STRIPE_TITOK = 'whsec_receptek'

async function stripeAlairas(torzs: string, titok = STRIPE_TITOK): Promise<string> {
  const ido = Math.floor(Date.now() / 1000)
  const kulcs = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(titok),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const jel = await crypto.subtle.sign('HMAC', kulcs, new TextEncoder().encode(`${ido}.${torzs}`))
  const hex = [...new Uint8Array(jel)].map((bajt) => bajt.toString(16).padStart(2, '0')).join('')
  return `t=${ido},v1=${hex}`
}

function stripeEsemeny(
  id: string,
  type: string,
  object: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object, ...extra },
  })
}

function fizetettCheckout(paymentIntent = 'pi_3QhB7c', eventId = 'evt_1QhB7c'): string {
  return stripeEsemeny(eventId, 'checkout.session.completed', {
    id: 'cs_test_a1',
    object: 'checkout.session',
    payment_intent: paymentIntent,
    payment_status: 'paid',
    amount_total: 1_270_000,
    currency: 'huf',
    customer_details: { name: 'Vevő Kft.', email: 'vevo@example.hu' },
  })
}

async function stripeKeres(torzs: string, alairas?: string): Promise<Request> {
  return new Request('https://bolt.example.hu/api/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': alairas ?? (await stripeAlairas(torzs)) },
    body: torzs,
  })
}

function utolso<T>(tomb: readonly T[]): T | undefined {
  return tomb[tomb.length - 1]
}

describe('receptek', () => {
  describe('közös kliens', () => {
    docsExample(
      'receptek/kozos-kliens',
      'az alapértékek a számlára kerülnek, az onError a kategóriát kapja',
      async () => {
        const hibak: unknown[] = []
        const { tarca, billingo } = docsClient({
          defaults: KLIENS_ALAPERTEKEI,
          hooks: {
            onError: ({ operation, attempt, error, willRetry }) => {
              hibak.push({
                operation,
                attempt,
                category: error.category,
                status: error.status,
                traceId: error.traceId,
                willRetry,
              })
            },
          },
        })

        const { document } = await tarca.documents.createOnce({
          vendorId: 'WEB-1001',
          partner: BUYER,
          items: ITEMS,
        })
        billingo.fail({ status: 503 }, { operation: 'GetDocument' })
        await tarca.documents.get(document.id ?? 0)

        expect(sentBodies(billingo, 'CreateDocument')).toEqual([
          expect.objectContaining({
            payment_method: 'wire_transfer',
            electronic: true,
            due_date: addBudapestDays(new Date(), 8),
          }),
        ])
        expect(hibak).toContainEqual(
          expect.objectContaining({
            operation: 'GetDocument',
            category: 'server',
            status: 503,
            willRetry: true,
          }),
        )
        expect(JSON.stringify(hibak)).not.toContain('tarca-teszt-kulcs')
      },
    )

    docsExample(
      'receptek/kozos-kliens',
      'hibás alapérték és hiányzó kulcs már a létrehozáskor configuration hiba',
      async () => {
        vi.stubEnv('BILLINGO_API_KEY', '')

        const hibasAlapertek = (() => {
          try {
            createTarca({ apiKey: 'kulcs', defaults: { paymentMethod: 'atutalas' as never } })
          } catch (error) {
            return error
          }
        })()
        const hianyzoKulcs = (() => {
          try {
            createTarca({ defaults: KLIENS_ALAPERTEKEI })
          } catch (error) {
            return error
          }
        })()

        expect(isBillingoError(hibasAlapertek) && hibasAlapertek.category).toBe('configuration')
        expect(isBillingoError(hianyzoKulcs) && hianyzoKulcs.category).toBe('configuration')
      },
    )
  })

  describe('kulcs ellenőrzése induláskor', () => {
    async function ellenorizdABillingot(tarca: Tarca, eles: boolean): Promise<void> {
      if (!(await tarca.verifyCredentials())) {
        throw new Error('A Billingo nem fogadta el a BILLINGO_API_KEY kulcsot.')
      }

      const szervezet = await tarca.organization.get()
      if (eles && szervezet.hasNavConnection !== true) {
        throw new Error(
          'Éles környezet, de a Billingo profilnak nincs NAV kapcsolata (teszt profil?).',
        )
      }
      if (!eles && szervezet.hasNavConnection === true) {
        console.warn('Fejlesztői környezet, de a Billingo profil NAV-kapcsolt éles profil.')
      }

      const vartAdoszam = process.env.BILLINGO_ADOSZAM
      if (vartAdoszam && szervezet.taxCode !== vartAdoszam) {
        throw new Error('A Billingo profil adószáma nem egyezik a BILLINGO_ADOSZAM értékével.')
      }
    }

    async function register(tarca: Tarca, eles: boolean): Promise<void> {
      try {
        await ellenorizdABillingot(tarca, eles)
      } catch (error) {
        if (isBillingoError(error) && error.retryable) {
          console.warn('A Billingo induláskor nem volt elérhető', error.category, error.status)
          return
        }
        throw error
      }
    }

    docsExample(
      'receptek/kulcs-ellenorzes-indulaskor',
      'a teszt profil fejlesztésben átmegy, élesben hibát dob',
      async () => {
        const { tarca, billingo } = docsClient()
        const figyelmeztetes = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await expect(ellenorizdABillingot(tarca, false)).resolves.toBeUndefined()
        await expect(ellenorizdABillingot(tarca, true)).rejects.toThrow('teszt profil')

        expect(figyelmeztetes).not.toHaveBeenCalled()
        expect(billingo.requests.map((request) => request.operation)).toEqual([
          'GetOrganizationData',
          'GetOrganizationData',
          'GetOrganizationData',
          'GetOrganizationData',
        ])
        const szervezet = await tarca.organization.get()
        expect(szervezet).toMatchObject({
          hasNavConnection: false,
          subscription: { expirationDate: addBudapestDays(new Date(), 1), features: [] },
        })
      },
    )

    docsExample(
      'receptek/kulcs-ellenorzes-indulaskor',
      'rossz kulcs, éles profil fejlesztésben, eltérő adószám',
      async () => {
        const figyelmeztetes = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await expect(
          ellenorizdABillingot(createMockTarca({ credentialsValid: false }), false),
        ).rejects.toThrow('nem fogadta el')

        const eles = docsClient({}, { hasNavConnection: true, taxCode: '12345678-2-42' }).tarca
        await ellenorizdABillingot(eles, false)
        expect(figyelmeztetes).toHaveBeenCalledWith(
          'Fejlesztői környezet, de a Billingo profil NAV-kapcsolt éles profil.',
        )
        await expect(ellenorizdABillingot(eles, true)).resolves.toBeUndefined()

        vi.stubEnv('BILLINGO_ADOSZAM', '87654321-2-42')
        await expect(ellenorizdABillingot(eles, true)).rejects.toThrow('adószáma nem egyezik')
      },
    )

    docsExample(
      'receptek/kulcs-ellenorzes-indulaskor',
      'ha a Billingo nem érhető el, a register csak figyelmeztet',
      async () => {
        const figyelmeztetes = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const { tarca, billingo } = docsClient()
        billingo.fail({ status: 503 }, { operation: 'GetOrganizationData', times: 3 })

        await register(tarca, true)

        expect(figyelmeztetes).toHaveBeenCalledWith(
          'A Billingo induláskor nem volt elérhető',
          'server',
          503,
        )
        await expect(register(createMockTarca({ credentialsValid: false }), true)).rejects.toThrow(
          'nem fogadta el',
        )
      },
    )
  })

  describe('webshop rendelésből számla', () => {
    interface Rendeles {
      readonly id: number
      readonly szam: string
      readonly email: string
      readonly szamlazas: {
        readonly nev: string
        readonly orszag: Billingo.Country
        readonly iranyitoszam: string
        readonly varos: string
        readonly utca: string
        readonly adoszam?: string
      }
      readonly tetelek: readonly {
        readonly megnevezes: string
        readonly mennyiseg: number
        readonly bruttoEgysegar: number
      }[]
    }

    async function szamlazdARendelest(tarca: Tarca, rendeles: Rendeles) {
      const { szamlazas } = rendeles
      const { document, created } = await tarca.documents.createOnce({
        vendorId: `WEB-${rendeles.id}`,
        partner: {
          name: szamlazas.nev,
          address: {
            countryCode: szamlazas.orszag,
            postCode: szamlazas.iranyitoszam,
            city: szamlazas.varos,
            address: szamlazas.utca,
          },
          emails: [rendeles.email],
          ...(szamlazas.adoszam
            ? { taxcode: szamlazas.adoszam, taxType: 'HAS_TAX_NUMBER' as const }
            : { taxType: 'NO_TAX_NUMBER' as const }),
        },
        items: rendeles.tetelek.map((tetel) => ({
          name: tetel.megnevezes,
          quantity: tetel.mennyiseg,
          grossUnitPrice: tetel.bruttoEgysegar,
          vat: 27,
        })),
        paymentMethod: 'bankcard',
        sendEmail: true,
        orderNumber: rendeles.szam,
      })
      return { id: document.id, szamlaszam: document.invoiceNumber, created }
    }

    const RENDELES: Rendeles = {
      id: 1001,
      szam: '2026/1001',
      email: 'vevo@example.hu',
      szamlazas: {
        nev: 'Vevő Kft.',
        orszag: 'HU',
        iranyitoszam: '1111',
        varos: 'Budapest',
        utca: 'Fő utca 1.',
        adoszam: '12345678-2-42',
      },
      tetelek: [
        { megnevezes: 'Póló', mennyiseg: 2, bruttoEgysegar: 6_350 },
        { megnevezes: 'Házhozszállítás', mennyiseg: 1, bruttoEgysegar: 1_270 },
      ],
    }

    docsExample(
      'receptek/webshop-rendeles',
      'kétszer futtatva egy számla, a második futás egy GET',
      async () => {
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })

        const elso = await szamlazdARendelest(tarca, RENDELES)
        const keresekElotte = billingo.requests.length
        const masodik = await szamlazdARendelest(tarca, RENDELES)

        expect(elso).toMatchObject({
          szamlaszam: expect.stringMatching(/^\d{4}-1$/),
          created: true,
        })
        expect(masodik).toEqual({ ...elso, created: false })
        expect(billingo.requests.slice(keresekElotte).map((request) => request.operation)).toEqual([
          'GetDocumentByVendorId',
        ])
        expect(billingo.count('CreateDocument')).toBe(1)
        expect(sentBodies(billingo, 'CreateDocument')).toEqual([
          expect.objectContaining({
            vendor_id: 'WEB-1001',
            payment_method: 'bankcard',
            settings: { should_send_email: true, order_number: '2026/1001' },
          }),
        ])
        expect(sentBodies(billingo, 'CreatePartner')).toEqual([
          expect.objectContaining({
            taxcode: '12345678-2-42',
            tax_type: 'HAS_TAX_NUMBER',
            emails: ['vevo@example.hu'],
          }),
        ])
        const szamla = await tarca.documents.get(elso.id ?? 0)
        expect(szamla.grossTotal).toBe(13_970)
      },
    )

    docsExample(
      'receptek/webshop-rendeles',
      'adószám nélkül NO_TAX_NUMBER, hibás tételnél kérés nélkül kézi feldolgozás',
      async () => {
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })
        const kezi: { id: number; hibak: readonly FieldError[] }[] = []
        const mentett: number[] = []

        async function fizetettRendeles(rendeles: Rendeles): Promise<void> {
          try {
            const szamla = await szamlazdARendelest(tarca, rendeles)
            mentett.push(szamla.id ?? 0)
          } catch (error) {
            if (isBillingoError(error) && error.category === 'validation') {
              kezi.push({ id: rendeles.id, hibak: error.fieldErrors })
              return
            }
            throw error
          }
        }

        const { adoszam: _, ...maganszemely } = RENDELES.szamlazas
        await fizetettRendeles({ ...RENDELES, id: 1002, szamlazas: maganszemely })
        await fizetettRendeles({
          ...RENDELES,
          id: 1003,
          tetelek: [{ megnevezes: 'Póló', mennyiseg: 2, bruttoEgysegar: Number.NaN }],
        })

        expect(mentett).toHaveLength(1)
        expect(sentBodies(billingo, 'CreatePartner')).toEqual([
          expect.objectContaining({ tax_type: 'NO_TAX_NUMBER' }),
        ])
        expect(kezi).toEqual([
          {
            id: 1003,
            hibak: [expect.objectContaining({ field: expect.stringMatching(/^items\.0/) })],
          },
        ])
        expect(billingo.count('CreateDocument')).toBe(1)
      },
    )

    docsExample(
      'receptek/webshop-rendeles',
      'elveszett válasz után a createOnce visszakeresi a számlát',
      async () => {
        const { tarca, billingo } = docsClient(
          { defaults: KLIENS_ALAPERTEKEI },
          { navRecordDelayMs: 0 },
        )
        billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })

        const eredmeny = await tarca.documents.createOnce(
          {
            vendorId: 'WEB-1001',
            partner: BUYER,
            items: [{ name: 'Póló', quantity: 2, grossUnitPrice: 6_350, vat: 27 }],
          },
          { recoveryDelayMs: 0 },
        )

        expect(eredmeny.created).toBe(true)
        expect(billingo.count('CreateDocument')).toBe(1)
      },
    )
  })

  describe('Stripe webhook', () => {
    function stripeUtvonal(tarca: Tarca) {
      const tarolo = memoryStore()
      const ertesitesek: IssuedDocument[] = []
      const ertesitsdAKonyvelot = async (eredmeny: IssuedDocument): Promise<void> => {
        ertesitesek.push(eredmeny)
      }
      const POST = stripeWebhook({
        secret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
        apiKey: process.env.STRIPE_SECRET_KEY,
        dedupe: tarolo,
        onPayment: async (payment) => {
          const eredmeny = await issueForPayment(tarca, payment, { vat: 27, ledger: tarolo })
          if (eredmeny.kind === 'refund-proposal' || eredmeny.kind === 'refund-failed') {
            await ertesitsdAKonyvelot(eredmeny)
          }
        },
      })
      return { POST, ertesitesek }
    }

    docsExample(
      'receptek/stripe-webhook',
      'két kézbesítésből egy nyugta, hamis aláírásra 400, teljes visszatérítésre sztornó',
      async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', STRIPE_TITOK)
        const { tarca, billingo } = docsClient()
        const { POST, ertesitesek } = stripeUtvonal(tarca)
        const fizetes = fizetettCheckout()

        const elso = await POST(await stripeKeres(fizetes))
        const ujra = await POST(await stripeKeres(fizetes))
        const hamis = await POST(await stripeKeres(fizetes, await stripeAlairas('{"id":"x"}')))
        const visszaterites = await POST(
          await stripeKeres(
            stripeEsemeny(
              'evt_2QhB7c',
              'charge.refunded',
              {
                id: 'ch_1',
                object: 'charge',
                payment_intent: 'pi_3QhB7c',
                amount: 1_270_000,
                amount_refunded: 1_270_000,
                refunded: true,
                currency: 'huf',
              },
              { previous_attributes: { amount_refunded: 0, refunded: false } },
            ),
          ),
        )

        expect([elso.status, ujra.status, hamis.status, visszaterites.status]).toEqual([
          200, 200, 400, 200,
        ])
        expect(billingo.count('CreateReceipt')).toBe(1)
        expect(billingo.count('CancelDocument')).toBe(1)
        expect(sentBodies(billingo, 'CreateReceipt')).toEqual([
          expect.objectContaining({ vendor_id: 'STRIPE-pi_3QhB7c' }),
        ])
        const bizonylatok = [...billingo.data.documents.values()].map((record) => record.document)
        expect(bizonylatok.map((bizonylat) => bizonylat.type).sort()).toEqual([
          'receipt',
          'receipt_cancellation',
        ])
        expect(bizonylatok.find((bizonylat) => bizonylat.type === 'receipt')?.grossTotal).toBe(
          12_700,
        )
        expect(ertesitesek).toEqual([])
      },
    )

    docsExample(
      'receptek/stripe-webhook',
      'nyugta részleges visszatérítése a könyvelőnek megy javaslatként',
      async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', STRIPE_TITOK)
        const { tarca, billingo } = docsClient()
        const { POST, ertesitesek } = stripeUtvonal(tarca)

        await POST(await stripeKeres(fizetettCheckout('pi_4QhB7c', 'evt_3QhB7c')))
        const reszleges = await POST(
          await stripeKeres(
            stripeEsemeny(
              'evt_4QhB7c',
              'charge.refunded',
              {
                id: 'ch_2',
                object: 'charge',
                payment_intent: 'pi_4QhB7c',
                amount: 1_270_000,
                amount_refunded: 635_000,
                refunded: false,
                currency: 'huf',
              },
              { previous_attributes: { amount_refunded: 0 } },
            ),
          ),
        )

        expect(reszleges.status).toBe(200)
        expect(ertesitesek).toEqual([expect.objectContaining({ kind: 'refund-proposal' })])
        expect(billingo.count('CreateModificationDocument')).toBe(0)
      },
    )

    docsExample(
      'receptek/stripe-webhook',
      'visszatérítés a fizetés előtt 500, üres titok TypeError',
      async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', STRIPE_TITOK)
        const { tarca, billingo } = docsClient()
        const { POST } = stripeUtvonal(tarca)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)

        const korai = await POST(
          await stripeKeres(
            stripeEsemeny('evt_5QhB7c', 'charge.refunded', {
              id: 'ch_3',
              object: 'charge',
              payment_intent: 'pi_5QhB7c',
              amount: 1_270_000,
              amount_refunded: 1_270_000,
              refunded: true,
              currency: 'huf',
            }),
          ),
        )

        expect(korai.status).toBe(500)
        expect(billingo.count('CancelDocument')).toBe(0)
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
        expect(() => stripeUtvonal(tarca)).toThrow(TypeError)
      },
    )
  })

  describe('díjbekérő, majd számla fizetéskor', () => {
    const HARMINC_NAP = 30 * 24 * 60 * 60
    const BIZONYTALAN = new Set(['network', 'timeout', 'server', 'unexpected_response'])

    function dijbekeroModul(tarca: Tarca) {
      const tarolo = memoryStore()

      async function dijbekerotKuldj(
        rendelesId: number,
        vevo: PartnerInput,
        tetelek: readonly DocumentItemInput[],
      ) {
        const { document } = await tarca.documents.createOnce({
          vendorId: `DIJBEKERO-${rendelesId}`,
          type: 'proforma',
          partner: vevo,
          items: tetelek,
          sendEmail: true,
        })
        return document
      }

      async function atutalasMegerkezett(dijbekeroId: number): Promise<number> {
        const kulcs = `dijbekero-szamla:${dijbekeroId}`
        const meglevo = await tarolo.get(kulcs)
        if (meglevo && meglevo !== 'folyamatban') return Number(meglevo)

        const foglalt = await tarolo.setIfAbsent?.(kulcs, 'folyamatban', HARMINC_NAP)
        if (!foglalt) {
          throw new Error(
            `A(z) ${dijbekeroId} díjbekérő átalakítása elakadt, nézd meg a Billingóban.`,
          )
        }

        let szamla: Billingo.Document
        try {
          szamla = await tarca.documents.createFromProforma(dijbekeroId, { dueInDays: 0 })
        } catch (error) {
          if (isBillingoError(error) && !BIZONYTALAN.has(error.category)) await tarolo.delete(kulcs)
          throw error
        }
        await tarolo.set(kulcs, String(szamla.id), HARMINC_NAP)
        await tarca.documents.archive(dijbekeroId)
        return szamla.id ?? 0
      }

      return { tarolo, dijbekerotKuldj, atutalasMegerkezett }
    }

    docsExample(
      'receptek/dijbekero-fizeteskor',
      'egy díjbekérő, belőle egy fizetett számla, a díjbekérő archiválva',
      async () => {
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })
        const { dijbekerotKuldj, atutalasMegerkezett } = dijbekeroModul(tarca)

        const dijbekero = await dijbekerotKuldj(1001, BUYER, ITEMS)
        await dijbekerotKuldj(1001, BUYER, ITEMS)
        const szamlaId = await atutalasMegerkezett(dijbekero.id ?? 0)
        const ujra = await atutalasMegerkezett(dijbekero.id ?? 0)

        expect(dijbekero).toMatchObject({ type: 'proforma', invoiceNumber: '000001' })
        expect(billingo.count('CreateDocument')).toBe(1)
        expect(ujra).toBe(szamlaId)
        expect(billingo.count('CreateDocumentFromProforma')).toBe(1)
        expect(billingo.count('ArchiveDocument')).toBe(1)
        const szamla = await tarca.documents.get(szamlaId)
        expect(szamla).toMatchObject({
          type: 'invoice',
          paymentStatus: 'paid',
          grossTotal: 190_500,
        })
        expect(szamla.relatedDocuments?.map((kapcsolt) => kapcsolt.id)).toEqual([dijbekero.id])
        expect(sentBodies(billingo, 'CreateDocumentFromProforma')).toEqual([
          { fulfillment_date: todayInBudapest(), due_date: todayInBudapest() },
        ])
        const lista = await tarca.documents.list()
        expect(lista.data.map((bizonylat) => bizonylat.id)).not.toContain(dijbekero.id)
      },
    )

    docsExample(
      'receptek/dijbekero-fizeteskor',
      'elakadt foglalás után nem alakít át újra',
      async () => {
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })
        const { tarolo, dijbekerotKuldj, atutalasMegerkezett } = dijbekeroModul(tarca)
        const dijbekero = await dijbekerotKuldj(1002, BUYER, ITEMS)
        await tarolo.set(`dijbekero-szamla:${dijbekero.id}`, 'folyamatban', HARMINC_NAP)

        await expect(atutalasMegerkezett(dijbekero.id ?? 0)).rejects.toThrow('elakadt')
        expect(billingo.count('CreateDocumentFromProforma')).toBe(0)
      },
    )

    docsExample(
      'receptek/dijbekero-fizeteskor',
      'elutasított átalakítás után a foglalás feloldódik, bizonytalan hiba után megmarad',
      async () => {
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })
        const { tarolo, dijbekerotKuldj, atutalasMegerkezett } = dijbekeroModul(tarca)
        const elso = await dijbekerotKuldj(1003, BUYER, ITEMS)
        const masodik = await dijbekerotKuldj(1004, BUYER, ITEMS)

        billingo.fail({ status: 402 }, { operation: 'CreateDocumentFromProforma' })
        await expect(atutalasMegerkezett(elso.id ?? 0)).rejects.toMatchObject({
          category: 'subscription',
        })
        expect(await tarolo.get(`dijbekero-szamla:${elso.id}`)).toBeUndefined()
        const szamlaId = await atutalasMegerkezett(elso.id ?? 0)
        expect(await tarolo.get(`dijbekero-szamla:${elso.id}`)).toBe(String(szamlaId))

        billingo.fail('network', { operation: 'CreateDocumentFromProforma', afterSuccess: true })
        await expect(atutalasMegerkezett(masodik.id ?? 0)).rejects.toMatchObject({
          category: 'network',
        })
        expect(await tarolo.get(`dijbekero-szamla:${masodik.id}`)).toBe('folyamatban')
        await expect(atutalasMegerkezett(masodik.id ?? 0)).rejects.toThrow('elakadt')
        expect(billingo.count('CreateDocumentFromProforma')).toBe(3)
      },
    )
  })

  describe('részletfizetés', () => {
    interface Jovairas {
      readonly azonosito: string
      readonly datum: string
      readonly osszeg: number
    }

    async function rogzitsdAJovairast(tarca: Tarca, szamlaId: number, jovairas: Jovairas) {
      const eddigi = await tarca.documents.payments.list(szamlaId)
      const befizetesek = eddigi.some((befizetes) => befizetes.voucherNumber === jovairas.azonosito)
        ? eddigi
        : await tarca.documents.payments.add(szamlaId, {
            date: jovairas.datum,
            price: jovairas.osszeg,
            paymentMethod: 'wire_transfer',
            voucherNumber: jovairas.azonosito,
          })

      const szamla = await tarca.documents.get(szamlaId)
      const befizetve = befizetesek.reduce((osszeg, befizetes) => osszeg + befizetes.price, 0)
      return { allapot: szamla.paymentStatus, hatralek: (szamla.grossTotal ?? 0) - befizetve }
    }

    docsExample(
      'receptek/reszletfizetes',
      'két részlet 190 500 Ft-ra, az ismételt kivonat nem rögzít újra',
      async () => {
        const { tarca, billingo } = docsClient()
        const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
        const ma = todayInBudapest()

        const elso = await rogzitsdAJovairast(tarca, szamla.id ?? 0, {
          azonosito: 'K-2026-0001',
          datum: ma,
          osszeg: 50_000,
        })
        const ismetelt = await rogzitsdAJovairast(tarca, szamla.id ?? 0, {
          azonosito: 'K-2026-0001',
          datum: ma,
          osszeg: 50_000,
        })
        const masodik = await rogzitsdAJovairast(tarca, szamla.id ?? 0, {
          azonosito: 'K-2026-0002',
          datum: ma,
          osszeg: 140_500,
        })

        expect(szamla.grossTotal).toBe(190_500)
        expect(elso).toEqual({ allapot: 'partially_paid', hatralek: 140_500 })
        expect(ismetelt).toEqual(elso)
        expect(masodik).toEqual({ allapot: 'paid', hatralek: 0 })
        expect(billingo.count('UpdatePayment')).toBe(2)
        expect(utolso(sentBodies(billingo, 'UpdatePayment'))).toEqual([
          expect.objectContaining({ price: 50_000, voucher_number: 'K-2026-0001' }),
          expect.objectContaining({ price: 140_500, voucher_number: 'K-2026-0002' }),
        ])
      },
    )

    docsExample(
      'receptek/reszletfizetes',
      'hibás összeg kérés nélkül validation, a clear után outstanding',
      async () => {
        const { tarca, billingo } = docsClient()
        const szamla = await tarca.documents.create({ partner: BUYER, items: ITEMS })
        const elotte = billingo.requests.length

        const hiba = await tarca.documents.payments
          .add(szamla.id ?? 0, {
            date: todayInBudapest(),
            price: Number.NaN,
            paymentMethod: 'wire_transfer',
          })
          .catch((error: unknown) => error)
        await tarca.documents.payments.add(szamla.id ?? 0, {
          date: todayInBudapest(),
          price: 50_000,
          paymentMethod: 'wire_transfer',
        })
        await tarca.documents.payments.clear(szamla.id ?? 0)

        expect(isBillingoError(hiba) && hiba.fieldErrors.map((field) => field.field)).toEqual([
          'payment.price',
        ])
        expect(billingo.requests[elotte]?.operation).toBe('GetPayment')
        expect((await tarca.documents.get(szamla.id ?? 0)).paymentStatus).toBe('outstanding')
      },
    )
  })

  describe('pénztári nyugta', () => {
    interface Eladas {
      readonly id: string
      readonly fizetesiMod: 'cash' | 'bankcard'
      readonly tetelek: readonly {
        readonly nev: string
        readonly mennyiseg: number
        readonly ar: number
      }[]
    }

    function nyugtaUtvonal(tarca: Tarca) {
      return async function POST(request: Request): Promise<Response> {
        const eladas = (await request.json()) as Eladas
        try {
          const { document: nyugta } = await tarca.receipts.createOnce({
            vendorId: `POS-${eladas.id}`,
            items: eladas.tetelek.map((tetel) => ({
              name: tetel.nev,
              quantity: tetel.mennyiseg,
              grossUnitPrice: tetel.ar,
              vat: 27,
            })),
            paymentMethod: eladas.fizetesiMod,
          })
          const blokk = await tarca.documents.posPdf(nyugta.id ?? 0, { size: 80 })
          return new Response(blokk.bytes, {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': `inline; filename="${blokk.filename ?? 'nyugta.pdf'}"`,
            },
          })
        } catch (error) {
          if (isBillingoError(error) && error.category === 'validation') {
            return Response.json({ hibak: error.fieldErrors }, { status: 422 })
          }
          throw error
        }
      }
    }

    const ELADAS: Eladas = {
      id: 'K1-2026-0042',
      fizetesiMod: 'bankcard',
      tetelek: [
        { nev: 'Lángos', mennyiseg: 2, ar: 1_270 },
        { nev: 'Limonádé', mennyiseg: 1, ar: 635 },
      ],
    }

    const kuldes = (eladas: Eladas) =>
      new Request('https://bolt.example.hu/api/nyugta', {
        method: 'POST',
        body: JSON.stringify(eladas),
      })

    docsExample(
      'receptek/penztari-nyugta',
      '3 175 Ft-os nyugta és PDF, újraküldésre ugyanaz a nyugta',
      async () => {
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })
        const POST = nyugtaUtvonal(tarca)

        const valasz = await POST(kuldes(ELADAS))
        const ujra = await POST(kuldes(ELADAS))
        const bajtok = new Uint8Array(await valasz.arrayBuffer())

        expect(valasz.headers.get('content-type')).toBe('application/pdf')
        expect(valasz.headers.get('content-disposition')).toBe('inline; filename="NYT-2026-1.pdf"')
        expect(new TextDecoder().decode(bajtok.slice(0, 4))).toBe('%PDF')
        expect(ujra.status).toBe(200)
        expect(billingo.count('CreateReceipt')).toBe(1)
        expect(billingo.count('PosPrint')).toBe(2)
        expect(sentBodies(billingo, 'CreateReceipt')).toEqual([
          expect.objectContaining({
            vendor_id: 'POS-K1-2026-0042',
            payment_method: 'bankcard',
            electronic: true,
          }),
        ])
        const [nyugta] = [...billingo.data.documents.values()]
        expect(nyugta?.document).toMatchObject({
          type: 'receipt',
          invoiceNumber: 'NYT-2026-1',
          grossTotal: 3_175,
          paymentStatus: 'paid',
        })
        const blokk = await tarca.documents.posPdf(nyugta?.document.id ?? 0, { size: 80 })
        expect(blokk.contentType).toBe('application/octet-stream')
      },
    )

    docsExample(
      'receptek/penztari-nyugta',
      'hibás tételre 422 a hibalistával, kérés nélkül',
      async () => {
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })
        const POST = nyugtaUtvonal(tarca)

        const valasz = await POST(
          kuldes({
            ...ELADAS,
            id: 'K1-2026-0043',
            tetelek: [{ nev: 'Lángos', mennyiseg: 1, ar: Number.NaN }],
          }),
        )

        expect(valasz.status).toBe(422)
        expect(((await valasz.json()) as { hibak: unknown[] }).hibak.length).toBeGreaterThan(0)
        expect(billingo.count('CreateReceipt')).toBe(0)
        await expect(tarca.documents.posPdf(1, { size: 70 as 80 })).rejects.toMatchObject({
          category: 'validation',
        })
      },
    )
  })

  describe('PDF mentése tárhelyre', () => {
    docsExample(
      'receptek/pdf-mentese',
      'a letöltés kivárja a 202-t, és a fájlnév a Billingo fejlécéből jön',
      async () => {
        const { tarca, billingo } = docsClient()
        const { document } = await tarca.documents.createOnce({
          vendorId: 'WEB-1001',
          partner: BUYER,
          items: ITEMS,
        })
        const mappa = await mkdtemp(join(tmpdir(), 'tarca-pdf-'))
        billingo.fail('notReady', { operation: 'DownloadDocument' })

        try {
          const szamlaId = document.id ?? 0
          const pdf = await tarca.documents.pdf(szamlaId, { maxWaitMs: 30_000 })
          await writeFile(join(mappa, pdf.filename ?? `${szamlaId}.pdf`), pdf.bytes)

          expect(billingo.count('DownloadDocument')).toBe(2)
          expect(pdf.filename).toBe(`${document.invoiceNumber}.pdf`)
          const mentett = await readFile(join(mappa, `${document.invoiceNumber}.pdf`))
          expect(mentett.subarray(0, 4).toString()).toBe('%PDF')
        } finally {
          await rm(mappa, { recursive: true, force: true })
        }
      },
    )

    docsExample(
      'receptek/pdf-mentese',
      'storeDocumentPdf dátum szerinti kulccsal, azonosítóval eggyel több kéréssel',
      async () => {
        const { tarca, billingo } = docsClient()
        const tarhely = memoryStorage({ publicBaseUrl: 'https://szamlak.example.hu' })
        const mentsdAPdfet = async (bizonylat: Billingo.Document | number): Promise<string> => {
          const fajl = await storeDocumentPdf(tarca, tarhely, bizonylat)
          return fajl.key
        }
        const { document } = await tarca.documents.createOnce({
          vendorId: 'WEB-1001',
          partner: BUYER,
          items: ITEMS,
        })
        const ev = document.invoiceDate?.slice(0, 4)
        const honap = document.invoiceDate?.slice(5, 7)

        const kulcs = await mentsdAPdfet(document)
        const getElotte = billingo.count('GetDocument')
        const azonositoval = await mentsdAPdfet(document.id ?? 0)

        expect(kulcs).toBe(`szamlak/${ev}/${honap}/${document.invoiceNumber}.pdf`)
        expect(azonositoval).toBe(kulcs)
        expect(billingo.count('GetDocument')).toBe(getElotte + 1)
        expect(await tarhely.getUrl(kulcs)).toBe(`https://szamlak.example.hu/${kulcs}`)

        const piszkozat = await tarca.documents.create({
          type: 'draft',
          partner: BUYER,
          items: ITEMS,
        })
        await expect(mentsdAPdfet(piszkozat)).rejects.toMatchObject({
          name: 'StorageError',
          operation: 'key',
        })
      },
    )

    docsExample(
      'receptek/pdf-mentese',
      'webhookban a mentés a válasz után fut, lemezre az fsStorage ír',
      async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', STRIPE_TITOK)
        const { tarca } = docsClient()
        const mappa = await mkdtemp(join(tmpdir(), 'tarca-fs-'))
        const utolag: (() => Promise<unknown>)[] = []
        const after = (task: () => Promise<unknown>): void => {
          utolag.push(task)
        }

        try {
          const tarhely = fsStorage({ directory: mappa })
          const mentsdAPdfet = async (bizonylat: Billingo.Document): Promise<string> =>
            (await storeDocumentPdf(tarca, tarhely, bizonylat)).key

          const POST = stripeWebhook({
            secret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
            onPayment: async (payment) => {
              const eredmeny = await issueForPayment(tarca, payment, { vat: 27 })
              if (eredmeny.kind === 'receipt' || eredmeny.kind === 'invoice') {
                const bizonylat = eredmeny.document
                after(() =>
                  mentsdAPdfet(bizonylat).catch((error: unknown) => {
                    console.error('A PDF mentése nem sikerült', bizonylat.id, error)
                  }),
                )
              }
            },
          })

          const valasz = await POST(await stripeKeres(fizetettCheckout()))
          expect(valasz.status).toBe(200)
          expect(utolag).toHaveLength(1)
          const kulcs = await utolag[0]?.()

          expect(kulcs).toMatch(/^nyugtak\/\d{4}\/\d{2}\/NYT-2026-1\.pdf$/)
          const fajl = await readFile(join(mappa, String(kulcs)))
          expect(fajl.subarray(0, 4).toString()).toBe('%PDF')
        } finally {
          await rm(mappa, { recursive: true, force: true })
        }
      },
    )
  })

  describe('havi export', () => {
    const HONAPOK = { interval: 'month', anchor: '2020-01-01' } as const

    function exportUtvonal(tarca: Tarca, tarhely: StorageAdapter) {
      return async function GET(request: Request): Promise<Response> {
        const titok = process.env.CRON_SECRET
        if (!titok || request.headers.get('authorization') !== `Bearer ${titok}`) {
          return new Response('Nincs jogosultság', { status: 401 })
        }

        const honap = billingPeriod(HONAPOK, todayPeriod(HONAPOK).index - 1)
        try {
          const fajl = await tarca.exports.run(
            {
              queryType: 'invoice_date',
              startDate: honap.start,
              endDate: honap.end,
              exportType: 'simple_csv',
            },
            { maxWaitMs: 240_000 },
          )
          const kulcs = `exportok/${honap.start.slice(0, 7)}.csv`
          await tarhely.put(kulcs, fajl.bytes, { contentType: fajl.contentType ?? 'text/csv' })
          return Response.json({ kulcs, allapot: fajl.state, uzenet: fajl.message })
        } catch (error) {
          if (isBillingoError(error) && error.category === 'not_ready') {
            console.warn(error.message, error.hint)
            return Response.json({ hiba: error.message }, { status: 202 })
          }
          throw error
        }
      }
    }

    docsExample(
      'receptek/havi-export',
      'az előző hónap CSV-je a tárhelyre kerül, titok nélkül 401',
      async () => {
        const { tarca, billingo } = docsClient()
        const tarhely = memoryStorage()
        const GET = exportUtvonal(tarca, tarhely)
        const keres = new Request('https://bolt.example.hu/api/cron/havi-export', {
          headers: { authorization: 'Bearer undefined' },
        })

        const titokNelkul = await GET(keres)
        vi.stubEnv('CRON_SECRET', 'cron-titok')
        const rosszToken = await GET(keres)
        const valasz = await GET(
          new Request('https://bolt.example.hu/api/cron/havi-export', {
            headers: { authorization: 'Bearer cron-titok' },
          }),
        )

        const ma = todayInBudapest()
        const [ev, ho] = ma.split('-').map(Number)
        const elozo = ho === 1 ? { ev: (ev ?? 0) - 1, ho: 12 } : { ev: ev ?? 0, ho: (ho ?? 0) - 1 }
        const honapKod = `${elozo.ev}-${String(elozo.ho).padStart(2, '0')}`
        const utolsoNap = new Date(Date.UTC(elozo.ev, elozo.ho, 0)).getUTCDate()

        expect([titokNelkul.status, rosszToken.status, valasz.status]).toEqual([401, 401, 200])
        expect(await valasz.json()).toEqual({
          kulcs: `exportok/${honapKod}.csv`,
          allapot: 'success',
        })
        expect(sentBodies(billingo, 'Create')).toEqual([
          {
            query_type: 'invoice_date',
            start_date: `${honapKod}-01`,
            end_date: `${honapKod}-${utolsoNap}`,
            export_type: 'simple_csv',
          },
        ])
        const fajl = await tarhely.get?.(`exportok/${honapKod}.csv`)
        expect([...(fajl ?? []).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
        expect(tarhely.files.get(`exportok/${honapKod}.csv`)?.contentType).toBe(
          'text/csv; charset=UTF-8',
        )
      },
    )

    docsExample(
      'receptek/havi-export',
      'a futó export a poll és a download hívással folytatható',
      async () => {
        const { tarca } = docsClient()

        async function folytasdAzExportot(id: string) {
          const allapot = await tarca.exports.poll(id)
          if (allapot.state === 'success' || allapot.state === 'warning') {
            return tarca.exports.download(id)
          }
          return undefined
        }

        const { id } = await tarca.exports.create({
          queryType: 'invoice_date',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          exportType: 'simple_csv',
        })

        const elso = await folytasdAzExportot(id)
        const masodik = await folytasdAzExportot(id)

        expect(elso).toBeUndefined()
        expect(masodik?.filename).toMatch(/_export\.csv$/)
        await expect(
          tarca.exports.create({
            queryType: 'invoice_date',
            startDate: '2026-02-30',
            endDate: '2026-02-28',
            exportType: 'simple_csv',
          }),
        ).rejects.toMatchObject({ category: 'validation' })
      },
    )
  })

  describe('havi előfizetés', () => {
    interface Elofizetes {
      readonly id: number
      readonly csomag: string
      readonly havidij: number
      readonly vevo: PartnerInput
    }

    const ELOFIZETESEK: readonly Elofizetes[] = [
      { id: 41, csomag: 'Alap', havidij: 9_900, vevo: BUYER },
      {
        id: 42,
        csomag: 'Profi',
        havidij: 24_900,
        vevo: {
          name: 'Másik Vevő Bt.',
          address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 2.' },
        },
      },
    ]

    const HONAPOK = { interval: 'month', anchor: '2026-01-01' } as const

    function elofizetesUtvonal(tarca: Tarca) {
      const aktivElofizetesek = async (): Promise<readonly Elofizetes[]> => ELOFIZETESEK
      return async function GET(request: Request): Promise<Response> {
        const titok = process.env.CRON_SECRET
        if (!titok || request.headers.get('authorization') !== `Bearer ${titok}`) {
          return new Response('Nincs jogosultság', { status: 401 })
        }

        const honap = todayPeriod(HONAPOK)
        const elofizetesek = await aktivElofizetesek()

        const eredmeny = await runBatch(tarca, {
          items: elofizetesek.map((elofizetes) => ({
            key: `ELOFIZETES-${elofizetes.id}-${honap.start}`,
            document: () => ({
              kind: 'invoice' as const,
              input: {
                partner: elofizetes.vevo,
                items: [
                  {
                    name: `${elofizetes.csomag} csomag havidíja (${honap.start}–${honap.end})`,
                    quantity: 1,
                    netUnitPrice: elofizetes.havidij,
                    vat: 27,
                  },
                ],
              },
            }),
          })),
          onProgress: (allapot) => console.info('előfizetések', allapot.done, '/', allapot.total),
        })

        if (eredmeny.stopped) console.warn('A számlázás leállt:', eredmeny.stopped.reason)
        return Response.json({
          uj: eredmeny.created.length,
          meglevo: eredmeny.existing.length,
          hibas: eredmeny.failed.map((tetel) => tetel.key),
          kihagyott: eredmeny.skipped.length,
          brutto: eredmeny.grossTotals,
        })
      }
    }

    docsExample(
      'receptek/havi-elofizetes',
      'próbafuttatás, kiállítás, majd újrafuttatás duplikáció nélkül',
      async () => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined)
        vi.stubEnv('CRON_SECRET', 'cron-titok')
        const { tarca, billingo } = docsClient({ defaults: KLIENS_ALAPERTEKEI })
        const GET = elofizetesUtvonal(tarca)
        const honap = todayPeriod({ interval: 'month', anchor: '2026-01-01' })
        const keres = () =>
          new Request('https://bolt.example.hu/api/cron/elofizetesek', {
            headers: { authorization: 'Bearer cron-titok' },
          })

        const proba = await runBatch(tarca, {
          dryRun: true,
          defaults: KLIENS_ALAPERTEKEI,
          items: ELOFIZETESEK.map((elofizetes) => ({
            key: `ELOFIZETES-${elofizetes.id}-${honap.start}`,
            document: () => ({
              kind: 'invoice' as const,
              input: {
                partner: elofizetes.vevo,
                items: [
                  {
                    name: elofizetes.csomag,
                    quantity: 1,
                    netUnitPrice: elofizetes.havidij,
                    vat: 27,
                  },
                ],
              },
            }),
          })),
        })
        const elso = await (await GET(keres())).json()
        const ujra = await (await GET(keres())).json()

        expect(proba.validated).toHaveLength(2)
        expect(proba.grossTotals).toEqual({ HUF: 44_196 })
        expect(elso).toEqual({
          uj: 2,
          meglevo: 0,
          hibas: [],
          kihagyott: 0,
          brutto: { HUF: 44_196 },
        })
        expect(ujra).toMatchObject({ uj: 0, meglevo: 2 })
        expect(billingo.count('CreateDocument')).toBe(2)
        expect(sentBodies(billingo, 'CreateDocument')).toContainEqual(
          expect.objectContaining({ vendor_id: `ELOFIZETES-41-${honap.start}` }),
        )
        expect(honap.start).toMatch(/-01$/)
      },
    )

    docsExample('receptek/havi-elofizetes', 'titok nélkül 401, és nem számláz', async () => {
      const { tarca, billingo } = docsClient()
      const GET = elofizetesUtvonal(tarca)

      const valasz = await GET(new Request('https://bolt.example.hu/api/cron/elofizetesek'))

      expect(valasz.status).toBe(401)
      expect(billingo.requests).toEqual([])
    })
  })

  describe('Express, NestJS, Fastify', () => {
    function stripeKezelo(tarca: Tarca) {
      return stripeWebhook({
        secret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
        onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27 }),
      })
    }

    docsExample(
      'receptek/express-nestjs-fastify',
      'Node http szerveren a nyers törzs aláírása ellenőrizhető',
      async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', STRIPE_TITOK)
        const { tarca, billingo } = docsClient()
        const webhook = stripeKezelo(tarca)
        const hibak: unknown[] = []
        const kezelo = toNodeHandler(webhook, { onError: (error) => hibak.push(error) })
        const szerver = createServer((request, response) => {
          if (request.method === 'POST' && request.url === '/webhooks/stripe') {
            void kezelo(request, response)
            return
          }
          response.statusCode = 404
          response.end()
        })
        await new Promise<void>((resolve) => szerver.listen(0, '127.0.0.1', resolve))

        try {
          const { port } = szerver.address() as AddressInfo
          const torzs = fizetettCheckout()
          const valasz = await fetch(`http://127.0.0.1:${port}/webhooks/stripe`, {
            method: 'POST',
            headers: { 'stripe-signature': await stripeAlairas(torzs) },
            body: torzs,
          })
          const ismeretlen = await fetch(`http://127.0.0.1:${port}/mas`)

          expect(valasz.status).toBe(200)
          expect(ismeretlen.status).toBe(404)
          expect(billingo.count('CreateReceipt')).toBe(1)
          expect(hibak).toEqual([])
        } finally {
          await new Promise((resolve) => szerver.close(resolve))
        }
      },
    )

    docsExample(
      'receptek/express-nestjs-fastify',
      'az express.json() után NodeBodyError, a NestJS rawBody és a Fastify Buffer működik',
      async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', STRIPE_TITOK)
        const { tarca, billingo } = docsClient()
        const webhook = stripeKezelo(tarca)
        const torzs = fizetettCheckout()
        const alairas = await stripeAlairas(torzs)
        const fejlecek = { host: 'bolt.example.hu', 'stripe-signature': alairas }
        const valaszok: { statusCode: number }[] = []
        const valaszObjektum = () => {
          const valasz = { statusCode: 0, setHeader: () => undefined, end: () => undefined }
          valaszok.push(valasz)
          return valasz
        }
        const tovabb: unknown[] = []

        await toNodeHandler(webhook)(
          { method: 'POST', url: '/webhooks/stripe', headers: fejlecek, body: JSON.parse(torzs) },
          valaszObjektum(),
          (error) => tovabb.push(error),
        )
        await toNodeHandler(webhook)(
          {
            method: 'POST',
            url: '/webhooks/stripe',
            headers: fejlecek,
            body: JSON.parse(torzs),
            rawBody: Buffer.from(torzs),
          },
          valaszObjektum(),
        )
        const fastify = await webhook(
          toWebRequest({
            method: 'POST',
            url: '/webhooks/stripe',
            headers: fejlecek,
            body: Buffer.from(torzs),
          }),
        )

        expect(tovabb).toEqual([expect.objectContaining({ name: 'NodeBodyError' })])
        expect(valaszok.map((valasz) => valasz.statusCode)).toEqual([0, 200])
        expect(fastify.status).toBe(200)
        expect(billingo.count('CreateReceipt')).toBe(1)
      },
    )
  })

  describe('Cloudflare Workers', () => {
    function workerKornyezet() {
      const doTarolo = new Map<string, unknown>()
      const storage = {
        get: async (key: string) => doTarolo.get(key),
        put: async (key: string, value: unknown) => {
          doTarolo.set(key, value)
        },
        delete: async (key: string) => doTarolo.delete(key),
      }
      const stub = {
        fetch: (input: string, init: RequestInit) =>
          handleDurableObjectStoreRequest(storage, new Request(input, init)),
      }
      const r2 = new Map<string, Uint8Array>()
      const SZAMLAK = {
        put: async (key: string, value: Uint8Array) => {
          r2.set(key, value)
          return { key, size: value.byteLength }
        },
        get: async (key: string) => {
          const value = r2.get(key)
          return value
            ? {
                key,
                size: value.byteLength,
                arrayBuffer: async () => value.slice().buffer as ArrayBuffer,
              }
            : null
        },
        delete: async (key: string) => {
          r2.delete(key)
        },
      }
      return { doTarolo, stub, r2, SZAMLAK }
    }

    docsExample(
      'receptek/cloudflare-workers',
      'a Worker egy nyugtát állít ki, a zár a Durable Objectben, a PDF az R2-ben',
      async () => {
        const billingo = createFakeBillingoFetch()
        const { doTarolo, stub, r2, SZAMLAK } = workerKornyezet()
        const env = {
          BILLINGO_API_KEY: 'tarca-teszt-kulcs-0000',
          STRIPE_WEBHOOK_SECRET: STRIPE_TITOK,
        }
        const fuggo: Promise<unknown>[] = []
        const ctx = { waitUntil: (promise: Promise<unknown>) => void fuggo.push(promise) }
        let tarca: Tarca | undefined

        async function fetchWorker(request: Request): Promise<Response> {
          const { pathname } = new URL(request.url)
          if (request.method !== 'POST' || pathname !== '/webhooks/stripe') {
            return new Response('Nincs ilyen útvonal', { status: 404 })
          }

          tarca ??= createTarca({ apiKey: env.BILLINGO_API_KEY, fetch: billingo.fetch })
          const szamlazo = tarca
          const zar = durableObjectStore(stub)
          const tarhely = r2BindingStorage(SZAMLAK)

          const webhook = stripeWebhook({
            secret: env.STRIPE_WEBHOOK_SECRET,
            dedupe: zar,
            onPayment: async (payment) => {
              const eredmeny = await issueForPayment(szamlazo, payment, {
                vat: 27,
                lock: zar,
                ledger: zar,
              })
              if (eredmeny.kind === 'receipt' || eredmeny.kind === 'invoice') {
                const bizonylat = eredmeny.document
                ctx.waitUntil(
                  storeDocumentPdf(szamlazo, tarhely, bizonylat).catch((error: unknown) => {
                    console.error('A PDF nem került az R2-be', bizonylat.id, error)
                  }),
                )
              }
            },
          })
          return webhook(request)
        }

        const torzs = fizetettCheckout()
        const workerKeres = async () =>
          new Request('https://szamlazo.example.hu/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': await stripeAlairas(torzs) },
            body: torzs,
          })
        const elso = await fetchWorker(await workerKeres())
        const ujra = await fetchWorker(await workerKeres())
        const mas = await fetchWorker(new Request('https://szamlazo.example.hu/'))
        await Promise.all(fuggo)

        expect([elso.status, ujra.status, mas.status]).toEqual([200, 200, 404])
        expect(billingo.count('CreateReceipt')).toBe(1)
        expect([...r2.keys()]).toEqual([
          expect.stringMatching(/^nyugtak\/\d{4}\/\d{2}\/NYT-2026-1\.pdf$/),
        ])
        expect([...doTarolo.keys()]).toContainEqual(expect.stringMatching(/^tarca:evt:stripe:/))
      },
    )
  })

  describe('számlázás AI asszisztensből', () => {
    docsExample(
      'receptek/mcp-asszisztens',
      'előnézet, megerősítő kód, egy kiállítás a hamis Billingón',
      async () => {
        const billingo = createFakeBillingoFetch()
        const kapcsolat = createTarcaMcpServer({
          apiKey: 'teszt-kulcs',
          fetch: billingo.fetch,
          allowWrite: true,
        }).connect({ protocolVersion: '2025-06-18' })

        async function eszkoz(nev: string, bemenet: Record<string, unknown>) {
          const sor = await kapcsolat.handleLine(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name: nev, arguments: bemenet },
            }),
          )
          return JSON.parse(sor ?? '{}').result
        }

        const szamla = {
          partner: {
            name: 'Vevő Kft.',
            address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
          },
          items: [
            { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
          ],
        }

        const kodNelkul = await eszkoz('create_document', szamla)
        const elonezet = await eszkoz('preview_document', szamla)
        const kiallitas = await eszkoz('create_document', {
          ...szamla,
          confirmation: elonezet.structuredContent.confirmation,
        })

        expect(kodNelkul.isError).toBe(true)
        expect(JSON.parse(kodNelkul.content[1].text).error.category).toBe('confirmation')
        const osszefoglalo = String(elonezet.content[0].text).replace(/[\u00a0\u202f]/g, ' ')
        expect(osszefoglalo).toContain(
          'Számla előnézete (még NEM készült el): Vevő Kft., nettó 150 000 HUF, bruttó 190 500 HUF',
        )
        expect(osszefoglalo).toContain('A vevő nem kap e-mailt a Billingótól.')
        expect(elonezet.structuredContent.vendorId).toMatch(/^MCP-[0-9A-F]{20}$/)
        expect(String(kiallitas.content[0].text).replace(/[\u00a0\u202f]/g, ' ')).toMatch(
          /^Kiállítva: Számla \d{4}-1: Vevő Kft\., bruttó 190 500 HUF/,
        )
        expect(billingo.count('CreateDocument')).toBe(1)
      },
    )

    docsExample(
      'receptek/mcp-asszisztens',
      'írási jog nélkül 16 eszköz, a HTTP kezelő token nélkül 401',
      async () => {
        vi.stubEnv('BILLINGO_API_KEY', 'tarca-teszt-kulcs-0000')
        const olvaso = createTarcaMcpServer()
        expect(olvaso.tools.filter((tool) => !tool.write)).toHaveLength(16)
        expect(olvaso.allowWrite).toBe(false)

        expect(() =>
          createTarcaMcpHandler(createTarcaMcpServer({ confirmationSecret: undefined }), {
            authorize: () => true,
          }),
        ).toThrow(expect.objectContaining({ category: 'configuration' }))

        vi.stubEnv('MCP_CONFIRMATION_SECRET', 'legalabb-tizenhat-bajtos-titok')
        const POST = createTarcaMcpHandler(
          createTarcaMcpServer({ confirmationSecret: process.env.MCP_CONFIRMATION_SECRET }),
          {
            authorize: (request) => {
              const token = process.env.MCP_TOKEN
              return Boolean(token) && request.headers.get('authorization') === `Bearer ${token}`
            },
          },
        )
        const hivas = (fejlecek: Record<string, string>) =>
          POST(
            new Request('https://bolt.example.hu/api/mcp', {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...fejlecek },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
            }),
          )

        const beallitatlan = await hivas({ authorization: 'Bearer undefined' })
        vi.stubEnv('MCP_TOKEN', 'mcp-token')
        const rossz = await hivas({ authorization: 'Bearer masik' })
        const jo = await hivas({
          authorization: 'Bearer mcp-token',
          'mcp-protocol-version': '2025-06-18',
        })

        expect([beallitatlan.status, rossz.status, jo.status]).toEqual([401, 401, 200])
      },
    )
  })

  describe('egységtesztek', () => {
    interface Rendeles {
      readonly id: number
      readonly tetelek: readonly {
        readonly nev: string
        readonly db: number
        readonly brutto: number
      }[]
    }

    async function fizetettRendeles(tarca: Tarca, rendeles: Rendeles) {
      const { document } = await tarca.documents.createOnce({
        vendorId: `WEB-${rendeles.id}`,
        partner: {
          name: 'Vevő Kft.',
          address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
        },
        items: rendeles.tetelek.map((tetel) => ({
          name: tetel.nev,
          quantity: tetel.db,
          grossUnitPrice: tetel.brutto,
          vat: 27,
        })),
      })
      return document
    }

    const rendeles: Rendeles = { id: 1001, tetelek: [{ nev: 'Póló', db: 2, brutto: 6_350 }] }

    docsExample(
      'receptek/egysegtesztek',
      'egy rendelésre egy számla, akkor is, ha a webhook kétszer jön',
      async () => {
        const tarca = createMockTarca({ defaults: { dueInDays: 8 } })

        await fizetettRendeles(tarca, rendeles)
        await fizetettRendeles(tarca, rendeles)

        expect(tarca.billingo.count('CreateDocument')).toBe(1)
        const [rekord] = [...tarca.billingo.data.documents.values()]
        expect(rekord?.document.grossTotal).toBe(12_700)
      },
    )

    docsExample(
      'receptek/egysegtesztek',
      'elveszett válasz után sincs második számla',
      async () => {
        const tarca = createMockTarca()
        tarca.failNext('documents.createOnce', undefined, { afterSuccess: true })

        await expect(fizetettRendeles(tarca, rendeles)).rejects.toThrow()
        await fizetettRendeles(tarca, rendeles)

        expect(tarca.billingo.data.documents.size).toBe(1)
      },
    )

    docsExample(
      'receptek/egysegtesztek',
      'a Billingo 503-ja után a createOnce megtalálja a kész számlát',
      async () => {
        const tarca = createMockTarca()
        tarca.billingo.fail({ status: 503 }, { operation: 'CreateDocument', afterSuccess: true })

        const szamla = await fizetettRendeles(tarca, rendeles)

        expect(szamla.grossTotal).toBe(12_700)
        expect(tarca.billingo.count('CreateDocument')).toBe(1)
      },
    )

    docsExample('receptek/egysegtesztek', 'üres kosárnál kérés sem megy ki', async () => {
      const tarca = createMockTarca()

      const hiba = await fizetettRendeles(tarca, { id: 1002, tetelek: [] }).catch(
        (error: unknown) => error,
      )

      expect(isBillingoError(hiba) && hiba.category).toBe('validation')
      expect(tarca.billingo.requests).toEqual([])
    })

    docsExample(
      'receptek/egysegtesztek',
      'rossz kulcsnál a verifyCredentials false, a navRecordDelayMs 0 azonnali NAV állapotot ad',
      async () => {
        expect(await createMockTarca({ credentialsValid: false }).verifyCredentials()).toBe(false)

        const tarca = createMockTarca({ navRecordDelayMs: 0 })
        const szamla = await fizetettRendeles(tarca, rendeles)
        const kesleltetett = createMockTarca()
        const masik = await fizetettRendeles(kesleltetett, rendeles)

        expect(await tarca.documents.navStatus(szamla.id ?? 0)).toMatchObject({
          status: 'no_online_szamla_settings',
        })
        expect(await kesleltetett.documents.navStatus(masik.id ?? 0)).toBeNull()
        expect(tarca.calls.map((call) => call.method)).toEqual([
          'documents.createOnce',
          'documents.navStatus',
        ])
      },
    )
  })

  describe('naplózás és metrikák', () => {
    docsExample(
      'receptek/naplozas-es-metrikak',
      'az onComplete minden próbálkozás végén fut, a hook hibája nem töri el a kérést',
      async () => {
        const sorok: unknown[][] = []
        const figyelmeztetesek: unknown[] = []
        const { tarca, billingo } = docsClient({
          hooks: {
            onComplete: (event) =>
              sorok.push([
                'billingo',
                event.operation,
                event.outcome,
                event.durationMs,
                event.attempt,
              ]),
            onRequest: () => {
              throw new Error('elromlott hook')
            },
            onWarning: (warning) => figyelmeztetesek.push(warning.hook),
          },
        })
        billingo.fail({ status: 503 }, { operation: 'GetOrganizationData' })

        await tarca.organization.get()

        expect(sorok).toEqual([
          ['billingo', 'GetOrganizationData', 'error', expect.any(Number), 1],
          ['billingo', 'GetOrganizationData', 'success', expect.any(Number), 2],
        ])
        expect(figyelmeztetesek).toEqual(['onRequest', 'onRequest'])
      },
    )

    docsExample(
      'receptek/naplozas-es-metrikak',
      'observe naplót és metrikát ad, a vendorId helyett HMAC hivatkozással',
      async () => {
        vi.stubEnv('TARCA_REF_SALT', 'kozos-so')
        const naplo: { szint: string; adat: Record<string, unknown>; uzenet: string }[] = []
        const naplozo = Object.fromEntries(
          (['info', 'warn', 'debug', 'error'] as const).map((szint) => [
            szint,
            (adat: Record<string, unknown>, uzenet: string) => naplo.push({ szint, adat, uzenet }),
          ]),
        )
        const bizonylatok: unknown[] = []
        const metrikak: MetricsRegistry = createMetricsRegistry()
        const { tarca, billingo } = docsClient({
          hooks: combineHooks(
            observe({
              logger: naplozo,
              metrics: metrikak,
              refSalt: process.env.TARCA_REF_SALT,
            }),
            {
              onDocument: (event) => {
                bizonylatok.push(['új bizonylat', event.action, event.document.invoiceNumber])
              },
            },
          ),
        })

        const { document } = await tarca.documents.createOnce({
          vendorId: 'WEB-1001',
          partner: BUYER,
          items: ITEMS,
        })

        const GET = (request: Request): Response => {
          const token = process.env.METRICS_TOKEN
          if (!token || request.headers.get('authorization') !== `Bearer ${token}`) {
            return new Response('Nincs jogosultság', { status: 401 })
          }
          return new Response(metrikak.renderPrometheus(), {
            headers: { 'content-type': 'text/plain; version=0.0.4' },
          })
        }
        const tilos = GET(new Request('https://bolt.example.hu/api/metrics'))
        vi.stubEnv('METRICS_TOKEN', 'metrika-token')
        const metrikaValasz = GET(
          new Request('https://bolt.example.hu/api/metrics', {
            headers: { authorization: 'Bearer metrika-token' },
          }),
        )
        const szoveg = await metrikaValasz.text()

        expect(billingo.requests).toHaveLength(5)
        expect(naplo.filter((sor) => sor.adat.event === 'tarca.request')).toHaveLength(5)
        expect(naplo).toContainEqual(
          expect.objectContaining({
            szint: 'info',
            adat: expect.objectContaining({
              event: 'tarca.request',
              operation: 'CreateDocument',
              method: 'POST',
              path: '/documents',
              attempt: 1,
              outcome: 'success',
              willRetry: false,
            }),
          }),
        )
        expect(naplo).toContainEqual(
          expect.objectContaining({
            szint: 'warn',
            adat: expect.objectContaining({
              operation: 'GetDocumentByVendorId',
              errorCategory: 'not_found',
            }),
          }),
        )
        const dokumentum = naplo.find((sor) => sor.adat.event === 'tarca.document')
        expect(dokumentum?.adat).toMatchObject({
          type: 'invoice',
          action: 'created',
          number: document.invoiceNumber,
          vendorRef: expect.stringMatching(/^hmac:[0-9a-f]{16}$/),
        })
        expect(JSON.stringify(naplo)).not.toContain('WEB-1001')
        expect(JSON.stringify(naplo)).not.toContain('tarca-teszt-kulcs')
        expect(bizonylatok).toEqual([['új bizonylat', 'created', document.invoiceNumber]])
        expect(tilos.status).toBe(401)
        expect(metrikaValasz.headers.get('content-type')).toBe('text/plain; version=0.0.4')
        expect(szoveg).toContain(
          'tarca_requests_total{operation="GetDocumentByVendorId",outcome="not_found"} 1',
        )
        expect(szoveg).toContain(
          'tarca_requests_total{operation="CreateDocument",outcome="success"} 1',
        )
        expect(szoveg).toContain('tarca_documents_total{action="created",type="invoice"} 1')
      },
    )
  })
})
