import { isBillingoError } from '../core/errors'
import type { Document } from '../generated/billingo'
import { unknownDocumentMessage } from '../mcp/tools-actions'
import { CliUsageError, flagValue, type ParsedArgs } from './args'
import { type CliIo, cliTarca, printJson } from './io'

const POSITIVE_INTEGER = /^[1-9]\d*$/

export async function verifyCommand(io: CliIo): Promise<number> {
  if (await cliTarca(io).verifyCredentials()) {
    io.stdout('Az API kulcs érvényes: a Billingo elfogadta.\n')
    return 0
  }
  io.stderr(
    'A Billingo elutasította az API kulcsot (401). V3 API kulcs kell: Billingo → Beállítások → API kulcsok. Ellenőrizd azt is, hogy a kulcs a jó céghez tartozik-e.\n',
  )
  return 1
}

type DocumentReference = { readonly id: number } | { readonly vendorId: string }

function documentReferenceOf(args: ParsedArgs): DocumentReference {
  const id = args.positionals[2]
  const vendorId = flagValue(args, 'vendor')
  if ((id === undefined) === (vendorId === undefined)) {
    throw new CliUsageError(
      'Pontosan egyet adj meg: tarca document get <azonosító> | --vendor <vendorId>',
    )
  }
  if (vendorId !== undefined) {
    if (vendorId.trim() === '') throw new CliUsageError('A --vendor értéke nem lehet üres.')
    return { vendorId }
  }
  if (id === undefined || !POSITIVE_INTEGER.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new CliUsageError(`A bizonylat azonosítója pozitív egész szám, kapott: ${id ?? ''}`)
  }
  return { id: Number(id) }
}

async function fetchDocument(io: CliIo, reference: DocumentReference): Promise<Document | null> {
  const tarca = cliTarca(io)
  if ('vendorId' in reference) return tarca.documents.findByVendorId(reference.vendorId)
  try {
    return await tarca.documents.get(reference.id)
  } catch (error) {
    if (isBillingoError(error) && error.category === 'forbidden') return null
    throw error
  }
}

export async function documentGetCommand(io: CliIo, args: ParsedArgs): Promise<number> {
  const reference = documentReferenceOf(args)
  const document = await fetchDocument(io, reference)
  if (!document) {
    io.stderr(
      `${'id' in reference ? unknownDocumentMessage(reference.id) : 'Nincs bizonylat ezzel a vendorId-val ebben a Billingo cégben.'}\n`,
    )
    return 1
  }
  printJson(io, document)
  return 0
}
