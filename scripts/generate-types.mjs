import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeSpecs } from './spec-core.mjs'
import { renderTypes } from './types-core.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const cacheDir = join(root, '.spec-cache')
const target = 'src/generated/billingo.ts'
const check = process.argv.includes('--check')

const indexPath = join(cacheDir, 'index.json')
if (!existsSync(indexPath)) {
  console.error('Nincs letöltött Billingo spec. Futtasd előbb: npm run spec:fetch')
  process.exit(1)
}
const { versions } = JSON.parse(readFileSync(indexPath, 'utf8'))
const specs = versions.map((version) =>
  JSON.parse(readFileSync(join(cacheDir, `billingo-${version}.json`), 'utf8')),
)
const source = renderTypes(mergeSpecs(specs))
const biome = join(root, 'node_modules', '.bin', 'biome')
const formatted = execFileSync(biome, ['format', `--stdin-file-path=${target}`], {
  cwd: root,
  input: source,
  encoding: 'utf8',
})

const targetPath = join(root, target)
if (check) {
  const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''
  if (current !== formatted) {
    console.error(
      `A ${target} eltér a friss Billingo spec alapján generált típusoktól (${versions.join(', ')}). Futtasd: npm run spec:types, nézd át a diffet, és igazítsd a klienst.`,
    )
    process.exit(1)
  }
  console.log(`✓ A ${target} szinkronban van a Billingo spec-kel (${versions.join(', ')}).`)
} else {
  writeFileSync(targetPath, formatted)
  console.log(`${target} legenerálva (${versions.join(', ')}).`)
}
