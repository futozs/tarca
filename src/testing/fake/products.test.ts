import { describe, expect, test } from 'vitest'
import {
  createFakeExchangeLog,
  fakeExchangeSpecErrors,
  succeededOperations,
} from '../../../tests/fake-exchanges'
import { loadMergedSpec, SPEC_AVAILABLE } from '../../../tests/openapi'
import { BillingoError } from '../../core/errors'
import { createFakeBillingoFetch } from '../fake-billingo'
import { inventoryRoutes, STOCK_TRACKING_DISABLED } from './inventory'
import {
  ENTITLEMENTS,
  ONLY_ONE_PRICE,
  PRICE_REQUIRED,
  PRODUCT_NOT_FOUND,
  productRoutes,
  VATS,
  vatRate,
} from './products'

const log = createFakeExchangeLog()

const PRODUCT = {
  name: 'TARCA-PROBE termék',
  comment: 'TARCA-PROBE',
  currency: 'HUF',
  vat: '27%',
  net_unit_price: 1000,
  unit: 'db',
}

const LIVE_DEFAULTS = {
  general_ledger_number: '',
  general_ledger_taxcode: '',
  entitlement: null,
  ean: '',
  sku: '',
  is_manage: false,
  is_generate_erase_code: false,
  connect_product_id: null,
  apply_discount: false,
  apply_quantity: false,
  is_connect_product: false,
  is_deposit_fee: false,
}

