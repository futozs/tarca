import { describe, expect } from 'vitest'
import {
  type BankAccountInput,
  createTarca,
  isBillingoError,
  nullIfNotFound,
} from '../../src/index'
import { createFakeBillingoFetch } from '../../src/testing/index'
import { BUYER, docsClient, docsExample, sentBodies } from './helpers'

const FO_SZAMLA: BankAccountInput = {
  name: 'Fő számla',
  accountNumber: '11111111-22222222-33333333',
  currency: 'HUF',
}

const EURO_SZAMLA: BankAccountInput = {
  name: 'Euró számla',
  accountNumber: '11111111-22222222-44444444',
  accountNumberIban: 'HU00111111112222222244444444',
  currency: 'EUR',
}

function recordingClient() {
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
  return { tarca, billingo, valaszok }
}

describe('bankszamlak', () => {
  docsExample('bankszamlak', 'friss profilon üres a lista', async () => {
    const { tarca } = docsClient()

    const oldal = await tarca.bankAccounts.list()

    expect([oldal.total, oldal.data]).toEqual([0, []])
  })

  docsExample('bankszamlak', 'a defaults.bankAccountId minden számlára', async () => {
    const { tarca: elokeszito, billingo } = docsClient()
    const bankszamla = await elokeszito.bankAccounts.create(FO_SZAMLA)
    const tarca = createTarca({
      apiKey: 'teszt',
      fetch: billingo.fetch,
      defaults: { bankAccountId: bankszamla.id ?? 0 },
    })

    await tarca.documents.create({
      partner: BUYER,
      items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 15_000, vat: 27 }],
    })

    expect(sentBodies(billingo, 'CreateDocument')).toEqual([
      expect.objectContaining({ bank_account_id: 1 }),
    ])
  })
})

describe('bankszamlak/lista', () => {
  docsExample('bankszamlak/lista', 'két bankszámla, a legújabb elöl', async () => {
    const { tarca, billingo, valaszok } = recordingClient()

    await tarca.bankAccounts.create(FO_SZAMLA)
    await tarca.bankAccounts.create({
      name: 'Euró számla',
      accountNumber: '11111111-22222222-44444444',
      currency: 'EUR',
    })
    const oldal = await tarca.bankAccounts.list({ perPage: 10 })
    const penznemek: string[] = []
    for await (const szamla of tarca.bankAccounts.all()) penznemek.push(szamla.currency)

    expect(oldal.total).toBe(2)
    expect(oldal.data.map((szamla) => szamla.name)).toEqual(['Euró számla', 'Fő számla'])
    expect(penznemek).toEqual(['EUR', 'HUF'])
    expect(
      billingo.requests.find((request) => request.operation === 'ListBankAccount')?.query,
    ).toEqual({ per_page: '10' })
    expect(valaszok[0]).toEqual({
      total: 2,
      per_page: 10,
      current_page: 1,
      last_page: 1,
      prev_page_url: null,
      next_page_url: null,
      data: [
        {
          id: 2,
          name: 'Euró számla',
          account_number: '11111111-22222222-44444444',
          account_number_iban: '',
          swift: '',
          currency: 'EUR',
          need_qr: false,
        },
        {
          id: 1,
          name: 'Fő számla',
          account_number: '11111111-22222222-33333333',
          account_number_iban: '',
          swift: '',
          currency: 'HUF',
          need_qr: false,
        },
      ],
    })
  })

  docsExample('bankszamlak/lista', 'hibás perPage-re RangeError', async () => {
    const { tarca, billingo } = docsClient()

    await expect(tarca.bankAccounts.list({ perPage: 500 })).rejects.toBeInstanceOf(RangeError)
    expect(billingo.requests).toEqual([])
  })
})

