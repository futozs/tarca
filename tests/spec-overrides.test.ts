import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  applySpecOverrides,
  describeOverride,
  mergeRawSpecs,
  mergeSpecs,
  specOverrideProblems,
} from '../scripts/spec-core.mjs'
import {
  SPEC_OVERRIDES,
  type SpecOverride,
  type SpecOverrideEvidence,
} from '../scripts/spec-overrides.mjs'
import { BILLINGO_API_URL } from '../src/core/context'
import {
  createSpecValidator,
  loadCachedSpecs,
  matchOperation,
  type OpenApiSchema,
  type OpenApiSpec,
  SPEC_AVAILABLE,
  type SpecValidator,
} from './openapi'

const BASE = {
  info: { version: 'teszt' },
  paths: {
    '/items': {
      get: { operationId: 'ListItem', responses: { '200': { description: 'ok' } } },
      post: {
        operationId: 'CreateItem',
        responses: {
          '200': { content: { 'application/pdf': { schema: { type: 'string' } } } },
          '400': { $ref: '#/components/responses/Bad' },
        },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          old_flag: { type: 'boolean' },
          kind: { $ref: '#/components/schemas/Kind', description: 'fajta' },
          note: { type: 'string', nullable: true },
        },
      },
      Kind: { type: 'string', enum: ['a'] },
    },
  },
}

type OverrideFields = SpecOverride extends infer Entry
  ? Entry extends SpecOverride
    ? Omit<Entry, 'reason' | 'evidence'>
    : never
  : never

const EVIDENCE: readonly SpecOverrideEvidence[] = [
  { source: 'probe', ref: '001-x.json', date: '2026-11-15' },
]

function override(fields: OverrideFields): SpecOverride {
  return { reason: 'teszt felülírás indoklása', evidence: EVIDENCE, ...fields }
}

function untyped(kind: string): SpecOverride {
  return JSON.parse(JSON.stringify({ kind, reason: 'ismeretlen fajta', evidence: EVIDENCE }))
}

function itemSchema(spec: unknown): Record<string, unknown> {
  return (spec as { components: { schemas: { Item: Record<string, unknown> } } }).components.schemas
    .Item
}

