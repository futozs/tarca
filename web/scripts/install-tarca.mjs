import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'tarcajs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..')
const versionFile = join(root, 'tarca-version.json')
const modulesDir = join(root, 'node_modules')
const target = join(modulesDir, PACKAGE)
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const LOCAL = 'local'
const LOCAL_MARKER = join(target, '.tarca-local')

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const MAX_WAIT_MS = positiveNumber(process.env.TARCA_INSTALL_MAX_WAIT_MS, 20 * 60_000)
const DELAY_MS = positiveNumber(process.env.TARCA_INSTALL_DELAY_MS, 15_000)

function log(message) {
  process.stdout.write(`▸ ${message}\n`)
}

function readVersion(path) {
  try {
    const { version } = JSON.parse(readFileSync(path, 'utf8'))
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

function npmFailure(result) {
  const output = `${result.stderr ?? ''}${result.error?.message ?? ''}`.trim()
  const lines = output.split('\n').map((line) => line.replace(/^npm error\s*/, '').trim())
  const summary = lines.filter((line) => line !== '').slice(0, 2)
  return summary.length > 0 ? summary.join(' · ') : `az npm kilépési kódja: ${result.status}`
}

function run(args, cwd) {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`npm ${args[0]}: ${npmFailure(result)}`)
}

function packFromRegistry(version, directory) {
  const result = spawnSync(
    'npm',
    [
      'pack',
      `${PACKAGE}@${version}`,
      '--pack-destination',
      directory,
      '--prefer-online',
      '--ignore-scripts',
      '--loglevel',
      'error',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  return result.status === 0 ? undefined : npmFailure(result)
}

async function downloadTarball(version, directory) {
  const startedAt = Date.now()
  for (let attempt = 1; ; attempt++) {
    const failure = packFromRegistry(version, directory)
    if (failure === undefined) return
    const elapsed = Date.now() - startedAt
    if (elapsed + DELAY_MS > MAX_WAIT_MS) {
      throw new Error(
        `${Math.round(elapsed / 1000)} mp alatt sem lett elérhető az npm-en. Az utolsó npm hiba: ${failure}`,
      )
    }
    log(
      `A ${PACKAGE}@${version} még nem érhető el az npm-en (${attempt}. próba, ${Math.round(elapsed / 1000)} mp), ${DELAY_MS / 1000} mp múlva újra. npm: ${failure}`,
    )
    await sleep(DELAY_MS)
  }
}

function packFromRepository(directory) {
  if (!existsSync(join(repoRoot, 'node_modules'))) {
    log('A repó gyökerében nincs node_modules, npm ci')
    run(['ci', '--loglevel', 'error'], repoRoot)
  }
  log('A repó gyökerének buildje (npm run build)')
  run(['run', 'build', '--silent'], repoRoot)
  run(
    ['pack', '--pack-destination', directory, '--ignore-scripts', '--loglevel', 'error'],
    repoRoot,
  )
}

async function install(version) {
  mkdirSync(modulesDir, { recursive: true })
  const staging = mkdtempSync(join(modulesDir, '.tarca-install-'))
  try {
    if (version === LOCAL) packFromRepository(staging)
    else await downloadTarball(version, staging)
    const tarball = readdirSync(staging).find((file) => file.endsWith('.tgz'))
    if (tarball === undefined) throw new Error('Az npm pack nem készített csomagot.')
    const extracted = join(staging, 'extracted')
    mkdirSync(extracted)
    execFileSync('tar', ['-xzf', join(staging, tarball), '-C', extracted])
    const unpacked = join(extracted, 'package')
    if (version !== LOCAL && readVersion(join(unpacked, 'package.json')) !== version) {
      throw new Error('A letöltött csomag verziója nem egyezik a kért verzióval.')
    }
    rmSync(target, { recursive: true, force: true })
    renameSync(unpacked, target)
    if (version === LOCAL) writeFileSync(LOCAL_MARKER, '')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

const version = readVersion(versionFile)
if (version === undefined || (version !== LOCAL && !SEMVER.test(version))) {
  process.stderr.write('✖ A web/tarca-version.json hiányzik vagy érvénytelen verziót tartalmaz.\n')
  process.exit(1)
}

if (
  version !== LOCAL &&
  !existsSync(LOCAL_MARKER) &&
  readVersion(join(target, 'package.json')) === version
) {
  process.exit(0)
}

const label = version === LOCAL ? `${PACKAGE} (a repó forrásából)` : `${PACKAGE}@${version}`
log(`${label} telepítése a web/node_modules-ba`)
try {
  await install(version)
  log(`${label} kész`)
} catch (error) {
  process.stderr.write(`✖ A ${label} telepítése nem sikerült: ${error.message}\n`)
  process.exit(1)
}
