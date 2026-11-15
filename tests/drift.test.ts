import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  changelogVersions,
  compareSnapshots,
  consistencyProblems,
  probePath,
  renderReport,
  routeExists,
  sha256,
  sourceOperations,
} from '../scripts/drift-core.mjs'
import { BILLINGO_OPERATIONS } from '../src/core/operations'

describe('változásfigyelő', () => {
  test('a changelog verzióit számszerűen rendezve gyűjti ki', () => {
    expect(changelogVersions('<p>3.0.15.9</p> 3.0.15.23 <b>3.0.15.9</b> 2.0.1')).toEqual([
      '3.0.15.9',
      '3.0.15.23',
    ])
  })

  test('a forráskódból ugyanazt a művelettáblát olvassa ki, mint ami a BILLINGO_OPERATIONS-ben van', () => {
    const parsed = sourceOperations(readFileSync('src/core/operations.ts', 'utf8'))
    expect(parsed).toHaveLength(Object.keys(BILLINGO_OPERATIONS).length)
    expect(parsed.find((operation) => operation.id === 'GetPartner')).toEqual({
      id: 'GetPartner',
      method: 'GET',
      path: '/partners/{id}',
      spec: 'only-3.0.14',
    })
  })

  test('a próbaútvonal kitölti a paramétereket, és csak a 404 jelent hiányzó útvonalat', () => {
    expect(probePath('/utils/check-tax-number/{tax_number}')).toBe(
      '/utils/check-tax-number/12345678',
    )
    expect(probePath('/documents/vendor/{vendor_id}')).toBe('/documents/vendor/1')
    expect(routeExists(401)).toBe(true)
    expect(routeExists(405)).toBe(true)
    expect(routeExists(404)).toBe(false)
  })

  test('összeveti a zárolt és a friss állapotot', () => {
    const hash = sha256('a')
    const changes = compareSnapshots(
      { versions: ['3.0.14'], default: '3.0.14', spec: hash, gone: 'x' },
      { versions: ['3.0.14', '3.0.16'], default: '3.0.16', spec: sha256('b'), extra: 1 },
    )
    expect(changes).toEqual([
      { name: 'versions', kind: 'changed', detail: 'új: 3.0.16' },
      { name: 'default', kind: 'changed', detail: '3.0.14 → 3.0.16' },
      { name: 'spec', kind: 'changed', detail: 'A tartalom ujjlenyomata megváltozott.' },
      { name: 'extra', kind: 'new', detail: 'Új figyelt forrás, nincs zárolt értéke.' },
      { name: 'gone', kind: 'missing', detail: 'A forrás nem volt elérhető.' },
    ])
    expect(compareSnapshots({ a: ['x', 'y'] }, { a: ['x'] })[0]?.detail).toBe('eltűnt: y')
    expect(compareSnapshots({ a: 1 }, { a: 1 })).toEqual([])
  })

  test('jelzi az ismeretlen műveletet és a 404-es útvonalat', () => {
    const problems = consistencyProblems({
      specOperations: [
        { id: 'GetServerTime', method: 'GET', path: '/utils/time' },
        { id: 'NewThing', method: 'POST', path: '/new' },
      ],
      knownOperations: [{ id: 'GetServerTime', method: 'GET', path: '/utils/time' }],
      missingRoutes: ['GET /partners/{id}'],
    })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('NewThing (POST /new)')
    expect(problems[1]).toContain('GET /partners/{id}')
  })

  test('a spec-felülírások problémáit is jelzi', () => {
    const problems = consistencyProblems({
      specOperations: [],
      knownOperations: [],
      missingRoutes: [],
      overrideProblems: ['Document: discount nullable: felesleges'],
    })
    expect(problems).toEqual([
      'Spec-felülírás (scripts/spec-overrides.mjs): Document: discount nullable: felesleges',
    ])
  })

  test('a jelentés magyarul írja le a teendőt', () => {
    expect(renderReport([], [])).toContain('Nincs eltérés.')
    const report = renderReport([{ name: 'spec:3.0.15', kind: 'changed', detail: 'x' }], ['baj'])
    expect(report).toContain('### Változott források')
    expect(report).toContain('### Eltérés a tárca kódjától')
    expect(report).toContain('npm run drift -- --update')
  })
})
