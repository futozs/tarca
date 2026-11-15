import { BillingoError, isBillingoError, nullIfNotFound } from '../core/errors'
import type { PageQuery } from '../core/pagination'
import { CURRENCIES } from '../documents/enums'
import type {
  Document,
  PaymentStatus,
  PaymentStatusSpending,
  ProductQuantity,
  TaxpayerAddress,
} from '../generated/billingo'
import {
  assertKnownKeys,
  optionalBoolean,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalInteger,
  optionalString,
  requiredId,
  requiredString,
  ToolInputError,
} from './arguments'
import { profileFindings, summarizeProfile } from './profile'
import type { JsonObject } from './protocol'
import {
  CURRENCY_PROPERTY,
  DATE_PROPERTY,
  ID_PROPERTY,
  objectSchema,
  PAGE_PROPERTIES,
  TEXT_PROPERTY,
} from './schemas'
import {
  describeDocument,
  documentSummary,
  lines,
  type McpTool,
  type McpToolContext,
  type McpToolOutput,
  money,
  plainJson,
  REMOTE_READ,
} from './tool-kit'
import { documentById, unknownDocumentMessage } from './tools-actions'

const DOCUMENT_LIST_TYPES = ['invoice', 'receipt'] as const
const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'outstanding',
  'paid',
  'partially_paid',
  'expired',
  'none',
]
const SPENDING_STATUSES: readonly PaymentStatusSpending[] = ['all', 'paid', 'unpaid', 'expired']

function pageOf(args: JsonObject): PageQuery {
  const page = optionalInteger(args, 'page', '')
  const perPage = optionalInteger(args, 'perPage', '')
  if (page !== undefined && page < 1) {
    throw new ToolInputError('A page legalább 1 legyen.', { fields: ['page'] })
  }
  if (perPage !== undefined && (perPage < 1 || perPage > 100)) {
    throw new ToolInputError('A perPage 1 és 100 közötti egész szám legyen.', {
      fields: ['perPage'],
    })
  }
  return {
    ...(page === undefined ? {} : { page }),
    ...(perPage === undefined ? {} : { perPage }),
  }
}

function pageLine(
  noun: string,
  page: { total: number; currentPage: number; lastPage: number },
): string {
  return `${page.total} ${noun}, ${page.currentPage}/${Math.max(page.lastPage, 1)}. oldal.`
}

async function getProfile(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, [], '')
  const tarca = context.client()
  const [organization, blocks, accounts] = await Promise.all([
    tarca.organization.get(),
    tarca.documentBlocks.list({ perPage: 100 }),
    tarca.bankAccounts.list({ perPage: 100 }),
  ])
  const profile = summarizeProfile(organization, { now: context.now() })
  const findings = profileFindings(profile)
  const currencies = [...new Set(accounts.data.map((account) => account.currency))]
  return {
    summary: lines(
      ...findings.map((finding) => finding.message),
      `Számlatömbök: ${blocks.data.map((block) => `${block.name ?? ''} (#${block.id ?? '?'}, ${block.type ?? '?'}${block.prefix ? `, előtag: ${block.prefix}` : ''})`).join('; ') || 'nincs'}.`,
      `Bankszámlák: ${accounts.data.length}${currencies.length > 0 ? ` (${currencies.join(', ')})` : ''}.`,
    ),
    data: {
      profile: {
        kind: profile.kind,
        hasNavConnection: profile.hasNavConnection,
        features: [...profile.features],
        apiLimit: profile.apiLimit ?? null,
        expirationDate: profile.expirationDate ?? null,
        daysLeft: profile.daysLeft ?? null,
        kobakReceiptFsEnabled: organization.kobakReceiptFsEnabled ?? null,
        hasSuccessfulNavReceiptSubmission: organization.hasSuccessfulNavReceiptSubmission ?? null,
      },
      findings: findings.map((finding) => ({ ...finding })),
      documentBlocks: blocks.data.map((block) =>
        plainJson({ id: block.id, name: block.name, prefix: block.prefix, type: block.type }),
      ),
      bankAccounts: accounts.data.map((account) =>
        plainJson({ id: account.id, name: account.name, currency: account.currency }),
      ),
      defaults: plainJson(context.defaults),
    },
  }
}

