import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, mergeSpecs } from '../scripts/spec-core.mjs'
import { BILLINGO_API_URL } from '../src/core/context'
import { BILLINGO_OPERATIONS, type OperationId } from '../src/core/operations'

export interface OpenApiSchema {
  readonly $ref?: string
  readonly type?: string
  readonly format?: string
  readonly nullable?: boolean
  readonly readOnly?: boolean
  readonly writeOnly?: boolean
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, OpenApiSchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | OpenApiSchema
  readonly minProperties?: number
  readonly maxProperties?: number
  readonly items?: OpenApiSchema
  readonly minItems?: number
  readonly maxItems?: number
  readonly uniqueItems?: boolean
  readonly oneOf?: readonly OpenApiSchema[]
  readonly anyOf?: readonly OpenApiSchema[]
  readonly allOf?: readonly OpenApiSchema[]
  readonly not?: OpenApiSchema
  readonly pattern?: string
  readonly minLength?: number
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: boolean
  readonly exclusiveMaximum?: boolean
  readonly multipleOf?: number
  readonly description?: string
  readonly example?: unknown
  readonly default?: unknown
  readonly deprecated?: boolean
  readonly title?: string
}

export interface OpenApiMediaType {
  readonly schema?: OpenApiSchema
}

export interface OpenApiParameter {
  readonly $ref?: string
  readonly name?: string
  readonly in?: string
  readonly required?: boolean
  readonly schema?: OpenApiSchema
}

export interface OpenApiRequestBody {
  readonly $ref?: string
  readonly required?: boolean
  readonly content?: Readonly<Record<string, OpenApiMediaType>>
}

export interface OpenApiResponse {
  readonly $ref?: string
  readonly content?: Readonly<Record<string, OpenApiMediaType>>
}

export interface OpenApiOperation {
  readonly operationId?: string
  readonly parameters?: readonly OpenApiParameter[]
  readonly requestBody?: OpenApiRequestBody
  readonly responses?: Readonly<Record<string, OpenApiResponse>>
}

export interface OpenApiSpec {
  readonly info: { readonly version: string }
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly components: {
    readonly schemas: Readonly<Record<string, OpenApiSchema>>
    readonly [section: string]: unknown
  }
}

export type ValidationMode = 'strict' | 'lenient'

export type ValidationDirection = 'request' | 'response'

export interface CheckOptions {
  readonly direction?: ValidationDirection
  readonly mode?: ValidationMode
  readonly redact?: boolean
}

export interface SchemaReport {
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

export const HANDLED_KEYWORDS: readonly string[] = [
  '$ref',
  'type',
  'format',
  'nullable',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'readOnly',
  'writeOnly',
]

export const IGNORED_KEYWORDS: Readonly<Record<string, string>> = {
  description: 'Szöveges leírás, nem korlátozza az értéket.',
  example: 'Mintaérték a dokumentációhoz, nem korlátozza az értéket.',
  default: 'A szerver által használt alapérték, nem korlátozza a küldött vagy kapott értéket.',
  deprecated: 'Elavultnak jelöli a mezőt, de az érték attól még érvényes.',
  title: 'Megjelenítendő név, nem korlátozza az értéket.',
  externalDocs: 'Külső dokumentáció linkje.',
  xml: 'XML leképezési tipp, JSON-nál nincs hatása.',
}

const KNOWN_KEYWORDS: ReadonlySet<string> = new Set([
  ...HANDLED_KEYWORDS,
  ...Object.keys(IGNORED_KEYWORDS),
])

export const HANDLED_TYPES: readonly string[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
]

const FLOAT_MAX = 3.4028234663852886e38
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))?$/
const BILLINGO_DATETIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function validParts(match: RegExpExecArray | null, limits: readonly number[]): boolean {
  if (!match) return false
  const [year, month, day, ...rest] = match.slice(1).map((part) => Number(part ?? 0))
  if (!isCalendarDate(year ?? 0, month ?? 0, day ?? 0)) return false
  return rest.every((part, index) => part <= (limits[index] ?? 0))
}

