import { describe, expect } from 'vitest'
import { createTarca, isBillingoError, nullIfNotFound, type ProductInput } from '../../src/index'
import { createFakeBillingoFetch } from '../../src/testing/index'
import { docsClient, docsExample, sentBodies } from './helpers'

const KAVE: ProductInput = {
  name: 'Kávé 250 g',
  currency: 'HUF',
  vat: '27%',
  unit: 'db',
  netUnitPrice: 1_000,
}

function queryString(query: Readonly<Record<string, string>>): string {
  return new URLSearchParams(query).toString()
}

describe('termekek', () => {
  docsExample('termekek', '1 000 Ft nettóból 1 270 Ft bruttó', async () => {
    const { tarca } = docsClient()

    const termek = await tarca.products.create(KAVE)

    expect([termek.netUnitPrice, termek.grossUnitPrice]).toEqual([1_000, 1_270])
  })

  docsExample('termekek', 'termék azonosítóval a számla tételén', async () => {
    const { tarca } = docsClient()
    const termek = await tarca.products.create(KAVE)

    const szamla = await tarca.documents.create({
      partner: {
        name: 'Vevő Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
      items: [{ productId: termek.id ?? 0, quantity: 2 }],
    })

    expect(szamla.grossTotal).toBe(2_540)
  })
})

describe('termekek/lista', () => {
  docsExample('termekek/lista/keres', 'egy oldal és a teljes lista', async () => {
    const { tarca, billingo } = docsClient()
    await tarca.products.create(KAVE)

    const oldal = await tarca.products.list({ query: 'kávé', perPage: 50 })
    const arak: (number | undefined)[] = []
    for await (const termek of tarca.products.all()) arak.push(termek.grossUnitPrice)

    expect(oldal.total).toBe(1)
    expect(arak).toEqual([1_270])
    expect(
      billingo.requests
        .filter((request) => request.operation === 'ListProduct')
        .map((request) => queryString(request.query)),
    ).toEqual(['per_page=50&query=k%C3%A1v%C3%A9', 'page=1&per_page=100'])
  })

  docsExample('termekek/lista/keres', 'hibás perPage-re RangeError', async () => {
    const { tarca, billingo } = docsClient()

    await expect(tarca.products.list({ perPage: 0 })).rejects.toBeInstanceOf(RangeError)
    expect(billingo.requests).toEqual([])
  })

  docsExample('termekek/lista/valasz', 'a listában 0 a beszerzési ár, nem null', async () => {
    const { tarca } = docsClient()
    const termek = await tarca.products.create(KAVE)

    const oldal = await tarca.products.list()

    expect(termek.purchasePrice).toBeNull()
    expect(oldal.data[0]).toMatchObject({
      purchasePrice: 0,
      entitlement: null,
      connectProductId: null,
    })
    expect(oldal).toMatchObject({ total: 1, perPage: 25, currentPage: 1, lastPage: 1 })
  })

  docsExample('termekek/lista/minta', 'kávéra egy találat, a lista mindkét árral', async () => {
    const { tarca } = docsClient()
    await tarca.products.create(KAVE)
    await tarca.products.create({
      name: 'Bögre',
      currency: 'HUF',
      vat: '27%',
      unit: 'db',
      grossUnitPrice: 2_540,
    })

    const kave = await tarca.products.list({ query: 'kávé' })
    const sorok: unknown[] = []
    for await (const termek of tarca.products.all()) {
      sorok.push([termek.name, termek.netUnitPrice, termek.grossUnitPrice, termek.purchasePrice])
    }

    expect(kave.data.map((termek) => termek.name)).toEqual(['Kávé 250 g'])
    expect(sorok).toEqual(
      expect.arrayContaining([
        ['Kávé 250 g', 1_000, 1_270, 0],
        ['Bögre', 2_000, 2_540, 0],
      ]),
    )
  })
})

describe('termekek/letrehozas', () => {
  docsExample('termekek/letrehozas/keres', 'a nettó ár egyedül megy a dróton', async () => {
    const { tarca, billingo } = docsClient()

    const termek = await tarca.products.create({
      name: 'Kávé 250 g',
      comment: 'Pörkölt szemes kávé',
      currency: 'HUF',
      vat: '27%',
      unit: 'db',
      netUnitPrice: 1_000,
      sku: 'KAVE-250',
    })

    expect([termek.id, termek.grossUnitPrice]).toEqual([1, 1_270])
    expect(sentBodies(billingo, 'CreateProduct')).toEqual([
      {
        name: 'Kávé 250 g',
        comment: 'Pörkölt szemes kávé',
        currency: 'HUF',
        vat: '27%',
        unit: 'db',
        net_unit_price: 1000,
        sku: 'KAVE-250',
      },
    ])
  })

  docsExample(
    'termekek/letrehozas/keres',
    'NaN árra validation hiba mindkét ármezőre, kérés nélkül',
    async () => {
      const { tarca, billingo } = docsClient()
      let mezok: string[] = []

      try {
        await tarca.products.create({
          name: 'Kávé 250 g',
          currency: 'HUF',
          vat: '27%',
          unit: 'db',
          netUnitPrice: Number('ezer'),
        })
      } catch (error) {
        if (isBillingoError(error)) {
          expect(error.category).toBe('validation')
          mezok = error.fieldErrors.map((hiba) => hiba.field)
        }
      }

      expect(mezok).toEqual(['netUnitPrice', 'grossUnitPrice'])
      expect(billingo.requests).toEqual([])
    },
  )

  docsExample('termekek/letrehozas/keres', 'ár nélkül és két árral is validation', async () => {
    const { tarca, billingo } = docsClient()
    const { netUnitPrice: _, ...arNelkul } = KAVE

    await expect(tarca.products.create(arNelkul as ProductInput)).rejects.toMatchObject({
      category: 'validation',
    })
    await expect(
      tarca.products.create({ ...KAVE, grossUnitPrice: 1_270 } as unknown as ProductInput),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.requests).toEqual([])
  })

  docsExample('termekek/letrehozas/valasz', 'a válasz null beszerzési árral', async () => {
    const { tarca } = docsClient()

    const termek = await tarca.products.create(KAVE)
    const bruttos = await tarca.products.create({
      name: 'Kávé 1 kg',
      currency: 'HUF',
      vat: '27%',
      unit: 'db',
      grossUnitPrice: 3_990,
    })

    expect(termek).toMatchObject({
      purchasePrice: null,
      entitlement: null,
      connectProductId: null,
      comment: '',
      sku: '',
      ean: '',
    })
    expect(bruttos.netUnitPrice).toBe(3_141.73)
  })

  docsExample(
    'termekek/letrehozas/valasz',
    'bizonytalan hiba után a meglévő terméket adja, nem hoz létre másodikat',
    async () => {
      const { tarca, billingo } = docsClient()
      billingo.fail('network', { operation: 'CreateProduct', afterSuccess: true })
      const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']

      async function termekLetrehozasa(input: ProductInput) {
        try {
          return await tarca.products.create(input)
        } catch (error) {
          if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
          const { data } = await tarca.products.list({ query: input.name })
          return data.find((termek) => termek.name === input.name) ?? tarca.products.create(input)
        }
      }

      const termek = await termekLetrehozasa(KAVE)

      expect(termek.id).toBe(1)
      expect(billingo.count('CreateProduct')).toBe(1)
    },
  )

  docsExample(
    'termekek/letrehozas/minta',
    'nettóból és bruttóból, a NaN ár el sem megy',
    async () => {
      const { tarca, billingo } = docsClient()

      const nettos = await tarca.products.create({ ...KAVE, sku: 'KAVE-250' })
      const bruttos = await tarca.products.create({
        name: 'Kávé 1 kg',
        currency: 'HUF',
        vat: '27%',
        unit: 'db',
        grossUnitPrice: 3_990,
      })
      const hiba = await tarca.products
        .create({
          name: 'Bögre',
          currency: 'HUF',
          vat: '27%',
          unit: 'db',
          netUnitPrice: Number('ezer'),
        })
        .catch((error: unknown) => error)

      expect([nettos.netUnitPrice, nettos.grossUnitPrice, nettos.purchasePrice]).toEqual([
        1_000,
        1_270,
        null,
      ])
      expect([bruttos.netUnitPrice, bruttos.grossUnitPrice]).toEqual([3_141.73, 3_990])
      expect(hiba).toMatchObject({ category: 'validation' })
      expect(billingo.count('CreateProduct')).toBe(2)
    },
  )
})

describe('termekek/lekeres', () => {
  docsExample('termekek/lekeres', 'mindkét ár, 0 beszerzési ár, törlés után null', async () => {
    const { tarca } = docsClient()

    const uj = await tarca.products.create(KAVE)
    const termek = await tarca.products.get(uj.id ?? 0)
    await tarca.products.delete(uj.id ?? 0)
    const torolt = await nullIfNotFound(tarca.products.get(uj.id ?? 0))

    expect([termek.netUnitPrice, termek.grossUnitPrice, termek.purchasePrice]).toEqual([
      1_000, 1_270, 0,
    ])
    expect(torolt).toBeNull()
  })

  docsExample('termekek/lekeres', 'a dróton érkező válasz a dokumentált alakú', async () => {
    const billingo = createFakeBillingoFetch()
    const valaszok: unknown[] = []
    const tarca = createTarca({
      apiKey: 'teszt',
      fetch: async (input, init) => {
        const response = await billingo.fetch(input, init)
        if ((init?.method ?? 'GET') === 'GET') valaszok.push(await response.clone().json())
        return response
      },
    })

    const uj = await tarca.products.create(KAVE)
    await tarca.products.get(uj.id ?? 0)
    await tarca.products.delete(uj.id ?? 0)
    await nullIfNotFound(tarca.products.get(uj.id ?? 0))

    expect(valaszok).toEqual([
      {
        id: 1,
        name: 'Kávé 250 g',
        comment: '',
        currency: 'HUF',
        vat: '27%',
        net_unit_price: 1000,
        gross_unit_price: 1270,
        unit: 'db',
        general_ledger_number: '',
        general_ledger_taxcode: '',
        entitlement: null,
        ean: '',
        sku: '',
        is_manage: false,
        purchase_price: 0,
        is_generate_erase_code: false,
        connect_product_id: null,
        apply_discount: false,
        apply_quantity: false,
        is_connect_product: false,
        is_deposit_fee: false,
      },
      { error: { message: 'Product is not found.' } },
    ])
  })
})

describe('termekek/modositas', () => {
  const kaveTeljes: ProductInput = {
    name: 'Kávé 250 g',
    comment: 'Pörkölt szemes kávé',
    currency: 'HUF',
    vat: '27%',
    unit: 'db',
    netUnitPrice: 1_000,
    sku: 'KAVE-250',
  }

  docsExample(
    'termekek/modositas/keres',
    'a lekért termék nettó ár nélkül, új bruttó árral',
    async () => {
      const { tarca, billingo } = docsClient()
      const uj = await tarca.products.create(kaveTeljes)
      const termekId = uj.id ?? 0

      const { id: _, netUnitPrice: __, ...termek } = await tarca.products.get(termekId)
      const dragabb = await tarca.products.update(termekId, { ...termek, grossUnitPrice: 1_524 })

      expect([dragabb.netUnitPrice, dragabb.comment, dragabb.sku]).toEqual([
        1_200,
        'Pörkölt szemes kávé',
        'KAVE-250',
      ])
      const [torzs] = sentBodies(billingo, 'UpdateProduct')
      expect(torzs).toMatchObject({ gross_unit_price: 1524 })
      expect(torzs).not.toHaveProperty('net_unit_price')
      expect(torzs).not.toHaveProperty('id')
    },
  )

  docsExample('termekek/modositas/keres', 'a lekért termék két árral nem megy el', async () => {
    const { tarca, billingo } = docsClient()
    const uj = await tarca.products.create(KAVE)
    const { id: _, ...termek } = await tarca.products.get(uj.id ?? 0)

    await expect(
      tarca.products.update(uj.id ?? 0, termek as unknown as ProductInput),
    ).rejects.toMatchObject({ category: 'validation' })
    expect(billingo.count('UpdateProduct')).toBe(0)
  })

  docsExample('termekek/modositas/keres', 'csak a kötelezők: ez megy a dróton', async () => {
    const { tarca, billingo } = docsClient()
    const uj = await tarca.products.create(kaveTeljes)

    await tarca.products.update(uj.id ?? 0, { ...KAVE, netUnitPrice: 3_000 })

    expect(sentBodies(billingo, 'UpdateProduct')).toEqual([
      { name: 'Kávé 250 g', currency: 'HUF', vat: '27%', unit: 'db', net_unit_price: 3000 },
    ])
  })

  docsExample(
    'termekek/modositas/valasz',
    'újraszámolt ár, kiürült megjegyzés, null beszerzési ár',
    async () => {
      const { tarca } = docsClient()
      const uj = await tarca.products.create(kaveTeljes)

      const csere = await tarca.products.update(uj.id ?? 0, { ...KAVE, netUnitPrice: 2_000 })

      expect(csere).toMatchObject({
        grossUnitPrice: 2_540,
        comment: '',
        sku: '',
        purchasePrice: null,
      })
    },
  )

  docsExample('termekek/modositas/valasz', 'bizonytalan hiba után megismételhető', async () => {
    const { tarca, billingo } = docsClient()
    const uj = await tarca.products.create(KAVE)
    billingo.fail({ status: 502 }, { operation: 'UpdateProduct' })
    const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']

    async function arValtozas(id: number, input: ProductInput) {
      try {
        return await tarca.products.update(id, input)
      } catch (error) {
        if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
        return tarca.products.update(id, input)
      }
    }

    const termek = await arValtozas(uj.id ?? 0, { ...KAVE, netUnitPrice: 1_200 })

    expect(termek.grossUnitPrice).toBe(1_524)
    expect(billingo.count('UpdateProduct')).toBe(2)
  })

  docsExample('termekek/modositas/minta', 'bruttó árral, majd csonka PUT-tal', async () => {
    const { tarca } = docsClient()
    const uj = await tarca.products.create(kaveTeljes)
    const termekId = uj.id ?? 0

    const { id: _, netUnitPrice: __, ...termek } = await tarca.products.get(termekId)
    const dragabb = await tarca.products.update(termekId, { ...termek, grossUnitPrice: 1_524 })
    const csonka = await tarca.products.update(termekId, { ...KAVE, netUnitPrice: 1_200 })

    expect([dragabb.netUnitPrice, dragabb.grossUnitPrice, dragabb.comment]).toEqual([
      1_200,
      1_524,
      'Pörkölt szemes kávé',
    ])
    expect([csonka.comment, csonka.sku]).toEqual(['', ''])
  })
})

describe('termekek/torles', () => {
  docsExample('termekek/torles', 'törlés 204, utána null, a második törlés csendes', async () => {
    const { tarca, billingo } = docsClient()

    const termek = await tarca.products.create(KAVE)
    await tarca.products.delete(termek.id ?? 0)
    const torolt = await nullIfNotFound(tarca.products.get(termek.id ?? 0))

    async function torol(id: number): Promise<void> {
      try {
        await tarca.products.delete(id)
      } catch (error) {
        if (isBillingoError(error) && error.category === 'not_found') return
        throw error
      }
    }

    expect(torolt).toBeNull()
    expect(
      billingo.requests.find((request) => request.operation === 'DeleteProduct'),
    ).toMatchObject({ method: 'DELETE', path: '/products/1', status: 204 })
    await expect(torol(termek.id ?? 0)).resolves.toBeUndefined()
  })
})

describe('termekek/keszlet', () => {
  docsExample(
    'termekek/keszlet',
    'készletkezelés nélkül 400, a segédfüggvény null-t ad',
    async () => {
      const { tarca } = docsClient()
      await tarca.products.create(KAVE)

      const error = await tarca.inventory.quantity(1).catch((caught: unknown) => caught)

      async function keszlet(termekId: number): Promise<number | null> {
        try {
          return (await tarca.inventory.quantity(termekId)).availableQuantity ?? 0
        } catch (caught) {
          if (isBillingoError(caught) && caught.status === 400) return null
          throw caught
        }
      }

      expect(error).toMatchObject({
        category: 'validation',
        status: 400,
        apiMessage: 'Automatic order processing is disabled',
      })
      expect(isBillingoError(error) && error.hint).toContain('készletkezelést')
      expect(await keszlet(1)).toBeNull()
    },
  )

  docsExample('termekek/keszlet', 'a stock beállítással 42 darab', async () => {
    const billingo = createFakeBillingoFetch({ stock: { 'KAVE-250': 42 } })
    const responses: unknown[] = []
    const tarca = createTarca({
      apiKey: 'teszt',
      fetch: async (input, init) => {
        const response = await billingo.fetch(input, init)
        if (String(input).includes('/inventory/')) responses.push(await response.clone().json())
        return response
      },
    })

    const termek = await tarca.products.create({ ...KAVE, sku: 'KAVE-250' })
    const { availableQuantity } = await tarca.inventory.quantity(termek.id ?? 0)

    expect(availableQuantity).toBe(42)
    expect(responses).toEqual([{ available_quantity: 42 }])
  })
})
