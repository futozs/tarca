import { describe, expect, test } from 'vitest'
import { createTarca } from '../client'
import { BillingoError } from '../core/errors'
import type { KeyValueStore } from '../core/store'
import { createFakeBillingoFetch, type FakeBillingoOptions } from '../testing'
import { issueForPayment, paymentVendorId } from './issue'
import type { PaymentCustomer, PaymentEvent } from './types'

const NOW = new Date('2026-10-02T10:00:00Z')

function setup(options: FakeBillingoOptions = {}) {
  const billingo = createFakeBillingoFetch({ now: () => NOW, ...options })
  const tarca = createTarca({ apiKey: 'tarca-teszt-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  return { billingo, tarca }
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

function huf(value: number) {
  return { value, minor: value * 100, currency: 'HUF' }
}

const COMPANY: PaymentCustomer = {
  name: 'Példa Kft.',
  email: 'penzugy@pelda.hu',
  taxNumber: '12345678-2-42',
  address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 1.' },
}

const PERSON: PaymentCustomer = {
  name: 'Kovács Éva',
  email: 'eva@pelda.hu',
  address: { country: 'HU', zip: '1111', city: 'Budapest', line1: 'Fő utca 2.' },
}

function paid(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    provider: 'stripe',
    kind: 'paid',
    id: 'pi_123',
    amount: huf(2540),
    paidAt: '2026-10-01T22:30:00Z',
    method: 'stripe',
    raw: {},
    ...overrides,
  }
}

function refunded(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return paid({ kind: 'refunded', ...overrides })
}

const OPTIONS = { vat: 27, recoveryDelayMs: 0 } as const

describe('paymentVendorId', () => {
  test('a szolgáltató nagybetűs nevéből és a fizetés azonosítójából áll', async () => {
    expect(await paymentVendorId(paid())).toBe('STRIPE-pi_123')
    expect(await paymentVendorId(paid({ provider: 'simplepay', id: '501180380' }))).toBe(
      'SIMPLEPAY-501180380',
    )
    expect(await paymentVendorId(paid({ provider: 'terminal', id: ' 42 ' }))).toBe('TERMINAL-42')
  })

  test('nem biztonságos karakternél vagy 64 karakter fölött rövid, determinisztikus hash-t ad', async () => {
    const weird = await paymentVendorId(paid({ id: 'rendelés/1 ő' }))
    expect(weird).toMatch(/^STRIPE-h[0-9a-f]{16}$/)
    expect(await paymentVendorId(paid({ id: 'rendelés/1 ő' }))).toBe(weird)
    const long = await paymentVendorId(paid({ id: 'x'.repeat(58) }))
    expect(long).toMatch(/^STRIPE-h[0-9a-f]{16}$/)
    expect(await paymentVendorId(paid({ id: 'x'.repeat(57) }))).toBe(`STRIPE-${'x'.repeat(57)}`)
    expect(await paymentVendorId(paid({ id: 'a.b:c-d_e' }))).toBe('STRIPE-a.b:c-d_e')
  })

  test('érvénytelen szolgáltatónévre és üres azonosítóra validációs hibát dob', async () => {
    await expect(paymentVendorId(paid({ provider: 'rossz név' }))).rejects.toMatchObject({
      category: 'validation',
    })
    await expect(paymentVendorId(paid({ id: ' ' }))).rejects.toMatchObject({
      category: 'validation',
    })
  })
})

describe('issueForPayment: sikeres fizetés nyugtával', () => {
  test('magánszemély kis összegű fizetéséről nyugtát ad, pontosan egyszer', async () => {
    const { billingo, tarca } = setup()

    const first = await issueForPayment(tarca, paid(), OPTIONS)
    const second = await issueForPayment(tarca, paid(), OPTIONS)

    expect(first).toMatchObject({ kind: 'receipt', vendorId: 'STRIPE-pi_123', created: true })
    expect(second).toMatchObject({ kind: 'receipt', vendorId: 'STRIPE-pi_123', created: false })
    if (first.kind !== 'receipt' || second.kind !== 'receipt') throw new Error('nyugta várt')
    expect(second.document.id).toBe(first.document.id)
    expect(first.decision?.type).toBe('receipt')
    expect(first.document).toMatchObject({ type: 'receipt', grossTotal: 2540, currency: 'HUF' })
    expect(billingo.count('CreateReceipt')).toBe(1)
    const sent = billingo.requests.find((request) => request.operation === 'CreateReceipt')
    expect(sent?.body).toMatchObject({
      vendor_id: 'STRIPE-pi_123',
      payment_method: 'stripe',
      currency: 'HUF',
      items: [{ name: 'Termék vagy szolgáltatás', unit_price: 2540, vat: '27%' }],
    })
    await issueForPayment(tarca, paid({ id: 'pi_456' }), {
      ...OPTIONS,
      fallbackItemName: ' Előfizetés ',
    })
    expect(
      billingo.requests.filter((request) => request.operation === 'CreateReceipt')[1]?.body,
    ).toMatchObject({ items: [{ name: 'Előfizetés' }] })
  })

  test('a fizetés tételeit és a tételenkénti áfakulcsot átveszi', async () => {
    const { billingo, tarca } = setup()
    const result = await issueForPayment(
      tarca,
      paid({
        amount: huf(2030),
        items: [
          { name: 'Kávé', quantity: 2, totalGross: huf(1780), vat: 27, sku: 'KAVE' },
          { name: 'Kifli', quantity: 1, totalGross: huf(250), vat: 5, unit: 'db' },
        ],
      }),
      { recoveryDelayMs: 0 },
    )
    expect(result).toMatchObject({ kind: 'receipt', created: true })
    const sent = billingo.requests.find((request) => request.operation === 'CreateReceipt')
    expect(sent?.body).toMatchObject({
      items: [
        { name: 'Kávé', quantity: 2, unit_price: 890, vat: '27%' },
        { name: 'Kifli', quantity: 1, unit_price: 250, vat: '5%' },
      ],
    })
  })

  test('nem osztható tételösszegnél is pontosan a fizetett összeget adja, a mennyiség a névbe kerül', async () => {
    const { billingo, tarca } = setup()
    const result = await issueForPayment(
      tarca,
      paid({
        amount: huf(1000),
        items: [{ name: 'Csomag', quantity: 3, totalGross: huf(1000) }],
      }),
      OPTIONS,
    )
    if (result.kind !== 'receipt') throw new Error('nyugta várt')
    expect(result.document.grossTotal).toBe(1000)
    const sent = billingo.requests.find((request) => request.operation === 'CreateReceipt')
    expect(sent?.body).toMatchObject({
      items: [{ name: 'Csomag (3 db)', quantity: 1, unit_price: 1000 }],
    })
  })

  test('a vatFor felülírja a tétel saját áfakulcsát, az items opció a fizetés tételeit', async () => {
    const vatFor = setup()
    await issueForPayment(
      vatFor.tarca,
      paid({ items: [{ name: 'Könyv', quantity: 1, totalGross: huf(2540), vat: 27 }] }),
      { vatFor: () => 5, recoveryDelayMs: 0 },
    )
    expect(
      vatFor.billingo.requests.find((request) => request.operation === 'CreateReceipt')?.body,
    ).toMatchObject({ items: [{ vat: '5%' }] })

    const own = setup()
    await issueForPayment(
      own.tarca,
      paid({ items: [{ name: 'Szolgáltatótól', quantity: 1, totalGross: huf(2540) }] }),
      { items: [{ name: 'Saját rendelésből', grossUnitPrice: 2540, vat: 18 }], recoveryDelayMs: 0 },
    )
    expect(
      own.billingo.requests.find((request) => request.operation === 'CreateReceipt')?.body,
    ).toMatchObject({ items: [{ name: 'Saját rendelésből', vat: '18%' }] })
  })

  test('áfakulcs nélkül vagy ismeretlen áfakulccsal validációs hiba, kérés nélkül', async () => {
    const { billingo, tarca } = setup()
    await expect(issueForPayment(tarca, paid())).rejects.toMatchObject({
      category: 'validation',
      hint: expect.stringContaining('vat'),
    })
    await expect(
      issueForPayment(
        tarca,
        paid({ items: [{ name: 'Bor', quantity: 1, totalGross: huf(2540), vat: 33 }] }),
      ),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.requests).toHaveLength(0)
  })

  test('nem pozitív mennyiségű tételre és összeg nélküli, tétel nélküli fizetésre validációs hibát dob', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(
        tarca,
        paid({ items: [{ name: 'Hibás', quantity: 0, totalGross: huf(2540) }] }),
        OPTIONS,
      ),
    ).rejects.toMatchObject({ category: 'validation' })
    await expect(
      issueForPayment(tarca, paid({ amount: undefined }), OPTIONS),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.requests).toHaveLength(0)
  })

  test('összeg nélkül a megadott tételekből és pénznemből dolgozik', async () => {
    const { billingo, tarca } = setup()
    const result = await issueForPayment(tarca, paid({ amount: undefined }), {
      items: [{ name: 'Belépő', grossUnitPrice: 10, vat: 27 }],
      currency: 'EUR',
      conversionRate: 400,
      recoveryDelayMs: 0,
    })
    expect(result).toMatchObject({
      kind: 'receipt',
      conversion: { rate: 400, source: 'option' },
    })
    expect(billingo.count('GetConversionRate')).toBe(0)
    expect(
      billingo.requests.find((request) => request.operation === 'CreateReceipt')?.body,
    ).toMatchObject({ currency: 'EUR', conversion_rate: 400 })
  })

  test('eltérő tételösszegnél validációs hibát dob, kivéve allowAmountMismatch mellett', async () => {
    const { tarca } = setup()
    const items = [{ name: 'Termék', grossUnitPrice: 2000, vat: 27 }] as const
    await expect(issueForPayment(tarca, paid(), { items })).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('eltér'),
    })
    await expect(
      issueForPayment(tarca, paid(), { items, allowAmountMismatch: true, recoveryDelayMs: 0 }),
    ).resolves.toMatchObject({ kind: 'receipt', created: true })
  })

  test('egy fillér eltérést is észrevesz (egész minor unitban hasonlít, tűrés nélkül)', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(tarca, paid({ amount: { value: 2540.01, minor: 254001, currency: 'HUF' } }), {
        vat: 27,
      }),
    ).resolves.toMatchObject({ kind: 'receipt' })
    await expect(
      issueForPayment(tarca, paid({ id: 'pi_2', amount: huf(2540) }), {
        items: [{ name: 'Termék', grossUnitPrice: 2540.01, vat: 27 }],
      }),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.count('CreateReceipt')).toBe(1)
  })

  test('0 Ft-os fizetésről nem készít bizonylatot', async () => {
    const { billingo, tarca } = setup()
    await expect(issueForPayment(tarca, paid({ amount: huf(0) }), OPTIONS)).resolves.toMatchObject({
      kind: 'skipped',
      reason: expect.stringContaining('0'),
    })
    expect(billingo.requests).toHaveLength(0)
  })

  test('negatív, nem egész vagy egymásnak ellentmondó összegre validációs hibát dob', async () => {
    const { billingo, tarca } = setup()
    for (const amount of [
      { value: -1, minor: -100, currency: 'HUF' },
      { value: 1.5, minor: 1.5, currency: 'HUF' },
      { value: 2540, minor: 2540, currency: 'HUF' },
    ]) {
      await expect(issueForPayment(tarca, paid({ amount }), OPTIONS)).rejects.toMatchObject({
        category: 'validation',
      })
    }
    await expect(
      issueForPayment(tarca, paid({ amount: { value: -1, minor: -100, currency: 'HUF' } }), {
        ...OPTIONS,
        document: 'receipt',
      }),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.requests).toHaveLength(0)
  })

  test('ismeretlen pénznemre és a pénznemek eltérésére validációs hibát dob, kérés nélkül', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(tarca, paid({ amount: { value: 1, minor: 100, currency: 'BTC' } }), OPTIONS),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('BTC') })
    await expect(
      issueForPayment(tarca, paid(), { ...OPTIONS, currency: 'EUR' }),
    ).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('pénzneme'),
    })
    expect(billingo.requests).toHaveLength(0)
  })

  test('devizás fizetésnél a Billingo árfolyamát kéri a teljesítés napjára, és jelzi', async () => {
    const { billingo, tarca } = setup()
    const result = await issueForPayment(
      tarca,
      paid({ amount: { value: 12.5, minor: 1250, currency: 'EUR' } }),
      OPTIONS,
    )
    expect(result).toMatchObject({
      kind: 'receipt',
      conversion: { rate: 390, source: 'billingo' },
      decision: { grossTotalHuf: 4875 },
    })
    const rate = billingo.requests.find((request) => request.operation === 'GetConversionRate')
    expect(rate?.query).toMatchObject({ from: 'EUR', to: 'HUF', date: '2026-10-02' })
    expect(
      billingo.requests.find((request) => request.operation === 'CreateReceipt')?.body,
    ).toMatchObject({ currency: 'EUR', conversion_rate: 390 })
  })

  test('a fizetési módot és a nyugta extra mezőit a hívó felülírhatja', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), {
      ...OPTIONS,
      method: 'bankcard',
      receipt: { electronic: true },
    })
    await issueForPayment(tarca, paid({ id: 'pi_456' }), {
      ...OPTIONS,
      method: 'bankcard',
      receipt: { paymentMethod: 'cash' },
    })
    const receipts = billingo.requests.filter((request) => request.operation === 'CreateReceipt')
    expect(receipts[0]?.body).toMatchObject({ payment_method: 'bankcard', electronic: true })
    expect(receipts[1]?.body).toMatchObject({ payment_method: 'cash' })
  })

  test('a lock beállítást a createOnce-nak, a megszakító jelet minden kérésnek továbbadja', async () => {
    const { billingo, tarca } = setup()
    const lock = memoryLedger()
    const keys: string[] = []
    await issueForPayment(tarca, paid(), {
      ...OPTIONS,
      lock: {
        ...lock,
        setIfAbsent: (key, value, ttl) => {
          keys.push(key)
          return lock.setIfAbsent?.(key, value, ttl) ?? false
        },
      },
    })
    expect(keys).toEqual([expect.stringMatching(/^tarca:once:[0-9a-f]{64}$/)])

    const before = billingo.requests.length
    const signal = AbortSignal.abort(new DOMException('Megszakítva.', 'AbortError'))
    for (const kind of ['paid', 'refunded', 'partially-refunded'] as const) {
      await expect(
        issueForPayment(
          tarca,
          paid({ id: 'pi_abort', kind, refunds: [{ id: 're_1', amount: huf(100) }] }),
          { ...OPTIONS, signal, ledger: memoryLedger() },
        ),
      ).rejects.toMatchObject({ name: 'AbortError' })
    }
    expect(billingo.requests.length).toBe(before)
  })

  test('érvénytelen beállításokra hibát dob, kérés nélkül', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(tarca, paid(), { ...OPTIONS, recoveryDelayMs: -1 }),
    ).rejects.toMatchObject({ category: 'configuration' })
    await expect(
      issueForPayment(tarca, paid(), { vat: 27, conversionRate: 0 }),
    ).rejects.toMatchObject({ category: 'validation' })
    await expect(
      issueForPayment(tarca, paid(), {
        vat: 27,
        method: 'kartya' as unknown as 'cash',
      }),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.requests).toHaveLength(0)
  })

  test('elveszett válasz után sem állít ki második nyugtát (afterSuccess)', async () => {
    const { billingo, tarca } = setup()
    billingo.fail('network', { operation: 'CreateReceipt', afterSuccess: true })

    const first = await issueForPayment(tarca, paid(), OPTIONS)
    const second = await issueForPayment(tarca, paid(), OPTIONS)

    expect(first).toMatchObject({ kind: 'receipt', created: true })
    expect(second).toMatchObject({ kind: 'receipt', created: false })
    expect(billingo.count('CreateReceipt')).toBe(1)
    expect(
      [...billingo.data.documents.values()].filter((record) => record.vendorId === 'STRIPE-pi_123'),
    ).toHaveLength(1)
  })

  test('a pénztárgép-köteles tevékenységnél validációs hibát dob', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(tarca, paid(), { ...OPTIONS, cashRegisterRequired: true }),
    ).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('pénztárgép'),
    })
    expect(billingo.count('CreateReceipt')).toBe(0)
  })

  test('a bizonylattípushoz nem illő áfakulcsra írás előtt validációs hibát dob', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(tarca, paid(), { vat: '0%', recoveryDelayMs: 0 }),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('nyugtán') })
    await expect(
      issueForPayment(tarca, paid({ customer: COMPANY }), { vat: 'none', recoveryDelayMs: 0 }),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('számlán') })
    expect(billingo.count('CreateReceipt') + billingo.count('CreateDocument')).toBe(0)
  })

  test('a pénznemben le nem írható tételösszegre és eltérő pénznemű tételre validációs hibát dob', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(tarca, paid({ amount: { value: 1500, minor: 1500, currency: 'JPY' } }), {
        items: [{ name: 'Tea', grossUnitPrice: 10.5, vat: 27 }],
        conversionRate: 2.5,
      }),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('Tea') })
    await expect(
      issueForPayment(
        tarca,
        paid({
          items: [
            { name: 'Kávé', quantity: 1, totalGross: { value: 10, minor: 1000, currency: 'EUR' } },
          ],
        }),
        OPTIONS,
      ),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('EUR') })
    expect(billingo.requests).toHaveLength(0)
  })
})

