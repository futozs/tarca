import type { BreadcrumbItem } from 'fumadocs-core/breadcrumb'
import { ChevronRight, House } from 'lucide-react'
import Link from 'next/link'
import { Fragment } from 'react'

const linkClass =
  'inline-flex min-h-8 items-center rounded-[var(--radius-md)] px-2 text-ink-2 transition-colors duration-[var(--dur-micro)] ease-out hover:bg-leaf hover:text-blue-ink'

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Morzsamenü" className="mb-5">
      <ol className="-ml-2 flex flex-wrap items-center gap-y-1 text-[0.8125rem]">
        <li>
          <Link
            href="/docs"
            aria-label="Dokumentáció kezdőlap"
            className={`${linkClass} w-8 justify-center px-0`}
          >
            <House className="size-4" aria-hidden="true" />
          </Link>
        </li>
        {items.map((item, position) => {
          const isLast = position === items.length - 1
          return (
            <Fragment key={`${String(item.name)}-${item.url ?? 'group'}`}>
              <li aria-hidden="true" className="text-rule-strong">
                <ChevronRight className="size-3.5" />
              </li>
              <li>
                {isLast ? (
                  <span
                    aria-current="page"
                    className="inline-flex min-h-8 items-center px-2 font-semibold text-ink"
                  >
                    {item.name}
                  </span>
                ) : item.url ? (
                  <Link href={item.url} className={linkClass}>
                    {item.name}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-8 items-center px-2 text-ink-2">
                    {item.name}
                  </span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
