import { describe, expect } from 'vitest'
import {
  createTarca,
  type DocumentBlockInput,
  isBillingoError,
  nullIfNotFound,
} from '../../src/index'
import { createFakeBillingoFetch } from '../../src/testing/index'
import { BUYER, docsClient, docsExample, sentBodies } from './helpers'

const WEBSHOP: DocumentBlockInput = { name: 'Webshop', prefix: 'WEB', type: 'invoice' }

function queryString(query: Readonly<Record<string, string>>): string {
  return new URLSearchParams(query).toString()
}

describe('szamlatombok', () => {
  docsExample('szamlatombok', 'a számla alapból az első invoice tömbbe kerül', async () => {
    const { tarca, billingo } = docsClient()
    await tarca.documentBlocks.create(WEBSHOP)

    await tarca.documents.create({
      partner: BUYER,
      items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
    })

    expect(sentBodies(billingo, 'CreateDocument')).toEqual([
      expect.objectContaining({ block_id: 1 }),
    ])
  })
})

describe('szamlatombok/lista', () => {
  docsExample('szamlatombok/lista/keres', 'típus szerinti szűrés és teljes lista', async () => {
    const { tarca, billingo } = docsClient()

    const nyugtaTombok = await tarca.documentBlocks.list({ type: 'receipt' })
    const tombok: unknown[] = []
    for await (const tomb of tarca.documentBlocks.all())
      tombok.push([tomb.id, tomb.name, tomb.type])

    expect(nyugtaTombok.data.map((tomb) => tomb.prefix)).toEqual(['NYT'])
    expect(tombok).toEqual([
      [1, 'Számlák', 'invoice'],
      [2, 'Nyugták', 'receipt'],
    ])
    expect(
      billingo.requests
        .filter((request) => request.operation === 'ListDocumentBlock')
        .map((request) => queryString(request.query)),
    ).toEqual(['type=receipt', 'page=1&per_page=100'])
  })

  docsExample('szamlatombok/lista/keres', 'hibás page-re RangeError', async () => {
    const { tarca, billingo } = docsClient()

    await expect(tarca.documentBlocks.list({ page: 1.5 })).rejects.toBeInstanceOf(RangeError)
    expect(billingo.requests).toEqual([])
  })

  docsExample('szamlatombok/lista/valasz', 'a friss profil két tömbje hat mezővel', async () => {
    const billingo = createFakeBillingoFetch()
    const valaszok: unknown[] = []
    const tarca = createTarca({
      apiKey: 'teszt',
      fetch: async (input, init) => {
        const response = await billingo.fetch(input, init)
        valaszok.push(await response.clone().json())
        return response
      },
    })

    const oldal = await tarca.documentBlocks.list()

    expect(oldal).toMatchObject({ total: 2, currentPage: 1, lastPage: 1 })
    expect(valaszok).toEqual([
      expect.objectContaining({
        data: [
          {
            id: 1,
            name: 'Számlák',
            prefix: '',
            custom_field1: '',
            custom_field2: '',
            type: 'invoice',
          },
          {
            id: 2,
            name: 'Nyugták',
            prefix: 'NYT',
            custom_field1: '',
            custom_field2: '',
            type: 'receipt',
          },
        ],
      }),
    ])
  })

  docsExample('szamlatombok/lista/minta', 'növekvő sorrend és típus szerinti szűrés', async () => {
    const { tarca } = docsClient()
    await tarca.documentBlocks.create(WEBSHOP)

    const sorok: unknown[] = []
    for await (const tomb of tarca.documentBlocks.all()) {
      sorok.push([tomb.id, tomb.name, tomb.prefix, tomb.type])
    }
    const szamlaTombok = await tarca.documentBlocks.list({ type: 'invoice' })
    const nyugtaTombok = await tarca.documentBlocks.list({ type: 'receipt' })

    expect(sorok).toEqual([
      [1, 'Számlák', '', 'invoice'],
      [2, 'Nyugták', 'NYT', 'receipt'],
      [3, 'Webshop', 'WEB', 'invoice'],
    ])
    expect(szamlaTombok.data.map((tomb) => tomb.name)).toEqual(['Számlák', 'Webshop'])
    expect(nyugtaTombok.data.map((tomb) => tomb.name)).toEqual(['Nyugták'])
  })
})

