import { describe, expect } from 'vitest'
import { isBillingoError } from '../../src/index'
import { BUYER, docsClient, docsExample, pinDocsClock, sentBodies } from './helpers'

pinDocsClock()

const KAVE = [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }]

describe('nyugtak', () => {
  docsExample('nyugtak', 'createOnce kártyás nyugtára', async () => {
    const { tarca } = docsClient()

    const { document, created } = await tarca.receipts.createOnce({
      vendorId: 'POS-1001',
      items: [
        { name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 },
        { name: 'Croissant', grossUnitPrice: 750, vat: 5 },
      ],
      paymentMethod: 'bankcard',
    })

    expect(created).toBe(true)
    expect(document).toMatchObject({
      invoiceNumber: 'NYT-2026-1',
      grossTotal: 1_950,
      type: 'receipt',
      paymentStatus: 'paid',
    })
    expect(document.dueDate).toBe(document.invoiceDate)
  })

  docsExample('nyugtak', 'a vendorId közös a számlákkal', async () => {
    const { tarca } = docsClient()
    await tarca.receipts.create({ vendorId: 'POS-1001', items: KAVE })

    const error = await tarca.documents
      .create({
        vendorId: 'POS-1001',
        partner: BUYER,
        items: [{ name: 'Kávé', quantity: 1, netUnitPrice: 500, vat: 27 }],
      })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.apiMessage).toBe('Duplicate vendor id. (id:POS-1001)')
  })
})

describe('nyugtak/kiallitas', () => {
  docsExample('nyugtak/kiallitas/keres', 'a dróton küldött törzs', async () => {
    const { tarca, billingo } = docsClient()

    const nyugta = await tarca.receipts.create({
      items: [
        { name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 },
        { name: 'Croissant', grossUnitPrice: 750, vat: 5 },
      ],
      paymentMethod: 'bankcard',
    })

    expect([nyugta.invoiceNumber, nyugta.grossTotal]).toEqual(['NYT-2026-1', 1_950])
    expect(billingo.requests.map((request) => request.operation)).toEqual([
      'ListDocumentBlock',
      'CreateReceipt',
    ])
    expect(billingo.requests[0]?.query).toMatchObject({ type: 'receipt' })
    expect(sentBodies(billingo, 'CreateReceipt')).toEqual([
      {
        type: 'receipt',
        payment_method: 'bankcard',
        currency: 'HUF',
        electronic: false,
        items: [
          { name: 'Kávé', unit_price: 600, vat: '27%', quantity: 2, unit: 'db' },
          { name: 'Croissant', unit_price: 750, vat: '5%', quantity: 1, unit: 'db' },
        ],
        block_id: 2,
      },
    ])
  })

  docsExample(
    'nyugtak/kiallitas/keres',
    'a defaults.paymentMethod és a cash alapérték',
    async () => {
      const elso = docsClient()
      const masodik = docsClient({ defaults: { paymentMethod: 'wire_transfer' } })

      await elso.tarca.receipts.create({ items: KAVE })
      await masodik.tarca.receipts.create({ items: KAVE })

      expect(sentBodies(elso.billingo, 'CreateReceipt')).toEqual([
        expect.objectContaining({ payment_method: 'cash' }),
      ])
      expect(sentBodies(masodik.billingo, 'CreateReceipt')).toEqual([
        expect.objectContaining({ payment_method: 'wire_transfer' }),
      ])
    },
  )

  docsExample('nyugtak/kiallitas/keres', 'a nyugta áfalistája szűkebb', async () => {
    const { tarca, billingo } = docsClient()

    const error = await tarca.receipts
      .create({ items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 13.5 }] })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.fieldErrors[0]?.field).toBe('items.0.vat')
    expect(isBillingoError(error) && error.fieldErrors[0]?.message).toContain(
      'none, 5%, 18%, 27%, AAM, TAM',
    )
    expect(billingo.requests).toEqual([])
  })

  docsExample('nyugtak/kiallitas/keres', 'partnerrel és e-mail címmel', async () => {
    const { tarca, billingo } = docsClient()

    const nyugta = await tarca.receipts.create({
      partner: { ...BUYER, emails: ['vevo@example.hu'] },
      emails: ['vevo@example.hu'],
      items: KAVE,
    })

    expect(nyugta.partner?.name).toBe('Vevő Kft.')
    expect(sentBodies(billingo, 'CreateReceipt')).toEqual([
      expect.objectContaining({ partner_id: 1, emails: ['vevo@example.hu'] }),
    ])
  })

  docsExample('nyugtak/kiallitas/valasz', 'partner nélkül a Magánszemély partner', async () => {
    const { tarca } = docsClient()

    const elso = await tarca.receipts.create({ items: KAVE })
    const masodik = await tarca.receipts.create({ items: KAVE })

    expect(elso.partner?.name).toBe('Magánszemély')
    expect(masodik.partner?.id).toBe(elso.partner?.id)
    expect(elso).toMatchObject({ paymentStatus: 'paid', kobakReceiptStatus: 'pending' })
  })

  docsExample('nyugtak/kiallitas/valasz', 'bizonytalan hiba után findByVendorId', async () => {
    const { tarca, billingo } = docsClient()
    billingo.fail('network', { operation: 'CreateReceipt', afterSuccess: true })
    const vendorId = 'POS-1001'
    let talalat: string | undefined

    try {
      await tarca.receipts.create({
        vendorId,
        items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }],
      })
    } catch (error) {
      const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']
      if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
      const meglevo = await tarca.documents.findByVendorId(vendorId)
      if (meglevo === null) throw error
      talalat = meglevo.invoiceNumber
    }

    expect(talalat).toBe('NYT-2026-1')
    expect(billingo.count('CreateReceipt')).toBe(1)
  })

  docsExample('nyugtak/kiallitas/minta', 'kártyás nyugta két áfakulccsal', async () => {
    const { tarca } = docsClient()

    const nyugta = await tarca.receipts.create({
      items: [
        { name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 },
        { name: 'Croissant', grossUnitPrice: 750, vat: 5 },
      ],
      paymentMethod: 'bankcard',
    })

    expect([nyugta.invoiceNumber, nyugta.grossTotal, nyugta.paymentStatus]).toEqual([
      'NYT-2026-1',
      1_950,
      'paid',
    ])
    expect(
      nyugta.summary?.vatRateSummary?.map((rate) => [
        rate.vatRateVatAmount,
        rate.vatRateVatAmountLocal,
      ]),
    ).toEqual([
      [255.12, 255],
      [35.71, 36],
    ])
  })

  docsExample('nyugtak/kiallitas/minta', 'pontosan egyszer', async () => {
    const { tarca, billingo } = docsClient()
    const nyugta = {
      vendorId: 'POS-1001',
      items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }],
      paymentMethod: 'bankcard' as const,
    }

    const elso = await tarca.receipts.createOnce(nyugta)
    const masodik = await tarca.receipts.createOnce(nyugta)

    expect([elso.created, elso.document.invoiceNumber, elso.document.grossTotal]).toEqual([
      true,
      'NYT-2026-1',
      1_200,
    ])
    expect([masodik.created, masodik.document.invoiceNumber]).toEqual([false, 'NYT-2026-1'])
    expect(billingo.count('CreateReceipt')).toBe(1)
  })
})