const FORMAT_CHECKS: Readonly<Record<string, (value: unknown) => string | undefined>> = {
  date: (value) =>
    typeof value !== 'string' || validParts(DATE.exec(value), [])
      ? undefined
      : 'nem YYYY-MM-DD dátum',
  'date-time': (value) =>
    typeof value !== 'string' || validParts(DATE_TIME.exec(value), [23, 59, 59, 23, 59])
      ? undefined
      : 'nem ISO dátum-idő',
  datetime: (value) =>
    typeof value !== 'string' || validParts(BILLINGO_DATETIME.exec(value), [23, 59, 59])
      ? undefined
      : 'nem YYYY-MM-DD HH:MM:SS dátum-idő',
  email: (value) => (typeof value !== 'string' || EMAIL.test(value) ? undefined : 'nem e-mail cím'),
  float: (value) =>
    typeof value !== 'number' || Math.abs(value) <= FLOAT_MAX
      ? undefined
      : 'kívül esik a float tartományon',
  int32: (value) =>
    typeof value !== 'number' || (value >= INT32_MIN && value <= INT32_MAX)
      ? undefined
      : 'kívül esik az int32 tartományon',
  binary: () => undefined,
}

export const HANDLED_FORMATS: readonly string[] = Object.keys(FORMAT_CHECKS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function shown(value: unknown, redact: boolean): string {
  if (redact) return jsonKind(value)
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

export function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`Csak belső hivatkozás támogatott: ${ref}`)
  let current: unknown = root
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~')
    if (!isRecord(current) || !(key in current)) {
      throw new Error(`Ismeretlen hivatkozás: ${ref}`)
    }
    current = current[key]
  }
  return current
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
    default:
      return isRecord(value)
  }
}

interface Context {
  readonly direction: ValidationDirection
  readonly mode: ValidationMode
  readonly redact: boolean
}

interface Findings {
  readonly errors: string[]
  readonly warnings: string[]
}

function emptyFindings(): Findings {
  return { errors: [], warnings: [] }
}

function merge(target: Findings, source: Findings): void {
  target.errors.push(...source.errors)
  target.warnings.push(...source.warnings)
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)]
}

export interface SchemaChecker {
  resolve(schema: OpenApiSchema): OpenApiSchema
  check(schema: OpenApiSchema, value: unknown, label: string, options?: CheckOptions): SchemaReport
}

