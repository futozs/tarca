'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConsoleEntry,
  RunResult,
  SandboxRequest,
  WorkerMessage,
} from '@/sandbox/runtime/protocol'

export interface SandboxLogEntry extends ConsoleEntry {
  readonly id: number
}

export type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'timeout'

export interface RunnerState {
  readonly runId: number
  readonly status: RunStatus
  readonly entries: readonly SandboxLogEntry[]
  readonly requests: readonly SandboxRequest[]
  readonly result: RunResult | undefined
}

const RUN_TIMEOUT_MS = 20_000

function withEntry(
  entries: readonly SandboxLogEntry[],
  entry: ConsoleEntry,
): readonly SandboxLogEntry[] {
  return [...entries, { ...entry, id: entries.length + 1 }]
}

const initialState: RunnerState = {
  runId: 0,
  status: 'idle',
  entries: [],
  requests: [],
  result: undefined,
}

export function useSandboxRunner(runnerUrl: string) {
  const [state, setState] = useState<RunnerState>(initialState)
  const workerRef = useRef<Worker | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const runIdRef = useRef(0)

  const stop = useCallback(() => {
    clearTimeout(timerRef.current)
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => stop, [stop])

  const run = useCallback(
    (code: string) => {
      stop()
      runIdRef.current += 1
      const runId = runIdRef.current
      setState({ ...initialState, runId, status: 'running' })

      let worker: Worker
      try {
        worker = new Worker(runnerUrl, { type: 'module', name: 'tarca-sandbox' })
      } catch (error) {
        setState((current) => ({
          ...current,
          status: 'failed',
          entries: withEntry(current.entries, {
            level: 'error',
            time: 0,
            args: [
              {
                t: 'string',
                v: `A sandbox futtatókörnyezete nem indult el: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          }),
        }))
        return
      }
      workerRef.current = worker

      worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
        const message = event.data
        if (message.type === 'ready') {
          worker.postMessage({ type: 'run', runId, code })
          return
        }
        if (message.runId !== runId) return
        if (message.type === 'console') {
          setState((current) => ({
            ...current,
            entries: withEntry(current.entries, message.entry),
          }))
        } else if (message.type === 'request') {
          setState((current) => ({ ...current, requests: [...current.requests, message.request] }))
        } else if (message.type === 'done') {
          stop()
          setState((current) => ({
            ...current,
            status: message.result.ok ? 'done' : 'failed',
            result: message.result,
          }))
        }
      })

      worker.addEventListener('error', (event) => {
        stop()
        setState((current) => ({
          ...current,
          status: 'failed',
          entries: withEntry(current.entries, {
            level: 'error',
            time: 0,
            args: [{ t: 'string', v: `Váratlan hiba a sandboxban: ${event.message}` }],
          }),
        }))
      })

      timerRef.current = setTimeout(() => {
        stop()
        setState((current) => ({ ...current, status: 'timeout' }))
      }, RUN_TIMEOUT_MS)
    },
    [runnerUrl, stop],
  )

  const cancel = useCallback(() => {
    if (!workerRef.current) return
    stop()
    setState((current) => ({
      ...current,
      status: 'failed',
      entries: withEntry(current.entries, {
        level: 'warn',
        time: 0,
        args: [{ t: 'string', v: 'A futást leállítottad.' }],
      }),
    }))
  }, [stop])

  return { state, run, cancel }
}
