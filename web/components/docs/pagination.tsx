import type * as PageTree from 'fumadocs-core/page-tree'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import Link from 'next/link'

function PaginationCard({
  item,
  direction,
}: {
  item: PageTree.Item
  direction: 'previous' | 'next'
}) {
  const isNext = direction === 'next'
  const Arrow = isNext ? ArrowRight : ArrowLeft
  return (
    <Link
      href={item.url}
      rel={isNext ? 'next' : 'prev'}
      className={`group flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-rule bg-paper px-4 py-3.5 transition-[border-color,background-color] duration-[var(--dur-micro)] ease-out hover:border-blue hover:bg-leaf active:scale-[0.99] ${isNext ? 'items-end text-right sm:col-start-2' : 'items-start'}`}
    >
      <span className="text-[0.8125rem] text-muted">
        {isNext ? 'Következő oldal' : 'Előző oldal'}
      </span>
      <span
        className={`flex max-w-full items-center gap-2 font-semibold text-blue-ink ${isNext ? '' : 'flex-row-reverse'}`}
      >
        <span className="truncate">{item.name}</span>
        <Arrow
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform duration-[var(--dur-short)] ease-out ${isNext ? 'group-hover:translate-x-0.5' : 'group-hover:-translate-x-0.5'}`}
        />
      </span>
    </Link>
  )
}

export function Pagination({
  previous,
  next,
}: {
  previous?: PageTree.Item | undefined
  next?: PageTree.Item | undefined
}) {
  if (!previous && !next) return null
  return (
    <nav aria-label="Lapozás a dokumentációban" className="mt-8 grid gap-4 sm:grid-cols-2">
      {previous ? <PaginationCard item={previous} direction="previous" /> : null}
      {next ? <PaginationCard item={next} direction="next" /> : null}
    </nav>
  )
}
