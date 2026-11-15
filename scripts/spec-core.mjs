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

export function mergeSpecs(specs) {
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
