import { Check } from 'lucide-react'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { LogoMark } from '@/components/site/logo'
import { withArticle } from '@/lib/hungarian'
import type { SampleError, SampleOnce } from './sample'
import { WireDiagram } from './wire-diagram'

export interface WhyData {
  readonly operationCount: number
  readonly split: {
    readonly documented: number
    readonly added: number
    readonly undocumented: number
  }
  readonly packageName: string
  readonly version: string
  readonly vendorId: string
  readonly once: SampleOnce
  readonly error: SampleError
}

function Tile({
  area,
  title,
  children,
  visual,
  delay = 0,
}: {
  area: string
  title: string
  children: ReactNode
  visual: ReactNode
  delay?: number
}) {
  return (
    <li className={`tile t-${area} ld-reveal`} style={{ '--d': delay } as CSSProperties}>
      <div className="tile-visual">{visual}</div>
      <div className="tile-copy">
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  )
}

function OnceVisual({ once, vendorId }: { once: SampleOnce; vendorId: string }) {
  return (
    <WireDiagram
      className="once-d mini"
      edges="a>hub b>hub hub>out"
      runs="a>hub>out|b>hub>out"
      role="img"
      aria-label={`Ugyanaz a ${vendorId} rendelés kétszer érkezik; a createOnce az elsőnél kiállítja a számlát, a másodiknál a meglévőt adja vissza.`}
    >
      <div className="once-grid">
        <div className="wd-node once-in once-a" data-node="a">
          <span className="label">Webhook</span>
          <span className="mono">{vendorId}</span>
          <span className="once-result wd-later" data-show="r1">
            created: {String(once.first.created)}
          </span>
        </div>
        <div className="wd-node once-in once-b" data-node="b">
          <span className="label">Ugyanaz újra</span>
          <span className="mono">{vendorId}</span>
          <span className="once-result wd-later" data-show="r2">
            created: {String(once.second.created)}
          </span>
        </div>
        <div className="wd-node once-hub" data-node="hub">
          createOnce()
        </div>
        <div className="wd-node once-out" data-node="out">
          <b>Számla</b>
          <span className="mono">{once.second.number}</span>
        </div>
      </div>
      <p className="once-verdict wd-later" data-show="r2">
        1 számla. <span>Nem kettő.</span>
      </p>
    </WireDiagram>
  )
}

