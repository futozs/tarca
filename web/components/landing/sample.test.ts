import { describe, expect, it } from 'vitest'
import {
  extractSnippet,
  formatHuf,
  readHeroSnippet,
  runSampleError,
  runSampleIssue,
  runSampleOnce,
  sampleInput,
  sampleItem,
} from './sample'

const FIRST_NUMBER = `${new Intl.DateTimeFormat('hu-HU', { year: 'numeric', timeZone: 'Europe/Budapest' }).format(new Date()).replace(/\D/g, '')}-1`

describe('a főoldal mintája a hamis Billingo ellen', () => {
  it('a documents.create négy kérést küld, sorrendben', async () => {
    const { requests } = await runSampleIssue()
    expect(requests.map(({ method, target, status }) => `${method} ${target} ${status}`)).toEqual([
      'GET /document-blocks 200',
      'GET /partners?query=Vevő Kft. 200',
      'POST /partners 201',
      'POST /documents 201',
    ])
  })

  it('a számla összegei a tételből jönnek', async () => {
    const { invoice } = await runSampleIssue()
    expect(invoice).toEqual({
      number: FIRST_NUMBER,
      partner: 'Vevő Kft.',
      itemName: 'Webfejlesztés',
      quantity: '10 óra',
      net: formatHuf(150_000),
      vatLabel: 'ÁFA 27%',
      vat: formatHuf(40_500),
      gross: formatHuf(190_500),
    })
  })

  it('a második createOnce a meglévő számlát adja vissza', async () => {
    const { first, second } = await runSampleOnce()
    expect(first).toEqual({ created: true, number: FIRST_NUMBER })
    expect(second).toEqual({ created: false, number: FIRST_NUMBER })
  })

  it('az üres tételnév helyi hibát ad, kérés nélkül', async () => {
    const error = await runSampleError()
    expect(error).toMatchObject({
      name: 'BillingoError',
      category: 'validation',
      field: 'items.0.name',
      fieldMessage: 'Nem lehet üres.',
    })
    expect(error.message).toContain('items.0.name')
    expect(error.hint).toContain('el sem küldte')
  })

  it('a forintot ezres tagolással írja', () => {
    expect(formatHuf(1500)).toBe('1 500 Ft')
  })
})

describe('a hero kódrészlete', () => {
  it('a declare sor előtt ér véget', () => {
    expect(extractSnippet('const a = 1\n\ndeclare const b: number\n')).toBe('const a = 1')
    expect(() => extractSnippet('const a = 1')).toThrow(/declare/)
  })

  it('kilenc sor, és ugyanazt a számlát állítja ki, mint a minta', async () => {
    const snippet = await readHeroSnippet()
    expect(snippet.split('\n')).toHaveLength(9)
    expect(snippet).toContain('documents.create(')
    expect(snippet).toContain(`name: '${sampleInput.partner.name}'`)
    expect(snippet).toContain(`name: '${sampleItem.name}'`)
    expect(snippet).toContain(`quantity: ${sampleItem.quantity}`)
    expect(snippet).toContain(`unit: '${sampleItem.unit}'`)
    expect(snippet).toContain('netUnitPrice: 15_000')
    expect(snippet).toContain(`vat: ${sampleItem.vat}`)
  })
})
