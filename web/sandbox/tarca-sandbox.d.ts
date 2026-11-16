declare module 'tarca-sandbox' {
  import type { OperationId } from 'tarcajs'
  import type {
    FakeBillingoDataView,
    FakeBillingoFault,
    FakeBillingoFaultOptions,
  } from 'tarcajs/testing'

  export const billingo: {
    fail(fault: FakeBillingoFault, options?: FakeBillingoFaultOptions): void
    count(operation?: OperationId): number
    counts(): Readonly<Partial<Record<OperationId, number>>>
    readonly data: FakeBillingoDataView
  }

  export const apiKey: string
}
