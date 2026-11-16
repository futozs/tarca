import type { CSSProperties } from 'react'
import { accusativeSuffix, withArticle } from '@/lib/hungarian'

interface Competitor {
  readonly name: string
  readonly operations: number | 'v2'
  readonly dependencies: string
  readonly released: string
}

const SPEC_OPERATIONS = 50

const COMPETITORS: readonly Competitor[] = [
  {
    name: '@codingsans/billingo-client',
    operations: 50,
    dependencies: '2 függőség, nem deklarált',
    released: '2022. július',
  },
  {
    name: '@clientapi/billingo',
    operations: 50,
    dependencies: '1 függőség',
    released: '2023. október',
  },
  { name: 'billingo_api_v3', operations: 50, dependencies: '2 függőség', released: '2024. január' },
  { name: 'billingo-v3', operations: 18, dependencies: '1 függőség', released: '2024. február' },
  { name: 'node-billingo', operations: 'v2', dependencies: '9 függőség', released: '2017. július' },
]

const DATA_AS_OF = '2026. november 15-i állapot.'
const TARCA_RELEASED = '2026. november'

export function bestCompetitor(rows: readonly Competitor[]): number {
  return Math.max(...rows.map((row) => (typeof row.operations === 'number' ? row.operations : 0)))
}

function share(operations: number, total: number): string {
  return `${((operations / total) * 100).toFixed(1)}%`
}

export function CompareSection({
  total,
  undocumented,
  packageName,
  comparisonUrl,
}: {
  total: number
  undocumented: number
  packageName: string
  comparisonUrl: string
}) {
  const best = bestCompetitor(COMPETITORS)
  const oursCount = `${withArticle(total)}-${accusativeSuffix(total)}`
  const rows = [
    {
      name: packageName,
      operations: total,
      dependencies: '0 függőség',
      released: TARCA_RELEASED,
      ours: true,
    },
    ...COMPETITORS.map((row) => ({ ...row, ours: false })),
  ]

  return (
    <section className="blue-field" id="osszevetes" aria-labelledby="osszevetes-cim">
      <div className="container">
        <div className="head ld-reveal">
          <h2 id="osszevetes-cim">
            A többiek legfeljebb {best}-ig jutnak. A&nbsp;tárca mind {oursCount} tudja.
          </h2>
          <p>A Billingo API v3 kliensei az npm-en, a publikált kódjuk alapján.</p>
        </div>
        <ol className="cmp body" data-grow aria-label="Billingo kliensek összevetése">
          {rows.map((row, i) => (
            <li
              key={row.name}
              className={row.ours ? 'cmp-row is-ours' : 'cmp-row'}
              style={{ '--d': i } as CSSProperties}
            >
              <span className="cmp-name">{row.name}</span>
              <span className="cmp-meta">
                <span>{row.dependencies}</span>
                <span>{row.released}</span>
              </span>
              {typeof row.operations === 'number' ? (
                <>
                  <span className="cmp-bar" aria-hidden="true">
                    <i style={{ width: share(row.operations, total) }} />
                  </span>
                  <span className="cmp-ops tnum">
                    {row.operations}
                    <span className="sr-only"> művelet</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="cmp-v2">A régi, v2-es API-hoz</span>
                  <span className="cmp-ops" aria-hidden="true">
                    v2
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
        <p className="cmp-note">
          {DATA_AS_OF} A 3.0.14-es spec {SPEC_OPERATIONS} műveletet ír le; a tárca ezen felül a
          3.0.15-ös spec új műveleteit és {undocumented} nem dokumentált, élőben működő műveletet is
          ismer.{' '}
          <a className="text-link" href={comparisonUrl}>
            Részletes összehasonlítás
          </a>
        </p>
      </div>
    </section>
  )
}
