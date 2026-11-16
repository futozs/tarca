import { describe, expect } from 'vitest'
import { createTarca } from '../../src/index'
import { createFakeBillingoFetch } from '../../src/testing/index'
import { docsClient, docsExample } from './helpers'

describe('arfolyam', () => {
  docsExample('arfolyam/keres', 'a Date a budapesti naptári napként megy ki', async () => {
    const { tarca, billingo } = docsClient()

    const ejfelUtan = new Date('2026-11-14T23:30:00Z')

    const arfolyam = await tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: ejfelUtan })

    expect(arfolyam.date).toBe('2026-11-15')
    expect(ejfelUtan.toISOString().slice(0, 10)).toBe('2026-11-14')
    expect(billingo.requests[0]?.query).toEqual({ from: 'EUR', to: 'HUF', date: '2026-11-15' })
  })

  docsExample('arfolyam/keres', 'nem létező napra RangeError, kérés nélkül', async () => {
    const { tarca, billingo } = docsClient()

    await expect(
      tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: '2026-13-01' }),
    ).rejects.toThrow(new RangeError('Nem létező naptári dátum: 2026-13-01'))
    expect(billingo.requests).toEqual([])
  })

  docsExample('arfolyam/valasz', 'a hamis Billingo a hufRates hányadosát adja', async () => {
    const billingo = createFakeBillingoFetch({ hufRates: { EUR: 385.5, PLN: 90 } })
    const tarca = createTarca({ apiKey: 'teszt-kulcs', fetch: billingo.fetch })

    const zloty = await tarca.currencies.rate({ from: 'PLN', to: 'EUR' })

    expect(zloty.rate).toBe(0.233463)
    expect(zloty).toMatchObject({ from: 'PLN', to: 'EUR' })
  })

  docsExample('arfolyam/valasz', 'ismeretlen pénznemre 422 a hufRates említésével', async () => {
    const { tarca } = docsClient()

    const hiba = await tarca.currencies.rate({ from: 'PLN', to: 'HUF' }).catch((error) => error)

    expect(hiba).toMatchObject({ category: 'validation', status: 422 })
    expect(hiba.fieldErrors[0]).toMatchObject({ field: 'from' })
    expect(hiba.fieldErrors[0].message).toContain('hufRates')
  })

  docsExample('arfolyam/minta', 'euró–forint egy napra, forint–euró dátum nélkül', async () => {
    const { tarca, billingo } = docsClient()

    const euro = await tarca.currencies.rate({ from: 'EUR', to: 'HUF', date: '2026-11-13' })
    const forint = await tarca.currencies.rate({ from: 'HUF', to: 'EUR' })

    expect(`1 ${euro.from} = ${euro.rate} ${euro.to} (${euro.date})`).toBe(
      '1 EUR = 390 HUF (2026-11-13)',
    )
    expect(`1 ${forint.from} = ${forint.rate} ${forint.to}`).toBe('1 HUF = 0.002564 EUR')
    expect(billingo.requests.map((request) => request.query)).toEqual([
      { from: 'EUR', to: 'HUF', date: '2026-11-13' },
      { from: 'HUF', to: 'EUR' },
    ])
  })
})
