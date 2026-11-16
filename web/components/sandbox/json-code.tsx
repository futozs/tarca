export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punctuation' | 'text'

export interface JsonToken {
  readonly kind: JsonTokenKind
  readonly text: string
  readonly offset: number
}

const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+|[^\s"{}[\],:]+)/g

export function tokenizeJson(code: string): JsonToken[] {
  const tokens: JsonToken[] = []
  for (const match of code.matchAll(TOKEN)) {
    const offset = match.index ?? 0
    if (match[1]) {
      tokens.push({ kind: match[2] ? 'key' : 'string', text: match[1], offset })
      if (match[2]) {
        tokens.push({ kind: 'punctuation', text: match[2], offset: offset + match[1].length })
      }
    } else if (match[3]) tokens.push({ kind: 'number', text: match[3], offset })
    else if (match[4]) tokens.push({ kind: 'literal', text: match[4], offset })
    else if (match[5]) tokens.push({ kind: 'punctuation', text: match[5], offset })
    else tokens.push({ kind: 'text', text: match[0], offset })
  }
  return tokens
}

const tone: Readonly<Record<JsonTokenKind, string | undefined>> = {
  key: 'text-[var(--code-token-function)]',
  string: 'text-[var(--code-token-string)]',
  number: 'text-[var(--code-token-constant)]',
  literal: 'text-[var(--code-token-keyword)]',
  punctuation: 'text-[var(--code-token-punctuation)]',
  text: undefined,
}

export function JsonCode({ code, json }: { code: string; json: boolean }) {
  return (
    <code className="block min-w-max font-mono text-[0.78rem] leading-[1.65] whitespace-pre text-[var(--code-foreground)]">
      {json
        ? tokenizeJson(code).map((token) => (
            <span key={token.offset} className={tone[token.kind]}>
              {token.text}
            </span>
          ))
        : code}
    </code>
  )
}
