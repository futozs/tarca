'use client'

import { AlertTriangle, ChevronRight, CircleX } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/cn'
import type {
  BillingoSnapshot,
  ConsoleEntry,
  RunResult,
  SandboxRequest,
} from '@/sandbox/runtime/protocol'
import { JsonCode } from './json-code'
import {
  defaultOpenRequest,
  documentTypeLabel,
  formatAmount,
  isWrite,
  paymentStatusLabel,
  requestTarget,
  statusLabel,
  statusTone,
} from './labels'
import { PreviewValue } from './preview-value'
import type { RunStatus, SandboxLogEntry } from './use-sandbox-runner'

function SectionTitle({
  id,
  children,
  count,
}: {
  id: string
  children: string
  count?: number | undefined
}) {
  return (
    <h2
      id={id}
      className="flex items-baseline gap-2 px-5 pt-6 pb-3 font-display text-[0.95rem] font-bold text-ink"
    >
      {children}
      {count ? (
        <span className="tnum font-sans text-sm font-medium text-muted">{count}</span>
      ) : null}
    </h2>
  )
}

function Hint({ children }: { children: string }) {
  return <p className="px-5 pb-2 text-sm text-muted">{children}</p>
}

export function IdleState() {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 px-6 py-12">
      <p className="font-display text-lg font-bold text-ink">Még nem futtattad a kódot.</p>
      <p className="max-w-sm text-sm text-muted">
        Nyomd meg a Futtatás gombot (⌘/Ctrl + Enter). A tárca a böngésződben fut, egy hamis Billingo
        ellen, így egyetlen kérés sem hagyja el a gépedet.
      </p>
    </div>
  )
}

const levelStyles: Readonly<Record<ConsoleEntry['level'], string>> = {
  log: '',
  debug: 'text-muted',
  info: 'text-info-ink',
  warn: 'bg-warning-bg text-warning-ink',
  error: 'bg-danger-bg text-danger-ink',
}

function LogArguments({ entry, defaultOpen }: { entry: SandboxLogEntry; defaultOpen: boolean }) {
  const nodes: ReactNode[] = []
  for (const [position, arg] of entry.args.entries()) {
    nodes.push(
      <span key={`${entry.id}.${position}`} className="mr-2 inline">
        <PreviewValue preview={arg} topLevel defaultOpen={defaultOpen} />
      </span>,
    )
  }
  return nodes
}

