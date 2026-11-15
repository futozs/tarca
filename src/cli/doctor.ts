import { createTarca, type Tarca } from '../client'
import { isBillingoError } from '../core/errors'
import { TARCA_VERSION } from '../core/version'
import type { TarcaDefaults } from '../documents/defaults'
import type { BankAccount, DocumentBlock, OrganizationData } from '../generated/billingo'
import {
  type ProfileStatus,
  type ProfileSummary,
  profileFindings,
  summarizeProfile,
} from '../mcp/profile'
import { API_KEY_ENV, type CliIo, isRecord } from './io'

export type DoctorStatus = ProfileStatus

export interface DoctorCheck {
  readonly id: string
  readonly status: DoctorStatus
  readonly message: string
}

export interface DoctorOptions {
  readonly taxCode?: string | undefined
  readonly defaults?: TarcaDefaults | undefined
  readonly checkUpdate?: boolean | undefined
}

export const NPM_LATEST_URL = 'https://registry.npmjs.org/tarcajs/latest'
export const USED_BY_URL = 'https://github.com/futozs/tarca/issues/new?template=used-by.yml'

interface ResponseSample {
  readonly date: string | undefined
  readonly sentAt: number
  readonly receivedAt: number
}

const MINIMUM_NODE_MAJOR = 22
const CLOCK_OK_SECONDS = 2
const CLOCK_WARN_SECONDS = 30
const DATE_HEADER_PRECISION_MS = 500

const secondsFormat = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 1 })

function check(id: string, status: DoctorStatus, message: string): DoctorCheck {
  return { id, status, message }
}

function reason(error: unknown): string {
  if (isBillingoError(error))
    return error.hint ? `${error.message} Tipp: ${error.hint}` : error.message
  return error instanceof Error ? error.message : String(error)
}

function nodeCheck(version: string): DoctorCheck {
  const major = Number(version.replace(/^v/, '').split('.')[0])
  if (Number.isInteger(major) && major >= MINIMUM_NODE_MAJOR) {
    return check('node', 'ok', `Node.js ${version}`)
  }
  return check(
    'node',
    'fail',
    `Node.js ${version}: a tárcához legalább Node.js ${MINIMUM_NODE_MAJOR} kell.`,
  )
}

function timezoneCheck(): DoctorCheck {
  try {
    new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest' }).format(new Date())
    return check('timezone', 'ok', 'Időzóna-adatok: Europe/Budapest elérhető.')
  } catch {
    return check(
      'timezone',
      'fail',
      'Időzóna-adatok: az Europe/Budapest időzóna nem érhető el (teljes ICU-val fordított Node.js kell), a bizonylatok dátuma rossz lenne.',
    )
  }
}

function keyCheck(raw: string | undefined): { readonly check: DoctorCheck; readonly key?: string } {
  const key = raw?.trim()
  if (!key) {
    return {
      check: check(
        'api-key',
        'fail',
        `API kulcs: hiányzik a ${API_KEY_ENV} környezeti változó. V3 kulcs kell: Billingo → Beállítások → API kulcsok.`,
      ),
    }
  }
  if (key !== raw) {
    return {
      key,
      check: check(
        'api-key',
        'warn',
        `API kulcs: ${key.length} karakter, de az elején vagy a végén szóköz van (a tárca levágja).`,
      ),
    }
  }
  return { key, check: check('api-key', 'ok', `API kulcs: ${key.length} karakter.`) }
}

function capturingFetch(
  base: typeof globalThis.fetch,
  now: () => Date,
  samples: ResponseSample[],
): typeof globalThis.fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const sentAt = now().getTime()
    const response = await base(input, init)
    samples.push({
      date: response.headers.get('date') ?? undefined,
      sentAt,
      receivedAt: now().getTime(),
    })
    return response
  }
  return wrapped as typeof globalThis.fetch
}

interface AuthResult {
  readonly check: DoctorCheck
  readonly organization?: OrganizationData
}

async function authCheck(tarca: Tarca): Promise<AuthResult> {
  try {
    const organization = await tarca.organization.get()
    return {
      organization,
      check: check('auth', 'ok', 'Hitelesítés: a Billingo elfogadta az API kulcsot.'),
    }
  } catch (error) {
    if (isBillingoError(error) && error.category === 'auth') {
      return {
        check: check(
          'auth',
          'fail',
          'Hitelesítés: a Billingo elutasította az API kulcsot (401). V3 API kulcs kell: Billingo → Beállítások → API kulcsok; a régi v2 kulcs nem működik.',
        ),
      }
    }
    return { check: check('auth', 'fail', `Hitelesítés: a próba nem sikerült. ${reason(error)}`) }
  }
}