describe('bankszamlak/letrehozas', () => {
  docsExample('bankszamlak/letrehozas/keres', 'a snake_case törzs', async () => {
    const { tarca, billingo } = docsClient()

    const bankszamla = await tarca.bankAccounts.create({
      name: 'Euró számla',
      accountNumber: '11111111-22222222-44444444',
      accountNumberIban: 'HU00111111112222222244444444',
      swift: 'ABCDHUHB',
      currency: 'EUR',
    })

    expect(bankszamla.id).toBe(1)
    expect(sentBodies(billingo, 'CreateBankAccount')).toEqual([
      {
        name: 'Euró számla',
        account_number: '11111111-22222222-44444444',
        account_number_iban: 'HU00111111112222222244444444',
        swift: 'ABCDHUHB',
        currency: 'EUR',
      },
    ])
  })

  docsExample('bankszamlak/letrehozas/valasz', '201, üres IBAN és SWIFT', async () => {
    const { tarca, billingo } = docsClient()

    const bankszamla = await tarca.bankAccounts.create(FO_SZAMLA)

    expect(bankszamla).toMatchObject({ accountNumberIban: '', swift: '', needQr: false })
    expect(billingo.requests[0]?.status).toBe(201)
  })

  docsExample('bankszamlak/letrehozas/valasz', 'hiányzó mezőkre 422', async () => {
    const { tarca } = docsClient()

    const hiba = await tarca.bankAccounts
      .create({ name: '', accountNumber: '', currency: 'HUF' })
      .catch((error: unknown) => error)

    expect(hiba).toMatchObject({
      category: 'validation',
      status: 422,
      fieldErrors: [
        { field: 'name', message: 'The name field is required.' },
        { field: 'account_number', message: 'The account number field is required.' },
      ],
    })
  })

  docsExample(
    'bankszamlak/letrehozas/valasz',
    'üres 201-es törzs után a listából veszi az azonosítót',
    async () => {
      const billingo = createFakeBillingoFetch()
      const tarca = createTarca({
        apiKey: 'teszt',
        retryDelayMs: 0,
        fetch: async (input, init) => {
          const response = await billingo.fetch(input, init)
          if (init?.method === 'POST') return new Response(null, { status: 201 })
          return response
        },
      })
      const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']

      async function bankszamlaLetrehozasa(input: BankAccountInput) {
        try {
          return (await tarca.bankAccounts.create(input)).id
        } catch (error) {
          if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
          for await (const szamla of tarca.bankAccounts.all()) {
            if (szamla.accountNumber === input.accountNumber) return szamla.id
          }
          return (await tarca.bankAccounts.create(input)).id
        }
      }

      const hiba = await tarca.bankAccounts
        .create({ ...FO_SZAMLA, accountNumber: '11111111-22222222-55555555' })
        .catch((error: unknown) => error)
      const id = await bankszamlaLetrehozasa(FO_SZAMLA)

      expect(hiba).toMatchObject({ category: 'unexpected_response', status: 201 })
      expect(id).toBe(2)
      expect(billingo.count('CreateBankAccount')).toBe(2)
    },
  )

  docsExample(
    'bankszamlak/letrehozas/minta',
    'forint és euró bankszámla, az euró számla az euró bankszámlát kapja',
    async () => {
      const { tarca, billingo } = docsClient()

      const forint = await tarca.bankAccounts.create(FO_SZAMLA)
      const euro = await tarca.bankAccounts.create({ ...EURO_SZAMLA, swift: 'ABCDHUHB' })
      const szamla = await tarca.documents.create({
        bankAccountId: euro.id ?? 0,
        currency: 'EUR',
        conversionRate: 390,
        partner: BUYER,
        items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 400, vat: 27 }],
      })

      expect([forint.id, forint.accountNumberIban, forint.needQr]).toEqual([1, '', false])
      expect([euro.id, euro.swift]).toEqual([2, 'ABCDHUHB'])
      expect(szamla.organization?.bankAccount?.id).toBe(2)
      expect(sentBodies(billingo, 'CreateBankAccount')[0]).toEqual({
        name: 'Fő számla',
        account_number: '11111111-22222222-33333333',
        currency: 'HUF',
      })
    },
  )
})

describe('bankszamlak/lekeres', () => {
  docsExample('bankszamlak/lekeres', 'a hét mező a dróton', async () => {
    const { tarca, valaszok } = recordingClient()

    const uj = await tarca.bankAccounts.create(FO_SZAMLA)
    const bankszamla = await tarca.bankAccounts.get(uj.id ?? 0)

    expect([bankszamla.name, bankszamla.accountNumber, bankszamla.accountNumberIban]).toEqual([
      'Fő számla',
      '11111111-22222222-33333333',
      '',
    ])
    expect(valaszok).toEqual([
      {
        id: 1,
        name: 'Fő számla',
        account_number: '11111111-22222222-33333333',
        account_number_iban: '',
        swift: '',
        currency: 'HUF',
        need_qr: false,
      },
    ])
  })

  docsExample('bankszamlak/lekeres', 'ismeretlen bankszámlára 403, nem null', async () => {
    const { tarca } = docsClient()

    const hiba = await nullIfNotFound(tarca.bankAccounts.get(99)).catch((error: unknown) => error)

    expect(hiba).toMatchObject({ category: 'forbidden', status: 403 })
  })
})

