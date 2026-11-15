import { createHash } from 'node:crypto'

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function changelogVersions(html) {
  const found = html.match(/\b3\.\d+\.\d+\.\d+\b/g) ?? []
  return [...new Set(found)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

export function sourceOperations(operationsSource) {
  return [
    ...operationsSource.matchAll(
      /^\s{2}(\w+):\s*\{\s*method:\s*'(\w+)',\s*path:\s*'([^']+)',\s*spec:\s*'([\w.-]+)'/gm,
    ),
  ].map(([, id, method, path, spec]) => ({ id, method, path, spec }))
}

export function probePath(path) {
  return path.replace(/\{tax_number\}/g, '12345678').replace(/\{\w+\}/g, '1')
}

export function routeExists(status) {
  return status !== 404
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

export function compareSnapshots(locked, current) {
  const changes = []
  for (const [name, value] of Object.entries(current)) {
    const before = locked[name]
    if (before === undefined) {
      changes.push({ name, kind: 'new', detail: 'Új figyelt forrás, nincs zárolt értéke.' })
      continue
    }
    if (same(before, value)) continue
    if (Array.isArray(before) && Array.isArray(value)) {
      const added = value.filter((item) => !before.includes(item))
      const removed = before.filter((item) => !value.includes(item))
      changes.push({
        name,
        kind: 'changed',
        detail: [
          added.length > 0 ? `új: ${added.join(', ')}` : '',
          removed.length > 0 ? `eltűnt: ${removed.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('; '),
      })
    } else if (!isHash(before) && !isHash(value)) {
      changes.push({ name, kind: 'changed', detail: `${String(before)} → ${String(value)}` })
    } else {
      changes.push({ name, kind: 'changed', detail: 'A tartalom ujjlenyomata megváltozott.' })
    }
  }
  for (const name of Object.keys(locked)) {
    if (!(name in current))
      changes.push({ name, kind: 'missing', detail: 'A forrás nem volt elérhető.' })
  }
  return changes
}

export function consistencyProblems({
  specOperations,
  knownOperations,
  missingRoutes,
  overrideProblems = [],
}) {
  const problems = []
  const known = new Map(knownOperations.map((operation) => [operation.id, operation]))
  const unknown = specOperations.filter((operation) => {
    const found = known.get(operation.id)
    return !found || found.method !== operation.method || found.path !== operation.path
  })
  if (unknown.length > 0) {
    problems.push(
      `A spec műveletei közül ezeket a tárca nem ismeri (vagy más útvonalon): ${unknown.map((operation) => `${operation.id} (${operation.method} ${operation.path})`).join(', ')}.`,
    )
  }
  if (missingRoutes.length > 0) {
    problems.push(
      `Ezek az útvonalak 404-et adnak az éles API-n (kulcs nélküli próba): ${missingRoutes.join(', ')}.`,
    )
  }
  for (const problem of overrideProblems) {
    problems.push(`Spec-felülírás (scripts/spec-overrides.mjs): ${problem}`)
  }
  return problems
}

export function renderReport(changes, problems) {
  const lines = ['## Billingo változásfigyelő', '']
  if (changes.length === 0 && problems.length === 0) return `${lines.join('\n')}Nincs eltérés.\n`
  if (changes.length > 0) {
    lines.push('### Változott források', '')
    for (const change of changes)
      lines.push(`- **${change.name}** (${change.kind}): ${change.detail}`)
    lines.push('')
  }
  if (problems.length > 0) {
    lines.push('### Eltérés a tárca kódjától', '')
    for (const problem of problems) lines.push(`- ${problem}`)
    lines.push('')
  }
  lines.push(
    'Teendő: nézd át a változást (`npm run spec:fetch`, `npm run spec:types`, a diff és a Billingo changelog), igazítsd a tárcát (BILLINGO_OPERATIONS, kliens, tesztek, docs), majd futtasd: `npm run drift -- --update`.',
    '',
  )
  return lines.join('\n')
}