function clockCheck(samples: readonly ResponseSample[]): DoctorCheck {
  const sample = samples.find((entry) => entry.date !== undefined)
  const serverTime = sample?.date === undefined ? Number.NaN : Date.parse(sample.date)
  if (!sample || Number.isNaN(serverTime)) {
    return check('clock', 'skip', 'Óra: a Billingo válaszában nem volt Date fejléc.')
  }
  const localTime = (sample.sentAt + sample.receivedAt) / 2
  const skewSeconds = (localTime - (serverTime + DATE_HEADER_PRECISION_MS)) / 1000
  const absolute = Math.abs(skewSeconds)
  const direction = skewSeconds > 0 ? 'siet' : 'késik'
  const amount = `${secondsFormat.format(absolute)} mp`
  if (absolute <= CLOCK_OK_SECONDS) {
    return check('clock', 'ok', `Óra: legfeljebb ${amount} eltérés a Billingo idejétől.`)
  }
  const risk = `a teljesítés napját és a fizetési határidőt a tárca a gép órájából, budapesti naptári napként számolja, így éjfél körül ${amount} ideig rossz napra kerülhetnek. Szinkronizáld az órát (NTP).`
  return check(
    'clock',
    absolute <= CLOCK_WARN_SECONDS ? 'warn' : 'fail',
    `Óra: a gép órája ${amount}-et ${direction}; ${risk}`,
  )
}

function environmentCheck(
  profile: ProfileSummary,
  nodeEnv: string | undefined,
): DoctorCheck | undefined {
  if (!profile.hasNavConnection) return undefined
  if (nodeEnv !== 'test' && nodeEnv !== 'development') return undefined
  return check(
    'environment',
    'warn',
    `Környezet: NODE_ENV=${nodeEnv}, de a kulcs NAV-kapcsolatos éles profilhoz tartozik. A tesztek valódi, a NAV-nak jelentett bizonylatot állíthatnak ki.`,
  )
}

function blockCheck(blocks: readonly DocumentBlock[], defaults: TarcaDefaults): DoctorCheck {
  const invoices = blocks.filter((block) => block.type === 'invoice').length
  const receipts = blocks.filter((block) => block.type === 'receipt').length
  const configured = (id: number | undefined, type: 'invoice' | 'receipt', name: string) => {
    if (id === undefined) return undefined
    const block = blocks.find((entry) => entry.id === id)
    if (!block) return `a defaults.${name} (${id}) nincs a fiók tömbjei között`
    if (block.type !== type)
      return `a defaults.${name} (${id}) ${block.type ?? '?'} típusú, nem ${type}`
    return undefined
  }
  const problems = [
    configured(defaults.blockId, 'invoice', 'blockId'),
    configured(defaults.receiptBlockId, 'receipt', 'receiptBlockId'),
  ].filter((problem): problem is string => problem !== undefined)
  const counts = `${invoices} számla- és ${receipts} nyugtatömb`
  if (invoices === 0) {
    return check(
      'document-blocks',
      'fail',
      `Számlatömbök: ${counts}; számla típusú tömb nélkül számlát nem lehet kiállítani.`,
    )
  }
  if (problems.length > 0) {
    return check('document-blocks', 'fail', `Számlatömbök: ${counts}, de ${problems.join('; ')}.`)
  }
  if (receipts === 0) {
    return check(
      'document-blocks',
      'warn',
      `Számlatömbök: ${counts}; nyugtához nyugta típusú tömb kell.`,
    )
  }
  return check('document-blocks', 'ok', `Számlatömbök: ${counts}.`)
}

function bankAccountCheck(accounts: readonly BankAccount[], defaults: TarcaDefaults): DoctorCheck {
  const currencies = [...new Set(accounts.map((account) => account.currency))]
  const summary = `${accounts.length}${currencies.length > 0 ? ` (${currencies.join(', ')})` : ''}`
  const configured = defaults.bankAccountId
  if (configured !== undefined && !accounts.some((account) => account.id === configured)) {
    return check(
      'bank-accounts',
      'fail',
      `Bankszámlák: ${summary}, de a defaults.bankAccountId (${configured}) nincs köztük.`,
    )
  }
  if (accounts.length === 0) {
    return check(
      'bank-accounts',
      'warn',
      'Bankszámlák: 0. Átutalásos számlán így nem szerepel bankszámlaszám.',
    )
  }
  return check('bank-accounts', 'ok', `Bankszámlák: ${summary}.`)
}

async function listCheck<T>(
  id: string,
  label: string,
  list: () => Promise<{ readonly data: readonly T[] }>,
  evaluate: (data: readonly T[]) => DoctorCheck,
): Promise<DoctorCheck> {
  try {
    return evaluate((await list()).data)
  } catch (error) {
    return check(id, 'warn', `${label}: a lekérdezés nem sikerült. ${reason(error)}`)
  }
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/, '')
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

