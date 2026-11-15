import { describe, expect, test } from 'vitest'
import { mockBillingo, TEST_API_KEY } from '../../tests/helpers'
import { createTarca } from '../client'
import { BillingoError } from '../core/errors'
import { DEFAULT_DUE_IN_DAYS, resolveDefaults, type TarcaDefaults } from './defaults'

function configurationError(defaults: TarcaDefaults): BillingoError {
  const mock = mockBillingo()
  try {
    createTarca({ apiKey: TEST_API_KEY, fetch: mock.fetch, defaults })
  } catch (error) {
    expect(mock.requests).toEqual([])
    if (error instanceof BillingoError) return error
    throw error
  }
  throw new Error('A createTarca nem dobott hibát.')
}

describe('createTarca defaults', () => {
  test('beépített alapértékek: hu, HUF, 8 nap, nem elektronikus, nincs e-mail, tömb és fizetési mód nincs rögzítve', () => {
    expect(resolveDefaults()).toEqual({
      blockId: undefined,
      receiptBlockId: undefined,
      bankAccountId: undefined,
      paymentMethod: undefined,
      language: 'hu',
      currency: 'HUF',
      dueInDays: 8,
      electronic: false,
      sendEmail: false,
    })
    expect(DEFAULT_DUE_IN_DAYS).toBe(8)
  })

  test('a megadott értékek változatlanul érvényesek', () => {
    const defaults = {
      blockId: 1,
      receiptBlockId: 2,
      bankAccountId: 3,
      paymentMethod: 'cash',
      language: 'de',
      currency: 'EUR',
      dueInDays: 0,
      electronic: true,
      sendEmail: true,
    } as const

    expect(resolveDefaults(defaults)).toEqual(defaults)
  })

  test.each([
    [{ blockId: 0 }, 'defaults.blockId pozitív egész azonosító legyen, kapott: 0'],
    [{ receiptBlockId: 1.5 }, 'defaults.receiptBlockId pozitív egész azonosító legyen'],
    [{ bankAccountId: -2 }, 'defaults.bankAccountId pozitív egész azonosító legyen'],
    [
      { paymentMethod: 'kartya' },
      'defaults.paymentMethod értéke nem ismert Billingo érték: „kartya”',
    ],
    [{ language: 'xx' }, 'defaults.language értéke nem ismert'],
    [{ currency: 'huf' }, 'defaults.currency értéke nem ismert'],
    [{ dueInDays: -1 }, 'defaults.dueInDays nemnegatív egész szám legyen, kapott: -1'],
    [{ dueInDays: 2.5 }, 'defaults.dueInDays nemnegatív egész szám legyen'],
    [{ electronic: 'igen' }, 'defaults.electronic true vagy false legyen, kapott: „igen”'],
    [{ sendEmail: 1 }, 'defaults.sendEmail true vagy false legyen'],
  ])('hibás érték már a createTarca-nál configuration hiba: %o', (defaults, message) => {
    const error = configurationError(defaults as unknown as TarcaDefaults)

    expect(error.category).toBe('configuration')
    expect(error.message).toContain(message)
  })
})
