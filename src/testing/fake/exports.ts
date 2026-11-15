import { toBudapestTimestamp } from '../../core/dates'
import type {
  DocumentExportQueryType,
  DocumentExportStatus,
  DocumentExportType,
} from '../../generated/billingo'
import {
  bodyFields,
  clientError,
  type FakeFieldError,
  type FakeRequest,
  type FakeResponse,
  type FakeRoutes,
  fileResponse,
  ok,
  requiredEnum,
  serverError,
  validationFailed,
} from './http'
import { integerField } from './products'
import { dateField } from './spendings'
import type { FakeBillingoState, FakeDocumentExport } from './state'

export const EXPORT_NOT_FOUND = 'Document export is not found.'

export const EXPORT_NOT_FINISHED = 'Document export is not finished yet.'

export const SIMPLE_CSV_HEADER: readonly string[] = [
  '"Számla sorszáma"',
  '"Kapcsolódó számla"',
  'Kelt',
  '"Telj. dátum"',
  '"Fiz. hat."',
  '"Fiz. mód"',
  '"Vevő név"',
  '"Vevő város"',
  '"Vevő irányítószám"',
  '"Vevő utca"',
  '"Vevő ország"',
  '"Vevő telefonszám"',
  '"Vevő adószám"',
  'Megjegyzés',
  '"Nettó végösszeg"',
  '"Bruttó végösszeg"',
  'Pénznem',
  'Árfolyam',
  '"Nettó forintosított"',
  '"Bruttó forintosított"',
  'Fizetett',
  '"Utolsó fizetés dátuma"',
  '"Kedvezmény típus"',
  'Kedvezmény',
  'Bizonylatszám',
  '"Számla típusa"',
  '"Elektronikus számla"',
]

const UTF8_BOM = [0xef, 0xbb, 0xbf]

const QUERY_TYPE_FLAGS: Readonly<Record<DocumentExportQueryType, true>> = {
  due_date: true,
  fulfillment_date: true,
  invoice_date: true,
  paid_date: true,
}

const EXPORT_TYPE_FLAGS: Readonly<Record<DocumentExportType, true>> = {
  armada: true,
  aws_batch: true,
  ex_panda: true,
  forintsoft: true,
  hessyn: true,
  ima: true,
  infoteka: true,
  kulcs_konyv: true,
  maxitax: true,
  nagy_machinator: true,
  nav_ptgszlah: true,
  nav_status: true,
  nav_xml: true,
  nav_xml_alias: true,
  novitax: true,
  proforma_outstanding: true,
  relax: true,
  rlb: true,
  rlb60: true,
  rlb_double_entry: true,
  simple_csv: true,
  simple_excel: true,
  simple_excel_items: true,
  tensoft: true,
  tensoft_29_dot_65: true,
  used_erase_code: true,
}

export const EXPORT_TYPES: readonly string[] = Object.keys(EXPORT_TYPE_FLAGS)

function isQueryType(value: unknown): value is DocumentExportQueryType {
  return typeof value === 'string' && Object.hasOwn(QUERY_TYPE_FLAGS, value)
}

function isExportType(value: unknown): value is DocumentExportType {
  return typeof value === 'string' && Object.hasOwn(EXPORT_TYPE_FLAGS, value)
}

function unsupportedType(exportType: DocumentExportType): FakeResponse {
  return serverError(
    501,
    `A hamis Billingo csak a simple_csv exportot készíti el, a(z) ${exportType} formátumot nem.`,
  )
}

function exportFilename(state: FakeBillingoState): string {
  return `${toBudapestTimestamp(state.config.now()).slice(0, 19).replace(/\D/g, '_')}_export.csv`
}

function csvFile(state: FakeBillingoState): FakeResponse {
  const text = `${SIMPLE_CSV_HEADER.join(';')}\n`
  return fileResponse({
    bytes: new Uint8Array([...UTF8_BOM, ...new TextEncoder().encode(text)]),
    contentType: 'text/csv; charset=UTF-8',
    disposition: `inline; filename=${exportFilename(state)}`,
  })
}

function withExisting(
  state: FakeBillingoState,
  request: FakeRequest,
  respond: (job: FakeDocumentExport) => FakeResponse,
): FakeResponse {
  const job = state.documentExports.get(request.params.id ?? '')
  return job ? respond(job) : clientError(404, EXPORT_NOT_FOUND)
}

function stateOf(job: FakeDocumentExport): Required<DocumentExportStatus> {
  return { id: job.id, state: job.polls < 2 ? 'pending' : 'success', message: '' }
}

export const exportRoutes: FakeRoutes = {
  Create: (state, request) => {
    const input = bodyFields(request.body)
    const errors: FakeFieldError[] = []
    const queryType = requiredEnum(input, 'query_type', isQueryType, errors)
    const startDate = dateField(input, 'start_date', errors, true)
    const endDate = dateField(input, 'end_date', errors, true)
    const exportType = requiredEnum(input, 'export_type', isExportType, errors)
    const documentBlockId = integerField(input, 'document_block_id', errors) ?? undefined
    if (
      errors.length > 0 ||
      queryType === undefined ||
      exportType === undefined ||
      startDate === null ||
      endDate === null
    ) {
      return validationFailed(errors)
    }
    if (exportType !== 'simple_csv') return unsupportedType(exportType)
    const job: FakeDocumentExport = {
      id: crypto.randomUUID(),
      queryType,
      startDate,
      endDate,
      exportType,
      documentBlockId,
      polls: 0,
    }
    state.documentExports.set(job.id, job)
    return ok({ id: job.id }, 201)
  },
  Poll: (state, request) =>
    withExisting(state, request, (job) => {
      const polled = { ...job, polls: job.polls + 1 }
      state.documentExports.set(job.id, polled)
      return ok(stateOf(polled))
    }),
  Download: (state, request) =>
    withExisting(state, request, (job) =>
      stateOf(job).state === 'success' ? csvFile(state) : clientError(404, EXPORT_NOT_FINISHED),
    ),
}