async function listDocuments(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(
    args,
    [
      'type',
      'paymentStatus',
      'partnerId',
      'blockId',
      'startDate',
      'endDate',
      'query',
      'page',
      'perPage',
    ],
    '',
  )
  const type = optionalEnum(args, 'type', '', DOCUMENT_LIST_TYPES)
  const paymentStatus = optionalEnum(args, 'paymentStatus', '', PAYMENT_STATUSES)
  const partnerId = optionalId(args, 'partnerId', '')
  const blockId = optionalId(args, 'blockId', '')
  const startDate = optionalDate(args, 'startDate', '')
  const endDate = optionalDate(args, 'endDate', '')
  const query = optionalString(args, 'query', '')
  const page = await context.client().documents.list({
    ...pageOf(args),
    ...(type === undefined ? {} : { type }),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
    ...(partnerId === undefined ? {} : { partnerId }),
    ...(blockId === undefined ? {} : { blockId }),
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
    ...(query === undefined ? {} : { query }),
  })
  return {
    summary: lines(
      pageLine('bizonylat', page),
      ...page.data.map((document) => `#${document.id ?? '?'} ${describeDocument(document)}`),
    ),
    data: {
      documents: page.data.map(documentSummary),
      total: page.total,
      currentPage: page.currentPage,
      lastPage: page.lastPage,
      perPage: page.perPage,
    },
  }
}

type DocumentRef = { readonly id: number } | { readonly vendorId: string }

function documentRefOf(args: JsonObject): DocumentRef {
  const id = optionalId(args, 'id', '')
  const vendorId = optionalString(args, 'vendorId', '')
  if (id !== undefined && vendorId === undefined) return { id }
  if (vendorId !== undefined && id === undefined) return { vendorId }
  throw new ToolInputError('Pontosan egyet adj meg ezek közül: id, vendorId.', {
    fields: ['id', 'vendorId'],
  })
}

async function lookupDocument(ref: DocumentRef, context: McpToolContext): Promise<Document | null> {
  const tarca = context.client()
  if ('vendorId' in ref) return tarca.documents.findByVendorId(ref.vendorId)
  try {
    return await documentById(tarca, ref.id)
  } catch (error) {
    if (error instanceof ToolInputError) return null
    throw error
  }
}

async function getDocument(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(
    args,
    ['id', 'vendorId', 'includePayments', 'includeNavStatus', 'includePublicUrl'],
    '',
  )
  const ref = documentRefOf(args)
  const includePayments = optionalBoolean(args, 'includePayments', '') ?? false
  const includeNavStatus = optionalBoolean(args, 'includeNavStatus', '') ?? false
  const includePublicUrl = optionalBoolean(args, 'includePublicUrl', '') ?? false
  const document = await lookupDocument(ref, context)
  if (!document) {
    return {
      summary:
        'id' in ref
          ? unknownDocumentMessage(ref.id)
          : 'Nincs bizonylat ezzel a vendorId-val ebben a Billingo cégben.',
      data: { found: false },
    }
  }
  const id = document.id
  if (id === undefined) {
    throw new BillingoError('A Billingo a bizonylatot azonosító nélkül adta vissza.', {
      category: 'unexpected_response',
      operation: 'GetDocument',
    })
  }
  const tarca = context.client()
  const payments = includePayments ? await tarca.documents.payments.list(id) : undefined
  const navStatus = includeNavStatus ? await tarca.documents.navStatus(id) : undefined
  const publicUrl = includePublicUrl ? await tarca.documents.publicUrl(id) : undefined
  return {
    summary: lines(
      describeDocument(document),
      document.cancelled === true && 'A bizonylat sztornózva van.',
      document.correctionType === 'modified' && 'Módosító számla készült hozzá.',
      navStatus === null &&
        'NAV-állapot: még nincs NAV rekord (frissen kiállított bizonylatnál ez várható).',
      navStatus !== null && navStatus !== undefined && `NAV-állapot: ${navStatus.status ?? '?'}.`,
      publicUrl !== undefined && `Nyilvános link: ${publicUrl}`,
    ),
    data: {
      found: true,
      document: plainJson(document),
      ...(payments === undefined ? {} : { payments: plainJson(payments) }),
      ...(navStatus === undefined
        ? {}
        : { navStatus: navStatus === null ? null : plainJson(navStatus) }),
      ...(publicUrl === undefined ? {} : { publicUrl }),
    },
  }
}