describe('nyugtak/piszkozat', () => {
  docsExample('nyugtak/piszkozat/keres', 'véglegesítés kártyás fizetéssel', async () => {
    const { tarca, billingo } = docsClient()
    const tetelek = [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }]

    const piszkozat = await tarca.receipts.create({ type: 'draft', items: tetelek })
    const nyugta = await tarca.receipts.finalizeDraft(piszkozat.id ?? 0, {
      items: tetelek,
      paymentMethod: 'bankcard',
    })

    expect([nyugta.id === piszkozat.id, nyugta.invoiceNumber]).toEqual([true, 'NYT-2026-1'])
    expect(sentBodies(billingo, 'CreateReceiptFromDraft')).toEqual([
      {
        type: 'receipt',
        payment_method: 'bankcard',
        currency: 'HUF',
        electronic: false,
        items: [{ name: 'Kávé', unit_price: 600, vat: '27%', quantity: 2, unit: 'db' }],
        block_id: 2,
      },
    ])
  })

  docsExample('nyugtak/piszkozat/keres', 'draft típussal nem véglegesíthető', async () => {
    const { tarca, billingo } = docsClient()

    const error = await tarca.receipts
      .finalizeDraft(1, { type: 'draft' as never, items: KAVE })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.fieldErrors[0]?.field).toBe('type')
    expect(billingo.requests).toEqual([])
  })

  docsExample('nyugtak/piszkozat/valasz', '201 és ugyanaz az azonosító', async () => {
    const { tarca, billingo } = docsClient()

    const piszkozat = await tarca.receipts.create({ type: 'draft', items: KAVE })
    const nyugta = await tarca.receipts.finalizeDraft(piszkozat.id ?? 0, { items: KAVE })

    expect([piszkozat.type, piszkozat.invoiceNumber]).toEqual(['draft', ''])
    expect([nyugta.id, nyugta.type, nyugta.paymentStatus]).toEqual([
      piszkozat.id,
      'receipt',
      'paid',
    ])
    expect(billingo.requests.at(-1)).toMatchObject({
      operation: 'CreateReceiptFromDraft',
      status: 201,
    })
  })

  docsExample('nyugtak/piszkozat/minta', 'piszkozat, majd nyugta', async () => {
    const { tarca } = docsClient()
    const tetelek = [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }]

    const piszkozat = await tarca.receipts.create({ type: 'draft', items: tetelek })
    const nyugta = await tarca.receipts.finalizeDraft(piszkozat.id ?? 0, {
      items: tetelek,
      paymentMethod: 'bankcard',
    })

    expect([piszkozat.id, piszkozat.type, piszkozat.invoiceNumber]).toEqual([1, 'draft', ''])
    expect([nyugta.id, nyugta.type, nyugta.invoiceNumber, nyugta.paymentStatus]).toEqual([
      1,
      'receipt',
      'NYT-2026-1',
      'paid',
    ])
  })
})

