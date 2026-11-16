import type { OperationInfo } from 'tarcajs'

export const SPEC_LABELS: Readonly<Record<OperationInfo['spec'], string>> = {
  both: '3.0.14 és 3.0.15',
  'only-3.0.14': 'csak a 3.0.14',
  'only-3.0.15': 'új a 3.0.15-ben',
  undocumented: 'nem dokumentált',
}

export const METHOD_TONES: Readonly<Record<OperationInfo['method'], string>> = {
  GET: 'bg-leaf-2 text-ink-2',
  POST: 'bg-blue-soft text-blue-ink',
  PUT: 'bg-warning-bg text-warning-ink',
  DELETE: 'bg-danger-bg text-danger-ink',
}