async function listPartners(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['query', 'page', 'perPage'], '')
  const query = optionalString(args, 'query', '')
  const page = await context
    .client()
    .partners.list({ ...pageOf(args), ...(query === undefined ? {} : { query }) })
  return {
    summary: lines(
      pageLine('partner', page),
      ...page.data.map(
        (partner) =>
          `#${partner.id ?? '?'} ${partner.name}, ${partner.address.postCode} ${partner.address.city}${partner.taxcode ? `, adószám: ${partner.taxcode}` : ''}`,
      ),
    ),
    data: {
      partners: page.data.map((partner) =>
        plainJson({
          id: partner.id,
          name: partner.name,
          address: partner.address,
          taxcode: partner.taxcode,
          taxType: partner.taxType,
        }),
      ),
      total: page.total,
      currentPage: page.currentPage,
      lastPage: page.lastPage,
    },
  }
}

async function getPartner(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['id'], '')
  const id = requiredId(args, 'id', '')
  const partner = await nullIfNotFound(context.client().partners.get(id))
  if (!partner) return { summary: `Nincs ${id} azonosítójú partner.`, data: { found: false } }
  return {
    summary: `Partner #${id}: ${partner.name}, ${partner.address.postCode} ${partner.address.city}, ${partner.address.address}.`,
    data: { found: true, partner: plainJson(partner) },
  }
}

async function listProducts(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['query', 'page', 'perPage'], '')
  const query = optionalString(args, 'query', '')
  const page = await context
    .client()
    .products.list({ ...pageOf(args), ...(query === undefined ? {} : { query }) })
  return {
    summary: lines(
      pageLine('termék', page),
      ...page.data.map(
        (product) =>
          `#${product.id ?? '?'} ${product.name}: nettó ${money(product.netUnitPrice ?? 0, product.currency)} / ${product.unit}, áfa ${product.vat}`,
      ),
    ),
    data: {
      products: page.data.map((product) =>
        plainJson({
          id: product.id,
          name: product.name,
          netUnitPrice: product.netUnitPrice,
          grossUnitPrice: product.grossUnitPrice,
          currency: product.currency,
          vat: product.vat,
          unit: product.unit,
        }),
      ),
      total: page.total,
      currentPage: page.currentPage,
      lastPage: page.lastPage,
    },
  }
}

const STOCK_DISABLED = 'Automatic order processing is disabled'

async function stockOf(context: McpToolContext, id: number): Promise<ProductQuantity | null> {
  try {
    return await context.client().inventory.quantity(id)
  } catch (error) {
    if (isBillingoError(error) && error.apiMessage === STOCK_DISABLED) return null
    throw error
  }
}

async function getProduct(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['id', 'includeStock'], '')
  const id = requiredId(args, 'id', '')
  const includeStock = optionalBoolean(args, 'includeStock', '') ?? false
  const product = await nullIfNotFound(context.client().products.get(id))
  if (!product) return { summary: `Nincs ${id} azonosítójú termék.`, data: { found: false } }
  const stock = includeStock ? await stockOf(context, id) : undefined
  return {
    summary: lines(
      `Termék #${id}: ${product.name}, nettó ${money(product.netUnitPrice ?? 0, product.currency)}, bruttó ${money(product.grossUnitPrice ?? 0, product.currency)} / ${product.unit}, áfa ${product.vat}.`,
      stock === null &&
        'Készlet: a Billingo fiókban nincs bekapcsolva a készletkezelés (automatikus rendeléskezelés).',
      stock !== null &&
        stock !== undefined &&
        `Készlet: ${stock.availableQuantity ?? '?'} ${product.unit}.`,
    ),
    data: {
      found: true,
      product: plainJson(product),
      ...(stock === undefined ? {} : { stock: stock === null ? null : plainJson(stock) }),
    },
  }
}

async function listSpendings(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['q', 'startDate', 'endDate', 'paymentStatus', 'page', 'perPage'], '')
  const q = optionalString(args, 'q', '')
  const startDate = optionalDate(args, 'startDate', '')
  const endDate = optionalDate(args, 'endDate', '')
  const paymentStatus = optionalEnum(args, 'paymentStatus', '', SPENDING_STATUSES)
  const page = await context.client().spendings.list({
    ...pageOf(args),
    ...(q === undefined ? {} : { q }),
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
  })
  return {
    summary: lines(
      pageLine('költség', page),
      ...page.data.map(
        (spending) =>
          `#${spending.id ?? '?'} ${spending.invoiceNumber ?? ''}: ${spending.partner?.name ?? 'partner nélkül'}, bruttó ${money(spending.totalGross ?? 0, spending.currency ?? 'HUF')}, kelte: ${spending.invoiceDate ?? '?'}`,
      ),
    ),
    data: {
      spendings: page.data.map((spending) => plainJson(spending)),
      total: page.total,
      currentPage: page.currentPage,
      lastPage: page.lastPage,
    },
  }
}

