import type { OperationId } from '../../core/operations'
import { isOperationId } from './router'

export interface FakeBillingoStatusFault {
  readonly status: number
  readonly message?: string | undefined
}

export type FakeBillingoFault = 'network' | 'timeout' | 'notReady' | FakeBillingoStatusFault

export interface FakeBillingoFaultOptions {
  readonly operation?: OperationId | undefined
  readonly times?: number | undefined
  readonly afterSuccess?: boolean | undefined
}

export interface FakeBillingoScheduledFault extends FakeBillingoFaultOptions {
  readonly fault: FakeBillingoFault
}

export type FaultEffect =
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'notReady' }
  | { readonly kind: 'status'; readonly status: number; readonly message: string | undefined }

export interface ActiveFault {
  readonly effect: FaultEffect
  readonly afterSuccess: boolean
}

interface PendingFault extends ActiveFault {
  readonly operation: OperationId | undefined
  remaining: number
}

export interface FaultQueue {
  add(fault: FakeBillingoFault, options?: FakeBillingoFaultOptions): void
  take(operation: OperationId): ActiveFault | undefined
  clear(): void
}

function effectOf(fault: FakeBillingoFault): FaultEffect {
  if (fault === 'network' || fault === 'timeout' || fault === 'notReady') return { kind: fault }
  if (typeof fault !== 'object' || fault === null) {
    throw new TypeError(`Ismeretlen hamis Billingo hiba: ${String(fault)}`)
  }
  if (!Number.isInteger(fault.status) || fault.status < 400 || fault.status > 599) {
    throw new TypeError(
      `A hiba státuszkódja 400 és 599 közötti egész szám legyen, kapott: ${String(fault.status)}`,
    )
  }
  return { kind: 'status', status: fault.status, message: fault.message }
}

function pendingFault(fault: FakeBillingoFault, options: FakeBillingoFaultOptions): PendingFault {
  const effect = effectOf(fault)
  const times = options.times ?? 1
  if (!Number.isInteger(times) || times < 1) {
    throw new TypeError(`A times értéke legalább 1 egész szám legyen, kapott: ${String(times)}`)
  }
  if (options.operation !== undefined && !isOperationId(options.operation)) {
    throw new TypeError(`Ismeretlen Billingo művelet: ${String(options.operation)}`)
  }
  const afterSuccess = options.afterSuccess === true
  if (afterSuccess && effect.kind === 'notReady') {
    throw new TypeError(
      'A notReady hiba nem kérhető afterSuccess módban: a 202 a válasz helyett jön.',
    )
  }
  return { effect, afterSuccess, operation: options.operation, remaining: times }
}

export function createFaultQueue(): FaultQueue {
  const pending: PendingFault[] = []
  return {
    add(fault, options = {}) {
      pending.push(pendingFault(fault, options))
    },
    take(operation) {
      const index = pending.findIndex(
        (fault) => fault.operation === undefined || fault.operation === operation,
      )
      const fault = pending[index]
      if (!fault) return undefined
      fault.remaining -= 1
      if (fault.remaining === 0) pending.splice(index, 1)
      return { effect: fault.effect, afterSuccess: fault.afterSuccess }
    },
    clear() {
      pending.length = 0
    },
  }
}
