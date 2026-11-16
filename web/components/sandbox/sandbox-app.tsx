'use client'

import {
  BookOpen,
  Check,
  Link2,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
  TriangleAlert,
} from 'lucide-react'
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  sidebarAsideClass,
  sidebarItemActiveClass,
  sidebarItemClass,
  sidebarItemIdleClass,
  sidebarScrollClass,
  sidebarSeparatorClass,
} from '@/components/docs/sidebar-styles'
import { cn } from '@/lib/cn'
import { useShortcutLabel } from '@/lib/use-shortcut-label'
import type { ExampleGroup } from '@/sandbox/examples/catalog'
import { formatPreview } from '@/sandbox/runtime/serialize'
import type { EditorMarker } from './code-editor'
import { BillingoState, ConsoleSection, IdleState, RequestRoute, RunNotice } from './output-panels'
import { useSandboxRunner } from './use-sandbox-runner'

export interface SandboxExample {
  readonly slug: string
  readonly title: string
  readonly group: ExampleGroup
  readonly description: string
  readonly docs?: string | undefined
  readonly code: string
}

export interface SandboxManifest {
  readonly runner: string
  readonly types: string
  readonly monaco: string
}

const CUSTOM = 'sajat'
const DRAFT_PREFIX = 'tarca.sandbox.v1.'

const toolClass =
  'inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-[var(--dur-micro)] hover:bg-leaf hover:text-ink active:bg-leaf-2'

function PlainCode({ code }: { code: string }) {
  return (
    <pre
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-editor py-4 pr-6 pl-[4.25rem] font-mono text-[13.5px] leading-[22px] whitespace-pre-wrap text-[var(--code-foreground)]"
    >
      {code}
    </pre>
  )
}

const CodeEditor = dynamic(() => import('./code-editor').then((mod) => mod.CodeEditor), {
  ssr: false,
})

function readDraft(slug: string): string | null {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + slug)
  } catch {
    return null
  }
}

function writeDraft(slug: string, code: string | null): void {
  try {
    if (code === null) window.localStorage.removeItem(DRAFT_PREFIX + slug)
    else window.localStorage.setItem(DRAFT_PREFIX + slug, code)
  } catch {
    return
  }
}