async function getSpending(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['id'], '')
  const id = requiredId(args, 'id', '')
  const spending = await nullIfNotFound(context.client().spendings.get(id))
  if (!spending) return { summary: `Nincs ${id} azonosítójú költség.`, data: { found: false } }
  return {
    summary: `Költség #${id}: ${spending.invoiceNumber ?? ''}, bruttó ${money(spending.totalGross ?? 0, spending.currency ?? 'HUF')}, kelte: ${spending.invoiceDate ?? '?'}.`,
    data: { found: true, spending: plainJson(spending) },
  }
}

function formatAddress(address: TaxpayerAddress): string {
  return [
    address.postalCode,
    address.city,
    [address.streetName, address.publicPlaceCategory, address.number].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
}

async function checkTaxNumber(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['taxNumber'], '')
  const taxNumber = requiredString(args, 'taxNumber', '')
  const result = await context.client().utils.checkTaxNumber(taxNumber)
  const headquarters = result.addresses?.find((address) => address.type === 'HQ')
  return {
    summary:
      result.result === 'validation_ok'
        ? lines(
            `${result.taxpayerName ?? 'Ismeretlen név'} (${result.taxNumber}): a NAV szerint érvényes adószám.`,
            headquarters && `Székhely: ${formatAddress(headquarters)}.`,
          )
        : `A NAV válasza a(z) ${result.taxNumber} adószámra: ${result.result}.`,
    data: plainJson(result),
  }
}

async function conversionRate(args: JsonObject, context: McpToolContext): Promise<McpToolOutput> {
  assertKnownKeys(args, ['from', 'to', 'date'], '')
  const from = optionalEnum(args, 'from', '', CURRENCIES)
  const to = optionalEnum(args, 'to', '', CURRENCIES) ?? 'HUF'
  const date = optionalDate(args, 'date', '')
  if (from === undefined) {
    throw new ToolInputError('A from mező kötelező (például EUR).', { fields: ['from'] })
  }
  const rate = await context
    .client()
    .currencies.rate({ from, to, ...(date === undefined ? {} : { date }) })
  return {
    summary: `1 ${rate.from} = ${rate.rate} ${rate.to}${rate.date ? ` (${rate.date})` : ''}.`,
    data: plainJson(rate),
  }
}

const PAGED = (properties: Readonly<Record<string, JsonObject>>): JsonObject =>
  objectSchema({ ...properties, ...PAGE_PROPERTIES })

const ID_ONLY = (description: string): JsonObject =>
  objectSchema({ id: { ...ID_PROPERTY, description } }, ['id'])

function tool(
  name: string,
  title: string,
  description: string,
  inputSchema: JsonObject,
  run: McpTool['run'],
): McpTool {
  return { name, title, description, inputSchema, annotations: REMOTE_READ, write: false, run }
}

