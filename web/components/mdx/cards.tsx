import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

export function Cards({ children }: { children: ReactNode }) {
  return <div className="not-prose my-6 grid gap-4 sm:grid-cols-2">{children}</div>
}

export function Card({
  title,
  href,
  children,
}: {
  title: string
  href: string
  children?: ReactNode
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-rule bg-paper p-4 transition-[border-color,background-color] duration-[var(--dur-micro)] ease-out hover:border-blue hover:bg-leaf active:scale-[0.99]"
    >
      <span className="flex items-center justify-between gap-3 font-semibold text-ink">
        {title}
        <ArrowRight
          className="size-4 shrink-0 text-muted transition-[color,transform] duration-[var(--dur-short)] ease-out group-hover:translate-x-0.5 group-hover:text-blue-ink"
          aria-hidden="true"
        />
      </span>
      {children ? <span className="text-sm leading-relaxed text-muted">{children}</span> : null}
    </Link>
  )
}
