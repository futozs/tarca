'use client'

import { ArrowUpRight, Check, ClipboardCopy, FileText, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const actionClass =
  'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-left text-[0.8125rem] text-muted transition-colors duration-[var(--dur-micro)] ease-out hover:bg-leaf hover:text-ink'

type CopyState = 'idle' | 'loading' | 'copied' | 'error'

const copyLabels: Record<CopyState, string> = {
  idle: 'Oldal másolása Markdownként',
  loading: 'Oldal másolása Markdownként',
  copied: 'Markdown kimásolva',
  error: 'A másolás nem sikerült',
}

export function PageActions({
  markdownUrl,
  editUrl,
  officialUrl,
}: {
  markdownUrl: string
  editUrl: string
  officialUrl?: string | undefined
}) {
  const [state, setState] = useState<CopyState>('idle')
  const cache = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function settle(next: CopyState, after: number) {
    setState(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), after)
  }

  async function copyMarkdown() {
    setState('loading')
    try {
      if (cache.current === null) {
        const response = await fetch(markdownUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        cache.current = await response.text()
      }
      await navigator.clipboard.writeText(cache.current)
      settle('copied', 2000)
    } catch {
      settle('error', 3000)
    }
  }

  return (
    <div className="mt-6 border-t border-rule pt-4">
      <ul className="flex flex-col gap-0.5">
        <li>
          <button type="button" onClick={copyMarkdown} className={actionClass} aria-live="polite">
            {state === 'loading' ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : state === 'copied' ? (
              <Check className="size-3.5 text-success-ink" aria-hidden="true" />
            ) : (
              <ClipboardCopy className="size-3.5" aria-hidden="true" />
            )}
            {copyLabels[state]}
          </button>
        </li>
        <li>
          <a href={markdownUrl} className={actionClass}>
            <FileText className="size-3.5" aria-hidden="true" />
            Megnyitás Markdownként
          </a>
        </li>
        {officialUrl ? (
          <li>
            <a href={officialUrl} target="_blank" rel="noreferrer" className={actionClass}>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
              Billingo API leírás
            </a>
          </li>
        ) : null}
        <li>
          <a href={editUrl} target="_blank" rel="noreferrer" className={actionClass}>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
            Oldal szerkesztése GitHubon
          </a>
        </li>
      </ul>
    </div>
  )
}
