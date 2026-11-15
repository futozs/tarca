import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(root, '.env')

if (existsSync(envFile)) process.loadEnvFile(envFile)

if (!process.env.BILLINGO_TEST_API_KEY?.trim()) {
  process.stderr.write(
    [
      'Hiányzik a BILLINGO_TEST_API_KEY: az e2e a Billingo fejlesztői TESZT profil API kulcsát kéri.',
      'Add meg a környezetben vagy a .env fájlban (lásd .env.example), majd futtasd újra.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

if (!process.env.BILLINGO_E2E_TAX_CODE?.trim()) {
  process.stderr.write(
    'Hiányzik a BILLINGO_E2E_TAX_CODE: a teszt profil adószáma nélkül az e2e nem tudja ellenőrizni, hogy tényleg a teszt szervezetet éri el.\n',
  )
  process.exit(1)
}

process.stdout.write(
  'Élő e2e a Billingo teszt profilján. Az első lépés ellenőrzi, hogy tényleg NAV kapcsolat nélküli teszt profil-e, különben leáll.\n',
)

const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--config', 'vitest.e2e.config.ts', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit', env: process.env },
)

process.exit(result.status ?? 1)
