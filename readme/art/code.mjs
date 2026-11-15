const TS_KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'const',
  'let',
  'await',
  'async',
  'function',
  'return',
  'if',
  'new',
  'true',
  'false',
  'null',
  'throw',
])

const TS_TOKEN =
  /(\/\/.*$)|('(?:[^'\\]|\\.)*')|(\b\d[\d_]*(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g

function mergeRuns(runs) {
  const merged = []
  for (const run of runs) {
    const last = merged.at(-1)
    if (last && last.fill === run.fill) last.text += run.text
    else merged.push({ ...run })
  }
  return merged
}

function nextSignificant(line, index) {
  return line.slice(index).trimStart()[0]
}

function wordColor(word, next, colors) {
  if (TS_KEYWORDS.has(word)) return colors.keyword
  if (next === '(') return colors.function
  if (next === ':') return colors.property
  return colors.foreground
}

export function highlightTs(line, colors) {
  const runs = []
  for (const match of line.matchAll(TS_TOKEN)) {
    const [text, comment, string, number, word] = match
    const end = match.index + text.length
    let fill = colors.punctuation
    if (comment) fill = colors.comment
    else if (string) fill = colors.string
    else if (number) fill = colors.constant
    else if (word) fill = wordColor(word, nextSignificant(line, end), colors)
    else if (/^\s+$/.test(text)) fill = colors.foreground
    runs.push({ text, fill })
  }
  return mergeRuns(runs)
}
