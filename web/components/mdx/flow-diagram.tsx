const REQUESTS = [
  { method: 'GET', path: '/document-blocks', status: 200, detail: 'számlatömb, ha nem adtad meg' },
  {
    method: 'GET',
    path: '/partners?query=Vevő Kft.',
    status: 200,
    detail: 'partner keresése név szerint',
  },
  { method: 'POST', path: '/partners', status: 201, detail: 'új partner, ha nincs találat' },
  { method: 'POST', path: '/documents', status: 201, detail: 'a számla kiállítása' },
] as const

const BOX_HEIGHT = 72
const CALLER = { x: 16, y: 114, width: 200 }
const TARCA = { x: 288, y: 114, width: 200 }
const REQUEST_BOX = { x: 572, width: 332, height: 48, top: 36, gap: 16 }
const WIRE = 'var(--blue)'
const PORT_STEP = 14

function requestTop(index: number): number {
  return REQUEST_BOX.top + index * (REQUEST_BOX.height + REQUEST_BOX.gap)
}

function fanOutY(index: number, middleY: number): number {
  return middleY + (index - (REQUESTS.length - 1) / 2) * PORT_STEP
}

function Port({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={3.5} fill={WIRE} />
}

function Wire({ d }: { d: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={WIRE}
      strokeWidth={2.5}
      strokeDasharray="0 8"
      strokeLinecap="round"
    />
  )
}

function Box({
  x,
  y,
  width,
  title,
  subtitle,
  emphasis = false,
}: {
  x: number
  y: number
  width: number
  title: string
  subtitle: string
  emphasis?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={BOX_HEIGHT}
        rx={8}
        fill={emphasis ? 'var(--leaf)' : 'var(--paper)'}
        stroke={emphasis ? WIRE : 'var(--rule-strong)'}
        strokeWidth={emphasis ? 2 : 1}
      />
      <text x={x + 18} y={y + 31} fill="var(--ink)" fontSize={17} fontWeight={700}>
        {title}
      </text>
      <text x={x + 18} y={y + 53} fill="var(--muted)" fontSize={13.5} className="font-mono">
        {subtitle}
      </text>
    </g>
  )
}

export function FlowDiagram() {
  const middleY = TARCA.y + BOX_HEIGHT / 2
  const tarcaRight = TARCA.x + TARCA.width
  return (
    <figure className="not-prose my-8">
      <div className="rounded-[var(--radius-lg)] border border-rule bg-paper p-2">
        <svg
          viewBox="0 0 920 312"
          role="img"
          aria-labelledby="flow-title flow-desc"
          className="hidden h-auto w-full font-sans sm:block"
        >
          <title id="flow-title">Egy számla útja a tárcán keresztül</title>
          <desc id="flow-desc">
            A kódod egyetlen documents.create() hívást tesz. A tárca ebből négy kérést küld a
            Billingónak: lekéri a számlatömböket, megkeresi a partnert, ha nincs, létrehozza, végül
            kiállítja a számlát. A kódod a kiállított számlát kapja vissza, vagy egy BillingoErrort.
          </desc>
          <Wire d={`M${CALLER.x + CALLER.width} ${middleY} H${TARCA.x}`} />
          {REQUESTS.map((request, index) => {
            const y = requestTop(index) + REQUEST_BOX.height / 2
            const startY = fanOutY(index, middleY)
            const bend = (tarcaRight + REQUEST_BOX.x) / 2
            return (
              <Wire
                key={request.path}
                d={`M${tarcaRight} ${startY} C${bend} ${startY} ${bend} ${y} ${REQUEST_BOX.x} ${y}`}
              />
            )
          })}
          <Box
            x={CALLER.x}
            y={CALLER.y}
            width={CALLER.width}
            title="A kódod"
            subtitle="documents.create()"
          />
          <Box
            x={TARCA.x}
            y={TARCA.y}
            width={TARCA.width}
            title="tárca"
            subtitle="ellenőriz, kitölt"
            emphasis
          />
          <text x={CALLER.x} y={CALLER.y + BOX_HEIGHT + 30} fill="var(--muted)" fontSize={13.5}>
            vissza: a számla vagy BillingoError
          </text>
          {REQUESTS.map((request, index) => {
            const top = requestTop(index)
            return (
              <g key={`box-${request.path}`}>
                <rect
                  x={REQUEST_BOX.x}
                  y={top}
                  width={REQUEST_BOX.width}
                  height={REQUEST_BOX.height}
                  rx={8}
                  fill="var(--paper)"
                  stroke="var(--rule-strong)"
                />
                <text
                  x={REQUEST_BOX.x + 16}
                  y={top + 30}
                  fontSize={14}
                  className="font-mono"
                  fill="var(--ink)"
                >
                  <tspan fill="var(--blue-ink)" fontWeight={600}>
                    {request.method}
                  </tspan>{' '}
                  {request.path}
                </text>
                <text
                  x={REQUEST_BOX.x + REQUEST_BOX.width - 16}
                  y={top + 30}
                  textAnchor="end"
                  fontSize={13.5}
                  className="font-mono"
                  fill="var(--success-ink)"
                >
                  {request.status}
                </text>
              </g>
            )
          })}
          <text x={REQUEST_BOX.x} y={22} fill="var(--muted)" fontSize={13.5}>
            Billingo API v3
          </text>
          <Port x={CALLER.x + CALLER.width} y={middleY} />
          <Port x={TARCA.x} y={middleY} />
          {REQUESTS.map((request, index) => (
            <g key={`port-${request.path}`}>
              <Port x={tarcaRight} y={fanOutY(index, middleY)} />
              <Port x={REQUEST_BOX.x} y={requestTop(index) + REQUEST_BOX.height / 2} />
            </g>
          ))}
        </svg>
        <div className="p-3 text-sm sm:hidden">
          <p className="mb-3 text-ink-2">
            A kódod egyetlen hívást tesz:{' '}
            <code className="font-mono text-ink">documents.create()</code>. A tárca ebből ezt a négy
            kérést küldi:
          </p>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {REQUESTS.map((request, index) => (
              <li key={request.path} className="m-0 flex gap-3 p-0">
                <span className="tnum flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-blue-soft font-mono text-xs font-semibold text-blue-ink">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <code className="font-mono break-all text-ink">
                    {request.method} {request.path}
                  </code>
                  <span className="block text-muted">{request.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-muted">
        A partnert és a számlatömböt a tárca keresi ki, ha nem adod meg az azonosítójukat. Ha a
        partner már létezik, a <code className="font-mono">POST /partners</code> kimarad.
      </figcaption>
    </figure>
  )
}
