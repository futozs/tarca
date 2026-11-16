import { describe, expect, test } from 'vitest'
import { BUYER, docsClient, docsExample, ITEMS, sentBodies } from './docs-examples/helpers'
import { DOCS_OPERATION_PAGES } from './docs-examples/operations'
import { loadDocsTree } from './docs-examples/tree'

describe('a dokumentáció szerkezete', () => {
  const tree = loadDocsTree()

  test('a meta.json fájlok érvényesek, és mindegyik mappát elér a gyökérből', () => {
    expect(tree.problems).toEqual([])
  })

  test('minden MDX oldal szerepel a mappája meta.json-jában', () => {
    const orphans = tree.mdxPages.filter((slug) => !tree.entries.has(slug))

    expect(orphans).toEqual([])
  })

  test('minden Billingo művelet egy tervezett dokumentációs oldalra mutat', () => {
    const missing = Object.entries(DOCS_OPERATION_PAGES)
      .filter(([, page]) => !tree.entries.has(page))
      .map(([operation, page]) => `${operation} → ${page}`)

    expect(missing).toEqual([])
  })
})

describe('kezdőlap', () => {
  docsExample('', 'számla createOnce-szal, a második hívás a meglévőt adja', async () => {
    const { tarca, billingo } = docsClient()
    const input = { vendorId: 'WEB-1001', partner: BUYER, items: ITEMS }

    const { document, created } = await tarca.documents.createOnce(input)
    const again = await tarca.documents.createOnce(input)

    expect(created).toBe(true)
    expect(document.grossTotal).toBe(190_500)
    expect(again).toMatchObject({ created: false, document: { id: document.id } })
    expect(sentBodies(billingo, 'CreateDocument')).toEqual([
      expect.objectContaining({ vendor_id: 'WEB-1001', partner_id: document.partner?.id }),
    ])
  })
})