export function createSchemaChecker(root: unknown): SchemaChecker {
  const patterns = new Map<string, RegExp>()

  function assertKnownKeywords(schema: OpenApiSchema): void {
    for (const key of Object.keys(schema)) {
      if (!KNOWN_KEYWORDS.has(key)) {
        throw new Error(`Nem kezelt séma kulcsszó: ${key}. Valósítsd meg a tests/openapi.ts-ben.`)
      }
    }
    for (const key of ['exclusiveMinimum', 'exclusiveMaximum'] as const) {
      const flag: unknown = schema[key]
      if (flag !== undefined && typeof flag !== 'boolean') {
        throw new Error(`A ${key} OpenAPI 3.0-ban logikai érték, kapott: ${JSON.stringify(flag)}`)
      }
    }
  }

  function resolve(input: OpenApiSchema): OpenApiSchema {
    let current = input
    for (let depth = 0; current.$ref !== undefined; depth++) {
      if (depth > 32) throw new Error(`Körkörös séma hivatkozás: ${input.$ref}`)
      const siblings = Object.keys(current).filter(
        (key) => key !== '$ref' && !(key in IGNORED_KEYWORDS),
      )
      if (siblings.length > 0) {
        throw new Error(`A $ref mellett nem kezelt kulcsszó: ${siblings.join(', ')}`)
      }
      const target = resolvePointer(root, current.$ref)
      if (!isRecord(target)) throw new Error(`A hivatkozás nem sémára mutat: ${current.$ref}`)
      current = target
    }
    assertKnownKeywords(current)
    return current
  }

  function schemaType(schema: OpenApiSchema): string | undefined {
    if (schema.type !== undefined) {
      if (typeof schema.type !== 'string' || !HANDLED_TYPES.includes(schema.type)) {
        throw new Error(`Nem kezelt séma típus: ${JSON.stringify(schema.type)}`)
      }
      return schema.type
    }
    return schema.properties !== undefined ? 'object' : undefined
  }

  function pattern(source: string): RegExp {
    const cached = patterns.get(source)
    if (cached) return cached
    const compiled = new RegExp(source, 'u')
    patterns.set(source, compiled)
    return compiled
  }

  function declaredKeys(input: OpenApiSchema, keys: Set<string> = new Set()): Set<string> {
    const schema = resolve(input)
    for (const key of Object.keys(schema.properties ?? {})) keys.add(key)
    for (const part of schema.allOf ?? []) declaredKeys(part, keys)
    return keys
  }

  function evaluate(schema: OpenApiSchema, value: unknown, path: string, ctx: Context): Findings {
    const findings = emptyFindings()
    check(schema, value, path, ctx, findings, undefined)
    return findings
  }

  function fewest(results: readonly Findings[], pick: (item: Findings) => number): Findings {
    return results.reduce((best, item) => (pick(item) < pick(best) ? item : best))
  }

  function checkOneOf(
    branches: readonly OpenApiSchema[],
    value: unknown,
    path: string,
    ctx: Context,
    out: Findings,
  ): void {
    const results = branches.map((part) => evaluate(part, value, path, ctx))
    const passing = results.filter((result) => result.errors.length === 0)
    if (passing.length === 0) {
      const best = fewest(results, (item) => item.errors.length)
      out.errors.push(`${path}: egyik oneOf ágnak sem felel meg`, ...best.errors)
      return
    }
    const least = fewest(passing, (item) => item.warnings.length)
    const closest = passing.filter((item) => item.warnings.length === least.warnings.length)
    if (closest.length > 1) {
      out.errors.push(`${path}: több oneOf ágnak is megfelel (${closest.length})`)
      return
    }
    merge(out, least)
  }

  function checkAnyOf(
    branches: readonly OpenApiSchema[],
    value: unknown,
    path: string,
    ctx: Context,
    out: Findings,
  ): void {
    const results = branches.map((part) => evaluate(part, value, path, ctx))
    const passing = results.filter((result) => result.errors.length === 0)
    if (passing.length === 0) {
      const best = fewest(results, (item) => item.errors.length)
      out.errors.push(`${path}: egyik anyOf ágnak sem felel meg`, ...best.errors)
      return
    }
    merge(
      out,
      fewest(passing, (item) => item.warnings.length),
    )
  }

  function checkString(schema: OpenApiSchema, value: string, path: string, out: Findings): void {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) {
      out.errors.push(`${path}: rövidebb, mint ${schema.minLength}`)
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      out.errors.push(`${path}: hosszabb, mint ${schema.maxLength}`)
    }
    if (schema.pattern !== undefined && !pattern(schema.pattern).test(value)) {
      out.errors.push(`${path}: nem illeszkedik a mintára (${schema.pattern})`)
    }
  }

  function checkNumber(schema: OpenApiSchema, value: number, path: string, out: Findings): void {
    if (schema.minimum !== undefined) {
      if (schema.exclusiveMinimum === true && value <= schema.minimum) {
        out.errors.push(`${path}: nem nagyobb, mint ${schema.minimum}`)
      } else if (value < schema.minimum) {
        out.errors.push(`${path}: kisebb, mint ${schema.minimum}`)
      }
    }
    if (schema.maximum !== undefined) {
      if (schema.exclusiveMaximum === true && value >= schema.maximum) {
        out.errors.push(`${path}: nem kisebb, mint ${schema.maximum}`)
      } else if (value > schema.maximum) {
        out.errors.push(`${path}: nagyobb, mint ${schema.maximum}`)
      }
    }
    if (schema.multipleOf !== undefined) {
      const ratio = value / schema.multipleOf
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        out.errors.push(`${path}: nem többszöröse ennek: ${schema.multipleOf}`)
      }
    }
  }

  function checkArray(
    schema: OpenApiSchema,
    value: readonly unknown[],
    path: string,
    ctx: Context,
    out: Findings,
  ): void {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      out.errors.push(`${path}: kevesebb elem, mint ${schema.minItems}`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      out.errors.push(`${path}: több elem, mint ${schema.maxItems}`)
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => canonicalJson(item)))
      if (seen.size !== value.length) out.errors.push(`${path}: ismétlődő elemek`)
    }
    const items = schema.items
    if (items) {
      value.forEach((item, index) => {
        check(items, item, `${path}[${index}]`, ctx, out, undefined)
      })
    }
  }

  function skippedByDirection(property: OpenApiSchema, ctx: Context): boolean {
    const resolved = resolve(property)
    return ctx.direction === 'request' ? resolved.readOnly === true : resolved.writeOnly === true
  }

  function checkObject(
    schema: OpenApiSchema,
    value: Record<string, unknown>,
    path: string,
    ctx: Context,
    out: Findings,
    inherited: ReadonlySet<string> | undefined,
  ): void {
    const properties = schema.properties ?? {}
    const required = schema.required ?? []
    const closed = schema.properties !== undefined || schema.additionalProperties !== undefined
    for (const key of required) {
      if (Object.hasOwn(value, key)) continue
      const property = properties[key]
      if (property && skippedByDirection(property, ctx)) continue
      out.errors.push(`${path}.${key}: kötelező mező hiányzik`)
    }
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`
      const property = properties[key]
      if (property) {
        const resolved = resolve(property)
        if (ctx.direction === 'request' && resolved.readOnly === true) {
          out.errors.push(`${itemPath}: csak olvasható mező, kérésben nem küldhető`)
          continue
        }
        if (ctx.direction === 'response' && resolved.writeOnly === true) {
          out.errors.push(`${itemPath}: csak írható mező, válaszban nem szerepelhet`)
          continue
        }
        if (
          item === null &&
          ctx.mode === 'lenient' &&
          resolved.nullable !== true &&
          !required.includes(key)
        ) {
          out.warnings.push(`${itemPath}: null, pedig a spec szerint nem nullable`)
          continue
        }
        check(property, item, itemPath, ctx, out, undefined)
        continue
      }
      if (inherited?.has(key)) continue
      const additional = schema.additionalProperties
      if (additional === true) continue
      if (typeof additional === 'object') {
        check(additional, item, ctx.redact ? `${path}.*` : itemPath, ctx, out, undefined)
        continue
      }
      if (!closed) continue
      const message = `${itemPath}: a sémában nem szereplő mező`
      if (ctx.mode === 'lenient') out.warnings.push(message)
      else out.errors.push(message)
    }
    const count = Object.keys(value).length
    if (schema.minProperties !== undefined && count < schema.minProperties) {
      out.errors.push(`${path}: kevesebb mező, mint ${schema.minProperties}`)
    }
    if (schema.maxProperties !== undefined && count > schema.maxProperties) {
      out.errors.push(`${path}: több mező, mint ${schema.maxProperties}`)
    }
  }

  function check(
    input: OpenApiSchema,
    value: unknown,
    path: string,
    ctx: Context,
    out: Findings,
    inherited: ReadonlySet<string> | undefined,
  ): void {
    const schema = resolve(input)
    if (value === null) {
      if (schema.nullable !== true) out.errors.push(`${path}: null nem engedett`)
      return
    }
    const scope = schema.allOf
      ? new Set([...(inherited ?? []), ...declaredKeys(schema)])
      : inherited
    for (const part of schema.allOf ?? []) check(part, value, path, ctx, out, scope)
    if (schema.oneOf) checkOneOf(schema.oneOf, value, path, ctx, out)
    if (schema.anyOf) checkAnyOf(schema.anyOf, value, path, ctx, out)
    if (schema.not) {
      const forbidden = evaluate(schema.not, value, path, { ...ctx, mode: 'strict' })
      if (forbidden.errors.length === 0)
        out.errors.push(`${path}: a not séma tiltja ezt az értéket`)
    }
    if (schema.enum) {
      const key = canonicalJson(value)
      if (!schema.enum.some((item) => canonicalJson(item) === key)) {
        out.errors.push(
          ctx.redact
            ? `${path}: nincs az engedett értékek között`
            : `${path}: ${shown(value, false)} nincs az engedett értékek között`,
        )
      }
    }
    const type = schemaType(schema)
    if (type !== undefined && !typeMatches(type, value)) {
      out.errors.push(`${path}: ${type} típus kell, kapott: ${shown(value, ctx.redact)}`)
      return
    }
    if (schema.format !== undefined) {
      const formatCheck = FORMAT_CHECKS[schema.format]
      if (!formatCheck) {
        throw new Error(
          `Nem kezelt formátum: ${schema.format}. Valósítsd meg a tests/openapi.ts-ben.`,
        )
      }
      const problem = formatCheck(value)
      if (problem) out.errors.push(`${path}: ${problem}`)
    }
    if (typeof value === 'string') checkString(schema, value, path, out)
    if (typeof value === 'number') checkNumber(schema, value, path, out)
    if (Array.isArray(value)) checkArray(schema, value, path, ctx, out)
    if (isRecord(value)) checkObject(schema, value, path, ctx, out, scope)
  }

  return {
    resolve,
    check(schema, value, label, options = {}) {
      const findings = evaluate(schema, value, label, {
        direction: options.direction ?? 'request',
        mode: options.mode ?? 'strict',
        redact: options.redact ?? false,
      })
      return { errors: unique(findings.errors), warnings: unique(findings.warnings) }
    },
  }
}

export interface SchemaValidator {
  validate(schemaName: string, value: unknown, options?: CheckOptions): string[]
  report(schemaName: string, value: unknown, options?: CheckOptions): SchemaReport
}

export function createValidator(schemas: Readonly<Record<string, OpenApiSchema>>): SchemaValidator {
  const checker = createSchemaChecker({ components: { schemas } })
  const report = (schemaName: string, value: unknown, options?: CheckOptions): SchemaReport =>
    checker.check({ $ref: `#/components/schemas/${schemaName}` }, value, schemaName, options)
  return {
    report,
    validate: (schemaName, value, options) => [...report(schemaName, value, options).errors],
  }
}

