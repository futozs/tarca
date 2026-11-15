import { describe, expect, test } from 'vitest'
import {
  createState,
  DEFAULT_TAX_CODE,
  findTaxpayer,
  nextDocumentNumber,
  nextId,
  today,
} from './state'

describe('a hamis Billingo állapota', () => {
  test('alapértékek: a teszt profil adószáma, NAV nélkül, két kezdő számlatömb', () => {
    const state = createState({ now: () => new Date('2026-11-15T10:00:00Z') })

    expect(state.config.taxCode).toBe(DEFAULT_TAX_CODE)
    expect(DEFAULT_TAX_CODE).toBe('00000000-0-00')
    expect(state.config.hasNavConnection).toBe(false)
    expect(state.config.apiKeys).toBeUndefined()
    expect(state.config.subscription).toEqual({ expirationDate: '2026-11-16', features: [] })
    expect([...state.documentBlocks.keys()]).toEqual([1, 2])
    expect(state.bankAccounts.size).toBe(0)
  })

  test('az azonosító-sorozatok erőforrásonként függetlenek', () => {
    const state = createState()

    expect([nextId(state, 'bankAccounts'), nextId(state, 'bankAccounts')]).toEqual([1, 2])
    expect(nextId(state, 'partners')).toBe(1)
    expect(nextId(state, 'documentBlocks')).toBe(3)
  })

  test('bizonylatszám tömbönként és évenként, hatjegyű sorszámmal', () => {
    let now = new Date('2026-12-31T22:59:59Z')
    const state = createState({ now: () => now })

    const invoices = [nextDocumentNumber(state, 1), nextDocumentNumber(state, 1)]
    const receipt = nextDocumentNumber(state, 2)
    now = new Date('2026-12-31T23:00:00Z')
    const newYear = [nextDocumentNumber(state, 1), nextDocumentNumber(state, 2)]

    expect(invoices).toEqual(['2026-000001', '2026-000002'])
    expect(receipt).toBe('NYT-2026-000001')
    expect(newYear).toEqual(['2027-000001', 'NYT-2027-000001'])
    expect(today(state)).toBe('2027-01-01')
  })

  test('ismeretlen számlatömbre nincs bizonylatszám', () => {
    expect(() => nextDocumentNumber(createState(), 99)).toThrow(
      'Nincs 99 azonosítójú számlatömb a hamis Billingóban.',
    )
  })

  test('az adózót a törzsszám azonosítja, bármilyen alakban adják meg', () => {
    const state = createState({
      taxpayers: { '13421739-2-41': { name: 'Teljes alak' }, '12345676': { name: 'Törzsszám' } },
    })

    expect(findTaxpayer(state, '13421739')?.name).toBe('Teljes alak')
    expect(findTaxpayer(state, '13421739-1-42')?.name).toBe('Teljes alak')
    expect(findTaxpayer(state, '12345676-2-42')?.name).toBe('Törzsszám')
    expect(findTaxpayer(state, '11111111-2-41')).toBeUndefined()
  })
})
