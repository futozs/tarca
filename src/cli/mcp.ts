import { createTarcaMcpServer } from '../mcp/server'
import { CliUsageError, flagValue, hasFlag, type ParsedArgs } from './args'
import { ALLOW_WRITE_ENV, API_KEY_ENV, type CliIo, readDefaults } from './io'

const TRUTHY: ReadonlySet<string> = new Set(['1', 'true', 'yes', 'igen'])

export function writeAllowed(io: CliIo, args: ParsedArgs): boolean {
  if (hasFlag(args, 'allow-write')) return true
  const value = io.env[ALLOW_WRITE_ENV]?.trim().toLowerCase()
  return value !== undefined && TRUTHY.has(value)
}

export async function mcpCommand(io: CliIo, args: ParsedArgs): Promise<number> {
  const defaultsPath = flagValue(args, 'defaults')
  if (defaultsPath === '-') {
    throw new CliUsageError(
      'Az mcp parancsnál a --defaults - nem használható: a stdin az MCP protokollé. Add meg az alapbeállításokat fájlban.',
    )
  }
  const allowWrite = writeAllowed(io, args)
  const apiKey = io.env[API_KEY_ENV]?.trim()
  const server = createTarcaMcpServer({
    ...(apiKey ? { apiKey } : {}),
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...(io.now ? { now: io.now } : {}),
    defaults: await readDefaults(io, defaultsPath),
    allowWrite,
  })
  io.stderr(
    `tarca MCP szerver fut (${allowWrite ? 'írás engedélyezve: kiállítás, sztornó, befizetés és kiküldés csak megerősítő kóddal' : 'csak olvasás'}).${apiKey ? '' : ` Figyelem: hiányzik a ${API_KEY_ENV}, a Billingót hívó eszközök hibát adnak.`}\n`,
  )
  const connection = server.connect()
  for await (const line of io.stdinLines()) {
    const response = await connection.handleLine(line)
    if (response !== undefined) io.stdout(`${response}\n`)
  }
  return 0
}