export function ConsoleSection({
  entries,
  status,
}: {
  entries: readonly SandboxLogEntry[]
  status: RunStatus
}) {
  const defaultOpen = entries.length < 12
  return (
    <section aria-labelledby="sandbox-konzol">
      <SectionTitle id="sandbox-konzol" count={entries.length}>
        Konzol
      </SectionTitle>
      {entries.length === 0 ? (
        <Hint>{status === 'running' ? 'Várakozás a kimenetre…' : 'A kód nem írt a konzolra.'}</Hint>
      ) : (
        <div className="mx-5 overflow-hidden rounded-[var(--radius-md)] border border-rule font-mono text-[0.8rem] leading-relaxed">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'sandbox-enter flex gap-2 border-b border-rule px-3 py-1.5 last:border-b-0',
                levelStyles[entry.level],
              )}
            >
              {entry.level === 'warn' ? (
                <AlertTriangle className="mt-1 size-3.5 shrink-0" aria-label="Figyelmeztetés" />
              ) : entry.level === 'error' ? (
                <CircleX className="mt-1 size-3.5 shrink-0" aria-label="Hiba" />
              ) : null}
              <div className="min-w-0 flex-1 break-words">
                <LogArguments entry={entry} defaultOpen={defaultOpen} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function RunNotice({
  entries,
  result,
  status,
}: {
  entries: readonly SandboxLogEntry[]
  result: RunResult | undefined
  status: RunStatus
}) {
  if (result?.error) {
    return (
      <div className="flex gap-2 border-b border-danger-border bg-danger-bg px-5 py-3 text-danger-ink">
        <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 font-mono text-[0.8rem] leading-relaxed break-words">
          <p className="mb-1 font-sans text-sm font-bold">
            Kezeletlen hiba{result.error.line ? ` a(z) ${result.error.line}. sorban` : ''}
          </p>
          <PreviewValue preview={result.error.preview} topLevel defaultOpen />
        </div>
      </div>
    )
  }
  if (status === 'timeout') {
    return (
      <p className="flex gap-2 border-b border-warning-border bg-warning-bg px-5 py-3 text-sm text-warning-ink">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />A futás 20 másodperc
        után leállt. Végtelen ciklus vagy le nem záródó Promise lehet a kódban.
      </p>
    )
  }
  const last = entries.at(-1)
  if (status !== 'failed' || result || !last) return null
  const message = last.args.map((arg) => (arg.t === 'string' ? arg.v : '')).join(' ')
  return (
    <p
      className={cn(
        'flex gap-2 border-b px-5 py-3 text-sm',
        last.level === 'warn'
          ? 'border-warning-border bg-warning-bg text-warning-ink'
          : 'border-danger-border bg-danger-bg text-danger-ink',
      )}
    >
      {last.level === 'warn' ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      )}
      {message}
    </p>
  )
}

const statusStyles = {
  ok: 'text-success-ink',
  'client-error': 'text-warning-ink',
  'server-error': 'text-danger-ink',
  network: 'text-warning-ink',
} as const

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-[3.25rem] shrink-0 items-center justify-center rounded-[var(--radius-sm)] px-1.5 font-mono text-[0.7rem] font-bold tracking-wide',
        method === 'DELETE'
          ? 'bg-danger-bg text-danger-ink'
          : isWrite(method)
            ? 'bg-blue text-on-blue'
            : 'bg-blue-soft text-blue-ink',
      )}
    >
      {method}
    </span>
  )
}

