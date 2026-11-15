import { describe, expect, test } from 'vitest'
import { createTarca } from '../client'
import type { KeyValueStore } from '../core/store'
import { createFakeBillingoFetch } from '../testing'
import { issueForPayment, type PaymentTarca } from './issue'
import { refundMarker } from './modification'
import type { IssuedModification, IssuedRefundProposal } from './partial-refund'
import type { PaymentEvent, PaymentLineItem, PaymentRefund } from './types'

const NOW = new Date('2026-10-02T10:00:00Z')

function huf(value: number) {
  return { value, minor: value * 100, currency: 'HUF' }
}

function memoryLedger(): KeyValueStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value)
    },
    delete: (key) => {
      values.delete(key)
    },
    setIfAbsent: (key, value) => {
      if (values.has(key)) return false
      values.set(key, value)
      return true
    },
  }
}

const CUSTOMER = {
  name: 'Kovács Éva',
  email: 'eva@pelda.hu',
  address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
}

const SINGLE_VAT: PaymentLineItem[] = [
  { name: 'Póló', quantity: 2, totalGross: huf(7_000), vat: 27 },
  { name: 'Sapka', quantity: 1, totalGross: huf(3_000), vat: 27 },
]

const MIXED_VAT: PaymentLineItem[] = [
  { name: 'Könyv', quantity: 1, totalGross: huf(4_000), vat: 5 },
  { name: 'Póló', quantity: 1, totalGross: huf(6_000), vat: 27 },
]

function paid(items: readonly PaymentLineItem[]): PaymentEvent {
  return {
    provider: 'barion',
    kind: 'paid',
    id: 'PAY-1',
    method: 'barion',
    amount: huf(10_000),
    customer: CUSTOMER,
    items,
    raw: {},
  }
}

function refund(id: string, value: number, before = 0): PaymentRefund {
  return { id, amount: huf(value), refundedBefore: huf(before) }
}

function partial(refunds: readonly PaymentRefund[] | undefined): PaymentEvent {
  return {
    provider: 'barion',
    kind: 'partially-refunded',
    id: 'PAY-1',
    method: 'barion',
    amount: huf(10_000),
    refunds,
    raw: {},
  }
}

async function invoiced(items: readonly PaymentLineItem[] = SINGLE_VAT, document = 'invoice') {
  const billingo = createFakeBillingoFetch({ now: () => NOW })
  const tarca = createTarca({ apiKey: 'tarca-teszt-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  const issued = await issueForPayment(tarca, paid(items), {
    document: document === 'receipt' ? 'receipt' : 'invoice',
    recoveryDelayMs: 0,
  })
  if (issued.kind !== 'invoice' && issued.kind !== 'receipt') throw new Error('bizonylat várt')
  return { billingo, tarca, originalId: issued.document.id ?? 0 }
}

function modifications(billingo: ReturnType<typeof createFakeBillingoFetch>) {
  return [...billingo.data.documents.values()]
    .map((record) => record.document)
    .filter((document) => document.type === 'modification')
}

