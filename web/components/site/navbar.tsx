'use client'

import type * as PageTree from 'fumadocs-core/page-tree'
import { ArrowUpRight, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { isNavLinkActive, navLinks, site } from '@/lib/site'
import { useShortcutLabel } from '@/lib/use-shortcut-label'
import { Wordmark } from './logo'
import { MobileMenu } from './mobile-menu'
import { useSearch } from './search-context'

const linkClass =
  'inline-flex items-center gap-1 rounded-[var(--radius-md)] px-3 py-2 text-sm font-[550] whitespace-nowrap transition-colors duration-[var(--dur-micro)] ease-out'

export function Navbar({ tree, wide = false }: { tree?: PageTree.Root; wide?: boolean }) {
  const pathname = usePathname()
  const { openSearch } = useSearch()
  const shortcut = useShortcutLabel().mod

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] h-[var(--navbar-height)] border-b border-rule bg-paper">
      <a
        href="#tartalom"
        className="absolute top-2 left-4 z-[var(--z-tooltip)] -translate-y-24 rounded-[var(--radius-md)] bg-ink px-4 py-2 text-sm font-semibold text-paper focus-visible:translate-y-0"
      >
        Ugrás a tartalomra
      </a>
      <div
        className={cn(
          'flex h-full items-center gap-2 lg:gap-6',
          wide ? 'px-2 sm:px-4' : 'container',
        )}
      >
        <MobileMenu tree={tree} />
        <Link
          href="/"
          aria-label="tárca, főoldal"
          className="flex items-center rounded-[var(--radius-md)] py-1"
        >
          <Wordmark />
        </Link>

        <nav aria-label="Fő navigáció" className="hidden items-center gap-1 lg:flex">
          {navLinks.map((link) => {
            const active = isNavLinkActive(pathname, link.match)
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  linkClass,
                  active ? 'bg-leaf text-blue-ink' : 'text-ink-2 hover:bg-leaf hover:text-ink',
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:gap-2">
          <a
            href={site.changelog}
            target="_blank"
            rel="noreferrer"
            title="Változásnapló"
            className="tnum hidden rounded-[var(--radius-sm)] border border-rule px-2 py-1 font-mono text-xs text-muted transition-colors duration-[var(--dur-micro)] hover:border-rule-strong hover:text-ink lg:inline-flex"
          >
            v{site.version}
          </a>
          <a
            href={site.repo}
            target="_blank"
            rel="noreferrer"
            className={cn(
              linkClass,
              'hidden text-ink-2 hover:bg-leaf hover:text-ink lg:inline-flex',
            )}
          >
            GitHub
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
          <a
            href={site.npm}
            target="_blank"
            rel="noreferrer"
            className={cn(
              linkClass,
              'hidden text-ink-2 hover:bg-leaf hover:text-ink lg:inline-flex',
            )}
          >
            npm
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={openSearch}
            aria-label="Keresés a dokumentációban"
            aria-keyshortcuts="Meta+K Control+K"
            className="hidden h-[34px] min-w-[190px] items-center gap-2 rounded-[var(--radius-md)] border border-rule-strong pr-1 pl-3 text-left text-sm text-muted transition-colors duration-[var(--dur-micro)] ease-out hover:border-blue hover:bg-leaf lg:inline-flex"
          >
            <Search className="size-[15px] shrink-0" aria-hidden="true" />
            <span className="flex-1">Keresés</span>
            <kbd className="rounded-[var(--radius-sm)] border border-rule bg-paper px-1 font-sans text-xs text-muted">
              {shortcut}K
            </kbd>
          </button>
          <button
            type="button"
            onClick={openSearch}
            aria-label="Keresés a dokumentációban"
            className="inline-flex size-10 items-center justify-center rounded-[var(--radius-md)] text-ink-2 transition-colors duration-[var(--dur-micro)] hover:bg-leaf hover:text-ink lg:hidden"
          >
            <Search className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  )
}
