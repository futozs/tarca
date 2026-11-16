import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import type { OperationId } from '../../src/core/operations'
import {
  createTarca,
  type DocumentItemInput,
  type PartnerInput,
  type Tarca,
  type TarcaOptions,
} from '../../src/index'
import {
  createFakeBillingoFetch,
  type FakeBillingo,
  type FakeBillingoOptions,
} from '../../src/testing/index'
import { TEST_API_KEY } from '../helpers'
import { docsPageExists, loadDocsTree } from './tree'

export const BUYER: PartnerInput = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
}

export const ITEMS: readonly DocumentItemInput[] = [
  { name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 },
]

const declared = loadDocsTree().entries

const DOCS_NOW = new Date('2026-11-16T09:00:00Z')

export function pinDocsClock(): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true, now: DOCS_NOW })
  })
  afterAll(() => {
    vi.useRealTimers()
  })
}

export function docsExample(page: string, name: string, run: () => Promise<void>): void {
  test(`${page || 'index'}: ${name}`, async () => {
    expect(declared.has(page), `nincs meta.json bejegyzés: ${page}`).toBe(true)
    expect(docsPageExists(page), `nincs ilyen MDX oldal: ${page}`).toBe(true)
    await run()
  })
}

export interface DocsClient {
  readonly tarca: Tarca
  readonly billingo: FakeBillingo
}

export function docsClient(
  options: Omit<TarcaOptions, 'apiKey' | 'fetch'> = {},
  fake: FakeBillingoOptions = {},
): DocsClient {
  const billingo = createFakeBillingoFetch(fake)
  const tarca = createTarca({
    retryDelayMs: 0,
    ...options,
    apiKey: TEST_API_KEY,
    fetch: billingo.fetch,
  })
  return { tarca, billingo }
}

export function sentBodies(billingo: FakeBillingo, operation: OperationId): unknown[] {
  return billingo.requests
    .filter((request) => request.operation === operation)
    .map((request) => request.body)
}
