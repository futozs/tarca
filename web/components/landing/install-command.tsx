'use client'

import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

const RESET_AFTER_MS = 1600

const labels: Record<CopyState, string> = {
  idle: 'Másolás',
  copied: 'Kimásolva',
  failed: 'Nem sikerült',
}

const announcements: Record<CopyState, string> = {
  idle: '',
  copied: 'A telepítő parancs a vágólapra került.',
  failed: 'A másolás nem sikerült, jelöld ki a parancsot kézzel.',
}

const icons = { idle: Copy, copied: Check, failed: TriangleAlert } as const

export function InstallCommand({ command }: { command: string }) {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(command)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), RESET_AFTER_MS)
  }

  const Icon = icons[state]

  return (
    <div className="install">
      <code>
        <span aria-hidden="true">$</span>
        {command}
      </code>
      <button
        type="button"
        className="install-copy"
        data-state={state}
        onClick={copy}
        aria-label={state === 'idle' ? 'Telepítő parancs másolása' : labels[state]}
      >
        <Icon aria-hidden="true" />
        <span aria-hidden="true">{labels[state]}</span>
      </button>
      <span className="sr-only" aria-live="polite">
        {announcements[state]}
      </span>
    </div>
  )
}