describe('nyugtak/sztorno', () => {
  docsExample('nyugtak/sztorno', 'receipt_cancellation a nyugtatömbben', async () => {
    const { tarca, billingo } = docsClient()

    const nyugta = await tarca.receipts.create({
      items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }],
      paymentMethod: 'bankcard',
    })
    const sztorno = await tarca.documents.cancel(nyugta.id ?? 0, { reason: 'Hibás tétel.' })

    expect([sztorno.type, sztorno.invoiceNumber, sztorno.grossTotal]).toEqual([
      'receipt_cancellation',
      'NYT-2026-2',
      -1_200,
    ])
    expect(sentBodies(billingo, 'CancelDocument')).toEqual([
      { cancellation_reason: 'Hibás tétel.' },
    ])
  })

  docsExample('nyugtak/sztorno', 'a sandbox példája', async () => {
    const { tarca, billingo } = docsClient()

    const nyugta = await tarca.receipts.create({
      items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }],
      paymentMethod: 'bankcard',
    })
    const sztorno = await tarca.documents.cancel(nyugta.id ?? 0)
    const eredeti = await tarca.documents.get(nyugta.id ?? 0)

    expect([sztorno.invoiceNumber, sztorno.type, sztorno.grossTotal]).toEqual([
      'NYT-2026-2',
      'receipt_cancellation',
      -1_200,
    ])
    expect([eredeti.invoiceNumber, eredeti.cancelled, eredeti.paymentStatus]).toEqual([
      'NYT-2026-1',
      true,
      'none',
    ])
    expect(sentBodies(billingo, 'CancelDocument')).toEqual([undefined])
  })
})

describe('nyugtak/blokknyomtatas', () => {
  docsExample(
    'nyugtak/blokknyomtatas',
    '80 mm-es blokk application/octet-stream típussal',
    async () => {
      const { tarca, billingo } = docsClient()

      const { document } = await tarca.receipts.createOnce({
        vendorId: 'POS-1001',
        items: [{ name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 }],
        paymentMethod: 'bankcard',
      })
      const blokk = await tarca.documents.posPdf(document.id ?? 0, { size: 80 })

      expect([blokk.filename, blokk.contentType]).toEqual([
        'NYT-2026-1.pdf',
        'application/octet-stream',
      ])
      expect(new TextDecoder().decode(blokk.bytes.slice(0, 4))).toBe('%PDF')
      expect(billingo.requests.at(-1)?.query).toEqual({ size: '80' })
    },
  )

  docsExample('nyugtak/blokknyomtatas', 'továbbküldés application/pdf típussal', async () => {
    const { tarca } = docsClient()
    const nyugtaId = (await tarca.receipts.create({ items: KAVE })).id ?? 0

    const blokk = await tarca.documents.posPdf(nyugtaId, { size: 58 })
    const valasz = new Response(blokk.bytes, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${blokk.filename ?? 'nyugta.pdf'}"`,
      },
    })

    expect(valasz.headers.get('content-type')).toBe('application/pdf')
    expect(valasz.headers.get('content-disposition')).toBe('inline; filename="NYT-2026-1.pdf"')
  })

  docsExample('nyugtak/blokknyomtatas', 'a posPdf nem várja ki a 202-t', async () => {
    const { tarca, billingo } = docsClient()
    const nyugtaId = (await tarca.receipts.create({ items: KAVE })).id ?? 0
    billingo.fail('notReady', { operation: 'PosPrint' })

    const error = await tarca.documents
      .posPdf(nyugtaId, { size: 58 })
      .catch((caught: unknown) => caught)

    expect(isBillingoError(error) && error.category).toBe('not_ready')
    expect(billingo.count('PosPrint')).toBe(1)
  })

  docsExample('nyugtak/blokknyomtatas', 'a sandbox példája', async () => {
    const { tarca } = docsClient()

    const nyugta = await tarca.receipts.create({
      items: [
        { name: 'Kávé', quantity: 2, grossUnitPrice: 600, vat: 27 },
        { name: 'Croissant', grossUnitPrice: 750, vat: 5 },
      ],
      paymentMethod: 'bankcard',
    })
    const blokk = await tarca.documents.posPdf(nyugta.id ?? 0, { size: 58 })

    expect([nyugta.invoiceNumber, blokk.filename, blokk.contentType]).toEqual([
      'NYT-2026-1',
      'NYT-2026-1.pdf',
      'application/octet-stream',
    ])
  })
})