export function SandboxApp({
  examples,
  manifest,
  tarcaVersion,
}: {
  examples: readonly SandboxExample[]
  manifest: SandboxManifest
  tarcaVersion: string
}) {
  const defaultExample = examples[0]
  const [slug, setSlug] = useState(defaultExample?.slug ?? CUSTOM)
  const [code, setCode] = useState(defaultExample?.code ?? '')
  const [shared, setShared] = useState(false)
  const [mobileView, setMobileView] = useState<'kod' | 'kimenet'>('kod')
  const [copied, setCopied] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const shortcut = useShortcutLabel()
  const { state, run, cancel } = useSandboxRunner(manifest.runner)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const example = useMemo(() => examples.find((item) => item.slug === slug), [examples, slug])
  const groups = useMemo(() => {
    const map = new Map<ExampleGroup, SandboxExample[]>()
    for (const item of examples) map.set(item.group, [...(map.get(item.group) ?? []), item])
    return [...map.entries()]
  }, [examples])

  const execute = useCallback(
    (source: string) => {
      setMobileView('kimenet')
      run(source)
    },
    [run],
  )

  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#kod=')) {
      const decoded = decompressFromEncodedURIComponent(hash.slice(5))
      if (decoded) {
        setSlug(CUSTOM)
        setCode(decoded)
        setShared(true)
        return
      }
    }
    const requested = new URLSearchParams(window.location.search).get('pelda')
    const target = examples.find((item) => item.slug === requested) ?? defaultExample
    if (!target) return
    const source = readDraft(target.slug) ?? target.code
    setSlug(target.slug)
    setCode(source)
    setMobileView('kod')
    run(source)
  }, [examples, defaultExample, run])

  const selectExample = (next: SandboxExample) => {
    const source = readDraft(next.slug) ?? next.code
    setSlug(next.slug)
    setCode(source)
    setShared(false)
    const url = new URL(window.location.href)
    url.searchParams.set('pelda', next.slug)
    url.hash = ''
    window.history.replaceState(null, '', url)
    execute(source)
  }

  const onCodeChange = (next: string) => {
    setCode(next)
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      if (example && next === example.code) writeDraft(slug, null)
      else writeDraft(slug, next)
    }, 400)
  }

  const reset = () => {
    if (!example) return
    writeDraft(slug, null)
    setCode(example.code)
  }

  const share = async () => {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = `kod=${compressToEncodedURIComponent(code)}`
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.history.replaceState(null, '', url)
    }
  }

  const modified = example ? code !== example.code : false
  const running = state.status === 'running'
  const requestCount = state.requests.length
  const marker: EditorMarker | undefined =
    state.result?.error?.line !== undefined
      ? {
          line: state.result.error.line,
          column: state.result.error.column,
          message: formatPreview(state.result.error.preview).split('\n')[0] ?? 'Hiba',
        }
      : undefined

  const statusText =
    state.status === 'running'
      ? 'Fut…'
      : state.status === 'done'
        ? `Lefutott ${Math.round(state.result?.durationMs ?? 0)} ms alatt, ${requestCount} kérés`
        : state.status === 'failed'
          ? 'Hibával állt le'
          : state.status === 'timeout'
            ? 'Időtúllépés miatt leállítva'
            : 'Kész a futtatásra'

  return (
    <div className="flex w-full">
      <aside className={sidebarAsideClass}>
        <div className={sidebarScrollClass}>
          <nav aria-label="Példák">
            <ul className="flex flex-col gap-0.5">
              {groups.map(([group, items], index) => (
                <Fragment key={group}>
                  <li className={cn(sidebarSeparatorClass, index === 0 && 'mt-2')}>{group}</li>
                  {items.map((item) => (
                    <li key={item.slug}>
                      <a
                        href={`/sandbox?pelda=${item.slug}`}
                        onClick={(event) => {
                          if (
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.button !== 0
                          )
                            return
                          event.preventDefault()
                          selectExample(item)
                        }}
                        aria-current={item.slug === slug ? 'page' : undefined}
                        className={cn(
                          sidebarItemClass,
                          item.slug === slug ? sidebarItemActiveClass : sidebarItemIdleClass,
                        )}
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </nav>
        </div>
      </aside>

      <div className="grid h-[calc(100dvh-var(--navbar-height))] min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] bg-paper">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule bg-paper px-3 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="pelda-valaszto">
              Példa kiválasztása
            </label>
            <select
              id="pelda-valaszto"
              value={slug}
              onChange={(event) => {
                const next = examples.find((item) => item.slug === event.target.value)
                if (next) selectExample(next)
              }}
              className="mb-1 h-9 w-full rounded-[var(--radius-md)] border border-rule-strong bg-paper px-2 text-sm text-ink lg:hidden"
            >
              {slug === CUSTOM ? <option value={CUSTOM}>Megosztott kód</option> : null}
              {groups.map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <h1 className="hidden truncate font-display text-lg font-bold text-ink lg:block">
              {example?.title ?? 'Megosztott kód'}
              {modified ? (
                <span className="ml-2 font-sans text-xs font-medium text-muted">módosítva</span>
              ) : null}
            </h1>
            <p className="hidden truncate text-sm text-muted sm:block">
              {example?.description ?? 'Egy link alapján megnyitott, saját kód.'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {example?.docs ? (
              <Link href={example.docs} className={cn(toolClass, 'hidden xl:inline-flex')}>
                <BookOpen className="size-4" aria-hidden="true" />
                Dokumentáció
              </Link>
            ) : null}
            <button
              type="button"
              onClick={reset}
              disabled={!modified}
              className={cn(toolClass, 'disabled:opacity-45 disabled:hover:bg-transparent')}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Visszaállítás</span>
            </button>
            <button type="button" onClick={share} className={toolClass}>
              {copied ? (
                <Check className="size-4 text-success-ink" aria-hidden="true" />
              ) : (
                <Link2 className="size-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{copied ? 'Link kimásolva' : 'Megosztás'}</span>
            </button>
            {running ? (
              <button
                type="button"
                onClick={cancel}
                className="ml-1 inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-rule-strong px-4 text-sm font-semibold whitespace-nowrap text-ink transition-colors duration-[var(--dur-micro)] hover:border-ink"
              >
                <Square className="size-3.5 fill-current" aria-hidden="true" />
                Leállítás
              </button>
            ) : (
              <button
                type="button"
                onClick={() => execute(code)}
                aria-keyshortcuts="Meta+Enter Control+Enter"
                className="ml-1 inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] bg-blue px-4 text-sm font-semibold whitespace-nowrap text-on-blue transition-[background-color,transform] duration-[var(--dur-micro)] hover:bg-blue-hover active:scale-[0.98] active:bg-blue-press"
              >
                <Play className="size-3.5 fill-current" aria-hidden="true" />
                Futtatás
                <kbd className="hidden rounded-[var(--radius-sm)] bg-on-blue/15 px-1.5 py-0.5 font-sans text-[0.68rem] font-medium sm:inline">
                  {shortcut.isMac ? '⌘↵' : 'Ctrl ↵'}
                </kbd>
              </button>
            )}
          </div>
          {shared ? (
            <p className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-ink">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              Megosztott kódot nyitottál meg. Futtatás előtt nézd át, mit csinál.
            </p>
          ) : null}
          <div
            className="flex w-full rounded-[var(--radius-md)] border border-rule bg-leaf p-0.5 lg:hidden"
            role="tablist"
            aria-label="Nézet"
          >
            {(['kod', 'kimenet'] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={mobileView === view}
                onClick={() => setMobileView(view)}
                className={cn(
                  'flex-1 rounded-[6px] py-1.5 text-sm font-semibold transition-colors duration-[var(--dur-micro)]',
                  mobileView === view
                    ? 'bg-paper text-ink shadow-[var(--shadow-leaf)]'
                    : 'text-muted',
                )}
              >
                {view === 'kod'
                  ? 'Kód'
                  : `Kimenet${requestCount ? ` · ${requestCount} kérés` : ''}`}
              </button>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,44%)]">
          <section
            aria-label="Kódszerkesztő"
            className={cn(
              'relative min-h-0 bg-editor',
              mobileView === 'kimenet' && 'hidden lg:block',
            )}
          >
            {editorReady ? null : <PlainCode code={code} />}
            <CodeEditor
              value={code}
              onChange={onCodeChange}
              onRun={() => execute(code)}
              onReady={() => setEditorReady(true)}
              monacoPath={manifest.monaco}
              typesUrl={manifest.types}
              marker={marker}
            />
          </section>
          <section
            aria-label="Kimenet"
            className={cn(
              'flex min-h-0 min-w-0 flex-col border-rule bg-paper lg:border-l',
              mobileView === 'kod' && 'hidden lg:flex',
            )}
          >
            <div
              className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
              role="log"
              aria-live="polite"
              aria-busy={running}
            >
              <RunNotice entries={state.entries} result={state.result} status={state.status} />
              {state.status === 'idle' ? (
                <IdleState />
              ) : (
                <>
                  <ConsoleSection entries={state.entries} status={state.status} />
                  <RequestRoute key={state.runId} requests={state.requests} status={state.status} />
                  {state.result ? <BillingoState billingo={state.result.billingo} /> : null}
                </>
              )}
            </div>
          </section>
        </div>

        <footer className="flex items-center gap-3 border-t border-rule bg-paper px-3 py-1.5 text-xs text-muted sm:px-5">
          <span className="inline-flex items-center gap-1.5">
            {running ? (
              <LoaderCircle className="size-3 animate-spin text-blue" aria-hidden="true" />
            ) : (
              <span
                className={cn(
                  'size-2 rounded-full',
                  state.status === 'failed' || state.status === 'timeout'
                    ? 'bg-danger-ink'
                    : 'bg-blue',
                )}
                aria-hidden="true"
              />
            )}
            {statusText}
          </span>
          <span className="hidden truncate md:inline">
            A hamis Billingo a böngésződben fut, kérés nem megy ki.
          </span>
          <span className="tnum ml-auto font-mono whitespace-nowrap">tarcajs {tarcaVersion}</span>
        </footer>
      </div>
    </div>
  )
}