describe('hamis Billingo: termékek', () => {
  test('létrehozás: 201, az élő alapértékek, a bruttó árat a nettóból és az áfakulcsból számolja', async () => {
    const { call } = log.harness()

    const created = await call('POST', '/products', PRODUCT)

    expect(created.status).toBe(201)
    expect(created.body).toEqual({
      id: 1,
      ...PRODUCT,
      gross_unit_price: 1270,
      ...LIVE_DEFAULTS,
      purchase_price: null,
    })
  })

  test('bruttó árból a nettót számolja; áfamentes kódnál a kettő azonos; tizedes árak', async () => {
    const { call } = log.harness()
    const { net_unit_price: _net, ...withoutNet } = PRODUCT

    const gross = await call('POST', '/products', { ...withoutNet, gross_unit_price: 1270 })
    const exempt = await call('POST', '/products', { ...PRODUCT, vat: 'AAM' })
    const euro = await call('POST', '/products', {
      ...PRODUCT,
      currency: 'EUR',
      net_unit_price: 12.34,
      vat: '5,5%',
    })

    const odd = await call('POST', '/products', { ...withoutNet, gross_unit_price: 100 })

    expect(gross.body).toMatchObject({ net_unit_price: 1000, gross_unit_price: 1270 })
    expect(odd.body).toMatchObject({ net_unit_price: 78.74, gross_unit_price: 100 })
    expect(exempt.body).toMatchObject({ net_unit_price: 1000, gross_unit_price: 1000 })
    expect(euro.body).toMatchObject({ net_unit_price: 12.34, gross_unit_price: 13.02 })
    expect([vatRate('27%'), vatRate('5,5%'), vatRate('0%'), vatRate('TAM')]).toEqual([
      0.27, 0.055, 0, 0,
    ])
  })

  test('lekérés és lista: a null beszerzési ár 0-ként olvasódik vissza (élőben így)', async () => {
    const { call } = log.harness()
    await call('POST', '/products', PRODUCT)

    const fetched = await call('GET', '/products/1')
    const listed = await call('GET', '/products')

    expect(fetched.body).toMatchObject({ id: 1, purchase_price: 0 })
    expect(listed.body).toMatchObject({ total: 1, data: [{ id: 1, purchase_price: 0 }] })
  })

  test('validáció: kötelező mezők, ár nélkül és két árral 422, rossz áfakulcs és jogcím', async () => {
    const { call, billingo } = log.harness()

    const empty = await call('POST', '/products', {})
    const both = await call('POST', '/products', { ...PRODUCT, gross_unit_price: 1270 })
    const wrong = await call('POST', '/products', {
      ...PRODUCT,
      vat: '28%',
      entitlement: 'NINCS',
      purchase_price: 'sok',
      connect_product_id: 1.5,
    })

    expect(empty).toMatchObject({ status: 422 })
    expect(empty.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'name', message: 'The name field is required.' },
        { field: 'currency', message: 'The currency field is required.' },
        { field: 'vat', message: 'The vat field is required.' },
        { field: 'unit', message: 'The unit field is required.' },
        { field: 'net_unit_price', message: PRICE_REQUIRED },
      ],
    })
    expect(both.body).toEqual({
      message: 'Validation Failed',
      errors: [{ field: 'net_unit_price', message: ONLY_ONE_PRICE }],
    })
    expect(wrong.body).toEqual({
      message: 'Validation Failed',
      errors: [
        { field: 'vat', message: 'The selected vat is invalid.' },
        { field: 'entitlement', message: 'The selected entitlement is invalid.' },
        { field: 'purchase_price', message: 'The purchase price must be a number.' },
        { field: 'connect_product_id', message: 'The connect product id must be an integer.' },
      ],
    })
    expect(billingo.data.products.size).toBe(0)
  })

  test('lista: névrészletre kis- és nagybetűtől függetlenül keres, a legújabb elöl, lapozva', async () => {
    const { call } = log.harness()
    for (const name of ['Kávé szemes', 'Tea', 'KÁVÉ őrölt']) {
      await call('POST', '/products', { ...PRODUCT, name })
    }

    const found = await call('GET', '/products?query=k%C3%A1v%C3%A9')
    const inner = await call('GET', '/products?query=SZEMES')
    const paged = await call('GET', '/products?per_page=2&page=2')

    expect(found.body).toMatchObject({
      total: 2,
      data: [
        { id: 3, name: 'KÁVÉ őrölt' },
        { id: 1, name: 'Kávé szemes' },
      ],
    })
    expect(inner.body).toMatchObject({ total: 1, data: [{ id: 1 }] })
    expect(paged.body).toMatchObject({ total: 3, current_page: 2, last_page: 2, data: [{ id: 1 }] })
  })

  test('módosítás teljes csere: a kihagyott megjegyzés üres lesz, a beszerzési ár null', async () => {
    const { call } = log.harness()
    await call('POST', '/products', { ...PRODUCT, purchase_price: 600, sku: 'A-1' })

    const updated = await call('PUT', '/products/1', {
      name: 'Módosított',
      currency: 'HUF',
      vat: '27%',
      net_unit_price: 2000,
      unit: 'db',
    })

    const invalid = await call('PUT', '/products/1', { name: 'Módosított' })

    expect(invalid.status).toBe(422)
    expect(updated.status).toBe(200)
    expect(updated.body).toEqual({
      id: 1,
      name: 'Módosított',
      comment: '',
      currency: 'HUF',
      vat: '27%',
      net_unit_price: 2000,
      gross_unit_price: 2540,
      unit: 'db',
      ...LIVE_DEFAULTS,
      purchase_price: null,
    })
  })

  test('törlés: 204, utána minden művelet 404 „Product is not found.” (élőben mérve)', async () => {
    const { call, billingo } = log.harness()
    await call('POST', '/products', PRODUCT)

    const deleted = await call('DELETE', '/products/1')
    const after = [
      await call('GET', '/products/1'),
      await call('PUT', '/products/1', PRODUCT),
      await call('DELETE', '/products/1'),
      await call('GET', '/products/99'),
      await call('GET', '/products/abc'),
      await call('GET', '/inventory/product/1/quantity'),
    ]

    expect(deleted.status).toBe(204)
    expect(deleted.bytes).toHaveLength(0)
    expect(after.map((response) => [response.status, response.body])).toEqual(
      Array.from({ length: 6 }, () => [404, { error: { message: PRODUCT_NOT_FOUND } }]),
    )
    expect(billingo.data.products.size).toBe(0)
  })

  test('a kliens a hamis Billingón: létrehozás, keresés, módosítás, törlés, és nullIfNotFound-képes 404', async () => {
    const { tarca } = log.harness()

    const product = await tarca.products.create({
      name: 'Webfejlesztés',
      currency: 'HUF',
      vat: '27%',
      netUnitPrice: 15_000,
      unit: 'óra',
    })
    const id = product.id ?? 0
    const found = []
    for await (const item of tarca.products.all({ query: 'webfejl' })) found.push(item.id)
    const updated = await tarca.products.update(id, {
      name: 'Webfejlesztés',
      currency: 'HUF',
      vat: '27%',
      grossUnitPrice: 25_400,
      unit: 'óra',
    })
    await tarca.products.delete(id)

    expect(product).toMatchObject({ id: 1, grossUnitPrice: 19_050, purchasePrice: null })
    expect(found).toEqual([id])
    expect(updated).toMatchObject({ netUnitPrice: 20_000, grossUnitPrice: 25_400 })
    await expect(tarca.products.get(id)).rejects.toMatchObject({
      category: 'not_found',
      apiMessage: PRODUCT_NOT_FOUND,
    })
  })
})

