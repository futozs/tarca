import { isBillingoError } from '../core/errors'
import { TARCA_VERSION } from '../core/version'
import { type ArgSpec, CliUsageError, flagValue, hasFlag, type ParsedArgs, parseArgs } from './args'
import { documentGetCommand, verifyCommand } from './commands'
import { formatDoctor, formatDoctorReport, runDoctor } from './doctor'
import { CliError, type CliIo, printJson, readDefaults } from './io'
import { mcpCommand } from './mcp'

export const CLI_USAGE: string = `tarcajs ${TARCA_VERSION}: Billingo API v3 parancssor

Használat: tarcajs <parancs> [kapcsolók]

Parancsok:
  doctor [--tax-code <adószám>] [--defaults <fájl.json>] [--check-update] [--json | --report]
      A környezet, az API kulcs, az óra, a profil (teszt vagy éles), a NAV-kapcsolat,
      az előfizetés, a számlatömbök és a bankszámlák ellenőrzése. Csak olvas (3 kérés).
      --tax-code: a kulcs cégének adószámát ezzel veti össze (nem írja ki)
      --defaults: a TarcaDefaults beállítások (blockId, bankAccountId …) ellenőrzése
      --check-update: az npm legfrissebb verziójának lekérdezése (hálózati hívás)
      --report: titokmentes Markdown jelentés hibajegyhez
  verify
      Az API kulcs ellenőrzése a Billingón.
  document get <azonosító> | --vendor <vendorId>
      Bizonylat lekérdezése JSON-ban.
  mcp [--allow-write] [--defaults <fájl.json>]
      MCP szerver stdio-n (Claude, Cursor és más MCP kliensek számára).

Környezeti változók:
  BILLINGO_API_KEY         a Billingo V3 API kulcs (Beállítások → API kulcsok)
  TARCA_MCP_ALLOW_WRITE    1 esetén az MCP szerver kiállíthat, sztornózhat, befizetést
                           rögzíthet és e-mailt küldhet, mindig előnézet és megerősítő kód után
`

const SPECS: Readonly<Record<string, ArgSpec>> = {
  doctor: {
    booleans: ['json', 'report', 'check-update'],
    values: ['tax-code', 'defaults'],
  },
  verify: {},
  'document get': { values: ['vendor'] },
  mcp: { booleans: ['allow-write'], values: ['defaults'] },
}

const MAX_POSITIONALS: Readonly<Record<string, number>> = {
  doctor: 1,
  verify: 1,
  'document get': 3,
  mcp: 1,
}

function commandOf(argv: readonly string[]): string | undefined {
  const [first, second] = argv
  if (first === undefined) return undefined
  const pair = second === undefined ? undefined : `${first} ${second}`
  if (pair !== undefined && pair in SPECS) return pair
  return first in SPECS ? first : undefined
}

async function doctorCommand(io: CliIo, args: ParsedArgs): Promise<number> {
  if (hasFlag(args, 'json') && hasFlag(args, 'report')) {
    throw new CliUsageError('A --json és a --report közül csak az egyiket add meg.')
  }
  const checks = await runDoctor(io, {
    taxCode: flagValue(args, 'tax-code'),
    defaults: await readDefaults(io, flagValue(args, 'defaults')),
    checkUpdate: hasFlag(args, 'check-update'),
  })
  if (hasFlag(args, 'json')) printJson(io, { checks })
  else if (hasFlag(args, 'report')) {
    io.stdout(formatDoctorReport(checks, { nodeVersion: io.nodeVersion }))
  } else io.stdout(`tarcajs doctor ${TARCA_VERSION}\n${formatDoctor(checks)}`)
  return checks.some((check) => check.status === 'fail') ? 1 : 0
}

function assertArity(command: string, positionals: readonly string[]): void {
  const extra = positionals.slice(MAX_POSITIONALS[command] ?? positionals.length)
  if (extra.length > 0) throw new CliUsageError(`Fölösleges argumentum: ${extra.join(' ')}`)
}

async function dispatch(io: CliIo, command: string, argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, SPECS[command])
  assertArity(command, args.positionals)
  switch (command) {
    case 'doctor':
      return doctorCommand(io, args)
    case 'verify':
      return verifyCommand(io)
    case 'document get':
      return documentGetCommand(io, args)
    default:
      return mcpCommand(io, args)
  }
}

function errorMessage(error: unknown): string {
  if (isBillingoError(error)) {
    const trace = error.traceId ? `\nTrace ID: ${error.traceId}` : ''
    return `${error.message}${error.hint ? `\nTipp: ${error.hint}` : ''}${trace}`
  }
  return error instanceof Error ? error.message : String(error)
}

function asksForHelp(argv: readonly string[]): boolean {
  const end = argv.indexOf('--')
  const options = end === -1 ? argv : argv.slice(0, end)
  return options.some((token) => token === '--help' || token === '-h')
}

export async function runCli(io: CliIo): Promise<number> {
  const argv = io.argv
  const first = argv[0]
  if (first === undefined) {
    io.stderr(CLI_USAGE)
    return 2
  }
  if (first === 'help' || asksForHelp(argv)) {
    io.stdout(CLI_USAGE)
    return 0
  }
  if (first === '--version' || first === '-v') {
    io.stdout(`${TARCA_VERSION}\n`)
    return 0
  }
  const command = commandOf(argv)
  if (command === undefined) {
    io.stderr(`Ismeretlen parancs: ${argv.slice(0, 2).join(' ')}\n\n${CLI_USAGE}`)
    return 2
  }
  try {
    return await dispatch(io, command, argv)
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.stderr(`${error.message}\nSegítség: tarcajs help\n`)
      return 2
    }
    if (error instanceof CliError || isBillingoError(error)) {
      io.stderr(`${errorMessage(error)}\n`)
      return 1
    }
    io.stderr(`Váratlan hiba: ${errorMessage(error)}\n`)
    return 1
  }
}
