import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type Billingo,
  type BillingoError,
  createTarca,
  type DocumentInput,
  isBillingoError,
  type OperationId,
} from 'tarcajs'
import { createFakeBillingoFetch, type FakeBillingoRequestRecord } from 'tarcajs/testing'

const SAMPLE_API_KEY = 'minta-kulcs'
const SNIPPET_FILE = 'components/landing/hero-snippet.ts'
const SNIPPET_END = '\ndeclare '

export const sampleItem = {
  name: 'Webfejlesztés',
  quantity: 10,
  unit: 'óra',
  netUnitPrice: 15_000,
  vat: 27,
} as const

export const sampleInput = {
  partner: {
    name: 'Vevő Kft.',
    address: { countryCode: 'HU', postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [sampleItem],
} satisfies DocumentInput

export const SAMPLE_VENDOR_ID = 'rendeles-1001'

const REQUEST_NOTES: Partial<Record<OperationId, string>> = {
  ListDocumentBlock: 'számlatömböt választ',
  ListPartner: 'partnert keres',
  CreatePartner: 'nincs ilyen, létrehozza',
  CreateDocument: 'kiállítja',
}

export interface SampleRequest {
  readonly id: string
  readonly method: string
  readonly target: string
  readonly note: string
  readonly status: string
}

export interface SampleInvoice {
  readonly number: string
  readonly partner: string
  readonly itemName: string
  readonly quantity: string
  readonly net: string
  readonly vatLabel: string
  readonly vat: string
  readonly gross: string
}

export interface SampleIssue {
  readonly requests: readonly SampleRequest[]
  readonly invoice: SampleInvoice
}

export interface SampleOnce {
  readonly first: { readonly created: boolean; readonly number: string }
  readonly second: { readonly created: boolean; readonly number: string }
}

export interface SampleError {
  readonly name: string
  readonly category: string
  readonly message: string
  readonly field: string
  readonly fieldMessage: string
  readonly hint: string
}

const huf = new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0, useGrouping: 'always' })

export function formatHuf(value: number): string {
  return `${huf.format(value)} Ft`
}

function sampleClient() {
  const fake = createFakeBillingoFetch({ apiKeys: [SAMPLE_API_KEY] })
  return { fake, tarca: createTarca({ apiKey: SAMPLE_API_KEY, fetch: fake.fetch }) }
}

function requestOf(record: FakeBillingoRequestRecord, index: number): SampleRequest {
  const note = record.operation === undefined ? undefined : REQUEST_NOTES[record.operation]
  if (note === undefined) {
    throw new Error(`Váratlan kérés a mintában: ${record.method} ${record.path}`)
  }
  const query = record.query.query
  return {
    id: `r${index + 1}`,
    method: record.method,
    target: query === undefined ? record.path : `${record.path}?query=${query}`,
    note,
    status: String(record.status),
  }
}

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`A minta számlából hiányzik: ${field}`)
  return value
}

export function invoiceOf(document: Billingo.Document): SampleInvoice {
  const item = required(document.items?.[0], 'items[0]')
  const summary = required(document.summary, 'summary')
  return {
    number: required(document.invoiceNumber, 'invoiceNumber'),
    partner: required(document.partner?.name, 'partner.name'),
    itemName: required(item.name, 'items[0].name'),
    quantity: `${required(item.quantity, 'items[0].quantity')} ${item.unit ?? ''}`.trim(),
    net: formatHuf(required(summary.netAmount, 'summary.netAmount')),
    vatLabel: `ÁFA ${required(item.vat, 'items[0].vat')}`,
    vat: formatHuf(required(summary.vatAmount, 'summary.vatAmount')),
    gross: formatHuf(required(document.grossTotal, 'grossTotal')),
  }
}

export async function runSampleIssue(): Promise<SampleIssue> {
  const { fake, tarca } = sampleClient()
  const document = await tarca.documents.create(sampleInput)
  return { requests: fake.requests.map(requestOf), invoice: invoiceOf(document) }
}

export async function runSampleOnce(): Promise<SampleOnce> {
  const { tarca } = sampleClient()
  const input = { ...sampleInput, vendorId: SAMPLE_VENDOR_ID }
  const first = await tarca.documents.createOnce(input)
  const second = await tarca.documents.createOnce(input)
  const number = (result: { readonly document: Billingo.Document }) =>
    required(result.document.invoiceNumber, 'invoiceNumber')
  return {
    first: { created: first.created, number: number(first) },
    second: { created: second.created, number: number(second) },
  }
}

function errorOf(error: BillingoError): SampleError {
  const field = required(error.fieldErrors[0], 'fieldErrors[0]')
  return {
    name: error.name,
    category: error.category,
    message: error.message,
    field: field.field,
    fieldMessage: field.message,
    hint: required(error.hint, 'hint'),
  }
}

export async function runSampleError(): Promise<SampleError> {
  const { fake, tarca } = sampleClient()
  try {
    await tarca.documents.create({ ...sampleInput, items: [{ ...sampleItem, name: '' }] })
  } catch (error) {
    if (!isBillingoError(error)) throw error
    if (fake.requests.length > 0) throw new Error('A hibás minta kérést küldött a Billingónak.')
    return errorOf(error)
  }
  throw new Error('Az üres tételnév nem adott hibát.')
}

export function extractSnippet(source: string): string {
  const end = source.indexOf(SNIPPET_END)
  if (end === -1) throw new Error(`A ${SNIPPET_FILE} fájlból hiányzik a declare sor.`)
  return source.slice(0, end).trimEnd()
}

export async function readHeroSnippet(): Promise<string> {
  return extractSnippet(await readFile(join(process.cwd(), SNIPPET_FILE), 'utf8'))
}