export interface SchemaUsage {
  readonly keywords: ReadonlyMap<string, readonly string[]>
  readonly formats: ReadonlyMap<string, readonly string[]>
  readonly types: ReadonlyMap<string, readonly string[]>
}

const SCHEMA_CHILDREN = ['items', 'not', 'additionalProperties'] as const
const SCHEMA_LISTS = ['oneOf', 'anyOf', 'allOf'] as const

export function schemaUsage(spec: unknown): SchemaUsage {
  const keywords = new Map<string, string[]>()
  const formats = new Map<string, string[]>()
  const types = new Map<string, string[]>()
  const note = (map: Map<string, string[]>, key: string, location: string): void => {
    const list = map.get(key) ?? []
    if (list.length < 3) list.push(location)
    map.set(key, list)
  }

  function walkSchema(schema: unknown, location: string): void {
    if (!isRecord(schema)) return
    for (const key of Object.keys(schema)) note(keywords, key, location)
    if (typeof schema.format === 'string') note(formats, schema.format, location)
    if (schema.type !== undefined) note(types, JSON.stringify(schema.type), location)
    if (isRecord(schema.properties)) {
      for (const [name, property] of Object.entries(schema.properties)) {
        walkSchema(property, `${location}/properties/${name}`)
      }
    }
    for (const key of SCHEMA_CHILDREN) walkSchema(schema[key], `${location}/${key}`)
    for (const key of SCHEMA_LISTS) {
      const list = schema[key]
      if (!Array.isArray(list)) continue
      for (const [index, part] of list.entries()) walkSchema(part, `${location}/${key}/${index}`)
    }
  }

  function walk(node: unknown, location: string): void {
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) walk(item, `${location}/${index}`)
      return
    }
    if (!isRecord(node)) return
    for (const [key, child] of Object.entries(node)) {
      const childLocation = `${location}/${key}`
      if (key === 'example' || key === 'examples') continue
      if (key === 'schema' || location === '#/components/schemas') walkSchema(child, childLocation)
      else walk(child, childLocation)
    }
  }

  walk(spec, '#')
  return { keywords, formats, types }
}