describe('spec-felülírások: a motor', () => {
  test('a nullable a sima mezőt nullable-re, a $ref mezőt nullable oneOf-ra írja, a bemenetet nem módosítja', () => {
    const before = JSON.stringify(BASE)
    const { spec, problems } = applySpecOverrides(BASE, [
      override({ kind: 'nullable', schema: 'Item', properties: ['name', 'kind'] }),
    ])

    expect(problems).toEqual([])
    expect(itemSchema(spec).properties).toEqual({
      name: { type: 'string', nullable: true },
      old_flag: { type: 'boolean' },
      kind: {
        description: 'fajta',
        nullable: true,
        oneOf: [{ $ref: '#/components/schemas/Kind' }],
      },
      note: { type: 'string', nullable: true },
    })
    expect(JSON.stringify(BASE)).toBe(before)
  })

  test('a kötelező mezőket a required listához fűzi', () => {
    const { spec } = applySpecOverrides(BASE, [
      override({ kind: 'required', schema: 'Item', properties: ['kind', 'note'] }),
    ])

    expect(itemSchema(spec).required).toEqual(['name', 'kind', 'note'])
  })

  test('az átnevezés megtartja a mezők sorrendjét és a required listát', () => {
    const renamed = applySpecOverrides(BASE, [
      override({ kind: 'rename', schema: 'Item', from: 'name', to: 'title' }),
    ]).spec

    expect(Object.keys(itemSchema(renamed).properties as object)).toEqual([
      'title',
      'old_flag',
      'kind',
      'note',
    ])
    expect(itemSchema(renamed).required).toEqual(['title'])
  })

  test('a státusz és a tartalomtípus felülírása a műveletet operationId szerint találja meg', () => {
    const { spec, problems } = applySpecOverrides(BASE, [
      override({ kind: 'status', operation: 'CreateItem', from: '200', to: '201' }),
      override({
        kind: 'content',
        operation: 'CreateItem',
        status: '201',
        mediaType: 'application/octet-stream',
        replaces: 'application/pdf',
        schema: { type: 'string', format: 'binary' },
      }),
      override({
        kind: 'content',
        operation: 'ListItem',
        status: '200',
        mediaType: 'application/json',
        schema: { $ref: '#/components/schemas/Item' },
      }),
    ])

    expect(problems).toEqual([])
    const item = (spec.paths['/items'] ?? {}) as Record<string, { responses: object }>
    expect(item.post?.responses).toEqual({
      '201': {
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      },
      '400': { $ref: '#/components/responses/Bad' },
    })
    expect(item.get?.responses).toEqual({
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
      },
    })
  })

  test('új műveletet és új sémát csak oda tesz, ahol még nincs', () => {
    const { spec, problems } = applySpecOverrides(BASE, [
      override({
        kind: 'operation',
        path: '/items/{id}',
        method: 'delete',
        operation: { operationId: 'DeleteItem', responses: { '204': {} } },
      }),
      override({ kind: 'schema', name: 'ItemUpdate', schema: { type: 'object' } }),
    ])

    expect(problems).toEqual([])
    expect(spec.paths['/items/{id}']).toEqual({
      delete: { operationId: 'DeleteItem', responses: { '204': {} } },
    })
    expect(spec.components.schemas.ItemUpdate).toEqual({ type: 'object' })
  })

  test('új válaszstátuszt csak a dokumentálatlan státuszra tesz, a meglévőre és ismeretlen műveletre jelez', () => {
    const notFound = { $ref: '#/components/responses/NotFound' }
    const { spec, problems } = applySpecOverrides(BASE, [
      override({ kind: 'response', operation: 'ListItem', status: '404', response: notFound }),
    ])
    const item = (spec.paths['/items'] ?? {}) as Record<string, { responses: object }>

    expect(problems).toEqual([])
    expect(item.get?.responses).toEqual({ '200': { description: 'ok' }, '404': notFound })
    expect(
      applySpecOverrides(BASE, [
        override({ kind: 'response', operation: 'CreateItem', status: '400', response: notFound }),
      ]).problems,
    ).toEqual([
      'CreateItem: 400 válasz: felesleges, a Billingo spec már ezt írja (a CreateItem már dokumentálja a 400 választ). Töröld a scripts/spec-overrides.mjs-ből.',
    ])
    const missing = applySpecOverrides(BASE, [
      override({ kind: 'response', operation: 'Nincs', status: '404', response: notFound }),
    ])
    expect(missing.problems).toHaveLength(1)
    expect(missing.problems[0]).toContain('nem alkalmazható (nincs Nincs művelet)')
    expect(missing.spec).toEqual(BASE)
  })

  test('a felesleges felülírást jelzi, a többit akkor is alkalmazza', () => {
    const { spec, problems } = applySpecOverrides(BASE, [
      override({ kind: 'nullable', schema: 'Item', properties: ['note'] }),
      override({ kind: 'required', schema: 'Item', properties: ['name'] }),
      override({ kind: 'rename', schema: 'Item', from: 'is_flag', to: 'old_flag' }),
      override({ kind: 'status', operation: 'CreateItem', from: '201', to: '200' }),
      override({
        kind: 'content',
        operation: 'CreateItem',
        status: '200',
        mediaType: 'application/pdf',
        schema: {},
      }),
      override({ kind: 'schema', name: 'Kind', schema: {} }),
      override({
        kind: 'operation',
        path: '/items',
        method: 'get',
        operation: { operationId: 'ListItem' },
      }),
      override({ kind: 'nullable', schema: 'Item', properties: ['old_flag'] }),
    ])

    expect(problems).toEqual([
      'Item: note nullable: felesleges, a Billingo spec már ezt írja (Item.note már nullable). Töröld a scripts/spec-overrides.mjs-ből.',
      'Item: name kötelező: felesleges, a Billingo spec már ezt írja (a Item már kötelezőnek írja: name). Töröld a scripts/spec-overrides.mjs-ből.',
      'Item: is_flag → old_flag: felesleges, a Billingo spec már ezt írja (a Item már old_flag néven írja). Töröld a scripts/spec-overrides.mjs-ből.',
      'CreateItem: 201 → 200 státusz: felesleges, a Billingo spec már ezt írja (a CreateItem már dokumentálja a 200 választ). Töröld a scripts/spec-overrides.mjs-ből.',
      'CreateItem 200: application/pdf: felesleges, a Billingo spec már ezt írja (a CreateItem 200 már application/pdf). Töröld a scripts/spec-overrides.mjs-ből.',
      'Kind séma: felesleges, a Billingo spec már ezt írja (a Kind séma már létezik). Töröld a scripts/spec-overrides.mjs-ből.',
      'GET /items (ListItem): felesleges, a Billingo spec már ezt írja (GET /items már dokumentált (ListItem)). Töröld a scripts/spec-overrides.mjs-ből.',
    ])
    expect(itemSchema(spec).properties).toMatchObject({ old_flag: { nullable: true } })
  })

  test('a nem alkalmazható felülírást jelzi, és nem módosít semmit', () => {
    const cases: readonly [OverrideFields, string][] = [
      [{ kind: 'nullable', schema: 'Nincs', properties: ['a'] }, 'nincs Nincs séma mezőkkel'],
      [{ kind: 'nullable', schema: 'Item', properties: ['a', 'b'] }, 'nincs a, b mező'],
      [{ kind: 'required', schema: 'Item', properties: ['a'] }, 'nincs a mező'],
      [{ kind: 'rename', schema: 'Kind', from: 'a', to: 'b' }, 'nincs Kind séma mezőkkel'],
      [{ kind: 'rename', schema: 'Item', from: 'a', to: 'b' }, 'nincs a mező'],
      [{ kind: 'rename', schema: 'Item', from: 'name', to: 'note' }, 'name és note is van'],
      [{ kind: 'status', operation: 'Nincs', from: '200', to: '201' }, 'nincs Nincs művelet'],
      [{ kind: 'status', operation: 'ListItem', from: '202', to: '201' }, 'nem dokumentálja a 202'],
      [
        { kind: 'content', operation: 'CreateItem', status: '400', mediaType: 'x/y', schema: {} },
        'hiányzik vagy közös',
      ],
      [
        {
          kind: 'content',
          operation: 'CreateItem',
          status: '200',
          mediaType: 'x/y',
          replaces: 'text/csv',
          schema: {},
        },
        'nem text/csv',
      ],
    ]
    for (const [fields, detail] of cases) {
      const { spec, problems } = applySpecOverrides(BASE, [override(fields)])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(`nem alkalmazható (`)
      expect(problems[0]).toContain(detail)
      expect(spec).toEqual(BASE)
    }
  })

  test('ismeretlen fajtájú felülírásra hibát dob', () => {
    expect(() => applySpecOverrides(BASE, [untyped('loosen')])).toThrow(
      'Ismeretlen spec-felülírás: loosen',
    )
    expect(() => describeOverride(untyped('toString'))).toThrow(TypeError)
  })

  test('a mergeSpecs a megadott felülírásokat alkalmazza, a mergeRawSpecs semmit', () => {
    const nullable = [override({ kind: 'nullable', schema: 'Item', properties: ['name'] })]

    expect(itemSchema(mergeSpecs([BASE], nullable)).properties).toMatchObject({
      name: { nullable: true },
    })
    expect(itemSchema(mergeRawSpecs([BASE]))).toEqual(BASE.components.schemas.Item)
    expect(specOverrideProblems([BASE], [...nullable, ...nullable])).toHaveLength(1)
  })
})

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SOURCES = new Set(['probe', 'mcp', 'e2e', 'route-probe'])

