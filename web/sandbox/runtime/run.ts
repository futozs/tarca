import { createSandboxBillingo } from './billingo'
import { createConsole, execute, SandboxSyntaxError, WRAPPER_LINE_OFFSET } from './execute'
import { createSandboxModules, installSandboxGlobals } from './modules'
import type { ConsoleEntry, RunResult, SandboxRequest } from './protocol'
import { serialize } from './serialize'

export interface RunCallbacks {
  readonly onConsole: (entry: ConsoleEntry) => void
  readonly onRequest: (request: SandboxRequest) => void
}

export interface RunOptions {
  readonly latencyMs?: readonly [number, number] | undefined
  readonly functionHeaderLines?: number | undefined
}

function lineFromStack(error: unknown, headerLines: number): { line?: number; column?: number } {
  if (!(error instanceof Error) || !error.stack) return {}
  const match = /<anonymous>:(\d+):(\d+)/.exec(error.stack)
  if (!match?.[1] || !match[2]) return {}
  const line = Number(match[1]) - headerLines - WRAPPER_LINE_OFFSET
  return line > 0 ? { line, column: Number(match[2]) } : {}
}

export async function runSandboxCode(
  code: string,
  callbacks: RunCallbacks,
  options: RunOptions = {},
): Promise<RunResult> {
  const billingo = createSandboxBillingo({
    latencyMs: options.latencyMs,
    onRequest: callbacks.onRequest,
  })
  const globals = installSandboxGlobals(billingo)
  const startedAt = performance.now()
  const sandboxConsole = createConsole((level, args) => {
    callbacks.onConsole({
      level,
      args: args.map((arg) => serialize(arg)),
      time: performance.now() - startedAt,
    })
  })

  try {
    await execute(code, createSandboxModules(billingo), sandboxConsole)
    return { ok: true, durationMs: performance.now() - startedAt, billingo: billingo.snapshot() }
  } catch (error) {
    const position =
      error instanceof SandboxSyntaxError
        ? { line: error.line, column: error.column }
        : lineFromStack(error, options.functionHeaderLines ?? 2)
    return {
      ok: false,
      error: { preview: serialize(error), ...position },
      durationMs: performance.now() - startedAt,
      billingo: billingo.snapshot(),
    }
  } finally {
    globals.restore()
  }
}
