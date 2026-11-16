import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { EXAMPLE_GROUPS, EXAMPLES, findExample } from './catalog'

const examplesDir = import.meta.dirname
const docsDir = join(import.meta.dirname, '../../content/docs')

describe('a sandbox példái', () => {
  test('minden példafájl szerepel a katalógusban, és fordítva', async () => {
    const files = (await readdir(examplesDir))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'catalog.ts')
      .map((file) => file.slice(0, -3))
      .sort()

    expect(EXAMPLES.map((example) => example.slug).sort()).toEqual(files)
  })

  test('a slugok egyediek, a csoportok ismertek és sorrendben vannak', () => {
    const slugs = EXAMPLES.map((example) => example.slug)
    expect(new Set(slugs).size).toBe(slugs.length)

    const groupOrder = EXAMPLES.map((example) => EXAMPLE_GROUPS.indexOf(example.group))
    expect(groupOrder.every((index) => index >= 0)).toBe(true)
    expect(groupOrder).toEqual([...groupOrder].sort((a, b) => a - b))
  })

  test('a findExample a slug alapján keres', () => {
    expect(findExample('szamla')?.title).toBe('Számla kiállítása')
    expect(findExample('nincs-ilyen')).toBeUndefined()
  })

  test.skipIf(!existsSync(docsDir))('a dokumentáció linkjei létező oldalra mutatnak', () => {
    for (const example of EXAMPLES) {
      if (!example.docs) continue
      const slug = example.docs.replace(/^\/docs\/?/, '')
      const page = [`${slug}.mdx`, join(slug, 'index.mdx')].some((file) =>
        existsSync(join(docsDir, file)),
      )
      expect(page, `${example.slug}: ${example.docs}`).toBe(true)
    }
  })
})