describe('szamlatombok/letrehozas', () => {
  docsExample('szamlatombok/letrehozas/keres', 'a törzs három mezője', async () => {
    const { tarca, billingo } = docsClient()

    const tomb = await tarca.documentBlocks.create({
      name: 'Webshop',
      prefix: 'WEB',
      type: 'invoice',
    })

    expect(tomb.id).toBe(3)
    expect(sentBodies(billingo, 'CreateDocumentBlock')).toEqual([
      { name: 'Webshop', prefix: 'WEB', type: 'invoice' },
    ])
  })

  docsExample(
    'szamlatombok/letrehozas/keres',
    'kötőjeles és üres névre validation, ékezetesre nem',
    async () => {
      const { tarca, billingo } = docsClient()
      let uzenet: string | undefined

      try {
        await tarca.documentBlocks.create({ name: 'Web-shop', prefix: 'WEB', type: 'invoice' })
      } catch (error) {
        if (isBillingoError(error)) uzenet = error.fieldErrors[0]?.message
      }

      expect(uzenet).toBe(
        'A számlatömb neve csak betűt, számot és szóközt tartalmazhat (például „TARCA E2E”), kapott: „Web-shop”.',
      )
      await expect(
        tarca.documentBlocks.create({ name: ' ', prefix: 'X', type: 'invoice' }),
      ).rejects.toMatchObject({ category: 'validation' })
      expect(billingo.requests).toEqual([])
      await expect(
        tarca.documentBlocks.create({ name: 'Bolt Győr 2', prefix: 'GY', type: 'invoice' }),
      ).resolves.toMatchObject({ name: 'Bolt Győr 2' })
    },
  )

  docsExample('szamlatombok/letrehozas/valasz', 'az új tömb alapértékei', async () => {
    const { tarca } = docsClient()

    const tomb = await tarca.documentBlocks.create(WEBSHOP)

    expect(tomb).toMatchObject({
      customField1: '',
      customField2: '',
      senderName: '',
      templateId: 0,
      normalNotificationId: 0,
      proformaNotificationId: 0,
      picPath: null,
      senderEmail: null,
      bccEmail: null,
      bankAccountId: null,
      invoiceNumberFormat: 'default',
      financialFulfillmentHighlight: 'basic',
      generated: false,
      createInvoiceFromPaidProforma: false,
      attachXmlToInvoicePdf: false,
    })
  })

  docsExample('szamlatombok/letrehozas/valasz', 'a WEB tömb első számlája', async () => {
    const { tarca } = docsClient()

    const tomb = await tarca.documentBlocks.create(WEBSHOP)
    const szamla = await tarca.documents.create({
      blockId: tomb.id ?? 0,
      partner: BUYER,
      items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
    })
    const alap = await tarca.documents.create({
      partner: BUYER,
      items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
    })

    expect(szamla.invoiceNumber).toMatch(/^WEB \/ \d{4}-000001$/)
    expect(alap.invoiceNumber).toMatch(/^\d{4}-1$/)
  })

  docsExample(
    'szamlatombok/letrehozas/valasz',
    'bizonytalan hiba után a listából veszi a már létrejött tömböt',
    async () => {
      const { tarca, billingo } = docsClient()
      billingo.fail('timeout', { operation: 'CreateDocumentBlock', afterSuccess: true })
      const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']

      async function tombLetrehozasa(input: DocumentBlockInput) {
        try {
          return (await tarca.documentBlocks.create(input)).id
        } catch (error) {
          if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
          for await (const tomb of tarca.documentBlocks.all({ type: input.type })) {
            if (tomb.name === input.name && tomb.prefix === input.prefix) return tomb.id
          }
          return (await tarca.documentBlocks.create(input)).id
        }
      }

      expect(await tombLetrehozasa(WEBSHOP)).toBe(3)
      expect(billingo.count('CreateDocumentBlock')).toBe(1)
    },
  )

  docsExample(
    'szamlatombok/letrehozas/minta',
    'új tömb, számla WEB előtaggal, a kötőjeles név el sem megy',
    async () => {
      const { tarca, billingo } = docsClient()

      const tomb = await tarca.documentBlocks.create(WEBSHOP)
      const szamla = await tarca.documents.create({
        blockId: tomb.id ?? 0,
        partner: BUYER,
        items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
      })
      const hiba = await tarca.documentBlocks
        .create({ name: 'Web-shop', prefix: 'WS', type: 'invoice' })
        .catch((error: unknown) => error)

      expect([tomb.id, tomb.invoiceNumberFormat, tomb.senderEmail]).toEqual([3, 'default', null])
      expect(szamla.invoiceNumber).toMatch(/^WEB \/ \d{4}-000001$/)
      expect(hiba).toMatchObject({ category: 'validation' })
      expect(billingo.count('CreateDocumentBlock')).toBe(1)
      expect(sentBodies(billingo, 'CreateDocument')).toEqual([
        expect.objectContaining({ block_id: 3 }),
      ])
    },
  )
})

