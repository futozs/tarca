import { describe, expect, test } from 'vitest'
import { createTarca } from '../client'
import { addBudapestDays, todayInBudapest } from '../core/dates'
import { BillingoError, isBillingoError } from '../core/errors'
import { createMockTarca, type MockTarcaMethod } from './index'

const ACCOUNT = { name: 'Fő számla', accountNumber: '11773016-11111018', currency: 'HUF' } as const

function methodNames(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, item]) => {
    if (typeof item === 'function') return [`${prefix}${key}`]
    if (typeof item === 'object' && item !== null) return methodNames(item, `${prefix}${key}.`)
    return []
  })
}

describe('createMockTarca', () => {
  test('a valódi kliens fut a hamis Billingo fölött, a hívások naplózva', async () => {
    const tarca = createMockTarca({ taxCode: '12345676-2-42' })

    const organization = await tarca.organization.get()
    const created = await tarca.bankAccounts.create(ACCOUNT)
    const page = await tarca.bankAccounts.list({ perPage: 10 })

    expect(organization).toMatchObject({ taxCode: '12345676-2-42', hasNavConnection: false })
    expect(created).toEqual({
      id: 1,
      ...ACCOUNT,
      accountNumberIban: '',
      swift: '',
      needQr: false,
    })
    expect(page).toEqual({ data: [created], total: 1, perPage: 10, currentPage: 1, lastPage: 1 })
    expect(tarca.calls).toEqual([
      { method: 'organization.get', args: [] },
      { method: 'bankAccounts.create', args: [ACCOUNT] },
      { method: 'bankAccounts.list', args: [{ perPage: 10 }] },
    ])
    expect(tarca.billingo.counts()).toEqual({
      GetOrganizationData: 1,
      CreateBankAccount: 1,
      ListBankAccount: 1,
    })
  })

  test('a valódi kliens validációja fut: a hibás perPage kérés nélkül bukik el', async () => {
    const tarca = createMockTarca()

    await expect(tarca.bankAccounts.list({ perPage: 101 })).rejects.toBeInstanceOf(RangeError)
    expect(tarca.calls.map((call) => call.method)).toEqual(['bankAccounts.list'])
    expect(tarca.billingo.count()).toBe(0)
  })

  test('failNext alapból hálózati hibát ad, kérés nélkül, és csak egyszer', async () => {
    const tarca = createMockTarca()
    tarca.failNext('bankAccounts.create')

    const error = await tarca.bankAccounts.create(ACCOUNT).catch((caught) => caught)
    const created = await tarca.bankAccounts.create(ACCOUNT)

    expect(isBillingoError(error)).toBe(true)
    expect(error).toMatchObject({ category: 'network', retryable: true })
    expect(created.id).toBe(1)
    expect(tarca.billingo.count('CreateBankAccount')).toBe(1)
    expect(tarca.calls).toHaveLength(2)
  })

  test('failNext afterSuccess: a bankszámla létrejön, a hívó mégis hibát kap', async () => {
    const tarca = createMockTarca()
    const custom = new BillingoError('Időtúllépés', { category: 'timeout' })
    tarca.failNext('bankAccounts.create', custom, { afterSuccess: true })

    await expect(tarca.bankAccounts.create(ACCOUNT)).rejects.toBe(custom)
    expect(tarca.billingo.data.bankAccounts.size).toBe(1)
  })

  test('failNext az all() iterátornál: az első lépés dob, afterSuccess-szel a bejárás végén', async () => {
    const tarca = createMockTarca()
    await tarca.bankAccounts.create(ACCOUNT)
    await tarca.bankAccounts.create({ ...ACCOUNT, name: 'Második' })
    tarca.failNext('bankAccounts.all')

    const before: string[] = []
    const early = await (async () => {
      for await (const account of tarca.bankAccounts.all()) before.push(account.name)
    })().catch((caught) => caught)
    const listsBefore = tarca.billingo.count('ListBankAccount')
    tarca.failNext('bankAccounts.all', undefined, { afterSuccess: true })
    const after: string[] = []
    const late = await (async () => {
      for await (const account of tarca.bankAccounts.all()) after.push(account.name)
    })().catch((caught) => caught)

    expect(early).toMatchObject({ category: 'network' })
    expect(before).toEqual([])
    expect(listsBefore).toBe(0)
    expect(late).toMatchObject({ category: 'network' })
    expect(after).toEqual(['Második', 'Fő számla'])
  })

  test('az all() hiba nélkül a hamis Billingo minden oldalát bejárja', async () => {
    const tarca = createMockTarca()
    for (const name of ['A', 'B', 'C']) await tarca.bankAccounts.create({ ...ACCOUNT, name })

    const names: string[] = []
    for await (const account of tarca.bankAccounts.all({ perPage: 2 })) names.push(account.name)

    expect(names).toEqual(['C', 'B', 'A'])
    expect(tarca.calls.at(-1)).toEqual({ method: 'bankAccounts.all', args: [{ perPage: 2 }] })
  })

  test('ismeretlen metódusra a failNext TypeError-t dob', () => {
    const tarca = createMockTarca()

    expect(() => tarca.failNext('bankAccounts.nincs' as MockTarcaMethod)).toThrow(
      'Ismeretlen tarca metódus: bankAccounts.nincs',
    )
    expect(() => tarca.failNext('calls' as MockTarcaMethod)).toThrow(TypeError)
  })

  test('a Tarca minden metódusa műszerezve van, így az új erőforrások maguktól bekerülnek', () => {
    const tarca = createMockTarca()
    const real = methodNames(createTarca({ apiKey: 'x', fetch: tarca.billingo.fetch }))

    expect(real).toContain('documents.payments.add')
    expect(real).toContain('exports.run')
    for (const method of real) {
      expect(() => tarca.failNext(method as MockTarcaMethod)).not.toThrow()
    }
  })

  test('minden erőforrás a hamis Billingón fut, a defaults a valódi kliensbe kerül', async () => {
    const tarca = createMockTarca({
      hufRates: { EUR: 400 },
      stock: { 'SKU-1': 7 },
      defaults: { dueInDays: 15, paymentMethod: 'cash' },
    })
    const today = todayInBudapest()

    const organization = await tarca.organization.get()
    const time = await tarca.utils.serverTime()
    const rate = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' })
    const account = await tarca.bankAccounts.create(ACCOUNT)
    const blocks = await tarca.documentBlocks.list({ type: 'invoice' })
    const partner = await tarca.partners.create({
      name: 'Vevő Kft.',
      address: { postCode: '1011', city: 'Budapest', address: 'Fő utca 1.' },
    })
    const product = await tarca.products.create({
      name: 'Tanácsadás',
      currency: 'HUF',
      vat: '27%',
      unit: 'óra',
      sku: 'SKU-1',
      netUnitPrice: 10_000,
    })
    const stock = await tarca.inventory.quantity(product.id ?? 0)
    const { document, created } = await tarca.documents.createOnce({
      vendorId: 'ORDER-1',
      partner: partner.id ?? 0,
      items: [{ productId: product.id ?? 0, quantity: 2 }],
    })
    const payments = await tarca.documents.payments.add(document.id ?? 0, {
      date: today,
      price: 25_400,
      paymentMethod: 'cash',
    })
    const pdf = await tarca.documents.pdf(document.id ?? 0)
    const receipt = await tarca.receipts.create({
      items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 27 }],
    })
    const spending = await tarca.spendings.create({
      category: 'other',
      currency: 'HUF',
      conversionRate: 1,
      totalGross: 1270,
      totalGrossHuf: 1270,
      totalVatAmount: 270,
      totalVatAmountHuf: 270,
      fulfillmentDate: today,
      invoiceNumber: 'SZLA-1',
      invoiceDate: today,
      dueDate: today,
      paymentMethod: 'cash',
    })
    const job = await tarca.exports.create({
      queryType: 'invoice_date',
      startDate: today,
      endDate: today,
      exportType: 'simple_csv',
    })

    expect(organization.hasNavConnection).toBe(false)
    expect(time.timezone).toBe('Europe/Budapest')
    expect(rate.rate).toBe(400)
    expect(account.id).toBe(1)
    expect(blocks.data.map((block) => block.type)).toContain('invoice')
    expect(stock).toEqual({ availableQuantity: 7 })
    expect(created).toBe(true)
    expect(document).toMatchObject({
      dueDate: addBudapestDays(new Date(), 15),
      paymentMethod: 'cash',
      grossTotal: 25_400,
    })
    expect(payments).toMatchObject([{ price: 25_400, paymentMethod: 'cash' }])
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe('%PDF-')
    expect(receipt).toMatchObject({ type: 'receipt', paymentMethod: 'cash', grossTotal: 600 })
    expect(spending.invoiceNumber).toBe('SZLA-1')
    expect(job.id).toEqual(expect.any(String))
    const resources = new Set(tarca.calls.map((call) => call.method.split('.')[0]))
    const expected = Object.keys(createTarca({ apiKey: 'x', fetch: tarca.billingo.fetch })).filter(
      (key) => key !== 'verifyCredentials',
    )
    expect([...resources].sort()).toEqual(expected.sort())
    expect(tarca.calls.map((call) => call.method)).toContain('documents.payments.add')
  })

  test('verifyCredentials: alapból igaz, credentialsValid: false esetén hamis, a többi hívás auth hibát kap', async () => {
    const valid = createMockTarca()
    const invalid = createMockTarca({ credentialsValid: false })

    await expect(valid.verifyCredentials()).resolves.toBe(true)
    await expect(invalid.verifyCredentials()).resolves.toBe(false)
    await expect(invalid.organization.get()).rejects.toMatchObject({
      category: 'auth',
      status: 401,
    })
    expect(valid.calls).toEqual([{ method: 'verifyCredentials', args: [] }])
  })

  test('a hamis Billingo hibái a valódi újrapróbálással együtt érvényesülnek', async () => {
    const tarca = createMockTarca()
    tarca.billingo.fail({ status: 503 }, { operation: 'GetServerTime', times: 2 })
    tarca.billingo.fail('network', { operation: 'DeleteBankAccount' })
    const created = await tarca.bankAccounts.create(ACCOUNT)

    const time = await tarca.utils.serverTime()
    const error = await tarca.bankAccounts.delete(created.id ?? 0).catch((caught) => caught)

    expect(time.timezone).toBe('Europe/Budapest')
    expect(tarca.billingo.count('GetServerTime')).toBe(3)
    expect(error).toMatchObject({ category: 'network' })
    expect(tarca.billingo.count('DeleteBankAccount')).toBe(1)
    expect(tarca.billingo.data.bankAccounts.size).toBe(1)
  })

  test('reset: üres napló, elfelejtett failNext, friss hamis Billingo', async () => {
    const tarca = createMockTarca({ hufRates: { EUR: 400 } })
    await tarca.bankAccounts.create(ACCOUNT)
    tarca.failNext('currencies.rate')

    tarca.reset()
    const rate = await tarca.currencies.rate({ from: 'EUR', to: 'HUF' })

    expect(rate.rate).toBe(400)
    expect(tarca.calls).toEqual([{ method: 'currencies.rate', args: [{ from: 'EUR', to: 'HUF' }] }])
    expect(tarca.billingo.data.bankAccounts.size).toBe(0)
    expect(tarca.billingo.requests).toHaveLength(1)
  })
})