describe('issueForPayment részleges visszatérítésnél', () => {
  test('egy áfakulcsnál a visszatérített összegre módosító számlát állít ki, áfakulcsonként egy negatív sorral', async () => {
    const { billingo, tarca, originalId } = await invoiced()
    const ledger = memoryLedger()

    const result = (await issueForPayment(tarca, partial([refund('TR-1', 3_500)]), {
      ledger,
    })) as IssuedModification

    expect(result).toMatchObject({
      kind: 'modification',
      vendorId: 'BARION-PAY-1',
      originalId,
      created: true,
      modifications: [{ refundId: 'TR-1', created: true, amount: { minor: -350_000 } }],
    })
    const [modification] = modifications(billingo)
    expect(modification?.items.map((item) => item.grossAmount)).toEqual([-3_500])
    expect(modification?.summary.vatRateSummary?.[0]?.vatRateGrossAmount).toBe(-3_500)
    expect(modification?.relatedDocuments).toEqual([expect.objectContaining({ id: originalId })])
    expect(modification?.comment).toBe(`(${await refundMarker('BARION-PAY-1', 'TR-1')})`)
    const sent = billingo.requests.find(
      (request) => request.operation === 'CreateModificationDocument',
    )
    expect(sent?.body).toMatchObject({
      payment_method: 'barion',
      items: [
        {
          name: 'Visszatérítés (27%)',
          quantity: 1,
          unit_price: -3_500,
          unit_price_type: 'gross',
          vat: '27%',
        },
      ],
    })
  })

  test('az újraküldött esemény nem állít ki újabb módosító számlát', async () => {
    const { billingo, tarca } = await invoiced()
    const ledger = memoryLedger()
    const event = partial([refund('TR-1', 3_500)])

    await issueForPayment(tarca, event, { ledger })
    const again = (await issueForPayment(tarca, event, { ledger })) as IssuedModification

    expect(again.created).toBe(false)
    expect(again.modifications[0]?.created).toBe(false)
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })

  test('a teljes visszatérítési listánál csak az újat állítja ki, és együtt pontosan az eredetit adják vissza', async () => {
    const { billingo, tarca } = await invoiced()
    const ledger = memoryLedger()

    await issueForPayment(tarca, partial([refund('TR-1', 3_333)]), { ledger })
    const second = (await issueForPayment(
      tarca,
      partial([refund('TR-1', 3_333), refund('TR-2', 6_667, 3_333)]),
      { ledger },
    )) as IssuedModification

    expect(second.modifications.map((modification) => modification.created)).toEqual([false, true])
    const all = modifications(billingo)
    expect(all).toHaveLength(2)
    expect(all.reduce((sum, document) => sum + document.grossTotal, 0)).toBe(-10_000)
  })

  test('ha a korábbi visszatérítés ledger-bejegyzése lejárt, a teljes listából sem állítja ki újra', async () => {
    const { billingo, tarca } = await invoiced()

    const first = (await issueForPayment(tarca, partial([refund('TR-1', 3_000)]), {
      ledger: memoryLedger(),
    })) as IssuedModification
    const later = (await issueForPayment(
      tarca,
      partial([refund('TR-1', 3_000), refund('TR-2', 2_000, 3_000)]),
      { ledger: memoryLedger() },
    )) as IssuedModification

    expect(later.modifications).toMatchObject([
      { refundId: 'TR-1', created: false, modificationId: first.modifications[0]?.modificationId },
      { refundId: 'TR-2', created: true },
    ])
    expect(modifications(billingo)).toHaveLength(2)
    expect(billingo.count('CreateModificationDocument')).toBe(2)
  })

  test('több áfakulcsnál alapból javaslatot ad, és nem állít ki semmit', async () => {
    const { billingo, tarca, originalId } = await invoiced(MIXED_VAT)

    const result = (await issueForPayment(tarca, partial([refund('TR-1', 6_000)]), {
      ledger: memoryLedger(),
    })) as IssuedRefundProposal

    expect(result).toMatchObject({
      kind: 'refund-proposal',
      document: 'invoice',
      documentId: originalId,
      refunds: [{ refundId: 'TR-1', amount: { minor: 600_000 } }],
    })
    expect(result.reason).toContain('refundItems')
    expect(result.refunds[0]?.items.map((item) => [item.vat, item.grossMinor])).toEqual([
      ['5%', 240_000],
      ['27%', 360_000],
    ])
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test("több áfakulcsnál partialRefund: 'proportional' esetén arányosan, áfakulcsonként egy sorral", async () => {
    const { billingo, tarca } = await invoiced(MIXED_VAT)

    await issueForPayment(tarca, partial([refund('TR-1', 1_000)]), {
      partialRefund: 'proportional',
      ledger: memoryLedger(),
    })

    const [modification] = modifications(billingo)
    expect(modification?.items.map((item) => [item.name, item.vat, item.grossAmount])).toEqual([
      ['Könyv', '5%', -400],
      ['Póló', '27%', -600],
    ])
  })

  test('a refundItems pontosan a megadott tételeket adja vissza negatív egységárral', async () => {
    const { billingo, tarca, originalId } = await invoiced(MIXED_VAT)

    await issueForPayment(tarca, partial([refund('TR-1', 6_000)]), {
      ledger: memoryLedger(),
      refundItems: ({ document, items, refund: current }) => {
        expect(document.id).toBe(originalId)
        expect(items).toHaveLength(2)
        expect(current.id).toBe('TR-1')
        return [{ name: 'Póló', grossUnitPrice: 6_000, vat: 27 }]
      },
    })

    const [modification] = modifications(billingo)
    expect(modification?.items).toMatchObject([{ name: 'Póló', quantity: 1, grossAmount: -6_000 }])
  })

  test('a refundItems eltérő összegére vagy hibás tételére validációs hibát dob, kiállítás nélkül', async () => {
    const { billingo, tarca } = await invoiced(MIXED_VAT)
    const ledger = memoryLedger()
    await expect(
      issueForPayment(tarca, partial([refund('TR-1', 6_000)]), {
        ledger,
        refundItems: () => [{ name: 'Póló', grossUnitPrice: 5_000, vat: 27 }],
      }),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('TR-1') })
    for (const items of [
      [{ name: 'Póló', grossUnitPrice: Number.NaN, vat: 27 }],
      [{ name: 'Póló', grossUnitPrice: -6_000, vat: 27 }],
      [{ name: 'Póló', quantity: 0, grossUnitPrice: 6_000, vat: 27 }],
      [{ name: 'Póló', quantity: Number.POSITIVE_INFINITY, grossUnitPrice: 6_000, vat: 27 }],
      [{ name: 'Póló', grossUnitPrice: 6_000, vat: 33 }],
    ]) {
      await expect(
        issueForPayment(tarca, partial([refund('TR-1', 6_000)]), {
          ledger,
          refundItems: () => items,
        }),
      ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('Póló') })
    }
    expect(billingo.count('CreateModificationDocument')).toBe(0)
    expect(ledger.values.size).toBe(0)
  })

  test('nyugtánál csak javaslatot ad (nyugta nem módosítható)', async () => {
    const { billingo, tarca } = await invoiced(SINGLE_VAT, 'receipt')

    const result = (await issueForPayment(tarca, partial([refund('TR-1', 1_000)]), {
      ledger: memoryLedger(),
    })) as IssuedRefundProposal

    expect(result).toMatchObject({ kind: 'refund-proposal', document: 'receipt' })
    expect(result.reason).toContain('könyvelő')
    expect(result.refunds[0]?.items.reduce((sum, item) => sum + item.grossMinor, 0)).toBe(100_000)
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('ledger nélkül javaslatot ad, okkal', async () => {
    const { billingo, tarca } = await invoiced()

    const result = (await issueForPayment(
      tarca,
      partial([refund('TR-1', 1_000)]),
    )) as IssuedRefundProposal

    expect(result).toMatchObject({ kind: 'refund-proposal', document: 'invoice' })
    expect(result.reason).toContain('vendorId')
    expect(result.reason).toContain('ledger')
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('setIfAbsent nélküli ledgerre konfigurációs hibát dob, kiállítás nélkül', async () => {
    const { billingo, tarca } = await invoiced()
    const { setIfAbsent: _ignored, ...plain } = memoryLedger()

    await expect(
      issueForPayment(tarca, partial([refund('TR-1', 1_000)]), { ledger: plain }),
    ).rejects.toMatchObject({ category: 'configuration' })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('tételes visszatérítés nélkül, skip módban vagy sztornózott számlánál kihagyja', async () => {
    const { tarca, originalId } = await invoiced()

    const noRefunds = await issueForPayment(tarca, partial(undefined))
    const skipMode = await issueForPayment(tarca, partial([refund('TR-1', 1)]), {
      partialRefund: 'skip',
    })
    await tarca.documents.cancel(originalId)
    const cancelled = await issueForPayment(tarca, partial([refund('TR-1', 1_000)]), {
      ledger: memoryLedger(),
    })

    expect(noRefunds).toMatchObject({
      kind: 'skipped',
      reason: expect.stringContaining('tételesen'),
    })
    expect(skipMode).toMatchObject({ kind: 'skipped' })
    expect(cancelled).toMatchObject({
      kind: 'skipped',
      reason: expect.stringContaining('sztornózták'),
    })
  })

  test('a bizonylat előtt érkező részleges visszatérítés in_progress hibát ad, hogy a szolgáltató újraküldje', async () => {
    const { billingo, tarca } = await invoiced()
    const ledger = memoryLedger()

    await expect(
      issueForPayment(tarca, { ...partial([refund('TR-1', 1_000)]), id: 'MAS' }, { ledger }),
    ).rejects.toMatchObject({
      category: 'in_progress',
      message: expect.stringContaining('BARION-MAS'),
    })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
    expect(ledger.values.size).toBe(0)
  })

  test('negatív (előleg) sorú bizonylatnál validációs hibát ad, módosító számla nélkül', async () => {
    const { billingo, tarca } = await invoiced()
    const final: PaymentTarca = {
      ...tarca,
      documents: {
        ...tarca.documents,
        findByVendorId: async (vendorId, options) => {
          const document = await tarca.documents.findByVendorId(vendorId, options)
          return (
            document && {
              ...document,
              items: [
                { name: 'Szolgáltatás', quantity: 1, vat: '27%', grossAmount: 13_810 },
                { name: 'Előleg', quantity: 1, vat: '27%', grossAmount: -3_810 },
              ],
            }
          )
        },
      },
    }

    await expect(
      issueForPayment(final, partial([refund('TR-1', 1_000)]), { ledger: memoryLedger() }),
    ).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('nem olvashatók ki'),
    })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('tétel nélküli bizonylatnál validációs hibát ad, módosító számla nélkül', async () => {
    const { billingo, tarca } = await invoiced()
    const empty: PaymentTarca = {
      ...tarca,
      documents: {
        ...tarca.documents,
        findByVendorId: async (vendorId, options) => {
          const document = await tarca.documents.findByVendorId(vendorId, options)
          return document && { ...document, items: [] }
        },
      },
    }

    await expect(
      issueForPayment(empty, partial([refund('TR-1', 1_000)]), { ledger: memoryLedger() }),
    ).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('nem olvashatók ki'),
    })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('az üres listát adó refundItems ugyanazt a módosítót adja, mint a resolver nélküli', async () => {
    const plain = await invoiced()
    const resolved = await invoiced()

    await issueForPayment(plain.tarca, partial([refund('TR-1', 3_500)]), {
      ledger: memoryLedger(),
    })
    await issueForPayment(resolved.tarca, partial([refund('TR-1', 3_500)]), {
      ledger: memoryLedger(),
      refundItems: () => [],
    })

    const sent = (billingo: ReturnType<typeof createFakeBillingoFetch>) =>
      billingo.requests.find((request) => request.operation === 'CreateModificationDocument')?.body
    expect(sent(plain.billingo)).toMatchObject({ items: [{ unit_price: -3_500 }] })
    expect(sent(resolved.billingo)).toEqual(sent(plain.billingo))
  })

  test('a pénznem eltérésére és a túl nagy visszatérítésre validációs hibát dob', async () => {
    const { billingo, tarca } = await invoiced()
    const ledger = memoryLedger()

    await expect(
      issueForPayment(
        tarca,
        partial([{ id: 'TR-1', amount: { value: 10, minor: 1000, currency: 'EUR' } }]),
        { ledger },
      ),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('EUR') })
    await expect(
      issueForPayment(tarca, partial([refund('TR-1', 10_001)]), { ledger }),
    ).rejects.toMatchObject({ category: 'validation' })
    await expect(
      issueForPayment(tarca, partial([refund('TR-1', 6_000), refund('TR-2', 4_001, 6_000)]), {
        ledger,
      }),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('elveszett válasz után a listából visszakeresi, és nem állít ki másodikat', async () => {
    const { billingo, tarca } = await invoiced()
    const ledger = memoryLedger()
    billingo.fail('network', { operation: 'CreateModificationDocument', afterSuccess: true })
    const event = partial([refund('TR-1', 2_000)])

    const first = (await issueForPayment(tarca, event, { ledger })) as IssuedModification
    const second = (await issueForPayment(tarca, event, { ledger })) as IssuedModification

    expect(first.modifications[0]).toMatchObject({ created: true })
    expect(second.modifications[0]).toMatchObject({
      created: false,
      modificationId: first.modifications[0]?.modificationId,
    })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
    expect(modifications(billingo)).toHaveLength(1)
  })

  test('ha a késő lista még nem mutatja, in_progress hibát dob, és később sem állít ki újat', async () => {
    const { billingo, tarca } = await invoiced()
    const ledger = memoryLedger()
    let lagging = true
    const lagged: PaymentTarca = {
      ...tarca,
      documents: {
        ...tarca.documents,
        list: async (query, options) => {
          const page = await tarca.documents.list(query, options)
          return lagging ? { ...page, data: [], total: 0, lastPage: 1 } : page
        },
      },
    }
    billingo.fail('network', { operation: 'CreateModificationDocument', afterSuccess: true })
    const event = partial([refund('TR-1', 2_000)])

    await expect(issueForPayment(lagged, event, { ledger })).rejects.toMatchObject({
      category: 'in_progress',
    })
    await expect(issueForPayment(lagged, event, { ledger })).rejects.toMatchObject({
      category: 'in_progress',
    })
    lagging = false
    const recovered = (await issueForPayment(lagged, event, { ledger })) as IssuedModification

    expect(recovered.modifications[0]).toMatchObject({ created: true })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
    expect(modifications(billingo)).toHaveLength(1)
  })

  test('két egyidejű kézbesítésből is csak egy módosító számla lesz', async () => {
    const { billingo, tarca } = await invoiced()
    const ledger = memoryLedger()
    const event = partial([refund('TR-1', 2_000)])

    const results = await Promise.allSettled([
      issueForPayment(tarca, event, { ledger }),
      issueForPayment(tarca, event, { ledger }),
    ])

    expect(billingo.count('CreateModificationDocument')).toBe(1)
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ category: 'in_progress' })
      }
    }
  })
})