describe('szamlatombok/lekeres', () => {
  docsExample('szamlatombok/lekeres', 'a Számlák tömb a dokumentált válasszal', async () => {
    const billingo = createFakeBillingoFetch()
    const valaszok: unknown[] = []
    const tarca = createTarca({
      apiKey: 'teszt',
      fetch: async (input, init) => {
        const response = await billingo.fetch(input, init)
        valaszok.push(await response.clone().json())
        return response
      },
    })

    const tomb = await tarca.documentBlocks.get(1)

    expect([tomb.name, tomb.prefix, tomb.senderEmail, tomb.financialFulfillmentHighlight]).toEqual([
      'Számlák',
      '',
      null,
      'basic',
    ])
    expect(valaszok).toEqual([
      {
        id: 1,
        name: 'Számlák',
        prefix: '',
        type: 'invoice',
        custom_field1: '',
        custom_field2: '',
        template_id: 0,
        pic_path: null,
        normal_notification_id: 0,
        proforma_notification_id: 0,
        generated: false,
        invoice_number_format: 'default',
        sender_email: null,
        sender_name: '',
        bcc_email: null,
        create_invoice_from_paid_proforma: false,
        fulfillment_date_from_proforma_payment_date: false,
        attach_xml_to_invoice_pdf: false,
        advance_paid_instant: false,
        financial_fulfillment_highlight: 'basic',
        entitlements_in_document_comment: false,
        bank_account_id: null,
      },
    ])
  })

  docsExample(
    'szamlatombok/lekeres',
    'ismeretlen tömbre 403, amit a nullIfNotFound továbbdob',
    async () => {
      const { tarca } = docsClient()

      const hiba = await nullIfNotFound(tarca.documentBlocks.get(99)).catch(
        (error: unknown) => error,
      )

      expect(hiba).toMatchObject({
        category: 'forbidden',
        status: 403,
        apiMessage:
          'You do not have permission for this operation. Or any ID in request is invalid or you do not have permission.',
      })
    },
  )

  docsExample('szamlatombok/lekeres', 'létezés ellenőrzése a listából', async () => {
    const { tarca } = docsClient()

    async function letezik(tombId: number): Promise<boolean> {
      for await (const tomb of tarca.documentBlocks.all()) {
        if (tomb.id === tombId) return true
      }
      return false
    }

    expect([await letezik(1), await letezik(99)]).toEqual([true, false])
  })
})

