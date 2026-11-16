import { FileText, Receipt, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { LogoMark } from '@/components/site/logo'
import { WireDiagram } from './wire-diagram'

const PROVIDERS = [
  { id: 'stripe', label: 'Stripe' },
  { id: 'simplepay', label: 'SimplePay' },
  { id: 'barion', label: 'Barion' },
  { id: 'revolut', label: 'Revolut' },
  { id: 'paypal', label: 'PayPal' },
] as const

const OUTPUTS = [
  { id: 'szamla', label: 'Számla', Icon: FileText, refund: false },
  { id: 'nyugta', label: 'Nyugta', Icon: Receipt, refund: false },
  { id: 'sztorno', label: 'Sztornó', Icon: Undo2, refund: true },
  { id: 'modosito', label: 'Módosító számla', Icon: Undo2, refund: true },
] as const

const edges = [
  ...PROVIDERS.map((provider) => `${provider.id}>hub`),
  ...OUTPUTS.map((output) => `hub>${output.id}${output.refund ? ':dim' : ''}`),
].join(' ')

const providerNames = PROVIDERS.map((provider) => provider.label)

export function PaymentsSection() {
  return (
    <section className="section" id="fizetesek" aria-labelledby="fizetesek-cim">
      <div className="container">
        <div className="head ld-reveal">
          <h2 id="fizetesek-cim">Fizetés után a bizonylat magától elkészül.</h2>
          <p>
            {providerNames.slice(0, -1).join(', ')} és {providerNames.at(-1)} webhookból pontosan
            egyszer nyugta vagy számla. Visszatérítéskor sztornó vagy módosító számla.
          </p>
        </div>
        <WireDiagram
          className="pay-flow body"
          edges={edges}
          runs="stripe>hub>szamla"
          role="img"
          aria-label={`${providerNames.join(', ')} webhookjából az issueForPayment számlát vagy nyugtát állít ki, visszatérítéskor sztornót vagy módosító számlát.`}
        >
          <ul className="pay-ins">
            {PROVIDERS.map((provider) => (
              <li key={provider.id} className="wd-node" data-node={provider.id}>
                {provider.label}
              </li>
            ))}
          </ul>
          <div className="wd-node pay-hub" data-node="hub">
            <LogoMark className="size-14 max-sm:size-11" />
            <code>issueForPayment()</code>
          </div>
          <ul className="pay-outs">
            {OUTPUTS.map(({ id, label, Icon, refund }) => (
              <li key={id} className={refund ? 'wd-node is-dashed' : 'wd-node'} data-node={id}>
                <Icon aria-hidden="true" />
                {label}
              </li>
            ))}
            <li className="pay-sub">Szaggatott: visszatérítéskor.</li>
          </ul>
        </WireDiagram>
        <p className="pay-cap" aria-hidden="true">
          Középen a tárca <code className="inline-code">issueForPayment()</code> függvénye.
        </p>
        <div className="pay-actions">
          <Link className="btn btn-secondary" href="/docs/fizetesek">
            Fizetési integrációk
          </Link>
        </div>
      </div>
    </section>
  )
}