function OperationsVisual({ split }: { split: WhyData['split'] }) {
  const parts = [
    { key: 'a', value: split.documented, label: 'A 3.0.14-es specben' },
    { key: 'b', value: split.added, label: 'Újdonság a 3.0.15-ösben' },
    { key: 'c', value: split.undocumented, label: 'Nem dokumentált, élőben mérve' },
  ] as const
  return (
    <div className="ops-v" data-grow>
      <div className="ops-bar" aria-hidden="true">
        {parts.map((part) => (
          <i key={part.key} className={`ops-${part.key}`} style={{ flexGrow: part.value }} />
        ))}
      </div>
      <ul className="ops-legend">
        {parts.map((part) => (
          <li key={part.key}>
            <i className={`ops-${part.key}`} aria-hidden="true" />
            <span>{part.label}</span>
            <b className="tnum">{part.value}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DepsVisual({ packageName, version }: { packageName: string; version: string }) {
  return (
    <WireDiagram
      className="deps-d mini"
      edges="pkg>none:dim"
      role="img"
      aria-label="Az npm ls kimenete: a csomag alatt üres a függőségfa."
    >
      <div className="wd-node deps-pkg" data-node="pkg">
        {packageName}@{version}
      </div>
      <div className="wd-node deps-empty is-dashed" data-node="none">
        (empty)
      </div>
      <p className="deps-cmd">npm ls --omit=dev</p>
    </WireDiagram>
  )
}

const RUNTIMES = [
  { id: 'node', label: 'Node 22+' },
  { id: 'bun', label: 'Bun' },
  { id: 'deno', label: 'Deno' },
  { id: 'cf', label: 'Cloudflare Workers' },
] as const

function RuntimesVisual() {
  return (
    <WireDiagram
      className="run-d mini"
      edges={RUNTIMES.map((runtime) => `pkg>${runtime.id}`).join(' ')}
      lightAll
      role="img"
      aria-label={`A tárca ezekben a környezetekben fut: ${RUNTIMES.map((runtime) => runtime.label).join(', ')}.`}
    >
      <div className="run-pkg" data-node="pkg">
        <LogoMark className="size-16" />
      </div>
      <ul>
        {RUNTIMES.map((runtime) => (
          <li key={runtime.id} className="wd-node" data-node={runtime.id}>
            <span className="label">{runtime.label}</span>
          </li>
        ))}
      </ul>
    </WireDiagram>
  )
}

function ErrorVisual({ error }: { error: SampleError }) {
  return (
    <div className="err-sheet">
      <div className="err-top">
        <span className="err-type">{error.name}</span>
        <span className="err-cat">{error.category}</span>
      </div>
      <p className="err-msg">{error.message}</p>
      <p className="err-field">
        <code>{error.field}</code>
        <span>{error.fieldMessage}</span>
      </p>
      <p className="err-hint">{error.hint}</p>
    </div>
  )
}

function TypesVisual() {
  return (
    <ul className="types-l">
      <li className="is-wrong">
        <span>A spec szerint</span>
        <code>is_created_by_nav</code>
      </li>
      <li>
        <span>A Billingo valójában küldi</span>
        <code>created_by_nav</code>
      </li>
      <li className="is-ours">
        <span>A tárca típusa</span>
        <code>createdByNav: boolean</code>
      </li>
    </ul>
  )
}

const TEST_NAMES = ['fizetés után egyszer számláz', 'elveszett válasz után sem lesz két számla']

function FakeVisual() {
  return (
    <ul className="run-sheet" aria-label="Minta tesztfuttatás">
      <li className="run-sheet-file">fizetes.test.ts</li>
      {TEST_NAMES.map((name) => (
        <li key={name}>
          <Check aria-hidden="true" />
          {name}
        </li>
      ))}
      <li className="run-sheet-sum">
        Tests <b>{TEST_NAMES.length} passed</b>
      </li>
    </ul>
  )
}

function PaymentVisual() {
  return (
    <WireDiagram
      className="pay-d mini"
      edges="paid>doc refund>storno"
      lightAll
      role="img"
      aria-label="A fizetésből számla vagy nyugta, a visszatérítésből sztornó lesz."
    >
      <div className="wd-node" data-node="paid">
        <span className="label">Fizetés</span>
      </div>
      <div className="wd-node" data-node="doc">
        <span className="label">Számla vagy nyugta</span>
      </div>
      <div className="wd-node is-dashed" data-node="refund">
        <span className="label">Visszatérítés</span>
      </div>
      <div className="wd-node is-dashed" data-node="storno">
        <span className="label">Sztornó</span>
      </div>
      <p className="pay-vid">vendorId: STRIPE-&lt;fizetés azonosító&gt;</p>
    </WireDiagram>
  )
}

function McpVisual() {
  return (
    <WireDiagram
      className="mcp-d mini"
      edges="ask>prev prev>code code>create"
      runs="ask>prev>code>create"
      role="img"
      aria-label="Az MCP szerver útja: az asszisztens kéri, a preview_document előnézetet ad, te jóváhagyod a megerősítő kóddal, és csak ezután fut a create_document."
    >
      <div className="wd-node" data-node="ask">
        <span className="label">Az asszisztens kéri</span>
        <span>
          számlát a <span className="whitespace-nowrap">Vevő Kft.-nek</span>
        </span>
      </div>
      <div className="wd-node" data-node="prev">
        <span className="mono">preview_document</span>
        <span>előnézet</span>
      </div>
      <div className="wd-node" data-node="code">
        <span className="label">Te jóváhagyod</span>
        <span>megerősítő kód</span>
      </div>
      <div className="wd-node" data-node="create">
        <span className="mono">create_document</span>
        <span>csak ezzel a kóddal</span>
      </div>
    </WireDiagram>
  )
}

export function WhyBento({ data }: { data: WhyData }) {
  return (
    <section className="section why" id="miert" aria-labelledby="miert-cim">
      <div className="container">
        <div className="head ld-reveal">
          <h2 id="miert-cim">Miért tárca?</h2>
          <p>
            A Billingo API-ban a számlához számlatömb, partner és pontos áfakód kell, egy ismételt
            kérésből pedig két számla lesz. Ezt a tárca intézi helyetted.
          </p>
        </div>

        <ul className="bento body">
          <Tile
            area="once"
            title="Nincs dupla számla"
            visual={<OnceVisual once={data.once} vendorId={data.vendorId} />}
          >
            <p>
              A <code className="inline-code">createOnce()</code> a rendelés azonosítója alapján
              megkeresi a bizonylatot, mielőtt kiállítja. Az újraküldött webhook a meglévő számlát
              kapja vissza.
            </p>
            <Link className="text-link" href="/docs/alapok/pontosan-egyszer">
              Pontosan egyszer
            </Link>
          </Tile>

          <Tile
            area="ops"
            title={`Mind ${withArticle(data.operationCount)} művelet`}
            visual={<OperationsVisual split={data.split} />}
            delay={1}
          >
            <p>
              Számla, díjbekérő, nyugta, sztornó, partner, termék, készlet és export. Mindegyiket
              élő e2e teszt futtatja.
            </p>
          </Tile>

          <Tile
            area="deps"
            title="0 futásidejű függőség"
            visual={<DepsVisual packageName={data.packageName} version={data.version} />}
            delay={2}
          >
            <p>
              Natív <code className="inline-code">fetch</code>. Se axios, se node-fetch.
            </p>
          </Tile>

          <Tile area="run" title="Bárhol fut" visual={<RuntimesVisual />}>
            <p>
              A CI a lefordított csomagot mind a négy környezetben lefuttatja, ESM és CommonJS
              buildként.
            </p>
          </Tile>

          <Tile
            area="err"
            title="Egy hibatípus, magyarul"
            visual={<ErrorVisual error={data.error} />}
            delay={1}
          >
            <p>
              Minden hiba <code className="inline-code">{data.error.name}</code>, kategóriával,
              mezőhibákkal és javítási tippel.
            </p>
          </Tile>

          <Tile area="types" title="Típusok a hivatalos specből" visual={<TypesVisual />}>
            <p>Ahol a Billingo mást küld, mint amit a spec ír, a típus az élő mérést követi.</p>
          </Tile>

          <Tile area="fake" title="Hamis Billingo a tesztekhez" visual={<FakeVisual />} delay={1}>
            <p>
              A <code className="inline-code">tarcajs/testing</code> memóriában fut, sorszámoz és
              kerekít, mint az igazi.
            </p>
          </Tile>

          <Tile area="pay" title="Fizetésből bizonylat" visual={<PaymentVisual />} delay={2}>
            <p>Webhookból pontosan egyszer, a fizetés azonosítójával.</p>
            <Link className="text-link" href="#fizetesek">
              Az öt szolgáltató
            </Link>
          </Tile>

          <Tile area="mcp" title="Parancssor és MCP szerver" visual={<McpVisual />}>
            <p>
              Az <code className="inline-code">npx tarcajs doctor</code> 3 olvasó kéréssel ellenőrzi
              a beállításod. Az MCP szerver csak előnézet és megerősítő kód után enged számlát
              kiállítani.
            </p>
            <Link className="text-link" href="/docs/kiegeszitok/mcp-szerver">
              MCP szerver
            </Link>
          </Tile>
        </ul>
      </div>
    </section>
  )
}
