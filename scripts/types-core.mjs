const PRIMITIVES = { string: 'string', integer: 'number', number: 'number', boolean: 'boolean' }

export function snakeToCamel(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function refName(ref) {
  return ref.split('/').pop()
}

function literal(value) {
  return typeof value === 'string'
    ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    : String(value)
}

function unique(values) {
  return [...new Set(values)]
}

export function typeOf(schema) {
  if (!schema) return 'unknown'
  const nullable = schema.nullable ? ' | null' : ''
  if (schema.$ref) return `${refName(schema.$ref)}${nullable}`
  if (schema.enum) return `${unique(schema.enum.map(literal)).join(' | ')}${nullable}`
  if (schema.oneOf) return `${unique(schema.oneOf.map(typeOf)).join(' | ')}${nullable}`
  if (schema.anyOf) return `${unique(schema.anyOf.map(typeOf)).join(' | ')}${nullable}`
  if (schema.allOf) {
    const parts = schema.allOf.map(typeOf)
    return `${parts.length === 1 ? parts[0] : `(${parts.join(' & ')})`}${nullable}`
  }
  if (schema.type === 'array') {
    const item = typeOf(schema.items)
    return `readonly ${/[ |&]/.test(item) ? `(${item})` : item}[]${nullable}`
  }
  if (schema.type === 'object' || schema.properties) {
    if (!schema.properties) return `Readonly<Record<string, unknown>>${nullable}`
    return `${objectBody(schema)}${nullable}`
  }
  return `${PRIMITIVES[schema.type] ?? 'unknown'}${nullable}`
}

function objectBody(schema) {
  const required = new Set(schema.required ?? [])
  const fields = Object.entries(schema.properties).map(
    ([key, property]) =>
      `readonly ${snakeToCamel(key)}${required.has(key) ? '' : '?'}: ${typeOf(property)}`,
  )
  return `{ ${fields.join('; ')} }`
}

export function renderSchema(name, schema) {
  if (schema.properties && !schema.oneOf && !schema.allOf && !schema.anyOf) {
    return `export interface ${name} ${objectBody(schema)}`
  }
  return `export type ${name} = ${typeOf(schema)}`
}

export function renderTypes(spec) {
  const schemas = spec.components?.schemas ?? {}
  return `${Object.keys(schemas)
    .sort()
    .map((name) => renderSchema(name, schemas[name]))
    .join('\n\n')}\n`
}
