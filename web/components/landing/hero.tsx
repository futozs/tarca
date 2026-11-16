import Link from 'next/link'
import { withArticle } from '@/lib/hungarian'
import type { CodeToken, CodeLine as Line } from './code-tokens'
import type { SampleInvoice, SampleRequest } from './sample'
import { WireDiagram } from './wire-diagram'

const PORT_LINE = 'documents.create('

export interface HeroProps {
  readonly version: string
  readonly operationCount: number
  readonly code: readonly Line[]
  readonly requests: readonly SampleRequest[]
  readonly invoice: SampleInvoice
}

function CodeLine({ tokens, focus }: { tokens: readonly CodeToken[]; focus: boolean }) {
  return (
    <span className={focus ? 'hero-ln is-focus' : 'hero-ln'}>
      {tokens.length === 0
        ? ' '
        : tokens.map((token) => (
            <span key={token.offset} style={{ color: token.color }}>
              {token.content}
            </span>
          ))}
    </span>
  )
}

export function Hero({ version, operationCount, code, requests, invoice }: HeroProps) {
  const route = ['code', ...requests.map((request) => request.id), 'tbar']
  const edges = route
    .slice(1)
    .map((to, i) => `${route[i]}>${to}`)
    .join(' ')
  const focusLine = code.find((line) =>
    line.tokens
      .map((token) => token.content)
      .join('')
      .includes(PORT_LINE),
  )?.number

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container">
        <div className="hero-head">
          <Link className="hero-tag" href="#miert">
            <span className="hero-tag-v tnum">v{version}</span>
            Mind {withArticle(operationCount)} Billingo művelet
          </Link>
          <h1 id="hero-title">
            <span>Billingo,</span>
            <span>TypeScriptben.</span>
          </h1>
          <div className="hero-side">
            <p className="hero-lead">Egy függvényhívás, és a számla kész a Billingóban.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/docs/alapok/telepites">
                Kezdd el
              </Link>
              <Link className="btn btn-secondary" href="/sandbox">
                Kipróbálom
              </Link>
            </div>
          </div>
        </div>

        <WireDiagram
          className="hero-stage"
          edges={edges}
          runs={route.join('>')}
          autostart
          role="group"
          aria-label={`Egy documents.create hívás útja: ${requests.length} kérés a Billingónak, a végén a számla`}
        >
          <figure className="hero-code" data-node="code" data-port-y=".is-focus">
            <figcaption className="hero-code-head">
              <span className="hero-code-file">szamla.ts</span>
              <span>TypeScript</span>
            </figcaption>
            <pre>
              <code>
                {code.map((line) => (
                  <CodeLine
                    key={line.number}
                    tokens={line.tokens}
                    focus={line.number === focusLine}
                  />
                ))}
              </code>
            </pre>
          </figure>

          <ol className="hero-reqs" aria-label="A tárca kérései">
            {requests.map((request) => (
              <li key={request.id} className="wd-node hero-req" data-node={request.id}>
                <div className="hero-req-line">
                  <span className={request.method === 'GET' ? 'verb' : 'verb is-write'}>
                    {request.method}
                  </span>
                  {request.target}
                </div>
                <div className="hero-req-note">
                  <span>{request.note}</span>
                  <span className="hero-status wd-later" data-show={request.id}>
                    {request.status}
                  </span>
                </div>
              </li>
            ))}
          </ol>

          <div className="hero-bill">
            <div className="hero-tbar" data-node="tbar" aria-hidden="true" />
            <div className="hero-leaf-clip">
              <div className="hero-leaf" data-show="tbar">
                <div className="hero-leaf-body">
                  <div className="hero-leaf-title">
                    <b>Számla</b>
                    <span className="hero-leaf-no">{invoice.number}</span>
                  </div>
                  <p className="hero-leaf-party">{invoice.partner}</p>
                  <div className="hero-leaf-lines">
                    <div>
                      <span>{invoice.itemName}</span>
                      <span className="tnum">{invoice.quantity}</span>
                    </div>
                    <div>
                      <span>Nettó</span>
                      <span className="tnum">{invoice.net}</span>
                    </div>
                    <div>
                      <span>{invoice.vatLabel}</span>
                      <span className="tnum">{invoice.vat}</span>
                    </div>
                  </div>
                  <div className="hero-leaf-total">
                    <span>Bruttó</span>
                    <b className="tnum">{invoice.gross}</b>
                  </div>
                </div>
                <div className="tear-bottom" aria-hidden="true" />
              </div>
            </div>
          </div>
        </WireDiagram>
      </div>
    </section>
  )
}
