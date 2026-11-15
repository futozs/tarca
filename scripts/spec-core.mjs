import { SPEC_OVERRIDES } from './spec-overrides.mjs'

export const SWAGGERHUB_API = 'https://api.swaggerhub.com/apis/Billingo/Billingo'
export const MIN_SPEC_VERSION = '3.0.14'
export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']

export function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function registryVersions(registry) {
  const versions = []
  for (const api of registry?.apis ?? []) {
    const version = api.properties?.find((property) => property.type === 'X-Version')?.value
    if (typeof version === 'string' && /^\d+(\.\d+)*$/.test(version)) versions.push(version)
  }
  return [...new Set(versions)].sort(compareVersions)
}

export function trackedVersions(versions, defaultVersion) {
  return versions.filter(
    (version) =>
      compareVersions(version, MIN_SPEC_VERSION) >= 0 &&
      compareVersions(version, defaultVersion) >= 0,
  )
}

export function specOperations(spec) {
  const operations = []
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.includes(method)) continue
      operations.push({ id: operation.operationId, method: method.toUpperCase(), path })
    }
  }
  return operations.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`))
}

export function mergeRawSpecs(specs) {
  const ordered = [...specs].sort((a, b) => compareVersions(a.info.version, b.info.version))
  const newest = ordered.at(-1)
  if (!newest) throw new Error('Nincs letöltött Billingo spec. Futtasd: npm run spec:fetch')
  const schemas = {}
  const parameters = {}
  const responses = {}
  const paths = {}
  for (const spec of ordered) {
    Object.assign(schemas, spec.components?.schemas ?? {})
    Object.assign(parameters, spec.components?.parameters ?? {})
    Object.assign(responses, spec.components?.responses ?? {})
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      paths[path] = { ...(paths[path] ?? {}), ...item }
    }
  }
  return {
    ...newest,
    info: { ...newest.info, version: ordered.map((spec) => spec.info.version).join('+') },
    paths,
    components: { ...newest.components, schemas, parameters, responses },
  }
}

export function mergeSpecs(specs, overrides = SPEC_OVERRIDES) {
  return applySpecOverrides(mergeRawSpecs(specs), overrides).spec
}

export function specOverrideProblems(specs, overrides = SPEC_OVERRIDES) {
  return applySpecOverrides(mergeRawSpecs(specs), overrides).problems
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redundant(detail) {
  return `felesleges, a Billingo spec már ezt írja (${detail}). Töröld a scripts/spec-overrides.mjs-ből.`
}

function inapplicable(detail) {
  return `nem alkalmazható (${detail}). Nézd meg, mit változtatott a Billingo, és igazítsd a scripts/spec-overrides.mjs-t.`
}

function componentSchema(spec, name) {
  const schema = spec.components?.schemas?.[name]
  return isRecord(schema) && isRecord(schema.properties) ? schema : undefined
}

function findOperation(spec, operationId) {
  for (const item of Object.values(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (isRecord(item?.[method]) && item[method].operationId === operationId) return item[method]
    }
  }
  return undefined
}

function renameKey(record, from, to) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key === from ? to : key, value]),
  )
}

function nullableSchema(schema) {
  if (schema.$ref === undefined) return { ...schema, nullable: true }
  const { $ref, ...rest } = schema
  return { ...rest, nullable: true, oneOf: [{ $ref }] }
}

function missingProperties(spec, override) {
  const schema = componentSchema(spec, override.schema)
  if (!schema) return { problem: inapplicable(`nincs ${override.schema} séma mezőkkel`) }
  const missing = override.properties.filter((name) => !isRecord(schema.properties[name]))
  if (missing.length > 0) {
    return {
      problem: inapplicable(`a ${override.schema} sémában nincs ${missing.join(', ')} mező`),
    }
  }
  return { schema }
}

const OVERRIDE_KINDS = {
  nullable(spec, override) {
    const { schema, problem } = missingProperties(spec, override)
    if (problem) return problem
    const already = override.properties.filter((name) => schema.properties[name].nullable === true)
    if (already.length > 0)
      return redundant(`${override.schema}.${already.join(', ')} már nullable`)
    for (const name of override.properties) {
      schema.properties[name] = nullableSchema(schema.properties[name])
    }
    return undefined
  },
  required(spec, override) {
    const { schema, problem } = missingProperties(spec, override)
    if (problem) return problem
    const current = Array.isArray(schema.required) ? schema.required : []
    const already = override.properties.filter((name) => current.includes(name))
    if (already.length > 0) {
      return redundant(`a ${override.schema} már kötelezőnek írja: ${already.join(', ')}`)
    }
    schema.required = [...current, ...override.properties]
    return undefined
  },
  rename(spec, override) {
    const schema = componentSchema(spec, override.schema)
    if (!schema) return inapplicable(`nincs ${override.schema} séma mezőkkel`)
    const hasFrom = Object.hasOwn(schema.properties, override.from)
    const hasTo = Object.hasOwn(schema.properties, override.to)
    if (hasTo && !hasFrom) return redundant(`a ${override.schema} már ${override.to} néven írja`)
    if (!hasFrom) return inapplicable(`a ${override.schema} sémában nincs ${override.from} mező`)
    if (hasTo) {
      return inapplicable(`a ${override.schema} sémában ${override.from} és ${override.to} is van`)
    }
    schema.properties = renameKey(schema.properties, override.from, override.to)
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.map((name) => (name === override.from ? override.to : name))
    }
    return undefined
  },
  status(spec, override) {
    const operation = findOperation(spec, override.operation)
    if (!operation) return inapplicable(`nincs ${override.operation} művelet`)
    const responses = isRecord(operation.responses) ? operation.responses : {}
    if (Object.hasOwn(responses, override.to)) {
      return redundant(`a ${override.operation} már dokumentálja a ${override.to} választ`)
    }
    if (!Object.hasOwn(responses, override.from)) {
      return inapplicable(`a ${override.operation} nem dokumentálja a ${override.from} választ`)
    }
    operation.responses = renameKey(responses, override.from, override.to)
    return undefined
  },
  response(spec, override) {
    const operation = findOperation(spec, override.operation)
    if (!operation) return inapplicable(`nincs ${override.operation} művelet`)
    const responses = isRecord(operation.responses) ? operation.responses : {}
    if (Object.hasOwn(responses, override.status)) {
      return redundant(`a ${override.operation} már dokumentálja a ${override.status} választ`)
    }
    operation.responses = { ...responses, [override.status]: structuredClone(override.response) }
    return undefined
  },
  content(spec, override) {
    const response = findOperation(spec, override.operation)?.responses?.[override.status]
    if (!isRecord(response) || response.$ref !== undefined) {
      return inapplicable(`a ${override.operation} ${override.status} válasza hiányzik vagy közös`)
    }
    const content = isRecord(response.content) ? response.content : {}
    if (Object.hasOwn(content, override.mediaType)) {
      return redundant(`a ${override.operation} ${override.status} már ${override.mediaType}`)
    }
    if (override.replaces !== undefined && !Object.hasOwn(content, override.replaces)) {
      return inapplicable(`a ${override.operation} ${override.status} nem ${override.replaces}`)
    }
    const kept = Object.entries(content).filter(([mediaType]) => mediaType !== override.replaces)
    response.content = Object.fromEntries([
      ...kept,
      [override.mediaType, { schema: structuredClone(override.schema) }],
    ])
    return undefined
  },
  schema(spec, override) {
    spec.components ??= {}
    spec.components.schemas ??= {}
    if (Object.hasOwn(spec.components.schemas, override.name)) {
      return redundant(`a ${override.name} séma már létezik`)
    }
    spec.components.schemas[override.name] = structuredClone(override.schema)
    return undefined
  },
  operation(spec, override) {
    spec.paths ??= {}
    const item = spec.paths[override.path]
    const existing = isRecord(item) ? item[override.method] : undefined
    if (isRecord(existing)) {
      return redundant(
        `${override.method.toUpperCase()} ${override.path} már dokumentált (${String(existing.operationId)})`,
      )
    }
    spec.paths[override.path] = {
      ...(isRecord(item) ? item : {}),
      [override.method]: structuredClone(override.operation),
    }
    return undefined
  },
}

const DESCRIPTIONS = {
  nullable: (override) => `${override.schema}: ${override.properties.join(', ')} nullable`,
  required: (override) => `${override.schema}: ${override.properties.join(', ')} kötelező`,
  rename: (override) => `${override.schema}: ${override.from} → ${override.to}`,
  status: (override) => `${override.operation}: ${override.from} → ${override.to} státusz`,
  response: (override) => `${override.operation}: ${override.status} válasz`,
  content: (override) => `${override.operation} ${override.status}: ${override.mediaType}`,
  schema: (override) => `${override.name} séma`,
  operation: (override) =>
    `${override.method.toUpperCase()} ${override.path} (${override.operation.operationId})`,
}

function knownKind(override) {
  if (!Object.hasOwn(OVERRIDE_KINDS, override.kind)) {
    throw new TypeError(`Ismeretlen spec-felülírás: ${String(override.kind)}`)
  }
  return override.kind
}

export function describeOverride(override) {
  return DESCRIPTIONS[knownKind(override)](override)
}

export function applySpecOverrides(spec, overrides) {
  const corrected = structuredClone(spec)
  const problems = []
  for (const override of overrides) {
    const problem = OVERRIDE_KINDS[knownKind(override)](corrected, override)
    if (problem) problems.push(`${describeOverride(override)}: ${problem}`)
  }
  return { spec: corrected, problems }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
