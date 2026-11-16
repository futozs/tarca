import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BillingoError } from 'tarcajs'
import { describe, expect, test } from 'vitest'
import { EXAMPLES } from '../examples/catalog'
import { compile, SandboxSyntaxError } from './execute'
import type { ConsoleEntry, SandboxRequest } from './protocol'
import { runSandboxCode } from './run'
import { formatPreview, serialize } from './serialize'

function collect() {
  const output: ConsoleEntry[] = []
  const requests: SandboxRequest[] = []
  return {
    output,
    requests,
    callbacks: {
      onConsole: (entry: ConsoleEntry) => output.push(entry),
      onRequest: (request: SandboxRequest) => requests.push(request),
    },
  }
}

function printed(output: readonly ConsoleEntry[]): string[] {
  return output.map((entry) => entry.args.map((arg) => formatPreview(arg)).join(' '))
}

describe('sandbox futtatókörnyezet', () => {
  test('a közös hivatkozás nem körkörös, a valódi kör igen', () => {
    const cim = { varos: 'Budapest' }
    const kor: Record<string, unknown> = { nev: 'kör' }
    kor.onmaga = kor

    expect(formatPreview(serialize({ cim, cimek: [cim] }))).not.toContain('Körkörös')
    expect(formatPreview(serialize(kor))).toContain('[Körkörös]')
  })

  test('a PDF bájtokat felismeri, a BillingoError mezőit megtartja', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 minta')
    const hiba = new BillingoError('Hibás bizonylatadatok: items.0.name: Nem lehet üres.', {
      category: 'validation',
      fieldErrors: [{ field: 'items.0.name', message: 'Nem lehet üres.' }],
    })

    expect(serialize(pdf)).toEqual({ t: 'bytes', length: pdf.byteLength, pdf: true })
    expect(formatPreview(serialize(hiba))).toContain("category: 'validation'")
    expect(formatPreview(serialize(hiba))).toContain("field: 'items.0.name'")
  })

  test('szintaktikai hibánál sort és oszlopot ad vissza', () => {
    expect(() => compile('const x = {\n  a: 1,\n  b: \n}')).toThrow(SandboxSyntaxError)
  })

  test('nem létező modul importja érthető hibát ad', async () => {
    const { callbacks } = collect()
    const result = await runSandboxCode(
      "import leftpad from 'left-pad'\nconsole.log(leftpad)",
      callbacks,
    )

    expect(result.ok).toBe(false)
    expect(result.error && formatPreview(result.error.preview)).toContain(
      'nem érhető el a sandboxban',
    )
  })

  test('a createTarca() kulcs nélkül is a hamis Billingóra megy, és minden kérést rögzít', async () => {
    const { callbacks, output, requests } = collect()
    const code = await readFile(join(import.meta.dirname, '../examples/szamla.ts'), 'utf8')

    const result = await runSandboxCode(code, callbacks)

    expect(result.ok).toBe(true)
    expect(printed(output)).toEqual(['2026-1 190500'])
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /document-blocks',
      'GET /partners',
      'POST /partners',
      'POST /documents',
    ])
    expect(requests.map((request) => request.operation)).toEqual([
      'ListDocumentBlock',
      'ListPartner',
      'CreatePartner',
      'CreateDocument',
    ])
    expect(result.billingo.documents).toMatchObject([
      { invoiceNumber: '2026-1', type: 'invoice', grossTotal: 190_500, partnerName: 'Vevő Kft.' },
    ])
  })

  test('a futás után visszaállítja a globális fetch-et és a kulcsot', async () => {
    const before = globalThis.fetch
    const key = process.env.BILLINGO_API_KEY
    const { callbacks } = collect()

    await runSandboxCode("throw new Error('szándékos')", callbacks)

    expect(globalThis.fetch).toBe(before)
    expect(process.env.BILLINGO_API_KEY).toBe(key)
  })

  test('a kód hibájánál a sor számát is visszaadja', async () => {
    const { callbacks } = collect()
    const result = await runSandboxCode(
      "const a = 1\nconst b = 2\nthrow new Error('itt')",
      callbacks,
    )

    expect(result.ok).toBe(false)
    expect(result.error?.line).toBe(3)
  })

  test('minden futás saját, üres hamis Billingót kap', async () => {
    const code =
      "import { createTarca } from 'tarcajs'\nconst tarca = createTarca()\nconsole.log((await tarca.documents.list()).total)"
    const first = collect()
    const second = collect()

    await runSandboxCode(
      "import { createTarca } from 'tarcajs'\nawait createTarca().receipts.create({ items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 27 }] })",
      first.callbacks,
    )
    await runSandboxCode(code, second.callbacks)

    expect(printed(second.output)).toEqual(['0'])
  })

  test.each(EXAMPLES.map((example) => example.slug))(
    'a(z) %s példa hiba nélkül lefut',
    async (slug) => {
      const { callbacks, output } = collect()
      const code = await readFile(join(import.meta.dirname, '../examples', `${slug}.ts`), 'utf8')

      const result = await runSandboxCode(code, callbacks)

      expect(result.error && formatPreview(result.error.preview)).toBeUndefined()
      expect(result.ok).toBe(true)
      expect(output.filter((entry) => entry.level === 'error')).toEqual([])
    },
  )
})
