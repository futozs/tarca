import { describe, expect, test } from 'vitest'
import { createTarca } from '../client'
import { isDocumentHookError } from '../core/document-events'
import type { KeyValueStore } from '../core/store'
import type { Document } from '../generated/billingo'
import { createFakeBillingoFetch } from '../testing'
import {
  createModificationOnce,
  type ModificationTarca,
  REFUND_LEDGER_KEY_PREFIX,
  REFUND_LEDGER_TTL_SECONDS,
  readRefundLedger,
  refundLedgerKey,
  refundMarker,
  relatedModifications,
} from './modification'

const NOW = new Date('2026-10-02T10:00:00Z')

function memoryLedger(): KeyValueStore & {
  readonly values: Map<string, string>
  readonly ttls: number[]
} {
  const values = new Map<string, string>()
  const ttls: number[] = []
  return {
    values,
    ttls,
    get: (key) => values.get(key),
    set: (key, value, ttl) => {
      ttls.push(ttl)
      values.set(key, value)
    },
    delete: (key) => {
      values.delete(key)
    },
    setIfAbsent: (key, value, ttl) => {
      if (values.has(key)) return false
      ttls.push(ttl)
      values.set(key, value)
      return true
    },
  }
}

async function setup() {
  const billingo = createFakeBillingoFetch({ now: () => NOW })
  const tarca = createTarca({ apiKey: 'tarca-teszt-kulcs', fetch: billingo.fetch, retryDelayMs: 0 })
  const original = await tarca.documents.create({
    partner: {
      name: 'Példa Kft.',
      address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    },
    items: [{ name: 'Szolgáltatás', quantity: 1, grossUnitPrice: 12_700, vat: 27 }],
  })
  return { billingo, tarca, documentId: original.id ?? 0 }
}

const ITEMS = [{ name: 'Visszatérítés', quantity: 1, grossUnitPrice: -1_270, vat: 27 }] as const

function input(documentId: number, ledger: KeyValueStore, refundId = 're_1') {
  return { documentId, vendorId: 'STRIPE-pi_1', refundId, items: ITEMS, ledger }
}

function lagging(tarca: ModificationTarca, lag: { on: boolean }): ModificationTarca {
  return {
    documents: {
      ...tarca.documents,
      list: async (query, options) => {
        const page = await tarca.documents.list(query, options)
        return lag.on ? { ...page, data: [], total: 0, lastPage: 1 } : page
      },
    },
  }
}

describe('refundLedgerKey és refundMarker', () => {
  test('a kulcs determinisztikus, tarca:refund: előtagú, és minden összetevőre érzékeny', async () => {
    const key = await refundLedgerKey('STRIPE-pi_1', 42, 're_1')
    expect(key).toMatch(new RegExp(`^${REFUND_LEDGER_KEY_PREFIX}[0-9a-f]{64}$`))
    expect(await refundLedgerKey('STRIPE-pi_1', 42, 're_1')).toBe(key)
    expect(
      new Set([
        key,
        await refundLedgerKey('STRIPE-pi_2', 42, 're_1'),
        await refundLedgerKey('STRIPE-pi_1', 43, 're_1'),
        await refundLedgerKey('STRIPE-pi_1', 42, 're_2'),
      ]).size,
    ).toBe(4)
    expect(REFUND_LEDGER_TTL_SECONDS).toBe(30 * 86_400)
  })

  test('a jelölő a vendorId-t és a rövid visszatérítés-azonosítót tartalmazza, a hosszút hash-eli', async () => {
    expect(await refundMarker('STRIPE-pi_1', 'ch_1:5000')).toBe(
      'Visszatérítés STRIPE-pi_1 ch_1:5000',
    )
    const hashed = await refundMarker('STRIPE-pi_1', 'ékezetes azonosító')
    expect(hashed).toMatch(/^Visszatérítés STRIPE-pi_1 h[0-9a-f]{16}$/)
    expect(await refundMarker('STRIPE-pi_1', 'x'.repeat(41))).toMatch(/ h[0-9a-f]{16}$/)
  })
})