describe('hamis Billingo: készlet', () => {
  test('a teszt profil alapállapota: 400 „Automatic order processing is disabled”, mint élőben', async () => {
    const { call, tarca } = log.harness()
    await call('POST', '/products', PRODUCT)

    const raw = await call('GET', '/inventory/product/1/quantity')
    const error = await tarca.inventory.quantity(1).catch((caught: unknown) => caught)

    expect(raw).toMatchObject({
      status: 400,
      body: { error: { message: STOCK_TRACKING_DISABLED } },
    })
    expect(error).toBeInstanceOf(BillingoError)
    expect(error).toMatchObject({ status: 400, apiMessage: STOCK_TRACKING_DISABLED })
    expect((error as BillingoError).message).toContain('készletkezelés')
  })

  test('a stock opcióval a cikkszám szerinti készletet adja, ismeretlen cikkszámra 0-t', async () => {
    const { call, tarca } = log.harness({ stock: { 'KAVE-250': 12.5 } })
    await call('POST', '/products', { ...PRODUCT, sku: 'KAVE-250' })
    await call('POST', '/products', { ...PRODUCT, sku: 'TEA-100' })

    expect(await tarca.inventory.quantity(1)).toEqual({ availableQuantity: 12.5 })
    expect(await tarca.inventory.quantity(2)).toEqual({ availableQuantity: 0 })
    expect((await call('GET', '/inventory/product/2/quantity')).body).toEqual({
      available_quantity: 0,
    })
  })

  test('a stock opció hibás értékét már létrehozáskor elutasítja', () => {
    expect(() => createFakeBillingoFetch({ stock: { A: Number.NaN } })).toThrow(
      'A stock.A értéke véges szám legyen',
    )
    expect(() => createFakeBillingoFetch({ stock: { A: '3' as unknown as number } })).toThrow(
      TypeError,
    )
  })
})

describe.skipIf(!SPEC_AVAILABLE)('hamis Billingo: termék és készlet a friss spec ellen', () => {
  test('az áfakulcs- és jogcímlista azonos a spec Vat és Entitlement enumjával', () => {
    const schemas = loadMergedSpec()?.components.schemas
    expect([...VATS].sort()).toEqual([...(schemas?.Vat?.enum ?? [])].sort())
    expect([...ENTITLEMENTS].sort()).toEqual([...(schemas?.Entitlement?.enum ?? [])].sort())
  })

  test('a fenti tesztek minden válasza megfelel a spec válaszsémájának', () => {
    expect(log.exchanges.length).toBeGreaterThan(30)
    expect(log.exchanges.flatMap(fakeExchangeSpecErrors)).toEqual([])
  })

  test('minden termék- és készletművelet legalább egy sikeres válasza át lett vizsgálva', () => {
    const succeeded = succeededOperations(log.exchanges)
    const operations = Object.keys({ ...productRoutes, ...inventoryRoutes })

    expect(operations).toHaveLength(6)
    expect(operations.filter((operation) => !succeeded.has(operation))).toEqual([])
  })
})
