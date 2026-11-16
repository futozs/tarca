import Link from 'next/link'
import { site } from '@/lib/site'
import { Wordmark } from './logo'

const columns = [
  {
    title: 'Dokumentáció',
    links: [
      { href: '/docs', label: 'Bevezetés' },
      { href: '/docs/alapok/telepites', label: 'Telepítés' },
      { href: '/docs/alapok/pontosan-egyszer', label: 'Pontosan egyszer' },
      { href: '/docs/alapok/hibakezeles', label: 'Hibakezelés' },
    ],
  },
  {
    title: 'Eszközök',
    links: [
      { href: '/sandbox', label: 'Sandbox' },
      { href: '/docs/receptek', label: 'Receptek' },
      { href: '/docs/tesztek', label: 'Tesztelés' },
      { href: '/docs/kiegeszitok/mcp-szerver', label: 'MCP és parancssor' },
      { href: '/llms.txt', label: 'llms.txt' },
    ],
  },
  {
    title: 'Projekt',
    links: [
      { href: site.repo, label: 'GitHub', external: true },
      { href: site.npm, label: 'npm', external: true },
      { href: site.changelog, label: 'Változásnapló', external: true },
      { href: site.issues, label: 'Hibabejelentés', external: true },
    ],
  },
] as const

const linkClass =
  'text-sm text-ink-2 underline-offset-[0.18em] transition-colors duration-[var(--dur-micro)] hover:text-blue-ink hover:underline'

export function SiteFooter() {
  return (
    <footer className="border-t border-rule bg-paper pt-16 pb-8">
      <div className="container">
        <div className="grid grid-cols-2 gap-x-[var(--gap)] gap-y-8 lg:grid-cols-[minmax(0,4fr)_repeat(3,minmax(0,2fr))]">
          <div className="col-span-2 lg:col-span-1">
            <Link
              href="/"
              aria-label="tárca, főoldal"
              className="inline-flex rounded-[var(--radius-md)]"
            >
              <Wordmark />
            </Link>
            <p className="mt-3 max-w-[22rem] text-sm text-muted">
              Nulla függőségű TypeScript kliens a Billingo API v3-hoz. MIT licenc.
            </p>
          </div>
          {columns.map((column) => (
            <div key={column.title}>
              <h2 className="font-sans text-sm font-bold text-ink">{column.title}</h2>
              <ul className="mt-3 grid gap-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {'external' in link ? (
                      <a href={link.href} target="_blank" rel="noreferrer" className={linkClass}>
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className={linkClass}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap justify-between gap-3 border-t border-rule pt-6 text-xs text-muted">
          <p>
            A tárca független, nyílt forráskódú projekt: nem a Billingo fejleszti, és nem áll
            kapcsolatban vele.
          </p>
          <p>
            A testvére:{' '}
            <a
              href={site.sibling}
              className="text-ink-2 underline decoration-rule-strong hover:text-blue-ink"
            >
              kassza
            </a>
            , Számlázz.hu-hoz.
          </p>
        </div>
      </div>
    </footer>
  )
}