describe('issueForPayment: számla', () => {
  test('adószámos vevőnek fizetett számlát állít ki, egyszer, adószámos partnerrel', async () => {
    const { billingo, tarca } = setup()
    const payment = paid({ customer: COMPANY })

    const first = await issueForPayment(tarca, payment, OPTIONS)
    const second = await issueForPayment(tarca, payment, OPTIONS)

    expect(first).toMatchObject({ kind: 'invoice', created: true, paymentRecorded: true })
    expect(second).toMatchObject({ kind: 'invoice', created: false, paymentRecorded: false })
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(billingo.count('UpdatePayment')).toBe(1)
    const partner = billingo.requests.find((request) => request.operation === 'CreatePartner')
    expect(partner?.body).toMatchObject({
      name: 'Példa Kft.',
      taxcode: '12345678-2-42',
      tax_type: 'HAS_TAX_NUMBER',
      address: { country_code: 'HU', post_code: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    })
    const document = billingo.requests.find((request) => request.operation === 'CreateDocument')
    expect(document?.body).toMatchObject({
      vendor_id: 'STRIPE-pi_123',
      type: 'invoice',
      payment_method: 'stripe',
      fulfillment_date: '2026-10-02',
      items: [{ unit_price: 2540, unit_price_type: 'gross', vat: '27%' }],
    })
    expect(document?.body).not.toHaveProperty('paid')
    const payments = billingo.requests.find((request) => request.operation === 'UpdatePayment')
    expect(payments?.body).toEqual([{ date: '2026-10-02', price: 2540, payment_method: 'stripe' }])
    if (first.kind !== 'invoice') throw new Error('számla várt')
    const stored = billingo.data.documents.get(first.document.id ?? 0)
    expect(stored?.document.paymentStatus).toBe('paid')
  })

  test('ha a befizetés rögzítése elbukik, az újraküldés pótolja, új számla nélkül', async () => {
    const { billingo, tarca } = setup()
    billingo.fail('network', { operation: 'UpdatePayment' })

    await expect(issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)).rejects.toThrow()
    const retried = await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)

    expect(retried).toMatchObject({ kind: 'invoice', created: false, paymentRecorded: true })
    expect(billingo.count('CreateDocument')).toBe(1)
    expect(billingo.count('UpdatePayment')).toBe(2)
  })

  test('elveszett válasz után sem állít ki második számlát (afterSuccess)', async () => {
    const { billingo, tarca } = setup()
    billingo.fail('timeout', { operation: 'CreateDocument', afterSuccess: true })

    const first = await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)
    const second = await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)

    expect(first).toMatchObject({ kind: 'invoice', created: true })
    expect(second).toMatchObject({ kind: 'invoice', created: false })
    expect(billingo.count('CreateDocument')).toBe(1)
  })

  test('a befizetés összege a Billingo által számolt bruttó, így a számla pontosan fizetett lesz', async () => {
    const { billingo, tarca } = setup()
    const result = await issueForPayment(
      tarca,
      paid({ customer: COMPANY, amount: huf(999) }),
      OPTIONS,
    )
    if (result.kind !== 'invoice') throw new Error('számla várt')
    const payments = billingo.requests.find((request) => request.operation === 'UpdatePayment')
    expect(payments?.body).toEqual([
      { date: '2026-10-02', price: result.document.grossTotal, payment_method: 'stripe' },
    ])
    expect(billingo.data.documents.get(result.document.id ?? 0)?.document.paymentStatus).toBe(
      'paid',
    )
  })

  test('adószámos vevőnél cím nélkül validációs hibát dob, számla nélkül', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(
        tarca,
        paid({ customer: { name: 'Példa Kft.', taxNumber: '12345678-2-42' } }),
        OPTIONS,
      ),
    ).rejects.toMatchObject({ category: 'validation', hint: expect.stringContaining('partner') })
    expect(billingo.count('CreateDocument')).toBe(0)
  })

  test('900 000 Ft-tól számlát állít ki', async () => {
    const { tarca } = setup()
    await expect(
      issueForPayment(tarca, paid({ amount: huf(900_000), customer: PERSON }), OPTIONS),
    ).resolves.toMatchObject({ kind: 'invoice', created: true })
  })

  test('számlakérésnél, a buyerIsBusiness és a customer.isBusiness jelzésnél számlát ad', async () => {
    for (const options of [{ invoiceRequested: true }, { buyerIsBusiness: true }] as const) {
      const { tarca } = setup()
      await expect(
        issueForPayment(tarca, paid({ customer: PERSON }), { ...OPTIONS, ...options }),
      ).resolves.toMatchObject({ kind: 'invoice' })
    }
    const { tarca } = setup()
    await expect(
      issueForPayment(tarca, paid({ customer: { ...PERSON, isBusiness: true } }), OPTIONS),
    ).resolves.toMatchObject({ kind: 'invoice' })
  })

  test('a magánszemély vevő NO_TAX_NUMBER, az EU-s vevő FOREIGN partner lesz', async () => {
    const person = setup()
    await issueForPayment(person.tarca, paid({ customer: PERSON }), {
      ...OPTIONS,
      invoiceRequested: true,
    })
    expect(
      person.billingo.requests.find((request) => request.operation === 'CreatePartner')?.body,
    ).toMatchObject({ tax_type: 'NO_TAX_NUMBER', emails: ['eva@pelda.hu'] })

    const foreign = setup()
    await issueForPayment(
      foreign.tarca,
      paid({
        customer: {
          name: 'Muster GmbH',
          euTaxNumber: 'ATU12345678',
          address: { country: 'AT', zip: '1010', city: 'Wien', line1: 'Ring 1' },
        },
      }),
      { ...OPTIONS, vat: 'AAM' },
    )
    expect(
      foreign.billingo.requests.find((request) => request.operation === 'CreatePartner')?.body,
    ).toMatchObject({
      taxcode: 'ATU12345678',
      tax_type: 'FOREIGN',
      address: { country_code: 'AT' },
    })
  })

  test('a FOREIGN adótípusú megadott partner is cégnek számít, így számla készül', async () => {
    const { billingo, tarca } = setup()
    const result = await issueForPayment(tarca, paid(), {
      ...OPTIONS,
      partner: {
        name: 'Beispiel GmbH',
        address: { countryCode: 'AT', postCode: '1010', city: 'Wien', address: 'Ring 1.' },
        taxcode: 'ATU12345678',
        taxType: 'FOREIGN',
      },
    })
    expect(result).toMatchObject({ kind: 'invoice', created: true })
    expect(billingo.count('CreateReceipt')).toBe(0)
  })

  test('a document opcióval kényszerített típust a döntésben jelzi', async () => {
    const { tarca } = setup()
    const invoice = await issueForPayment(tarca, paid({ customer: PERSON }), {
      ...OPTIONS,
      document: 'invoice',
    })
    expect(invoice).toMatchObject({
      kind: 'invoice',
      decision: {
        type: 'invoice',
        reasons: ['A bizonylat típusát a hívó adta meg.'],
        grossTotalHuf: 2540,
      },
    })
    const foreign = await issueForPayment(
      tarca,
      paid({ id: 'pi_eur', amount: { value: 10, minor: 1000, currency: 'EUR' } }),
      { ...OPTIONS, document: 'receipt', conversionRate: 400 },
    )
    expect(foreign).toMatchObject({ kind: 'receipt', decision: { grossTotalHuf: 4000 } })
  })

  test('a befizetést újraküldéskor is a számla saját árfolyamával pótolja, új árfolyam-lekérés nélkül', async () => {
    const { billingo, tarca } = setup()
    const payment = paid({
      amount: { value: 12.5, minor: 1250, currency: 'EUR' },
      customer: COMPANY,
    })
    billingo.fail('network', { operation: 'UpdatePayment' })

    await expect(
      issueForPayment(tarca, payment, { ...OPTIONS, conversionRate: 395.5 }),
    ).rejects.toThrow()
    const retried = await issueForPayment(tarca, payment, OPTIONS)

    expect(retried).toMatchObject({ kind: 'invoice', created: false, paymentRecorded: true })
    const updates = billingo.requests.filter((request) => request.operation === 'UpdatePayment')
    expect(updates.at(-1)?.body).toEqual([
      { date: '2026-10-02', price: 12.5, payment_method: 'stripe', conversion_rate: 395.5 },
    ])
    expect(billingo.count('GetConversionRate')).toBe(0)
  })

  test('devizás számlánál átadja az árfolyamot, a befizetésnél is', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(
      tarca,
      paid({ amount: { value: 12.5, minor: 1250, currency: 'EUR' }, customer: COMPANY }),
      { ...OPTIONS, conversionRate: 395.5 },
    )
    expect(
      billingo.requests.find((request) => request.operation === 'CreateDocument')?.body,
    ).toMatchObject({ currency: 'EUR', conversion_rate: 395.5 })
    expect(
      billingo.requests.find((request) => request.operation === 'UpdatePayment')?.body,
    ).toEqual([
      { date: '2026-10-02', price: 12.5, payment_method: 'stripe', conversion_rate: 395.5 },
    ])
  })

  test('a magyar vevő csak közösségi adószámmal validációs hibát kap', async () => {
    const { billingo, tarca } = setup()
    await expect(
      issueForPayment(
        tarca,
        paid({ customer: { ...COMPANY, taxNumber: undefined, euTaxNumber: 'HU12345678' } }),
        OPTIONS,
      ),
    ).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('belföldi'),
    })
    expect(billingo.count('CreateDocument')).toBe(0)
  })

  test('a megadott teljesítési napot a számlára és az árfolyam napjára is használja, a hibásat elutasítja', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(
      tarca,
      paid({ amount: { value: 12.5, minor: 1250, currency: 'EUR' }, customer: COMPANY }),
      { ...OPTIONS, invoice: { fulfillmentDate: '2026-09-30', comment: 'Webshop' } },
    )
    expect(
      billingo.requests.find((request) => request.operation === 'GetConversionRate')?.query,
    ).toMatchObject({ date: '2026-09-30' })
    expect(
      billingo.requests.find((request) => request.operation === 'CreateDocument')?.body,
    ).toMatchObject({ fulfillment_date: '2026-09-30', comment: 'Webshop' })
    await expect(
      issueForPayment(tarca, paid({ id: 'pi_rossz', customer: COMPANY }), {
        ...OPTIONS,
        invoice: { fulfillmentDate: '2026-02-30' },
      }),
    ).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('2026-02-30'),
    })
  })

  test('a megadott partnert és vendorId-t használja', async () => {
    const { billingo, tarca } = setup()
    const result = await issueForPayment(tarca, paid(), {
      ...OPTIONS,
      vendorId: ' WEB-1001 ',
      partner: {
        name: 'Saját Kft.',
        address: { postCode: '6720', city: 'Szeged', address: 'Kárász utca 1.' },
        taxcode: '87654321-2-06',
        taxType: 'HAS_TAX_NUMBER',
      },
    })
    expect(result).toMatchObject({ kind: 'invoice', vendorId: 'WEB-1001' })
    expect(
      billingo.requests.find((request) => request.operation === 'CreateDocument')?.body,
    ).toMatchObject({ vendor_id: 'WEB-1001' })
  })
})