export function unsupportedSchemaUsage(spec: unknown): string[] {
  const usage = schemaUsage(spec)
  const problems: string[] = []
  for (const [keyword, locations] of usage.keywords) {
    if (!KNOWN_KEYWORDS.has(keyword)) problems.push(`kulcsszó ${keyword}: ${locations.join(', ')}`)
  }
  for (const [format, locations] of usage.formats) {
    if (!HANDLED_FORMATS.includes(format))
      problems.push(`formátum ${format}: ${locations.join(', ')}`)
  }
  for (const [type, locations] of usage.types) {
    if (!HANDLED_TYPES.map((item) => JSON.stringify(item)).includes(type)) {
      problems.push(`típus ${type}: ${locations.join(', ')}`)
    }
  }
  return problems
}

export const UNDOCUMENTED_SCHEMAS: Readonly<Partial<Record<OperationId, OpenApiOperation>>> = {}

export interface ParameterInput {
  readonly path: Readonly<Record<string, string>>
  readonly query: URLSearchParams
}

export interface RedactOptions {
  readonly redact?: boolean
}

export interface ResponseCheckOptions {
  readonly mode: ValidationMode
  readonly redact?: boolean
  readonly contentType?: string | undefined
}

export interface SpecValidator {
  operation(operationId: OperationId): OpenApiOperation
  requestErrors(operationId: OperationId, body: unknown, options?: RedactOptions): string[]
  parameterErrors(
    operationId: OperationId,
    input: ParameterInput,
    options?: RedactOptions,
  ): string[]
  responseErrors(
    operationId: OperationId,
    status: number,
    body: unknown,
    options: ResponseCheckOptions,
  ): SchemaReport
}

function mediaTypeOf(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType === 'application/json' || /^application\/[\w.+-]+\+json$/.test(mediaType)
}

function mediaMatches(range: string, mediaType: string): boolean {
  const normalized = range.toLowerCase()
  if (normalized === '*/*') return true
  if (normalized.endsWith('/*')) return mediaType.startsWith(normalized.slice(0, -1))
  return normalized === mediaType
}