describe('spec-felülírások: a tábla', () => {
  test('minden bejegyzésnek van indoka és dátumozott, ismert forrású bizonyítéka', () => {
    const today = new Date().toISOString().slice(0, 10)
    const problems = SPEC_OVERRIDES.flatMap((entry) => {
      const label = describeOverride(entry)
      const issues: string[] = []
      if (entry.reason.trim().length < 20) issues.push(`${label}: rövid indok`)
      if (entry.evidence.length === 0) issues.push(`${label}: nincs bizonyíték`)
      for (const item of entry.evidence) {
        if (!SOURCES.has(item.source)) issues.push(`${label}: ismeretlen forrás ${item.source}`)
        if (!DATE.test(item.date) || item.date > today) issues.push(`${label}: rossz dátum`)
        if (item.source === 'probe' && !/^\d{3}-[\w-]+\.json$/.test(item.ref)) {
          issues.push(`${label}: rossz próbafájlnév ${item.ref}`)
        }
        if (item.ref.trim() === '') issues.push(`${label}: üres hivatkozás`)
      }
      if ('properties' in entry && entry.properties.length === 0) {
        issues.push(`${label}: üres mezőlista`)
      }
      return issues
    })

    expect(SPEC_OVERRIDES.length).toBeGreaterThan(20)
    expect(problems).toEqual([])
  })

  test('egy cél csak egyszer szerepel', () => {
    const labels = SPEC_OVERRIDES.flatMap((entry) =>
      'properties' in entry
        ? entry.properties.map((name) => `${entry.kind} ${entry.schema}.${name}`)
        : [describeOverride(entry)],
    )
    expect(labels.filter((label, index) => labels.indexOf(label) !== index)).toEqual([])
  })
})