describe('szamlatombok/modositas', () => {
  docsExample(
    'szamlatombok/modositas/keres',
    'a lekért tömb visszaküldve, id, pic_path és null mezők nélkül',
    async () => {
      const { tarca, billingo } = docsClient()

      const tomb = await tarca.documentBlocks.get(1)
      const modositott = await tarca.documentBlocks.update(1, {
        ...tomb,
        customField1: 'Rendelésszám',
        senderName: 'Minta Bolt',
      })

      expect([modositott.customField1, modositott.senderName]).toEqual([
        'Rendelésszám',
        'Minta Bolt',
      ])
      expect(sentBodies(billingo, 'UpdateDocumentBlock')).toEqual([
        {
          name: 'Számlák',
          prefix: '',
          type: 'invoice',
          custom_field1: 'Rendelésszám',
          custom_field2: '',
          template_id: 0,
          normal_notification_id: 0,
          proforma_notification_id: 0,
          generated: false,
          invoice_number_format: 'default',
          sender_name: 'Minta Bolt',
          create_invoice_from_paid_proforma: false,
          fulfillment_date_from_proforma_payment_date: false,
          attach_xml_to_invoice_pdf: false,
          advance_paid_instant: false,
          financial_fulfillment_highlight: 'basic',
          entitlements_in_document_comment: false,
        },
      ])
    },
  )

  docsExample('szamlatombok/modositas/keres', 'kötőjeles névre validation', async () => {
    const { tarca, billingo } = docsClient()

    await expect(
      tarca.documentBlocks.update(1, { name: 'Szám-lák', prefix: '', type: 'invoice' }),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.requests).toEqual([])
  })

  docsExample('szamlatombok/modositas/valasz', 'csonka PUT után kiürülnek a mezők', async () => {
    const { tarca } = docsClient()
    const tomb = await tarca.documentBlocks.get(1)
    await tarca.documentBlocks.update(1, { ...tomb, customField1: 'x', senderName: 'y' })

    const csere = await tarca.documentBlocks.update(1, {
      name: 'Számlák',
      prefix: '',
      type: 'invoice',
    })

    expect(csere).toMatchObject({
      customField1: '',
      customField2: '',
      senderName: '',
      senderEmail: null,
      bccEmail: null,
      bankAccountId: null,
      financialFulfillmentHighlight: 'basic',
    })
  })

  docsExample('szamlatombok/modositas/valasz', 'null e-mail a dróton 422', async () => {
    const billingo = createFakeBillingoFetch()

    const response = await billingo.fetch('https://api.billingo.hu/v3/document-blocks/1', {
      method: 'PUT',
      headers: { 'x-api-key': 'teszt', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Számlák',
        prefix: '',
        type: 'invoice',
        sender_email: null,
        bcc_email: null,
      }),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'sender_email', message: 'The Sender email must be a valid email address.' },
        { field: 'bcc_email', message: 'The Bcc email must be a valid email address.' },
      ],
    })
  })

  docsExample(
    'szamlatombok/modositas/valasz',
    'bizonytalan hiba után nem küldi újra, ha már lefutott',
    async () => {
      const { tarca, billingo } = docsClient()
      billingo.fail('network', { operation: 'UpdateDocumentBlock', afterSuccess: true })
      const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']

      async function egyediMezo(tombId: number, ertek: string) {
        const tomb = await tarca.documentBlocks.get(tombId)
        try {
          return await tarca.documentBlocks.update(tombId, { ...tomb, customField1: ertek })
        } catch (error) {
          if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
          const most = await tarca.documentBlocks.get(tombId)
          if (most.customField1 === ertek) return most
          return tarca.documentBlocks.update(tombId, { ...most, customField1: ertek })
        }
      }

      const tomb = await egyediMezo(1, 'Rendelésszám')

      expect(tomb.customField1).toBe('Rendelésszám')
      expect(billingo.count('UpdateDocumentBlock')).toBe(1)
    },
  )

  docsExample('szamlatombok/modositas/minta', 'lekért tömbből, majd csonka PUT', async () => {
    const { tarca } = docsClient()

    const tomb = await tarca.documentBlocks.get(1)
    const modositott = await tarca.documentBlocks.update(1, {
      ...tomb,
      customField1: 'Rendelésszám',
      senderName: 'Minta Bolt',
    })
    const csonka = await tarca.documentBlocks.update(1, {
      name: 'Számlák',
      prefix: '',
      type: 'invoice',
    })

    expect([modositott.customField1, modositott.senderName]).toEqual(['Rendelésszám', 'Minta Bolt'])
    expect([csonka.customField1, csonka.senderName]).toEqual(['', ''])
  })
})

describe('szamlatombok/torles', () => {
  docsExample('szamlatombok/torles', 'törlés 204, utána 403 és a lista nélküle', async () => {
    const { tarca, billingo } = docsClient()

    const tomb = await tarca.documentBlocks.create({
      name: 'Ideiglenes',
      prefix: 'TMP',
      type: 'invoice',
    })
    await tarca.documentBlocks.delete(tomb.id ?? 0)
    const hiba = await tarca.documentBlocks.get(tomb.id ?? 0).catch((error: unknown) => error)
    const maradt = await tarca.documentBlocks.list()

    expect(isBillingoError(hiba) ? hiba.category : hiba).toBe('forbidden')
    expect(maradt.data.map((elem) => elem.name)).toEqual(['Számlák', 'Nyugták'])
    expect(
      billingo.requests
        .filter((request) => request.path === '/document-blocks/3')
        .map((request) => [request.method, request.status]),
    ).toEqual([
      ['DELETE', 204],
      ['GET', 403],
    ])
  })

  docsExample(
    'szamlatombok/torles',
    'bizonytalan hiba után csak akkor töröl újra, ha még megvan',
    async () => {
      const { tarca, billingo } = docsClient()
      const tomb = await tarca.documentBlocks.create(WEBSHOP)
      billingo.fail('network', { operation: 'DeleteDocumentBlock', afterSuccess: true })

      async function torol(tombId: number): Promise<void> {
        try {
          await tarca.documentBlocks.delete(tombId)
        } catch (error) {
          if (
            !isBillingoError(error) ||
            !['network', 'timeout', 'server'].includes(error.category)
          ) {
            throw error
          }
          for await (const elem of tarca.documentBlocks.all()) {
            if (elem.id === tombId) return tarca.documentBlocks.delete(tombId)
          }
        }
      }

      await torol(tomb.id ?? 0)

      expect(billingo.count('DeleteDocumentBlock')).toBe(1)
      expect(billingo.data.documentBlocks.has(tomb.id ?? 0)).toBe(false)
    },
  )
})