async function updateCheck(fetchImpl: typeof globalThis.fetch): Promise<DoctorCheck> {
  try {
    const response = await fetchImpl(NPM_LATEST_URL, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body: unknown = await response.json()
    const latest = isRecord(body) && typeof body.version === 'string' ? body.version : ''
    if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('nincs verziószám a válaszban')
    return compareVersions(latest, TARCA_VERSION) > 0
      ? check('update', 'warn', `Frissítés: elérhető a tarca ${latest} (most: ${TARCA_VERSION}).`)
      : check('update', 'ok', `Frissítés: a tarca ${TARCA_VERSION} a legfrissebb.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return check('update', 'skip', `Frissítés: az npm nem volt elérhető (${message}).`)
  }
}

const SKIPPED_AFTER_AUTH = [
  ['profile', 'Profil'],
  ['subscription', 'Előfizetés'],
  ['document-blocks', 'Számlatömbök'],
  ['bank-accounts', 'Bankszámlák'],
] as const

export async function runDoctor(io: CliIo, options: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const now = io.now ?? (() => new Date())
  const defaults = options.defaults ?? {}
  const { check: keyResult, key } = keyCheck(io.env[API_KEY_ENV])
  const checks = [nodeCheck(io.nodeVersion), timezoneCheck(), keyResult]
  const update =
    options.checkUpdate === true ? [await updateCheck(io.fetch ?? globalThis.fetch)] : []
  if (key === undefined) {
    return [
      ...checks,
      check('auth', 'skip', 'Hitelesítés: API kulcs nélkül nem próbálható.'),
      ...update,
    ]
  }
  const samples: ResponseSample[] = []
  const tarca = createTarca({
    apiKey: key,
    fetch: capturingFetch(io.fetch ?? globalThis.fetch, now, samples),
    maxAttempts: 1,
  })
  const auth = await authCheck(tarca)
  if (auth.organization === undefined) {
    return [
      ...checks,
      auth.check,
      clockCheck(samples),
      ...SKIPPED_AFTER_AUTH.map(([id, label]) =>
        check(id, 'skip', `${label}: sikertelen hitelesítés miatt kimaradt.`),
      ),
      ...update,
    ]
  }
  const profile = summarizeProfile(auth.organization, { now: now(), taxCode: options.taxCode })
  const environment = environmentCheck(profile, io.env.NODE_ENV)
  const blocks = await listCheck(
    'document-blocks',
    'Számlatömbök',
    () => tarca.documentBlocks.list({ perPage: 100 }),
    (data) => blockCheck(data, defaults),
  )
  const accounts = await listCheck(
    'bank-accounts',
    'Bankszámlák',
    () => tarca.bankAccounts.list({ perPage: 100 }),
    (data) => bankAccountCheck(data, defaults),
  )
  return [
    ...checks,
    auth.check,
    clockCheck(samples),
    ...profileFindings(profile),
    ...(environment ? [environment] : []),
    blocks,
    accounts,
    ...update,
  ]
}

const SYMBOLS: Readonly<Record<DoctorStatus, string>> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
  skip: '-',
}

function summary(checks: readonly DoctorCheck[]): string {
  const failures = checks.filter((entry) => entry.status === 'fail').length
  const warnings = checks.filter((entry) => entry.status === 'warn').length
  return `Összegzés: ${failures} hiba, ${warnings} figyelmeztetés.`
}

export function formatDoctor(checks: readonly DoctorCheck[]): string {
  const healthy = !checks.some((entry) => entry.status === 'fail')
  return [
    ...checks.map((entry) => `${SYMBOLS[entry.status]} ${entry.message}`),
    '',
    summary(checks),
    ...(healthy ? ['', `Használod a tárcát? Két perc, és sokat segít: ${USED_BY_URL}`] : []),
    '',
  ].join('\n')
}

export interface DoctorReportMeta {
  readonly nodeVersion: string
  readonly platform?: string | undefined
}

export function formatDoctorReport(checks: readonly DoctorCheck[], meta: DoctorReportMeta): string {
  return [
    '## tarcajs doctor jelentés',
    '',
    `- tarca: ${TARCA_VERSION}`,
    `- Node.js: ${meta.nodeVersion}`,
    ...(meta.platform ? [`- platform: ${meta.platform}`] : []),
    '',
    '| Ellenőrzés | Állapot | Eredmény |',
    '| --- | --- | --- |',
    ...checks.map(
      (entry) => `| ${entry.id} | ${entry.status} | ${entry.message.replace(/[\\|]/g, '\\$&')} |`,
    ),
    '',
    summary(checks),
    '',
    'A jelentés nem tartalmaz API kulcsot, adószámot, bankszámlaszámot, vevői adatot vagy bizonylattartalmat. Átadás előtt nézd át.',
    '',
  ].join('\n')
}
