import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  changelogVersions,
  compareSnapshots,
  consistencyProblems,
  probePath,
  renderReport,
  routeExists,
  sha256,
  sourceOperations,
} from './drift-core.mjs'
import {
  canonicalJson,
  mergeSpecs,
  registryVersions,
  SWAGGERHUB_API,
  specOperations,
  specOverrideProblems,
  trackedVersions,
} from './spec-core.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = join(root, 'scripts', 'drift.lock.json')
const update = process.argv.includes('--update')
const skipRoutes = process.argv.includes('--skip-routes')
const API_URL = 'https://api.billingo.hu/v3'
const CHANGELOG_URL = 'https://developers.billingo.hu/changelogs'
const OFFICIAL_MCP = '@billingo/billingo-mcp'
const PROBE_DELAY_MS = 1_200
const USER_AGENT = 'tarca-drift-watcher'

async function fetchOk(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}

async function collect() {
  const snapshot = {}
  const errors = []
  const specs = []
  const attempt = async (name, run) => {
    try {
      snapshot[name] = await run()
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let versions = []
  let defaultVersion
  await attempt('swaggerhub:versions', async () => {
    const registry = await (await fetchOk(SWAGGERHUB_API)).json()
    versions = registryVersions(registry)
    return versions
  })
  await attempt('swaggerhub:default', async () => {
    defaultVersion = (await (await fetchOk(`${SWAGGERHUB_API}/settings/default`)).json()).version
    return defaultVersion
  })
  for (const version of defaultVersion ? trackedVersions(versions, defaultVersion) : []) {
    await attempt(`spec:${version}`, async () => {
      const spec = await (await fetchOk(`${SWAGGERHUB_API}/${version}`)).json()
      specs.push(spec)
      return sha256(canonicalJson(spec))
    })
  }
  await attempt('docs:changelog', async () =>
    changelogVersions(await (await fetchOk(CHANGELOG_URL)).text()),
  )
  await attempt('npm:billingo-mcp', async () => {
    const meta = await (await fetchOk(`https://registry.npmjs.org/${OFFICIAL_MCP}/latest`)).json()
    return meta.version
  })
  return { snapshot, errors, specs }
}

async function probeRoutes(operations) {
  const missing = []
  for (const operation of operations) {
    const response = await fetch(`${API_URL}${probePath(operation.path)}`, {
      method: operation.method,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    })
    await response.arrayBuffer()
    if (!routeExists(response.status)) missing.push(`${operation.method} ${operation.path}`)
    await sleep(PROBE_DELAY_MS)
  }
  return missing
}

const { snapshot, errors, specs } = await collect()
if (update) {
  writeFileSync(lockPath, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`A zárfájl frissítve: ${Object.keys(snapshot).length} forrás.`)
  if (errors.length > 0) console.error(`Nem elérhető források:\n${errors.join('\n')}`)
  process.exit(errors.length > 0 ? 1 : 0)
}
const knownOperations = sourceOperations(
  readFileSync(join(root, 'src', 'core', 'operations.ts'), 'utf8'),
)
const locked = JSON.parse(readFileSync(lockPath, 'utf8'))
const changes = compareSnapshots(locked, snapshot)
const problems = consistencyProblems({
  specOperations: specs.length > 0 ? specOperations(mergeSpecs(specs)) : [],
  knownOperations,
  missingRoutes: skipRoutes ? [] : await probeRoutes(knownOperations),
  overrideProblems: specs.length > 0 ? specOverrideProblems(specs) : [],
})
const report = renderReport(changes, problems)
process.stdout.write(report)
if (errors.length > 0) console.error(`\nNem elérhető források:\n${errors.join('\n')}`)
if (process.env.DRIFT_REPORT_FILE) writeFileSync(process.env.DRIFT_REPORT_FILE, report)
process.exit(changes.length > 0 || problems.length > 0 ? 1 : 0)