describe.skipIf(!SPEC_AVAILABLE)('spec-felülírások: a friss Billingo spec ellen', () => {
  const specs = loadCachedSpecs()

  test('minden felülírás alkalmazható és szükséges (a nyers spec még nem mondja ugyanezt)', () => {
    expect(specOverrideProblems(specs)).toEqual([])
  })

  test('ha a Billingo kijavítaná a spec-et, minden felülírás feleslegesként bukna el', () => {
    const fixed = mergeSpecs(specs)
    const { problems } = applySpecOverrides(fixed, SPEC_OVERRIDES)

    expect(problems).toHaveLength(SPEC_OVERRIDES.length)
    expect(problems.every((problem) => problem.includes('felesleges'))).toBe(true)
  })
})

interface ProbeRecord {
  readonly file: string
  readonly operation: string
  readonly method: string
  readonly path: string
  readonly status: number
  readonly contentType: string
  readonly request?: unknown
  readonly body: unknown
}

interface Verdict {
  readonly request: readonly string[]
  readonly response: readonly string[]
}

const PROBE_DIR = join(import.meta.dirname, '..', '.research', 'probe', 'out')
const PROBES_AVAILABLE = existsSync(PROBE_DIR)

const SERVER_ONLY_RULES: Readonly<Record<string, string>> = {
  '010-block-create-tarca-e2e.json name':
    'A tömbnév karakterkészletét (csak betű, szám, szóköz) a spec nem írja le, a pontos szabály nem ismert.',
  '083-document-finalize-draft-empty-body.json conversion_rate':
    'Csak nem forintos pénznemnél kötelező; ezt a feltételt OpenAPI 3.0 séma nem tudja kifejezni.',
}