const PARAMETER_LOCATIONS: ReadonlySet<string> = new Set(['path', 'query'])

export function createSpecValidator(
  spec: OpenApiSpec,
  undocumented: Readonly<Partial<Record<OperationId, OpenApiOperation>>> = UNDOCUMENTED_SCHEMAS,
): SpecValidator {
  const checker = createSchemaChecker(spec)
  const cache = new Map<OperationId, OpenApiOperation>()

  function deref<T extends { readonly $ref?: string }>(value: T): T {
    let current = value
    for (let depth = 0; current.$ref !== undefined; depth++) {
      if (depth > 32) throw new Error(`Körkörös hivatkozás: ${value.$ref}`)
      const target = resolvePointer(spec, current.$ref)
      if (!isRecord(target)) throw new Error(`A hivatkozás nem objektumra mutat: ${current.$ref}`)
      current = target as T
    }
    return current
  }

  function operation(operationId: OperationId): OpenApiOperation {
    const cached = cache.get(operationId)
    if (cached) return cached
    const info = BILLINGO_OPERATIONS[operationId]
    let found: OpenApiOperation
    if (info.spec === 'undocumented') {
      const mapped = undocumented[operationId]
      if (!mapped) {
        throw new Error(
          `${operationId}: a művelet nincs a Billingo spec-ben, és az UNDOCUMENTED_SCHEMAS sem írja le. Élő ellenőrzés után vedd fel a tests/openapi.ts UNDOCUMENTED_SCHEMAS táblájába.`,
        )
      }
      found = mapped
    } else {
      const item = spec.paths[info.path]
      const raw = item?.[info.method.toLowerCase()]
      if (!item || !isRecord(raw)) {
        throw new Error(`${operationId}: nincs a spec-ben (${info.method} ${info.path}).`)
      }
      const fromSpec = raw as OpenApiOperation
      if (fromSpec.operationId !== operationId) {
        throw new Error(
          `${operationId}: a spec ezen az útvonalon a(z) ${String(fromSpec.operationId)} műveletet írja le (${info.method} ${info.path}).`,
        )
      }
      const shared = Array.isArray(item.parameters) ? (item.parameters as OpenApiParameter[]) : []
      const own = (fromSpec.parameters ?? []).map((parameter) => deref(parameter))
      const inherited = shared
        .map((parameter) => deref(parameter))
        .filter(
          (parameter) =>
            !own.some((mine) => mine.name === parameter.name && mine.in === parameter.in),
        )
      found = { ...fromSpec, parameters: [...inherited, ...own] }
    }
    cache.set(operationId, found)
    return found
  }

  function schemaLabel(schema: OpenApiSchema, fallback: string): string {
    return schema.$ref ? (schema.$ref.split('/').pop() ?? fallback) : fallback
  }

  function jsonSchema(
    content: Readonly<Record<string, OpenApiMediaType>>,
    where: string,
  ): OpenApiSchema | undefined {
    const entry = Object.entries(content).find(([mediaType]) =>
      isJsonMediaType(mediaTypeOf(mediaType)),
    )
    if (!entry) return undefined
    const schema = entry[1].schema
    if (!schema) throw new Error(`${where}: a JSON tartalomnak nincs sémája.`)
    return schema
  }

  function requestErrors(operationId: OperationId, body: unknown, options: RedactOptions = {}) {
    const raw = operation(operationId).requestBody
    if (!raw) {
      return body === undefined
        ? []
        : [`${operationId}: a spec szerint nincs kéréstörzse, mégis érkezett`]
    }
    const requestBody = deref(raw)
    if (body === undefined) {
      return requestBody.required === true ? [`${operationId}: kötelező kéréstörzs hiányzik`] : []
    }
    const schema = jsonSchema(requestBody.content ?? {}, `${operationId} kérés`)
    if (!schema) {
      throw new Error(`${operationId}: a kéréstörzs nem JSON, ezt a validátor nem kezeli.`)
    }
    return [
      ...checker.check(schema, body, schemaLabel(schema, operationId), {
        direction: 'request',
        mode: 'strict',
        redact: options.redact ?? false,
      }).errors,
    ]
  }

  function coerce(raw: string, input: OpenApiSchema): unknown {
    const schema = checker.resolve(input)
    const numericEnum =
      schema.type === undefined &&
      schema.enum !== undefined &&
      schema.enum.every((item) => typeof item === 'number')
    const type = schema.type ?? (numericEnum ? 'number' : 'string')
    switch (type) {
      case 'integer':
      case 'number':
        return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw
      case 'boolean':
        return raw === 'true' ? true : raw === 'false' ? false : raw
      case 'string':
        return raw
      default:
        throw new Error(`Nem támogatott paramétertípus: ${type}`)
    }
  }

  function parameterErrors(
    operationId: OperationId,
    input: ParameterInput,
    options: RedactOptions = {},
  ) {
    const info = BILLINGO_OPERATIONS[operationId]
    const parameters = (operation(operationId).parameters ?? []).map((parameter) =>
      deref(parameter),
    )
    const errors: string[] = []
    const redact = options.redact ?? false
    for (const parameter of parameters) {
      if (!parameter.in || !PARAMETER_LOCATIONS.has(parameter.in)) {
        throw new Error(
          `${operationId}: nem kezelt paraméterhely: ${String(parameter.in)} (${String(parameter.name)})`,
        )
      }
    }
    const validate = (parameter: OpenApiParameter, raw: string, label: string): void => {
      if (!parameter.schema) throw new Error(`${label}: a paraméternek nincs sémája.`)
      errors.push(
        ...checker.check(parameter.schema, coerce(raw, parameter.schema), label, {
          direction: 'request',
          mode: 'strict',
          redact,
        }).errors,
      )
    }
    const templateNames = [...info.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '')
    for (const name of templateNames) {
      const parameter = parameters.find((item) => item.in === 'path' && item.name === name)
      const label = `${operationId} útvonal.${name}`
      if (!parameter) {
        errors.push(`${label}: a spec nem írja le ezt az útvonal-paramétert`)
        continue
      }
      const raw = input.path[name]
      if (raw === undefined) errors.push(`${label}: hiányzik`)
      else validate(parameter, raw, label)
    }
    const queryParameters = parameters.filter((item) => item.in === 'query')
    const keys = [...input.query.keys()]
    for (const key of new Set(keys)) {
      const label = `${operationId} query.${key}`
      const parameter = queryParameters.find((item) => item.name === key)
      if (!parameter) {
        errors.push(`${label}: a spec-ben nem szereplő query paraméter`)
        continue
      }
      const values = input.query.getAll(key)
      if (values.length > 1) errors.push(`${label}: többször szerepel`)
      validate(parameter, values[0] ?? '', label)
    }
    for (const parameter of queryParameters) {
      if (parameter.required === true && parameter.name && !input.query.has(parameter.name)) {
        errors.push(`${operationId} query.${parameter.name}: kötelező paraméter hiányzik`)
      }
    }
    return errors
  }

  function responseErrors(
    operationId: OperationId,
    status: number,
    body: unknown,
    options: ResponseCheckOptions,
  ): SchemaReport {
    const responses = operation(operationId).responses ?? {}
    const code = String(status)
    const raw = responses[code] ?? responses[`${code[0]}XX`] ?? responses.default
    const errors: string[] = []
    const warnings: string[] = []
    if (!raw) {
      const message = `${operationId} ${code}: a státusz nincs dokumentálva`
      if (options.mode === 'lenient') warnings.push(message)
      else errors.push(message)
      return { errors, warnings }
    }
    const response = deref(raw)
    const content = response.content ?? {}
    const documented = Object.keys(content)
    const label = `${operationId} ${code}`
    if (documented.length === 0) {
      if (body !== undefined) errors.push(`${label}: a spec szerint üres válasz, mégis van törzse`)
      return { errors, warnings }
    }
    let expectJson = documented.some((mediaType) => isJsonMediaType(mediaTypeOf(mediaType)))
    if (options.contentType !== undefined) {
      const actual = mediaTypeOf(options.contentType)
      const match = documented.find((mediaType) => mediaMatches(mediaTypeOf(mediaType), actual))
      if (!match) {
        errors.push(
          `${label}: nem dokumentált tartalomtípus (${actual}), a spec szerint: ${documented.join(', ')}`,
        )
        return { errors, warnings }
      }
      expectJson = isJsonMediaType(mediaTypeOf(match))
    }
    if (!expectJson) return { errors, warnings }
    if (body === undefined) {
      errors.push(`${label}: hiányzik a JSON választörzs`)
      return { errors, warnings }
    }
    const schema = jsonSchema(content, label)
    if (!schema) return { errors, warnings }
    const report = checker.check(schema, body, schemaLabel(schema, label), {
      direction: 'response',
      mode: options.mode,
      redact: options.redact ?? false,
    })
    return { errors: [...errors, ...report.errors], warnings: [...warnings, ...report.warnings] }
  }

  return { operation, requestErrors, parameterErrors, responseErrors }
}

