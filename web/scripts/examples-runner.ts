import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EXAMPLES, type ExampleMeta } from '../sandbox/examples/catalog'
import type { ConsoleLevel } from '../sandbox/runtime/execute'
import type { BillingoSnapshot, ConsoleEntry, SandboxRequest } from '../sandbox/runtime/protocol'
import { runSandboxCode } from '../sandbox/runtime/run'
import { formatPreview } from '../sandbox/runtime/serialize'

export interface GeneratedExample extends ExampleMeta {
  readonly code: string
  readonly output: readonly { readonly level: ConsoleLevel; readonly text: string }[]
  readonly requests: readonly Omit<SandboxRequest, 'durationMs'>[]
  readonly billingo: BillingoSnapshot
}

export async function runExamples(root: string): Promise<GeneratedExample[]> {
  const results: GeneratedExample[] = []
  for (const example of EXAMPLES) {
    const code = (
      await readFile(join(root, 'sandbox/examples', `${example.slug}.ts`), 'utf8')
    ).trimEnd()
    const output: ConsoleEntry[] = []
    const requests: SandboxRequest[] = []
    const result = await runSandboxCode(code, {
      onConsole: (entry) => output.push(entry),
      onRequest: (request) => requests.push(request),
    })
    if (!result.ok) {
      const detail = result.error ? formatPreview(result.error.preview) : 'ismeretlen hiba'
      throw new Error(`A(z) "${example.slug}" példa hibával futott le: ${detail}`)
    }
    const errors = output.filter((entry) => entry.level === 'error')
    if (errors.length > 0) {
      throw new Error(
        `A(z) "${example.slug}" példa hibát írt a konzolra: ${errors
          .map((entry) => entry.args.map((arg) => formatPreview(arg)).join(' '))
          .join('; ')}`,
      )
    }
    results.push({
      ...example,
      code,
      output: output.map((entry) => ({
        level: entry.level,
        text: entry.args.map((arg) => formatPreview(arg)).join(' '),
      })),
      requests: requests.map(({ durationMs: _, ...request }) => request),
      billingo: result.billingo,
    })
  }
  return results
}
