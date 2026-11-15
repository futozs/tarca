import { describe, expect, test } from 'vitest'
import { createTarca } from '../../src/client'
import { createFakeBillingo } from '../fake-billingo'
import { TEST_API_KEY } from '../helpers'
import { assertTestProfile } from './guard'

function tarcaFor(hasNavConnection: boolean) {
  const billingo = createFakeBillingo({ taxCode: '12345678', hasNavConnection })
  return createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch, retryDelayMs: 0 })
}

describe('az e2e tesztprofil-őre', () => {
  test('átengedi a NAV kapcsolat nélküli, várt adószámú szervezetet', async () => {
    await expect(assertTestProfile(tarcaFor(false), '12345678')).resolves.toBeUndefined()
  })

  test('leállítja a futást NAV kapcsolatos (éles) szervezetnél', async () => {
    await expect(assertTestProfile(tarcaFor(true), '12345678')).rejects.toThrow('NAV kapcsolata')
  })

  test('leállítja a futást, ha az adószám nem egyezik vagy nincs megadva', async () => {
    await expect(assertTestProfile(tarcaFor(false), '87654321')).rejects.toThrow('nem a várt')
    await expect(assertTestProfile(tarcaFor(false), '')).rejects.toThrow('nincs megadva')
  })
})
