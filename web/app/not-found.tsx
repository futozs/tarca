import type { Metadata } from 'next'
import Link from 'next/link'
import { Navbar } from '@/components/site/navbar'
import { SiteFooter } from '@/components/site/site-footer'

export const metadata: Metadata = {
  title: 'Az oldal nem található',
  robots: { index: false, follow: true },
}

const leafLines = [
  { label: 'Kért oldal', value: 'nincs meg' },
  { label: 'Státusz', value: '404' },
  { label: 'Kiállítva', value: 'sosem' },
] as const

function MissingLeaf() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-[20rem]">
      <div className="missing-tbar" />
      <div className="missing-leaf">
        <div className="missing-leaf-body">
          <div className="flex items-baseline justify-between font-mono text-xs text-muted">
            <span>tárca</span>
            <span>GET /oldal</span>
          </div>
          <p className="mt-5 font-display text-[5.5rem] leading-none font-extrabold tracking-[-0.04em] text-ink [font-stretch:112%]">
            404
          </p>
          <dl className="mt-6 grid gap-2 border-t border-dashed border-rule-strong pt-4 font-mono text-[0.8rem] text-ink-2">
            {leafLines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-3">
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex items-baseline justify-between border-t border-ink pt-3">
            <span className="text-xs font-semibold text-ink">Bruttó</span>
            <span className="font-mono text-lg font-semibold text-blue-ink">0 Ft</span>
          </div>
        </div>
        <div className="missing-leaf-tear" />
      </div>
    </div>
  )
}

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main
        id="tartalom"
        className="container grid items-center gap-14 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:py-28"
      >
        <div className="max-w-[38rem]">
          <p className="font-mono text-xs font-medium text-blue-ink">404 · Nem található</p>
          <h1 className="mt-4 font-display text-[length:var(--text-h2)] leading-[1.05] font-extrabold tracking-[-0.02em] text-balance text-ink [font-stretch:112%]">
            Ilyen oldal nincs a tárcában.
          </h1>
          <p className="mt-5 text-[length:var(--text-lead)] leading-relaxed text-ink-2">
            Lehet, hogy elavult a link, vagy elgépelődött a cím. A dokumentációban a keresővel
            megtalálod, amit keresel, a sandboxban pedig rögtön futtathatod a példákat.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/docs" className="btn btn-primary">
              Dokumentáció
            </Link>
            <Link href="/sandbox" className="btn btn-secondary">
              Sandbox
            </Link>
            <Link href="/" className="text-link">
              Vissza a főoldalra
            </Link>
          </div>
        </div>
        <MissingLeaf />
      </main>
      <SiteFooter />
    </>
  )
}