export const LOOKUP_TOOLS: readonly McpTool[] = [
  tool(
    'get_profile',
    'Billingo profil',
    'Egy lépésben megmutatja a Billingo céget: teszt vagy éles profil (becslés: a Billingónak nincs teszt jelzője), NAV-kapcsolat, előfizetés és lejárat, a számlatömbök és a bankszámlák (számlaszám nélkül), valamint a szerver alapbeállításai. Érdemes ezzel kezdeni.',
    objectSchema({}),
    getProfile,
  ),
  tool(
    'list_documents',
    'Bizonylatok listája',
    'Bizonylatok listája a legújabbal kezdve, szűrőkkel. A frissen kiállított bizonylat 15–30 másodpercig még hiányozhat a listából; vendorId-ra a get_document keres azonnal.',
    PAGED({
      type: {
        type: 'string',
        enum: [...DOCUMENT_LIST_TYPES],
        description: 'invoice (minden, ami nem nyugta) vagy receipt (nyugta).',
      },
      paymentStatus: {
        type: 'string',
        enum: [...PAYMENT_STATUSES],
        description: 'Fizetési állapot.',
      },
      partnerId: { ...ID_PROPERTY, description: 'Csak ennek a partnernek a bizonylatai.' },
      blockId: { ...ID_PROPERTY, description: 'Csak ennek a tömbnek a bizonylatai.' },
      startDate: { ...DATE_PROPERTY, description: 'Kelte legkorábban.' },
      endDate: { ...DATE_PROPERTY, description: 'Kelte legkésőbb.' },
      query: { ...TEXT_PROPERTY, description: 'Keresés, például bizonylatszámra.' },
    }),
    listDocuments,
  ),
  tool(
    'get_document',
    'Bizonylat lekérdezése',
    'Egy bizonylat azonosító (id) vagy vendorId alapján, pontosan az egyikkel. Kérésre a befizetéseit, a NAV-állapotát és a nyilvános letöltési linkjét is lekéri (mindegyik külön kérés). Ismeretlen id-re a Billingo 403-at ad: ezt „nincs ilyen bizonylat” eredményként adja vissza.',
    objectSchema({
      id: { ...ID_PROPERTY, description: 'A bizonylat azonosítója.' },
      vendorId: { ...TEXT_PROPERTY, description: 'A kiállításkor megadott saját azonosító.' },
      includePayments: { type: 'boolean', description: 'A befizetések listája is.' },
      includeNavStatus: { type: 'boolean', description: 'A NAV Online Számla állapot is.' },
      includePublicUrl: {
        type: 'boolean',
        description: 'Nyilvános link, amelyen a PDF bejelentkezés nélkül letölthető.',
      },
    }),
    getDocument,
  ),
  tool(
    'list_partners',
    'Partnerek listája',
    'Partnerek név szerint rendezve. A query csak a partner nevének szavai elejére keres (kis- és nagybetű mindegy), az adószámra és az e-mail címre nem. A frissen létrehozott vagy átnevezett partnert a Billingo keresője kb. egy percig nem látja.',
    PAGED({ query: { ...TEXT_PROPERTY, description: 'A név szavainak eleje.' } }),
    listPartners,
  ),
  tool(
    'get_partner',
    'Partner lekérdezése',
    'Egy partner minden adata.',
    ID_ONLY('A partner azonosítója.'),
    getPartner,
  ),
  tool(
    'list_products',
    'Termékek listája',
    'Termékek, a query a névben keres.',
    PAGED({ query: { ...TEXT_PROPERTY, description: 'Keresés a termék nevében.' } }),
    listProducts,
  ),
  tool(
    'get_product',
    'Termék lekérdezése',
    'Egy termék minden adata, kérésre a készlettel együtt (ehhez a Billingóban bekapcsolt készletkezelés kell).',
    objectSchema(
      {
        id: { ...ID_PROPERTY, description: 'A termék azonosítója.' },
        includeStock: { type: 'boolean', description: 'A készlet is.' },
      },
      ['id'],
    ),
    getProduct,
  ),
  tool(
    'list_spendings',
    'Költségek listája',
    'Költségek (bejövő számlák) listája szűrőkkel.',
    PAGED({
      q: { ...TEXT_PROPERTY, description: 'Keresés.' },
      startDate: { ...DATE_PROPERTY, description: 'Kelte legkorábban.' },
      endDate: { ...DATE_PROPERTY, description: 'Kelte legkésőbb.' },
      paymentStatus: {
        type: 'string',
        enum: [...SPENDING_STATUSES],
        description: 'Fizetési állapot.',
      },
    }),
    listSpendings,
  ),
  tool(
    'get_spending',
    'Költség lekérdezése',
    'Egy költség minden adata.',
    ID_ONLY('A költség azonosítója.'),
    getSpending,
  ),
  tool(
    'check_tax_number',
    'Adószám ellenőrzése',
    'A NAV adatai alapján (a Billingón keresztül) ellenőrzi a magyar adószámot, és visszaadja a cég nevét és címét. Élő NAV-kapcsolat kell hozzá: fejlesztői teszt profilon mindig nav_unavailable hibát ad, ez nem kulcshiba.',
    objectSchema(
      {
        taxNumber: {
          ...TEXT_PROPERTY,
          description: 'Teljes adószám NNNNNNNN-N-NN formában, például 12345678-2-42.',
        },
      },
      ['taxNumber'],
    ),
    checkTaxNumber,
  ),
  tool(
    'get_conversion_rate',
    'Árfolyam',
    'A Billingo árfolyama két pénznem között, például devizás számlához (conversionRate).',
    objectSchema(
      {
        from: { ...CURRENCY_PROPERTY, description: 'Miből, például EUR.' },
        to: { ...CURRENCY_PROPERTY, description: 'Mibe, alapértelmezés: HUF.' },
        date: { ...DATE_PROPERTY, description: 'Melyik nap árfolyama, alapértelmezés: ma.' },
      },
      ['from'],
    ),
    conversionRate,
  ),
]