function loadProbes(): ProbeRecord[] {
  return readdirSync(PROBE_DIR)
    .filter((file) => /^\d{3}-.+\.json$/.test(file))
    .sort()
    .map((file) => ({ file, ...JSON.parse(readFileSync(join(PROBE_DIR, file), 'utf8')) }))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function verdict(validator: SpecValidator, record: ProbeRecord): Verdict {
  try {
    const url = new URL(`${BILLINGO_API_URL}${record.path}`)
    const { operation, pathParams } = matchOperation(record.method, url)
    const request = [
      ...(operation === record.operation
        ? []
        : [`a próba ${record.operation}, a kérés ${operation}`]),
      ...validator.parameterErrors(operation, { path: pathParams, query: url.searchParams }),
      ...validator.requestErrors(operation, record.request),
    ]
    const json = record.contentType.includes('json')
    const response = validator.responseErrors(
      operation,
      record.status,
      json ? (record.body ?? undefined) : undefined,
      { mode: 'strict', contentType: record.contentType || undefined },
    )
    return { request, response: [...response.errors, ...response.warnings] }
  } catch (error) {
    return { request: [], response: [`kivétel: ${messageOf(error)}`] }
  }
}

function rejectedFields(record: ProbeRecord): string[] {
  const errors = (record.body as { errors?: readonly { field: string }[] }).errors ?? []
  return [...new Set(errors.map((error) => error.field.split('.')[0] ?? ''))]
}

function flaggedFields(messages: readonly string[]): Set<string> {
  return new Set(messages.map((message) => /^\w+\.(\w+)/.exec(message)?.[1] ?? message))
}

function mismatches(validator: SpecValidator, record: ProbeRecord): string[] {
  const { request, response } = verdict(validator, record)
  const label = `${record.file} (${record.status})`
  const problems = response.map((message) => `${label} válasz: ${message}`)
  if (record.status !== 422) {
    return [...problems, ...request.map((message) => `${label} kérés: ${message}`)]
  }
  const flagged = flaggedFields(request)
  for (const field of rejectedFields(record)) {
    if (flagged.has(field) || SERVER_ONLY_RULES[`${record.file} ${field}`] !== undefined) continue
    problems.push(`${label}: a Billingo elutasította a(z) ${field} mezőt, a szerződés nem`)
  }
  return problems
}

function probeRefs(entry: SpecOverride): string[] {
  return entry.evidence.flatMap((item) => (item.source === 'probe' ? [item.ref] : []))
}

function variants(
  entry: SpecOverride,
): { readonly label: string; readonly entry?: SpecOverride }[] {
  if (!('properties' in entry) || entry.properties.length === 1) {
    return [{ label: describeOverride(entry) }]
  }
  return entry.properties.map((name) => ({
    label: `${entry.schema}.${name} (${entry.kind})`,
    entry: { ...entry, properties: entry.properties.filter((other) => other !== name) },
  }))
}

describe.skipIf(!SPEC_AVAILABLE || !PROBES_AVAILABLE)(
  'spec-felülírások: a bizonyítékok (.research/probe/out, csak helyben)',
  () => {
    const specs = loadCachedSpecs()
    const probes = PROBES_AVAILABLE ? loadProbes() : []
    const byFile = new Map(probes.map((record) => [record.file, record]))
    const corrected = createSpecValidator(mergeSpecs(specs) as unknown as OpenApiSpec)

    test('minden hivatkozott próbafájl létezik', () => {
      const missing = SPEC_OVERRIDES.flatMap(probeRefs).filter((ref) => !byFile.has(ref))
      expect(missing).toEqual([])
    })

    test('a javított spec minden élő próbát elfogad, és a 422-es kéréseket ugyanott utasítja el, mint a Billingo', () => {
      expect(probes.length).toBeGreaterThan(100)
      expect(probes.flatMap((record) => mismatches(corrected, record))).toEqual([])
    })

    test('a nyers spec ugyanezeken a próbákon elbukik, tehát a felülírások nem üresek', () => {
      const raw = createSpecValidator(mergeRawSpecs(specs) as unknown as OpenApiSpec)
      expect(probes.flatMap((record) => mismatches(raw, record)).length).toBeGreaterThan(100)
    })

    test('minden felülírás, és minden felsorolt mezője, legalább egy saját próbáján számít', () => {
      const unproven: string[] = []
      for (const entry of SPEC_OVERRIDES) {
        const records = probeRefs(entry).flatMap((ref) => byFile.get(ref) ?? [])
        if (records.length === 0) continue
        const expected = records.map((record) => verdict(corrected, record))
        for (const variant of variants(entry)) {
          const without = SPEC_OVERRIDES.flatMap((other) =>
            other === entry ? (variant.entry ? [variant.entry] : []) : [other],
          )
          const validator = createSpecValidator(
            mergeSpecs(specs, without) as unknown as OpenApiSpec,
          )
          const changed = records.some(
            (record, index) =>
              JSON.stringify(verdict(validator, record)) !== JSON.stringify(expected[index]),
          )
          if (!changed) unproven.push(variant.label)
        }
      }
      expect(unproven).toEqual([])
    })

    test('az új séma minden mezőjét a Billingo élőben elfogadta, vagy az alapsémája írhatónak dokumentálja', () => {
      const raw = mergeRawSpecs(specs).components.schemas
      const unproven = SPEC_OVERRIDES.flatMap((entry) => {
        if (entry.kind !== 'schema') return []
        const accepted = new Set(
          probeRefs(entry)
            .flatMap((ref) => byFile.get(ref) ?? [])
            .filter((record) => record.status >= 200 && record.status < 300)
            .flatMap((record) => Object.keys(record.request ?? {})),
        )
        const base = entry.basedOn === undefined ? undefined : raw[entry.basedOn]
        const documented = (name: string): boolean => {
          const property = (base as OpenApiSchema | undefined)?.properties?.[name]
          return property !== undefined && property.readOnly !== true
        }
        const properties = Object.keys((entry.schema as OpenApiSchema).properties ?? {})
        return properties
          .filter((name) => !accepted.has(name) && !documented(name))
          .map((name) => `${entry.name}.${name}`)
      })
      expect(unproven).toEqual([])
    })
  },
)
