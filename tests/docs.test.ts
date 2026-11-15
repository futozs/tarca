import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { createTarca } from '../src/client'
import { isOneOf, PAYMENT_METHODS } from '../src/documents/enums'
import { createFakeBillingoFetch, createMockTarca } from '../src/testing'

const ROOT = new URL('../', import.meta.url)

async function read(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), 'utf8')
}

function sectionOf(source: string, heading: string): string {
  const start = source.indexOf(`\n${heading}\n`)
  if (start === -1) throw new Error(`Nincs ilyen szakasz: ${heading}`)
  const end = source.indexOf('\n## ', start + heading.length)
  return source.slice(start, end === -1 ? undefined : end)
}

function lineWith(source: string, marker: string): string {
  const line = source.split('\n').find((item) => item.includes(marker))
  if (line === undefined) throw new Error(`Nincs ilyen sor: ${marker}`)
  return line
}

const HUNGARIAN_TIMES: Readonly<Record<number, string>> = { 2: 'kétszer', 3: 'háromszor' }

describe('a dokumentáció állításai a tényleges viselkedéshez igazodnak', () => {
  test('a README a GET-kérések számát mondja, nem az ismétlésekét, és ez egyezik a ténylegessel', async () => {
    const billingo = createFakeBillingoFetch()
    billingo.fail({ status: 503 }, { operation: 'GetOrganizationData', times: 10 })
    const tarca = createTarca({ apiKey: 'kulcs', fetch: billingo.fetch, retryDelayMs: 0 })

    await expect(tarca.organization.get()).rejects.toMatchObject({ category: 'server' })
    const callout = lineWith(
      await read('readme/template.md'),
      '> **Írást a tárca soha nem küld újra magától.**',
    )

    expect(callout).toContain(
      `összesen legfeljebb ${HUNGARIAN_TIMES[billingo.count('GetOrganizationData')]} megy ki`,
    )
  })

  test('a nyugta fizetési módjáról a recept és a README is mondja, hogy a defaults.paymentMethod érvényes rá', async () => {
    const recipes = await read('agents/recipes.md')
    const shared = /paymentMethod: '(\w+)'/.exec(sectionOf(recipes, '## One shared client'))?.[1]
    if (!isOneOf(PAYMENT_METHODS, shared))
      throw new Error('A közös kliens fizetési módja nincs meg.')
    const tarca = createMockTarca({ defaults: { paymentMethod: shared } })

    await tarca.receipts.create({ items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 27 }] })
    const sent = tarca.billingo.requests.find((request) => request.operation === 'CreateReceipt')

    expect(sent?.body).toMatchObject({ payment_method: shared })
    expect(lineWith(recipes, 'The receipt goes to the first `receipt` block')).toContain(
      '`defaults.paymentMethod`',
    )
    expect(lineWith(await read('readme/template.md'), '- Nyugtánál')).toContain(
      '`defaults.paymentMethod`',
    )
  })
})
