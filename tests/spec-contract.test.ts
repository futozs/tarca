import { describe, expect, test } from 'vitest'
import { specOperations } from '../scripts/spec-core.mjs'
import { camelToSnake, snakeToCamel } from '../src/core/case'
import { BILLINGO_OPERATIONS, type OperationId } from '../src/core/operations'
import { loadMergedSpec, type OpenApiSchema } from './openapi'

const spec = loadMergedSpec()

function propertyNames(schema: OpenApiSchema, names: Set<string>): void {
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    names.add(name)
    propertyNames(property, names)
  }
  if (schema.items) propertyNames(schema.items, names)
  for (const part of [...(schema.oneOf ?? []), ...(schema.anyOf ?? []), ...(schema.allOf ?? [])]) {
    propertyNames(part, names)
  }
}

describe.skipIf(!spec)('szerződés a friss Billingo spec-kel', () => {
  const operations = spec ? specOperations(spec) : []

  test('a spec minden művelete szerepel a BILLINGO_OPERATIONS táblában, azonos metódussal és útvonallal', () => {
    const missing = operations.filter((operation) => {
      const known = BILLINGO_OPERATIONS[operation.id as OperationId]
      return !known || known.method !== operation.method || known.path !== operation.path
    })
    expect(missing).toEqual([])
  })

  test('a tábla dokumentált műveletei mind szerepelnek a spec-ben, a nem dokumentáltak nem', () => {
    const inSpec = new Set(operations.map((operation) => operation.id))
    const problems = Object.entries(BILLINGO_OPERATIONS).flatMap(([id, info]) => {
      if (info.spec === 'undocumented') return inSpec.has(id) ? [`${id}: már dokumentált`] : []
      return inSpec.has(id) ? [] : [`${id}: eltűnt a spec-ből`]
    })
    expect(problems).toEqual([])
  })

  test('minden mezőnév veszteség nélkül alakítható camelCase-re és vissza', () => {
    const names = new Set<string>()
    for (const schema of Object.values(spec?.components.schemas ?? {})) propertyNames(schema, names)
    const broken = [...names].filter((name) => camelToSnake(snakeToCamel(name)) !== name)
    expect(names.size).toBeGreaterThan(100)
    expect(broken).toEqual([])
  })
})
