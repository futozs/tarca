import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registryVersions, SWAGGERHUB_API, trackedVersions } from './spec-core.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const cacheDir = join(root, '.spec-cache')

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'tarca-spec-fetch' },
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

const registry = await fetchJson(SWAGGERHUB_API)
const { version: defaultVersion } = await fetchJson(`${SWAGGERHUB_API}/settings/default`)
const versions = trackedVersions(registryVersions(registry), defaultVersion)
if (!versions.includes(defaultVersion)) {
  throw new Error(`Az alapértelmezett Billingo spec verzió (${defaultVersion}) nincs a listában.`)
}

await mkdir(cacheDir, { recursive: true })
for (const version of versions) {
  const spec = await fetchJson(`${SWAGGERHUB_API}/${version}`)
  await writeFile(join(cacheDir, `billingo-${version}.json`), `${JSON.stringify(spec, null, 2)}\n`)
  console.log(`✓ billingo-${version}.json`)
}
await writeFile(
  join(cacheDir, 'index.json'),
  `${JSON.stringify({ default: defaultVersion, versions }, null, 2)}\n`,
)
console.log(
  `A spec a .spec-cache/ mappában: ${versions.join(', ')} (alapértelmezett: ${defaultVersion})`,
)
