import { BILLINGO_OPERATIONS, type OperationInfo } from 'tarcajs'
import { withArticle } from './hungarian'

const operations: readonly OperationInfo[] = Object.values(BILLINGO_OPERATIONS)

export const OPERATION_COUNT = operations.length

export const SPEC_SPLIT = {
  documented: operations.filter((op) => op.spec === 'both' || op.spec === 'only-3.0.14').length,
  added: operations.filter((op) => op.spec === 'only-3.0.15').length,
  undocumented: operations.filter((op) => op.spec === 'undocumented').length,
} as const

export const siteDescription = `Nulla függőségű TypeScript kliens a Billingo API v3-hoz: mind ${withArticle(OPERATION_COUNT)} művelet, pontosan egyszeri számlakiállítás, magyar hibaüzenetek és hamis Billingo a tesztekhez.`