export interface MatchedOperation {
  readonly operation: OperationId
  readonly pathParams: Readonly<Record<string, string>>
}

export function matchOperation(
  method: string,
  url: URL,
  baseUrl: string = BILLINGO_API_URL,
): MatchedOperation {
  const base = new URL(baseUrl)
  const prefix = base.pathname.replace(/\/+$/, '')
  if (url.origin !== base.origin || !url.pathname.startsWith(`${prefix}/`)) {
    throw new Error(`A kérés nem a Billingo API-ra megy: ${method} ${url.origin}${url.pathname}`)
  }
  const segments = url.pathname.slice(prefix.length + 1).split('/')
  const candidates: { operation: OperationId; params: Record<string, string> }[] = []
  for (const [operation, info] of Object.entries(BILLINGO_OPERATIONS)) {
    if (info.method !== method.toUpperCase()) continue
    const template = info.path.slice(1).split('/')
    if (template.length !== segments.length) continue
    const params: Record<string, string> = {}
    const matches = template.every((part, index) => {
      const segment = segments[index] ?? ''
      const name = /^\{(\w+)\}$/.exec(part)?.[1]
      if (name === undefined) return part === segment
      params[name] = decodeURIComponent(segment)
      return segment !== ''
    })
    if (matches) candidates.push({ operation: operation as OperationId, params })
  }
  const [chosen, ...others] = candidates
  if (!chosen) {
    throw new Error(`Nincs ilyen Billingo művelet: ${method.toUpperCase()} ${url.pathname}`)
  }
  if (others.length > 0) {
    throw new Error(
      `Több művelet is illeszkedik: ${candidates.map((item) => item.operation).join(', ')}`,
    )
  }
  return { operation: chosen.operation, pathParams: chosen.params }
}

