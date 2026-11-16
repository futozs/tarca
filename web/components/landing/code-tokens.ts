import { codeToTokens } from 'shiki'
import { tarcaCodeTheme } from '@/lib/code-theme'

export interface CodeToken {
  readonly offset: number
  readonly content: string
  readonly color: string | undefined
}

export interface CodeLine {
  readonly number: number
  readonly tokens: readonly CodeToken[]
}

export async function tokenizeTs(code: string): Promise<readonly CodeLine[]> {
  const { tokens } = await codeToTokens(code, { lang: 'ts', theme: tarcaCodeTheme })
  return tokens.map((line, i) => ({
    number: i + 1,
    tokens: line.map(({ offset, content, color }) => ({ offset, content, color })),
  }))
}
