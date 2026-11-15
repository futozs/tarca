import { runSmoke } from './smoke-core.mjs'

const ENTRIES = {
  root: '../dist/index.js',
  testing: '../dist/testing/index.js',
  node: '../dist/node/index.js',
  batch: '../dist/batch/index.js',
  observe: '../dist/observe/index.js',
  storage: '../dist/storage/index.js',
  storageFs: '../dist/storage/fs.js',
  stores: '../dist/stores/index.js',
  journal: '../dist/journal/index.js',
  mcp: '../dist/mcp/index.js',
  payments: '../dist/payments/index.js',
  paymentsStripe: '../dist/payments/stripe.js',
  paymentsSimplePay: '../dist/payments/simplepay.js',
  paymentsBarion: '../dist/payments/barion.js',
  paymentsRevolut: '../dist/payments/revolut.js',
  paymentsPayPal: '../dist/payments/paypal.js',
}

function runtimeName() {
  if (typeof globalThis.Bun !== 'undefined') return `Bun ${globalThis.Bun.version}`
  if (typeof globalThis.Deno !== 'undefined') return `Deno ${globalThis.Deno.version.deno}`
  if (typeof globalThis.EdgeRuntime !== 'undefined') return 'Edge Runtime'
  return `Node.js ${globalThis.process?.versions?.node ?? '?'}`
}

async function loadEsm() {
  const modules = {}
  for (const [name, path] of Object.entries(ENTRIES)) {
    modules[name] = await import(new URL(path, import.meta.url).href)
  }
  return modules
}

async function loadCjs() {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const modules = {}
  for (const [name, path] of Object.entries(ENTRIES)) {
    modules[name] = require(path.replace(/\.js$/, '.cjs'))
  }
  return modules
}

const runtime = runtimeName()
const esm = await runSmoke(await loadEsm())
console.log(`✓ ${runtime} ESM: ${esm.length} ellenőrzés`)
if (runtime.startsWith('Node.js') || runtime.startsWith('Bun')) {
  const cjs = await runSmoke(await loadCjs())
  console.log(`✓ ${runtime} CommonJS: ${cjs.length} ellenőrzés`)
}
