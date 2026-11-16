import { CircleAlert, Info, Lightbulb, NotebookPen, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const variants = {
  note: {
    label: 'Megjegyzés',
    icon: NotebookPen,
    className: 'border-note-border bg-note-bg [--callout-ink:var(--note-ink)]',
  },
  tip: {
    label: 'Tanács',
    icon: Lightbulb,
    className: 'border-success-border bg-success-bg [--callout-ink:var(--success-ink)]',
  },
  info: {
    label: 'Tudnivaló',
    icon: Info,
    className: 'border-info-border bg-info-bg [--callout-ink:var(--info-ink)]',
  },
  warning: {
    label: 'Figyelem',
    icon: TriangleAlert,
    className: 'border-warning-border bg-warning-bg [--callout-ink:var(--warning-ink)]',
  },
  danger: {
    label: 'Veszély',
    icon: CircleAlert,
    className: 'border-danger-border bg-danger-bg [--callout-ink:var(--danger-ink)]',
  },
} as const

export type CalloutType = keyof typeof variants

export function Callout({
  type = 'note',
  title,
  children,
}: {
  type?: CalloutType | 'error' | 'warn' | 'success'
  title?: ReactNode
  children: ReactNode
}) {
  const key: CalloutType =
    type === 'error' ? 'danger' : type === 'warn' ? 'warning' : type === 'success' ? 'tip' : type
  const variant = variants[key]
  const Icon = variant.icon
  return (
    <aside
      className={cn(
        'my-6 flex gap-3 rounded-[var(--radius-md)] border px-4 py-3.5 text-[0.95rem] leading-relaxed',
        variant.className,
      )}
    >
      <Icon className="mt-[0.2rem] size-4 shrink-0 text-[var(--callout-ink)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[0.9rem] font-bold text-[var(--callout-ink)]">
          {title ?? variant.label}
        </p>
        <div className="text-ink [&>:last-child]:mb-0 [&_a]:!text-[var(--callout-ink)] [&_a]:!underline [&_a]:!decoration-current/40 [&_p]:mb-2">
          {children}
        </div>
      </div>
    </aside>
  )
}
