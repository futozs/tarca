import { FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'

export function TryIt({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="not-prose my-6 rounded-[var(--radius-lg)] border border-rule bg-paper">
      <header className="flex items-center gap-2 border-b border-rule bg-leaf px-4 py-2.5 rounded-t-[var(--radius-lg)]">
        <FlaskConical className="size-4 text-blue-ink" aria-hidden="true" />
        <p className="text-sm font-bold text-blue-ink">Próbáld ki</p>
        {title ? <p className="truncate text-sm text-muted">{title}</p> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}
