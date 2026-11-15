import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { BILLINGO_OPERATIONS, type OperationId } from '../src/core/operations'
import { E2E_EXCLUDED, E2E_GROUPS, E2E_OPERATIONS } from './e2e/suite'

function implementedOperations(): Set<string> {
  const found = new Set<string>()
  const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.startsWith('core'),
  )
  for (const file of files) {
    const source = readFileSync(join('src', file), 'utf8')
    for (const match of source.matchAll(/operation: '(\w+)'/g)) found.add(match[1] ?? '')
  }
  return found
}

describe('API lefedettség', () => {
  const implemented = implementedOperations()

  test('a kliens csak a táblában szereplő műveleteket hívja', () => {
    expect([...implemented].filter((id) => !(id in BILLINGO_OPERATIONS))).toEqual([])
  })

  test('minden megvalósított műveletnek van e2e lépése vagy indokolt kivétele', () => {
    const covered = new Set<string>([...E2E_OPERATIONS, ...Object.keys(E2E_EXCLUDED)])
    expect([...implemented].filter((id) => !covered.has(id))).toEqual([])
    expect(E2E_OPERATIONS.filter((id) => !implemented.has(id))).toEqual([])
    expect(Object.keys(E2E_EXCLUDED).filter((id) => !implemented.has(id))).toEqual([])
  })

  test('egy művelet nem lehet egyszerre lefedett és kivétel, és minden kivételnek van valódi indoka', () => {
    expect(E2E_OPERATIONS.filter((id) => id in E2E_EXCLUDED)).toEqual([])
    const exclusions = E2E_GROUPS.flatMap((group) => Object.keys(group.excluded))
    expect(exclusions.filter((id, index) => exclusions.indexOf(id) !== index)).toEqual([])
    const weak = Object.entries(E2E_EXCLUDED).filter(
      ([, reason]) => (reason ?? '').trim().length < 20,
    )
    expect(weak).toEqual([])
  })

  test('az e2e csoportok neve egyedi, és mindegyik lefed vagy kivételez legalább egy műveletet', () => {
    const titles = E2E_GROUPS.map((group) => group.title)
    expect(new Set(titles).size).toBe(titles.length)
    expect(
      E2E_GROUPS.filter(
        (group) => group.operations.length + Object.keys(group.excluded).length === 0,
      ).map((group) => group.title),
    ).toEqual([])
  })

  test('a megvalósítatlan műveletek listája csak fogyhat', () => {
    const missing = (Object.keys(BILLINGO_OPERATIONS) as OperationId[]).filter(
      (id) => !implemented.has(id),
    )
    expect(missing.length).toBeLessThanOrEqual(46)
  })
})
