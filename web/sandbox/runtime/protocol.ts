import type { ConsoleLevel } from './execute'
import type { Preview } from './serialize'

export interface ConsoleEntry {
  readonly level: ConsoleLevel
  readonly args: readonly Preview[]
  readonly time: number
}

export type RequestOutcome = number | 'network' | 'timeout'

export type ResponseKind = 'json' | 'pdf' | 'csv' | 'text' | 'empty'

export interface SandboxRequest {
  readonly id: number
  readonly operation: string | undefined
  readonly method: string
  readonly path: string
  readonly query: readonly (readonly [string, string])[]
  readonly requestBody: string | undefined
  readonly status: RequestOutcome
  readonly responseHeaders: readonly (readonly [string, string])[]
  readonly responseKind: ResponseKind
  readonly responseBody: string
  readonly durationMs: number
}

export interface DocumentSummary {
  readonly id: number
  readonly invoiceNumber: string
  readonly type: string
  readonly grossTotal: number
  readonly currency: string
  readonly paymentStatus: string
  readonly cancelled: boolean
  readonly vendorId: string | undefined
  readonly partnerName: string | undefined
}

export interface BillingoSnapshot {
  readonly documents: readonly DocumentSummary[]
  readonly partners: number
  readonly products: number
}

export interface RunError {
  readonly preview: Preview
  readonly line?: number | undefined
  readonly column?: number | undefined
}

export interface RunResult {
  readonly ok: boolean
  readonly error?: RunError | undefined
  readonly durationMs: number
  readonly billingo: BillingoSnapshot
}

export type WorkerRequest = { readonly type: 'run'; readonly runId: number; readonly code: string }

export type WorkerMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'console'; readonly runId: number; readonly entry: ConsoleEntry }
  | { readonly type: 'request'; readonly runId: number; readonly request: SandboxRequest }
  | { readonly type: 'done'; readonly runId: number; readonly result: RunResult }