describe('createModificationOnce', () => {
  test('setIfAbsent nélküli vagy hiányzó ledgerre konfigurációs hibát dob, kérés nélkül', async () => {
    const { billingo, tarca, documentId } = await setup()
    const before = billingo.requests.length
    const { setIfAbsent: _ignored, ...plain } = memoryLedger()
    await expect(createModificationOnce(tarca, input(documentId, plain))).rejects.toMatchObject({
      category: 'configuration',
    })
    await expect(
      createModificationOnce(tarca, {
        ...input(documentId, plain),
        ledger: undefined as unknown as KeyValueStore,
      }),
    ).rejects.toMatchObject({ category: 'configuration' })
    expect(billingo.requests.length).toBe(before)
  })

  test('érvénytelen azonosítókra RangeError-t dob', async () => {
    const { tarca } = await setup()
    const ledger = memoryLedger()
    await expect(createModificationOnce(tarca, input(0, ledger))).rejects.toBeInstanceOf(RangeError)
    await expect(
      createModificationOnce(tarca, { ...input(1, ledger), vendorId: ' ' }),
    ).rejects.toBeInstanceOf(RangeError)
    await expect(createModificationOnce(tarca, input(1, ledger, ''))).rejects.toBeInstanceOf(
      RangeError,
    )
  })

  test('kiállítja, a ledgerbe az azonosítót írja, és másodszorra kérés nélkül created: false', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()

    const first = await createModificationOnce(tarca, {
      ...input(documentId, ledger),
      comment: 'Részleges visszatérítés',
      paymentMethod: 'stripe',
    })
    const before = billingo.requests.length
    const second = await createModificationOnce(tarca, input(documentId, ledger))

    expect(first).toMatchObject({ created: true, grossTotal: -1_270 })
    expect(first.document?.comment).toBe('Részleges visszatérítés (Visszatérítés STRIPE-pi_1 re_1)')
    expect(second).toMatchObject({
      created: false,
      modificationId: first.modificationId,
      grossTotal: -1_270,
      document: undefined,
    })
    expect(billingo.requests.length).toBe(before)
    expect(billingo.count('CreateModificationDocument')).toBe(1)
    const key = await refundLedgerKey('STRIPE-pi_1', documentId, 're_1')
    expect(JSON.parse(ledger.values.get(key) ?? '{}')).toEqual({
      state: 'done',
      modificationId: first.modificationId,
      grossTotal: -1_270,
    })
    expect(ledger.ttls.every((ttl) => ttl === REFUND_LEDGER_TTL_SECONDS)).toBe(true)
    expect(await readRefundLedger(ledger, 'STRIPE-pi_1', documentId, 're_1')).toEqual({
      modificationId: first.modificationId,
      grossTotal: -1_270,
    })
    expect(await readRefundLedger(ledger, 'STRIPE-pi_1', documentId, 're_2')).toBeUndefined()
  })

  test('biztos hiba után feloldja a foglalást, így a következő próbálkozás kiállíthatja', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    billingo.fail(
      { status: 422, message: 'The given data was invalid.' },
      {
        operation: 'CreateModificationDocument',
      },
    )

    await expect(createModificationOnce(tarca, input(documentId, ledger))).rejects.toMatchObject({
      category: 'validation',
    })
    expect(ledger.values.size).toBe(0)
    await expect(createModificationOnce(tarca, input(documentId, ledger))).resolves.toMatchObject({
      created: true,
    })
    expect(billingo.count('CreateModificationDocument')).toBe(2)
  })

  test('bizonytalan hiba után a listából visszakeresi, created: true', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    billingo.fail('timeout', { operation: 'CreateModificationDocument', afterSuccess: true })

    const result = await createModificationOnce(tarca, input(documentId, ledger))

    expect(result).toMatchObject({ created: true, grossTotal: -1_270 })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
    const key = await refundLedgerKey('STRIPE-pi_1', documentId, 're_1')
    expect(JSON.parse(ledger.values.get(key) ?? '{}')).toMatchObject({ state: 'done' })
  })

  test('bizonytalan hiba után, amíg a lista késik, in_progress, és soha nem küld második POST-ot', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    const lag = { on: true }
    const slow = lagging(tarca, lag)
    billingo.fail('network', { operation: 'CreateModificationDocument', afterSuccess: true })

    const failure = await createModificationOnce(slow, input(documentId, ledger)).catch(
      (error: unknown) => error,
    )
    expect(failure).toMatchObject({ category: 'in_progress' })
    expect(failure).toHaveProperty('cause.category', 'network')
    await expect(createModificationOnce(slow, input(documentId, ledger))).rejects.toMatchObject({
      category: 'in_progress',
    })
    lag.on = false
    const recovered = await createModificationOnce(slow, input(documentId, ledger))

    expect(recovered.created).toBe(true)
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })

  test('ha a bizonytalan POST valójában nem jött létre, a függő bejegyzés miatt sem állít ki újat', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    billingo.fail('network', { operation: 'CreateModificationDocument' })

    await expect(createModificationOnce(tarca, input(documentId, ledger))).rejects.toMatchObject({
      category: 'in_progress',
    })
    await expect(createModificationOnce(tarca, input(documentId, ledger))).rejects.toMatchObject({
      category: 'in_progress',
      hint: expect.stringContaining('tarca:refund:'),
    })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })

  test('csak a saját jelölős, az eredetire hivatkozó módosítót fogadja el visszakereséskor', async () => {
    const { billingo, tarca, documentId } = await setup()
    await tarca.documents.createModification(documentId, {
      items: ITEMS,
      comment: '(Visszatérítés STRIPE-pi_1 re_10)',
    })
    const ledger = memoryLedger()
    billingo.fail('network', { operation: 'CreateModificationDocument' })

    await expect(createModificationOnce(tarca, input(documentId, ledger))).rejects.toMatchObject({
      category: 'in_progress',
    })
  })

  test('a ledger olvasási hibájára store_unavailable, kérés nélkül', async () => {
    const { billingo, tarca, documentId } = await setup()
    const before = billingo.requests.length
    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error('redis://titok@host le')),
      set: () => undefined,
      delete: () => undefined,
      setIfAbsent: () => true,
    }

    const failure = await createModificationOnce(tarca, input(documentId, broken)).catch(
      (error: unknown) => error,
    )

    expect(failure).toMatchObject({ category: 'store_unavailable' })
    expect(String((failure as Error).message)).not.toContain('titok')
    expect(billingo.requests.length).toBe(before)
  })

  test('a POST közbeni megszakítás bizonytalan: a foglalás marad, és az újrapróbálás nem állít ki másodikat', async () => {
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    const controller = new AbortController()
    const tarca = createTarca({
      apiKey: 'tarca-teszt-kulcs',
      retryDelayMs: 0,
      fetch: async (resource, init) => {
        const response = await billingo.fetch(resource, init)
        if (String(resource).endsWith('/create-modification-document')) {
          controller.abort(new DOMException('A hívó megszakította.', 'AbortError'))
          throw controller.signal.reason
        }
        return response
      },
    })
    const original = await tarca.documents.create({
      partner: {
        name: 'Példa Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
      items: [{ name: 'Szolgáltatás', quantity: 1, grossUnitPrice: 12_700, vat: 27 }],
    })
    const ledger = memoryLedger()

    const failure = await createModificationOnce(tarca, input(original.id ?? 0, ledger), {
      signal: controller.signal,
    }).catch((error: unknown) => error)
    const again = await createModificationOnce(tarca, input(original.id ?? 0, ledger))

    expect(failure).toMatchObject({ name: 'AbortError' })
    expect(again.created).toBe(true)
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })

  test('már megszakított jellel nem foglal és nem küld kérést, így később kiállítható', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    const before = billingo.requests.length

    await expect(
      createModificationOnce(tarca, input(documentId, ledger), {
        signal: AbortSignal.abort(new DOMException('Megszakítva.', 'AbortError')),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(ledger.values.size).toBe(0)
    expect(billingo.requests.length).toBe(before)
    await expect(createModificationOnce(tarca, input(documentId, ledger))).resolves.toMatchObject({
      created: true,
    })
  })

  test('ha az onDocument hook a kiállítás után hibát dob, a ledger megjegyzi a módosítót, és nincs második', async () => {
    const billingo = createFakeBillingoFetch({ now: () => NOW })
    const failing = createTarca({
      apiKey: 'tarca-teszt-kulcs',
      fetch: billingo.fetch,
      retryDelayMs: 0,
      hooks: {
        onDocument: (event) => {
          if (event.action === 'modified') throw new Error('a napló nem írható')
        },
        onDocumentError: 'throw',
      },
    })
    const original = await failing.documents.create({
      partner: {
        name: 'Példa Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
      items: [{ name: 'Szolgáltatás', quantity: 1, grossUnitPrice: 12_700, vat: 27 }],
    })
    const ledger = memoryLedger()
    const plain = createTarca({
      apiKey: 'tarca-teszt-kulcs',
      fetch: billingo.fetch,
      retryDelayMs: 0,
    })

    const failure = await createModificationOnce(failing, input(original.id ?? 0, ledger)).catch(
      (error: unknown) => error,
    )
    const again = await createModificationOnce(plain, input(original.id ?? 0, ledger))

    expect(isDocumentHookError(failure)).toBe(true)
    expect(again).toMatchObject({ created: false, grossTotal: -1_270 })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })

  test('elveszett vagy lejárt ledger-bejegyzés után a listából megtalálja a korábbi módosítót, újat nem állít ki', async () => {
    const { billingo, tarca, documentId } = await setup()
    const first = await createModificationOnce(tarca, input(documentId, memoryLedger()))
    const fresh = memoryLedger()

    const again = await createModificationOnce(tarca, input(documentId, fresh))

    expect(again).toMatchObject({
      created: false,
      modificationId: first.modificationId,
      grossTotal: -1_270,
    })
    expect(billingo.count('CreateModificationDocument')).toBe(1)
    const key = await refundLedgerKey('STRIPE-pi_1', documentId, 're_1')
    expect(JSON.parse(fresh.values.get(key) ?? '{}')).toEqual({
      state: 'done',
      modificationId: first.modificationId,
      grossTotal: -1_270,
    })
  })

  test('ha a foglalás előtti keresés hibázik, feloldja a foglalást, és nem küld POST-ot', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    billingo.fail({ status: 403, message: 'Forbidden' }, { operation: 'ListDocument' })

    await expect(createModificationOnce(tarca, input(documentId, ledger))).rejects.toMatchObject({
      category: 'forbidden',
    })
    expect(ledger.values.size).toBe(0)
    expect(billingo.count('CreateModificationDocument')).toBe(0)
  })

  test('ha a foglalás közben egy másik hívás befejezte, a kész bejegyzést adja, kérés nélkül', async () => {
    const { billingo, tarca, documentId } = await setup()
    let reads = 0
    const racing: KeyValueStore = {
      ...memoryLedger(),
      get: () => {
        reads += 1
        return reads === 1 ? undefined : JSON.stringify({ state: 'done', modificationId: 77 })
      },
      setIfAbsent: () => false,
    }
    const before = billingo.requests.length

    const result = await createModificationOnce(tarca, input(documentId, racing))

    expect(result).toMatchObject({ created: false, modificationId: 77, document: undefined })
    expect(reads).toBe(2)
    expect(billingo.requests.length).toBe(before)
  })

  test('a foglalást deleteIfEquals-szal oldja fel, ha a ledger ismeri, így más foglalását nem törli', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    const released: string[] = []
    const guarded: KeyValueStore = {
      ...ledger,
      delete: () => {
        throw new Error('a sima delete nem futhat')
      },
      deleteIfEquals: (key, value) => {
        released.push(value)
        if (ledger.values.get(key) !== value) return false
        ledger.values.delete(key)
        return true
      },
    }
    billingo.fail(
      { status: 422, message: 'The given data was invalid.' },
      {
        operation: 'CreateModificationDocument',
      },
    )

    await expect(createModificationOnce(tarca, input(documentId, guarded))).rejects.toMatchObject({
      category: 'validation',
    })
    expect(released).toHaveLength(1)
    expect(JSON.parse(released[0] ?? '{}')).toMatchObject({ state: 'pending' })
    expect(ledger.values.size).toBe(0)
  })

  test('ha a kész állapot beírása elbukik, a hiba megnevezi a módosítót, és a következő hívás megtalálja', async () => {
    const { billingo, tarca, documentId } = await setup()
    const ledger = memoryLedger()
    let failSet = true
    const flaky: KeyValueStore = {
      ...ledger,
      set: (key, value, ttl) => {
        if (failSet) throw new Error('le')
        return ledger.set(key, value, ttl)
      },
    }

    const failure = await createModificationOnce(tarca, input(documentId, flaky)).catch(
      (error: unknown) => error,
    )
    failSet = false
    const again = await createModificationOnce(tarca, input(documentId, flaky))

    expect(failure).toMatchObject({ category: 'store_unavailable' })
    expect(String((failure as Error).message)).toContain(String(again.modificationId))
    expect(again.created).toBe(true)
    expect(billingo.count('CreateModificationDocument')).toBe(1)
  })
})

