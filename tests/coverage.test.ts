import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { BILLINGO_OPERATIONS, type OperationId } from '../src/core/operations'
import { E2E_EXCLUDED, E2E_OPERATIONS } from './e2e/suite'

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
  })

  test('a megvalósítatlan műveletek listája csak fogyhat', () => {
    const missing = (Object.keys(BILLINGO_OPERATIONS) as OperationId[]).filter(
      (id) => !implemented.has(id),
    )
    expect(missing.length).toBeLessThanOrEqual(46)
  })
})