describe('issueForPayment: nem sikeres fizetés', () => {
  test('a sikertelen és egyéb állapotot kihagyja, kérés nélkül', async () => {
    const { billingo, tarca } = setup()
    await expect(issueForPayment(tarca, paid({ kind: 'failed' }))).resolves.toMatchObject({
      kind: 'skipped',
      reason: expect.stringContaining('failed'),
    })
    await expect(issueForPayment(tarca, paid({ kind: 'other' }))).resolves.toMatchObject({
      kind: 'skipped',
    })
    expect(billingo.requests).toHaveLength(0)
  })
})

describe('issueForPayment: teljes visszatérítés', () => {
  test('a nyugtát pontosan egyszer sztornózza', async () => {
    const { billingo, tarca } = setup()
    const issued = await issueForPayment(tarca, paid(), OPTIONS)
    if (issued.kind !== 'receipt') throw new Error('nyugta várt')

    const first = await issueForPayment(tarca, refunded(), OPTIONS)
    const second = await issueForPayment(tarca, refunded(), OPTIONS)

    expect(first).toMatchObject({
      kind: 'cancellation',
      document: 'receipt',
      originalId: issued.document.id,
      created: true,
      cancellation: { type: 'receipt_cancellation' },
    })
    expect(second).toMatchObject({ kind: 'cancellation', created: false, cancellation: undefined })
    expect(billingo.count('CancelDocument')).toBe(1)
  })

  test('a számlát pontosan egyszer sztornózza', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)

    const first = await issueForPayment(tarca, refunded(), OPTIONS)
    const second = await issueForPayment(tarca, refunded(), OPTIONS)

    expect(first).toMatchObject({ kind: 'cancellation', document: 'invoice', created: true })
    expect(second).toMatchObject({ kind: 'cancellation', document: 'invoice', created: false })
    expect(billingo.count('CancelDocument')).toBe(1)
  })

  test('bizonylat nélkül kihagyja a visszatérítést', async () => {
    const { billingo, tarca } = setup()
    await expect(issueForPayment(tarca, refunded(), OPTIONS)).resolves.toMatchObject({
      kind: 'skipped',
      reason: expect.stringContaining('nem található'),
    })
    expect(billingo.count('CancelDocument')).toBe(0)
  })

  test('visszatérítés után érkező fizetési értesítésre nem állít ki új bizonylatot', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), OPTIONS)
    await issueForPayment(tarca, refunded(), OPTIONS)

    const late = await issueForPayment(tarca, paid(), OPTIONS)

    expect(late).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('sztornózták') })
    expect(billingo.count('CreateReceipt')).toBe(1)
  })

  test('elveszett válasz után a cancelled jelző dönt: létrejöttnek jelzi, második sztornó nélkül', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), OPTIONS)
    billingo.fail('network', { operation: 'CancelDocument', afterSuccess: true })

    const result = await issueForPayment(tarca, refunded(), OPTIONS)
    const again = await issueForPayment(tarca, refunded(), OPTIONS)

    expect(result).toMatchObject({ kind: 'cancellation', created: true, cancellation: undefined })
    expect(again).toMatchObject({ kind: 'cancellation', created: false })
    expect(billingo.count('CancelDocument')).toBe(1)
  })

  test('ha a sztornó sorsa nem dönthető el, az eredeti hibát dobja tovább, második POST nélkül', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), OPTIONS)
    billingo.fail('network', { operation: 'CancelDocument' })

    const failure = await issueForPayment(tarca, refunded(), OPTIONS).catch((error) => error)

    expect(failure).toBeInstanceOf(BillingoError)
    expect(failure).toMatchObject({ category: 'network', operation: 'CancelDocument' })
    expect(billingo.count('CancelDocument')).toBe(1)
    expect(billingo.count('GetDocument')).toBe(1)
    await expect(issueForPayment(tarca, refunded(), OPTIONS)).resolves.toMatchObject({
      created: true,
    })
    expect(billingo.count('CancelDocument')).toBe(2)
  })

  test('ha a bizonytalan sztornó után a visszaolvasás sem sikerül, az eredeti hibát dobja', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), OPTIONS)
    billingo.fail('timeout', { operation: 'CancelDocument' })
    billingo.fail({ status: 403, message: 'Forbidden' }, { operation: 'GetDocument' })

    await expect(issueForPayment(tarca, refunded(), OPTIONS)).rejects.toMatchObject({
      category: 'timeout',
      operation: 'CancelDocument',
    })
    expect(billingo.count('CancelDocument')).toBe(1)
    expect(billingo.count('GetDocument')).toBe(1)
  })

  test('a bizonytalan sztornó után ismételhető visszaolvasási hibánál másodszor is megnézi', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), OPTIONS)
    billingo.fail('timeout', { operation: 'CancelDocument', afterSuccess: true })
    billingo.fail(
      { status: 503, message: 'Service Unavailable' },
      { operation: 'GetDocument', times: 3 },
    )

    await expect(issueForPayment(tarca, refunded(), OPTIONS)).resolves.toMatchObject({
      kind: 'cancellation',
      created: true,
    })
    expect(billingo.count('CancelDocument')).toBe(1)
    expect(billingo.count('GetDocument')).toBe(4)
  })

  test('egyidejű sztornónál a 400-as elutasítás után a már sztornózott bizonylatot jelzi, módosító nélkül', async () => {
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    let raced = false
    const tarca = createTarca({
      apiKey: 'tarca-teszt-kulcs',
      retryDelayMs: 0,
      fetch: async (resource, init) => {
        if (!raced && String(resource).endsWith('/cancel')) {
          raced = true
          await billingo.fetch(resource, init)
        }
        return billingo.fetch(resource, init)
      },
    })
    await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)

    const result = await issueForPayment(tarca, refunded(), { ...OPTIONS, ledger: memoryLedger() })

    expect(result).toMatchObject({ kind: 'cancellation', document: 'invoice', created: false })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
    expect(
      [...billingo.data.documents.values()].filter(
        (record) => record.document.type === 'cancellation',
      ),
    ).toHaveLength(1)
  })

  test('a nyugta sztornójának 400-as elutasítását továbbdobja, módosító vagy javaslat nélkül', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), OPTIONS)
    billingo.fail(
      { status: 400, message: 'Cannot cancel the document (id:1).' },
      { operation: 'CancelDocument' },
    )

    await expect(
      issueForPayment(tarca, refunded(), { ...OPTIONS, ledger: memoryLedger() }),
    ).rejects.toMatchObject({ category: 'validation', status: 400, operation: 'CancelDocument' })
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('a nem bizonytalan sztornóhibát változatlanul továbbdobja', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid(), OPTIONS)
    billingo.fail({ status: 403, message: 'Forbidden' }, { operation: 'CancelDocument' })

    await expect(issueForPayment(tarca, refunded(), OPTIONS)).rejects.toMatchObject({
      category: 'forbidden',
    })
    expect(billingo.count('GetDocument')).toBe(0)
  })

  test('módosított számlát nem sztornóz, a maradékra módosító számlát állít ki a ledgerrel, egyszer', async () => {
    const { billingo, tarca } = setup()
    const issued = await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)
    if (issued.kind !== 'invoice') throw new Error('számla várt')
    const id = issued.document.id ?? 0
    await tarca.documents.createModification(id, {
      items: [{ name: 'Kézi jóváírás', quantity: 1, grossUnitPrice: -540, vat: 27 }],
    })
    const ledger = memoryLedger()

    const first = await issueForPayment(tarca, refunded(), { ...OPTIONS, ledger })
    const second = await issueForPayment(tarca, refunded(), { ...OPTIONS, ledger })

    expect(first).toMatchObject({
      kind: 'modification',
      originalId: id,
      created: true,
      modifications: [{ refundId: 'teljes', created: true, amount: { minor: -200_000 } }],
    })
    expect(second).toMatchObject({
      kind: 'modification',
      created: false,
      modifications: [{ refundId: 'teljes', created: false, amount: { minor: -200_000 } }],
    })
    expect(billingo.count('CancelDocument')).toBe(0)
    expect(billingo.count('CreateModificationDocument')).toBe(2)
    const modifications = [...billingo.data.documents.values()].filter(
      (record) => record.document.type === 'modification',
    )
    expect(modifications.map((record) => record.document.grossTotal).sort()).toEqual([-2000, -540])
  })

  test('módosított számlánál ledger nélkül javaslatot ad', async () => {
    const { billingo, tarca } = setup()
    const issued = await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)
    if (issued.kind !== 'invoice') throw new Error('számla várt')
    await tarca.documents.createModification(issued.document.id ?? 0, {
      items: [{ name: 'Kézi jóváírás', quantity: 1, grossUnitPrice: -540, vat: 27 }],
    })

    const result = await issueForPayment(tarca, refunded(), OPTIONS)

    expect(result).toMatchObject({
      kind: 'refund-proposal',
      document: 'invoice',
      refunds: [{ refundId: 'teljes', amount: { minor: 200_000 } }],
      reason: expect.stringContaining('ledger'),
    })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })

  test('ha a Billingo 400-zal elutasítja a sztornót, újra lekéri, és a maradékra módosítót ad', async () => {
    const { billingo, tarca } = setup()
    await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)
    billingo.fail(
      { status: 400, message: 'Cannot cancel the document (id:1).' },
      { operation: 'CancelDocument' },
    )

    const result = await issueForPayment(tarca, refunded(), { ...OPTIONS, ledger: memoryLedger() })

    expect(result).toMatchObject({
      kind: 'modification',
      modifications: [{ amount: { minor: -254_000 } }],
    })
    expect(billingo.count('CancelDocument')).toBe(1)
  })

  test('összeget növelő vagy olvashatatlan végösszegű módosító mellett a maradékot nem osztja szét, kiállítás nélkül', async () => {
    const { billingo, tarca } = setup()
    const issued = await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)
    if (issued.kind !== 'invoice') throw new Error('számla várt')
    await tarca.documents.createModification(issued.document.id ?? 0, {
      items: [{ name: 'Pótdíj', quantity: 1, grossUnitPrice: 1000, vat: 27 }],
    })

    await expect(
      issueForPayment(tarca, refunded(), { ...OPTIONS, ledger: memoryLedger() }),
    ).rejects.toMatchObject({ category: 'validation', message: expect.stringContaining('növelő') })

    const blind = {
      ...tarca,
      documents: {
        ...tarca.documents,
        list: async (...args: Parameters<typeof tarca.documents.list>) => {
          const page = await tarca.documents.list(...args)
          return {
            ...page,
            data: page.data.map(({ grossTotal: _dropped, ...document }) => document),
          }
        },
      },
    }
    await expect(
      issueForPayment(blind, refunded(), { ...OPTIONS, ledger: memoryLedger() }),
    ).rejects.toMatchObject({
      category: 'validation',
      message: expect.stringContaining('végösszege'),
    })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })

  test('a teljesen visszatérített módosított számlánál kihagyja', async () => {
    const { billingo, tarca } = setup()
    const issued = await issueForPayment(tarca, paid({ customer: COMPANY }), OPTIONS)
    if (issued.kind !== 'invoice') throw new Error('számla várt')
    await tarca.documents.createModification(issued.document.id ?? 0, {
      items: [{ name: 'Teljes jóváírás', quantity: 1, grossUnitPrice: -2540, vat: 27 }],
    })

    await expect(
      issueForPayment(tarca, refunded(), { ...OPTIONS, ledger: memoryLedger() }),
    ).resolves.toMatchObject({ kind: 'skipped', reason: expect.stringContaining('módosító') })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })
})
