import Link from 'next/link'
import { LogoMark } from '@/components/site/logo'
import { InstallCommand } from './install-command'

export function ClosingSection({ packageName, repo }: { packageName: string; repo: string }) {
  return (
    <section className="blue-field closing" aria-labelledby="kezdd-el">
      <div className="container">
        <div className="closing-grid">
          <div className="closing-logo ld-reveal">
            <LogoMark className="size-[clamp(72px,9vw,112px)]" />
          </div>
          <h2 id="kezdd-el" className="ld-reveal">
            Kezdd el most.
          </h2>
          <div className="closing-actions ld-reveal">
            <InstallCommand command={`npm i ${packageName}`} />
            <Link className="btn btn-on-blue" href="/docs">
              Dokumentáció
            </Link>
            <a className="btn btn-ghost-blue" href={repo}>
              GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