describe('relatedModifications', () => {
  test('több oldalon is megkeresi az eredetire hivatkozó módosítókat, mást nem', async () => {
    const original: Document = {
      id: 7,
      partner: {
        id: 3,
        name: 'Példa Kft.',
        address: { countryCode: 'HU', postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
      invoiceDate: '2026-10-01',
    }
    const queries: unknown[] = []
    const pages: Document[][] = [
      [
        { id: 8, type: 'invoice', relatedDocuments: [] },
        { id: 9, type: 'modification', relatedDocuments: [{ id: 99 }] },
      ],
      [{ id: 10, type: 'modification', relatedDocuments: [{ id: 7 }] }],
    ]
    const found = await relatedModifications(
      {
        documents: {
          list: async (query = {}) => {
            queries.push(query)
            const page = query.page ?? 1
            return {
              data: pages[page - 1] ?? [],
              total: 3,
              perPage: 100,
              currentPage: page,
              lastPage: 2,
            }
          },
        },
      },
      original,
    )
    expect(found.map((document) => document.id)).toEqual([10])
    expect(queries).toEqual([
      { page: 1, perPage: 100, partnerId: 3, startDate: '2026-10-01' },
      { page: 2, perPage: 100, partnerId: 3, startDate: '2026-10-01' },
    ])
  })
})
