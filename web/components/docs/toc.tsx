'use client'

import { AnchorProvider, ScrollProvider, TOCItem, type TOCItemType } from 'fumadocs-core/toc'
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

export function TocProvider({ toc, children }: { toc: TOCItemType[]; children: ReactNode }) {
  return (
    <AnchorProvider toc={toc} single>
      {children}
    </AnchorProvider>
  )
}

function TocList({ toc, onNavigate }: { toc: TOCItemType[]; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col border-l border-rule">
      {toc.map((item) => (
        <li key={item.url}>
          <TOCItem
            href={item.url}
            onClick={onNavigate}
            className={cn(
              '-ml-px block border-l-2 border-transparent py-1 pr-2 text-[0.8125rem] leading-snug text-muted transition-colors duration-[var(--dur-micro)] ease-out hover:text-ink data-[active=true]:border-blue data-[active=true]:font-semibold data-[active=true]:text-blue-ink',
              item.depth <= 2 ? 'pl-3' : item.depth === 3 ? 'pl-6' : 'pl-9',
            )}
          >
            {item.title}
          </TOCItem>
        </li>
      ))}
    </ul>
  )
}

export function DesktopToc({ toc, children }: { toc: TOCItemType[]; children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={containerRef}
      className="scrollbar-thin sticky top-[calc(var(--navbar-height)+1.5rem)] max-h-[calc(100dvh-var(--navbar-height)-3rem)] overflow-y-auto pb-6"
    >
      {toc.length > 0 ? (
        <ScrollProvider containerRef={containerRef}>
          <p className="mb-2 pl-3 text-[0.8125rem] font-bold text-ink">Ezen az oldalon</p>
          <TocList toc={toc} />
        </ScrollProvider>
      ) : null}
      {children}
    </div>
  )
}

export function MobileToc({ toc }: { toc: TOCItemType[] }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (toc.length === 0) return null
  return (
    <div className="mb-8 rounded-[var(--radius-md)] border border-rule bg-paper xl:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 w-full items-center justify-between rounded-[var(--radius-md)] px-4 text-left text-sm font-semibold text-ink transition-colors duration-[var(--dur-micro)] hover:bg-leaf"
      >
        Ezen az oldalon
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-4 text-muted transition-transform duration-[var(--dur-short)] ease-out',
            open && 'rotate-90',
          )}
        />
      </button>
      <div id={panelId} hidden={!open} className="px-3 pt-1 pb-3">
        <TocList toc={toc} onNavigate={() => setOpen(false)} />
      </div>
    </div>
  )
}