function RequestBody({ request }: { request: SandboxRequest }) {
  const [view, setView] = useState<'request' | 'response'>(
    request.requestBody ? 'request' : 'response',
  )
  const responseText =
    request.responseKind === 'empty'
      ? request.status === 'network' || request.status === 'timeout'
        ? 'Nem érkezett válasz.'
        : 'Üres válasz.'
      : request.responseBody
  return (
    <div className="mt-3 overflow-hidden rounded-[var(--radius-md)] bg-editor">
      <div
        className="flex border-b border-editor-rule"
        role="tablist"
        aria-label="Kérés vagy válasz"
      >
        {(['request', 'response'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={view === item}
            onClick={() => setView(item)}
            className={cn(
              'relative px-3 py-2 text-xs font-semibold transition-colors duration-[var(--dur-micro)]',
              view === item
                ? 'text-[var(--code-foreground)] after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-blue-mid'
                : 'text-[var(--code-token-comment)] hover:text-[var(--code-foreground)]',
            )}
          >
            {item === 'request' ? 'Elküldött JSON' : 'Billingo válasza'}
          </button>
        ))}
      </div>
      <div className="scrollbar-thin max-h-[26rem] overflow-auto p-3">
        {view === 'request' ? (
          request.requestBody ? (
            <JsonCode code={request.requestBody} json />
          ) : (
            <p className="text-xs text-[var(--code-token-comment)]">
              {request.method} kérés, törzs nélkül.
            </p>
          )
        ) : (
          <>
            {request.responseHeaders.length > 0 ? (
              <div className="mb-3 border-b border-editor-rule pb-2 font-mono text-[0.72rem] leading-relaxed">
                {request.responseHeaders.map(([name, value]) => (
                  <div key={name} className="break-all">
                    <span className="text-[var(--code-token-function)]">{name}</span>
                    <span className="text-[var(--code-token-punctuation)]">: </span>
                    <span className="text-[var(--code-token-string)]">{value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <JsonCode code={responseText} json={request.responseKind === 'json'} />
          </>
        )}
      </div>
    </div>
  )
}

function RequestStop({
  request,
  open,
  onToggle,
  last,
}: {
  request: SandboxRequest
  open: boolean
  onToggle: () => void
  last: boolean
}) {
  const tone = statusTone(request.status)
  return (
    <li className="sandbox-enter relative pl-7">
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute top-[29px] -bottom-[29px] left-[11px] border-l-2 border-dotted border-blue-mid"
        />
      )}
      <span
        aria-hidden="true"
        className="sandbox-stub absolute top-[28px] left-3 w-4 border-t-2 border-dotted border-blue-mid"
      />
      <span
        aria-hidden="true"
        className={cn(
          'sandbox-port absolute top-6 left-[7px] size-2.5 rounded-full',
          tone === 'ok' ? 'bg-blue' : tone === 'server-error' ? 'bg-danger-ink' : 'bg-warning-ink',
        )}
      />
      <div className="pb-3">
        <div
          className={cn(
            'rounded-[var(--radius-md)] border bg-paper transition-colors duration-[var(--dur-micro)]',
            open ? 'border-rule-strong' : 'border-rule hover:border-rule-strong',
          )}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left"
          >
            <MethodBadge method={request.method} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[0.8rem] text-ink">
                {requestTarget(request)}
              </span>
              {request.operation ? (
                <span className="block truncate font-mono text-[0.7rem] text-muted">
                  {request.operation}
                </span>
              ) : null}
            </span>
            <span
              className={cn('tnum shrink-0 font-mono text-xs font-semibold', statusStyles[tone])}
            >
              {statusLabel(request.status)}
            </span>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 text-muted transition-transform duration-[var(--dur-short)] ease-[var(--ease-out)]',
                open && 'rotate-90',
              )}
            />
          </button>
          {open ? (
            <div className="px-3 pb-3">
              <RequestBody request={request} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function RequestRoute({
  requests,
  status,
}: {
  requests: readonly SandboxRequest[]
  status: RunStatus
}) {
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(new Map())
  const autoOpen = status === 'running' ? undefined : defaultOpenRequest(requests)
  return (
    <section aria-labelledby="sandbox-keresek">
      <SectionTitle id="sandbox-keresek" count={requests.length}>
        Kérések a Billingónak
      </SectionTitle>
      {requests.length === 0 ? (
        <Hint>
          {status === 'running'
            ? 'Várakozás az első kérésre…'
            : 'A kód nem küldött kérést ennek a hamis Billingónak.'}
        </Hint>
      ) : (
        <ol className="px-5">
          {requests.map((request, index) => {
            const open = toggled.get(request.id) ?? request.id === autoOpen
            return (
              <RequestStop
                key={request.id}
                request={request}
                open={open}
                last={index === requests.length - 1}
                onToggle={() => setToggled((current) => new Map(current).set(request.id, !open))}
              />
            )
          })}
        </ol>
      )}
    </section>
  )
}

export function BillingoState({ billingo }: { billingo: BillingoSnapshot }) {
  const { documents } = billingo
  return (
    <section aria-labelledby="sandbox-allapot" className="pb-8">
      <SectionTitle id="sandbox-allapot" count={documents.length}>
        Bizonylatok a hamis Billingóban
      </SectionTitle>
      {documents.length === 0 ? (
        <Hint>A futás után nincs bizonylat a hamis Billingóban.</Hint>
      ) : (
        <div className="mx-5 overflow-x-auto rounded-[var(--radius-md)] border border-rule">
          <table className="w-full text-left text-sm">
            <thead className="bg-leaf text-xs text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Sorszám
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Típus
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Bruttó
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Állapot
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id} className="border-t border-rule">
                  <td className="px-3 py-2 font-mono text-[0.8rem] whitespace-nowrap text-ink">
                    {document.invoiceNumber || '–'}
                    {document.vendorId ? (
                      <span className="block text-[0.7rem] text-muted">{document.vendorId}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                    {documentTypeLabel(document.type)}
                  </td>
                  <td className="tnum px-3 py-2 text-right whitespace-nowrap text-ink">
                    {formatAmount(document.grossTotal, document.currency)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                    {document.cancelled ? 'sztornózva' : paymentStatusLabel(document.paymentStatus)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
