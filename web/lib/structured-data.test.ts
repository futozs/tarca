import { describe, expect, test } from 'vitest'
import { siteStructuredData } from './structured-data'

describe('strukturált adatok', () => {
  test('a JSON-LD érvényes, és az npm csomagot a tarcajs néven, a repóval együtt írja le', () => {
    const data = JSON.parse(siteStructuredData())
    const software = data['@graph'].find(
      (node: { '@type': string }) => node['@type'] === 'SoftwareSourceCode',
    )
    expect(software.name).toBe('tarcajs')
    expect(software.sameAs).toContain('https://www.npmjs.com/package/tarcajs')
    expect(software.codeRepository).toBe('https://github.com/futozs/tarca')
  })

  test('a szkriptbe ágyazott JSON nem tartalmaz nyers < jelet', () => {
    expect(siteStructuredData()).not.toContain('<')
  })
})