describe('bankszamlak/modositas', () => {
  docsExample('bankszamlak/modositas/keres', 'a lekért bankszámla SWIFT kóddal', async () => {
    const { tarca, billingo } = docsClient()
    const uj = await tarca.bankAccounts.create(EURO_SZAMLA)
    const bankszamlaId = uj.id ?? 0

    const { id: _, ...bankszamla } = await tarca.bankAccounts.get(bankszamlaId)
    const modositott = await tarca.bankAccounts.update(bankszamlaId, {
      ...bankszamla,
      swift: 'ABCDHUHB',
    })

    expect([modositott.accountNumberIban, modositott.swift]).toEqual([
      'HU00111111112222222244444444',
      'ABCDHUHB',
    ])
    expect(sentBodies(billingo, 'UpdateBankAccount')).toEqual([
      {
        name: 'Euró számla',
        account_number: '11111111-22222222-44444444',
        account_number_iban: 'HU00111111112222222244444444',
        swift: 'ABCDHUHB',
        currency: 'EUR',
        need_qr: false,
      },
    ])
  })

  docsExample('bankszamlak/modositas/valasz', 'a kihagyott IBAN elveszik', async () => {
    const { tarca } = docsClient()
    const uj = await tarca.bankAccounts.create(EURO_SZAMLA)

    const csere = await tarca.bankAccounts.update(uj.id ?? 0, {
      name: 'Euró számla',
      accountNumber: '11111111-22222222-44444444',
      currency: 'EUR',
    })

    expect(csere.accountNumberIban === '' ? 'az IBAN elveszett' : 'rendben').toBe(
      'az IBAN elveszett',
    )
  })

  docsExample('bankszamlak/modositas/valasz', 'bizonytalan hiba után megismételhető', async () => {
    const { tarca, billingo } = docsClient()
    const uj = await tarca.bankAccounts.create(FO_SZAMLA)
    billingo.fail({ status: 503 }, { operation: 'UpdateBankAccount' })
    const bizonytalan = ['network', 'timeout', 'server', 'unexpected_response']

    async function cserel(id: number, input: BankAccountInput) {
      try {
        return await tarca.bankAccounts.update(id, input)
      } catch (error) {
        if (!isBillingoError(error) || !bizonytalan.includes(error.category)) throw error
        return tarca.bankAccounts.update(id, input)
      }
    }

    const eredmeny = await cserel(uj.id ?? 0, { ...FO_SZAMLA, swift: 'ABCDHUHB' })

    expect(eredmeny.swift).toBe('ABCDHUHB')
    expect(billingo.count('UpdateBankAccount')).toBe(2)
  })

  docsExample(
    'bankszamlak/modositas/minta',
    'teljes bankszámlával, majd csonka PUT-tal',
    async () => {
      const { tarca } = docsClient()
      const uj = await tarca.bankAccounts.create(EURO_SZAMLA)
      const bankszamlaId = uj.id ?? 0

      const { id: _, ...bankszamla } = await tarca.bankAccounts.get(bankszamlaId)
      const teljes = await tarca.bankAccounts.update(bankszamlaId, {
        ...bankszamla,
        swift: 'ABCDHUHB',
      })
      const csonka = await tarca.bankAccounts.update(bankszamlaId, {
        name: 'Euró számla',
        accountNumber: '11111111-22222222-44444444',
        currency: 'EUR',
      })

      expect([teljes.accountNumberIban, teljes.swift]).toEqual([
        'HU00111111112222222244444444',
        'ABCDHUHB',
      ])
      expect([csonka.accountNumberIban, csonka.swift]).toEqual(['', ''])
    },
  )
})

describe('bankszamlak/torles', () => {
  docsExample('bankszamlak/torles', 'törlés 204, utána üres a lista', async () => {
    const { tarca, billingo } = docsClient()

    const bankszamla = await tarca.bankAccounts.create(FO_SZAMLA)
    await tarca.bankAccounts.delete(bankszamla.id ?? 0)
    const maradt = await tarca.bankAccounts.list()

    expect(maradt.total).toBe(0)
    expect(
      billingo.requests.find((request) => request.operation === 'DeleteBankAccount'),
    ).toMatchObject({ method: 'DELETE', path: '/bank-accounts/1', status: 204 })
  })

  docsExample(
    'bankszamlak/torles',
    'elveszett válasz után nem töröl újra, mert már nincs a listában',
    async () => {
      const { tarca, billingo } = docsClient()
      const bankszamla = await tarca.bankAccounts.create(FO_SZAMLA)
      billingo.fail('network', { operation: 'DeleteBankAccount', afterSuccess: true })

      async function torol(bankszamlaId: number): Promise<void> {
        try {
          await tarca.bankAccounts.delete(bankszamlaId)
        } catch (error) {
          if (
            !isBillingoError(error) ||
            !['network', 'timeout', 'server'].includes(error.category)
          ) {
            throw error
          }
          for await (const szamla of tarca.bankAccounts.all()) {
            if (szamla.id === bankszamlaId) return tarca.bankAccounts.delete(bankszamlaId)
          }
        }
      }

      await torol(bankszamla.id ?? 0)

      expect(billingo.count('DeleteBankAccount')).toBe(1)
      expect(billingo.data.bankAccounts.size).toBe(0)
    },
  )
})