const CACHE_DIR = join(import.meta.dirname, '..', '.spec-cache')

export const SPEC_REQUIRED: boolean = process.env.TARCA_REQUIRE_SPEC === '1'

export function loadCachedSpecs(): OpenApiSpec[] {
  const indexPath = join(CACHE_DIR, 'index.json')
  if (!existsSync(indexPath)) {
    if (SPEC_REQUIRED) {
      throw new Error('TARCA_REQUIRE_SPEC=1, de nincs .spec-cache. Futtasd: npm run spec:fetch')
    }
    return []
  }
  const { versions } = JSON.parse(readFileSync(indexPath, 'utf8')) as { versions: string[] }
  return versions.map(
    (version) =>
      JSON.parse(readFileSync(join(CACHE_DIR, `billingo-${version}.json`), 'utf8')) as OpenApiSpec,
  )
}

export function loadMergedSpec(): OpenApiSpec | undefined {
  const specs = loadCachedSpecs()
  if (specs.length === 0) return undefined
  return mergeSpecs(specs) as unknown as OpenApiSpec
}

const mergedSpec = loadMergedSpec()

export const SPEC_AVAILABLE: boolean = mergedSpec !== undefined

const specValidator = mergedSpec ? createSpecValidator(mergedSpec) : undefined
const schemaValidator = mergedSpec ? createValidator(mergedSpec.components.schemas) : undefined

function requireSpec<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error(
      'Nincs letöltött Billingo spec (.spec-cache), a szerződés nem ellenőrizhető. Futtasd: npm run spec:fetch. A szerződéstesztet tedd describe.skipIf(!SPEC_AVAILABLE) alá, hogy a hiány látszódjon.',
    )
  }
  return value
}

export function billingoSpecValidator(): SpecValidator {
  return requireSpec(specValidator)
}

export function contractErrors(schemaName: string, value: unknown): string[] {
  return requireSpec(schemaValidator).validate(schemaName, value, { direction: 'request' })
}

export function requestErrors(
  operationId: OperationId,
  body: unknown,
  options?: RedactOptions,
): string[] {
  return requireSpec(specValidator).requestErrors(operationId, body, options)
}

export function parameterErrors(
  operationId: OperationId,
  input: ParameterInput,
  options?: RedactOptions,
): string[] {
  return requireSpec(specValidator).parameterErrors(operationId, input, options)
}

export function responseErrors(
  operationId: OperationId,
  status: number,
  body: unknown,
  options: ResponseCheckOptions,
): SchemaReport {
  return requireSpec(specValidator).responseErrors(operationId, status, body, options)
}
