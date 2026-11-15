import { describe, expect, test } from 'vitest'
import { specOperations } from '../scripts/spec-core.mjs'
import { camelToSnake, snakeToCamel } from '../src/core/case'
import { BILLINGO_OPERATIONS, type OperationId } from '../src/core/operations'
import {
  billingoSpecValidator,
  loadCachedSpecs,
  loadMergedSpec,
  type OpenApiSchema,
  SPEC_AVAILABLE,
  UNDOCUMENTED_SCHEMAS,
  unsupportedSchemaUsage,
} from './openapi'

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

describe.skipIf(!SPEC_AVAILABLE)('szerződés a friss Billingo spec-kel', () => {
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

  test('mindkét letöltött spec csak olyan séma-kulcsszót, formátumot és típust használ, amit a validátor kezel vagy indokoltan figyelmen kívül hagy', () => {
    const versions = loadCachedSpecs()
    expect(versions.length).toBeGreaterThanOrEqual(2)
    for (const version of versions) {
      expect(unsupportedSchemaUsage(version), version.info.version).toEqual([])
    }
  })

  test('minden dokumentált művelet kérés- és válaszszerződése feloldható, a leíratlan nem dokumentált művelet hibát dob', () => {
    const validator = billingoSpecValidator()
    const problems: string[] = []
    for (const [id, info] of Object.entries(BILLINGO_OPERATIONS)) {
      const operationId = id as OperationId
      if (info.spec === 'undocumented' && !UNDOCUMENTED_SCHEMAS[operationId]) {
        expect(() => validator.operation(operationId)).toThrow('UNDOCUMENTED_SCHEMAS')
        continue
      }
      const operation = validator.operation(operationId)
      const templateNames = [...info.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
      const pathNames = (operation.parameters ?? [])
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name)
      if (templateNames.join() !== pathNames.join()) {
        problems.push(
          `${operationId}: útvonal-paraméterek ${templateNames.join()} ≠ ${pathNames.join()}`,
        )
      }
      const body = operation.requestBody
      if (
        body &&
        !Object.keys(body.content ?? {}).some((type) => type.startsWith('application/json'))
      ) {
        problems.push(`${operationId}: nem JSON kéréstörzs`)
      }
      for (const status of Object.keys(operation.responses ?? {})) {
        if (!/^\d{3}$/.test(status)) {
          problems.push(`${operationId}: nem kezelt státuszkulcs ${status}`)
          continue
        }
        expect(() =>
          validator.responseErrors(operationId, Number(status), {}, { mode: 'lenient' }),
        ).not.toThrow()
      }
    }
    expect(problems).toEqual([])
  })

  test('az UNDOCUMENTED_SCHEMAS csak nem dokumentált műveletet írhat le', () => {
    const documented = Object.keys(UNDOCUMENTED_SCHEMAS).filter(
      (id) => BILLINGO_OPERATIONS[id as OperationId].spec !== 'undocumented',
    )
    expect(documented).toEqual([])
  })
})
