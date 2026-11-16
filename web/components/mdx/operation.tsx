import { BILLINGO_OPERATIONS, type OperationId } from 'tarcajs'
import { cn } from '@/lib/cn'
import { METHOD_TONES, SPEC_LABELS } from './spec-presence'

export function Operation({ id, methods = [] }: { id: OperationId; methods?: readonly string[] }) {
  const operation = BILLINGO_OPERATIONS[id]
  return (
    <div className="not-prose my-6 flex flex-col gap-2 rounded-[var(--radius-md)] border border-rule bg-leaf px-4 py-3">
      <p className="flex min-w-0 items-center gap-2 font-mono text-[0.85rem] text-ink">
        <span
          className={cn(
            'shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[0.75rem] font-semibold',
            METHOD_TONES[operation.method],
          )}
        >
          {operation.method}
        </span>
        <span className="min-w-0 break-all">{operation.path}</span>
      </p>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem]">
        {methods.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <dt className="text-muted">tárca</dt>
            <dd className="font-mono text-blue-ink">{methods.join(', ')}</dd>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <dt className="text-muted">Billingo</dt>
          <dd className="font-mono text-ink-2">{id}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-muted">spec</dt>
          <dd className="text-ink-2">{SPEC_LABELS[operation.spec]}</dd>
        </div>
      </dl>
    </div>
  )
}
