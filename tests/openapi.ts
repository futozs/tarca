import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeSpecs } from '../scripts/spec-core.mjs'

export interface OpenApiSchema {
  readonly $ref?: string
  readonly type?: string
  readonly format?: string
  readonly nullable?: boolean
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, OpenApiSchema>>
  readonly required?: readonly string[]
  readonly items?: OpenApiSchema
  readonly oneOf?: readonly OpenApiSchema[]
  readonly anyOf?: readonly OpenApiSchema[]
  readonly allOf?: readonly OpenApiSchema[]
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly additionalProperties?: boolean | OpenApiSchema
}

export interface OpenApiOperation {
  readonly operationId: string
}

export interface OpenApiSpec {
  readonly info: { readonly version: string }
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>
  readonly components: { readonly schemas: Readonly<Record<string, OpenApiSchema>> }
}

const CACHE_DIR = join(import.meta.dirname, '..', '.spec-cache')

export const SPEC_REQUIRED: boolean = process.env.TARCA_REQUIRE_SPEC === '1'

export function loadMergedSpec(): OpenApiSpec | undefined {
  const indexPath = join(CACHE_DIR, 'index.json')
  if (!existsSync(indexPath)) {
    if (SPEC_REQUIRED) {
      throw new Error('TARCA_REQUIRE_SPEC=1, de nincs .spec-cache. Futtasd: npm run spec:fetch')
    }
    return undefined
  }
  const { versions } = JSON.parse(readFileSync(indexPath, 'utf8')) as { versions: string[] }
  const specs = versions.map(
    (version) =>
      JSON.parse(readFileSync(join(CACHE_DIR, `billingo-${version}.json`), 'utf8')) as OpenApiSpec,
  )
  return mergeSpecs(specs) as unknown as OpenApiSpec
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isRecord(value)
    default:
      return true
  }
}

export interface SchemaValidator {
  validate(schemaName: string, value: unknown): string[]
}

export function createValidator(schemas: Readonly<Record<string, OpenApiSchema>>): SchemaValidator {
  function resolve(schema: OpenApiSchema): OpenApiSchema {
    if (!schema.$ref) return schema
    const name = schema.$ref.split('/').pop() ?? ''
    const found = schemas[name]
    if (!found) throw new Error(`Ismeretlen séma hivatkozás: ${schema.$ref}`)
    return resolve(found)
  }

  function check(input: OpenApiSchema, value: unknown, path: string): string[] {
    const schema = resolve(input)
    if (value === null) return schema.nullable ? [] : [`${path}: null nem engedett`]
    if (schema.allOf) return schema.allOf.flatMap((part) => check(part, value, path))
    if (schema.oneOf) {
      const results = schema.oneOf.map((part) => check(part, value, path))
      const matches = results.filter((errors) => errors.length === 0).length
      if (matches === 1) return []
      if (matches === 0) {
        const best = results.reduce((a, b) => (b.length < a.length ? b : a))
        return [`${path}: egyik oneOf ágnak sem felel meg`, ...best]
      }
      return [`${path}: több oneOf ágnak is megfelel (${matches})`]
    }
    if (schema.anyOf) {
      const results = schema.anyOf.map((part) => check(part, value, path))
      return results.some((errors) => errors.length === 0)
        ? []
        : [`${path}: egyik anyOf ágnak sem felel meg`]
    }
    const errors: string[] = []
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} nincs az engedett értékek között`)
    }
    const type = schema.type ?? (schema.properties ? 'object' : undefined)
    if (type && !typeMatches(type, value)) {
      return [...errors, `${path}: ${type} típus kell, kapott: ${JSON.stringify(value)}`]
    }
    if (typeof value === 'string') {
      if (schema.format === 'date' && !DATE.test(value))
        errors.push(`${path}: nem YYYY-MM-DD dátum`)
      if (schema.format === 'date-time' && !DATE_TIME.test(value)) {
        errors.push(`${path}: nem ISO dátum-idő`)
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: hosszabb, mint ${schema.maxLength}`)
      }
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: kisebb, mint ${schema.minimum}`)
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: nagyobb, mint ${schema.maximum}`)
      }
    }
    if (Array.isArray(value) && schema.items) {
      const items = schema.items
      value.forEach((item, index) => {
        errors.push(...check(items, item, `${path}[${index}]`))
      })
    }
    if (isRecord(value) && schema.properties) {
      for (const key of schema.required ?? []) {
        if (!(key in value)) errors.push(`${path}.${key}: kötelező mező hiányzik`)
      }
      for (const [key, item] of Object.entries(value)) {
        const property = schema.properties[key]
        if (property) errors.push(...check(property, item, `${path}.${key}`))
        else if (
          schema.additionalProperties === undefined ||
          schema.additionalProperties === false
        ) {
          errors.push(`${path}.${key}: a sémában nem szereplő mező`)
        }
      }
    }
    return errors
  }

  return {
    validate(schemaName: string, value: unknown): string[] {
      return check({ $ref: `#/components/schemas/${schemaName}` }, value, schemaName)
    },
  }
}

const mergedSpec = loadMergedSpec()
const validator = mergedSpec ? createValidator(mergedSpec.components.schemas) : undefined

export function contractErrors(schemaName: string, value: unknown): string[] {
  return validator ? validator.validate(schemaName, value) : []
}
