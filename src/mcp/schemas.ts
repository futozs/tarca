import { CURRENCIES, DOCUMENT_LANGUAGES, PAYMENT_METHODS, RECEIPT_VATS } from '../documents/enums'
import { MAX_EMAILS, MAX_TOOL_ITEMS, MCP_DOCUMENT_TYPES, MCP_TAX_TYPES } from './inputs'
import type { JsonObject } from './protocol'

const TEXT: JsonObject = { type: 'string', minLength: 1 }

export const ID_PROPERTY: JsonObject = { type: 'integer', minimum: 1 }

export const DATE_PROPERTY: JsonObject = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'Dátum ÉÉÉÉ-HH-NN formában (Europe/Budapest szerint).',
}

export const PAYMENT_METHOD_PROPERTY: JsonObject = {
  type: 'string',
  enum: [...PAYMENT_METHODS],
  description:
    'Fizetési mód Billingo kóddal, például wire_transfer (átutalás), cash (készpénz), bankcard (bankkártya).',
}

export const CURRENCY_PROPERTY: JsonObject = {
  type: 'string',
  enum: [...CURRENCIES],
  description: 'Pénznem, alapértelmezés: HUF.',
}

export const EMAILS_PROPERTY: JsonObject = {
  type: 'array',
  items: { ...TEXT, description: 'E-mail cím.' },
  minItems: 1,
  maxItems: MAX_EMAILS,
}

const VAT: JsonObject = {
  description:
    'Áfakulcs: szám (például 27, 18, 5, 0, 5.5) vagy Billingo kód (például "27%", "AAM" alanyi adómentes, "TAM" tárgyi adómentes, "EU", "EUK", "F.AFA", "K.AFA").',
  anyOf: [{ type: 'number' }, { type: 'string', minLength: 1 }],
}

const RECEIPT_VAT: JsonObject = {
  description: `Nyugta áfakulcsa: ${RECEIPT_VATS.join(', ')} (5, 18, 27 számként is).`,
  anyOf: [{ type: 'number' }, { type: 'string', minLength: 1 }],
}

export function objectSchema(
  properties: Readonly<Record<string, JsonObject>>,
  required: readonly string[] = [],
): JsonObject {
  return { type: 'object', properties, required: [...required], additionalProperties: false }
}

const QUANTITY: JsonObject = { type: 'number', description: 'Mennyiség, alapértelmezés: 1.' }

const DOCUMENT_ITEM: JsonObject = objectSchema({
  name: { ...TEXT, description: 'A tétel megnevezése.' },
  quantity: QUANTITY,
  unit: { ...TEXT, description: 'Mennyiségi egység, alapértelmezés: db.' },
  netUnitPrice: {
    type: 'number',
    description: 'Nettó egységár. A netUnitPrice és a grossUnitPrice közül pontosan egyet adj meg.',
  },
  grossUnitPrice: {
    type: 'number',
    description:
      'Bruttó egységár. A netUnitPrice és a grossUnitPrice közül pontosan egyet adj meg.',
  },
  vat: VAT,
  comment: { ...TEXT, description: 'Megjegyzés a tételhez.' },
  productId: {
    ...ID_PROPERTY,
    description:
      'Meglévő Billingo termék azonosítója. Ekkor a név, az ár és az áfa a termékből jön, csak a quantity és a comment adható meg.',
  },
})

const RECEIPT_ITEM: JsonObject = objectSchema({
  name: { ...TEXT, description: 'A tétel megnevezése.' },
  quantity: QUANTITY,
  unit: { ...TEXT, description: 'Mennyiségi egység, alapértelmezés: db.' },
  grossUnitPrice: { type: 'number', description: 'Bruttó egységár (nyugtán mindig bruttó).' },
  vat: RECEIPT_VAT,
  productId: { ...ID_PROPERTY, description: 'Meglévő Billingo termék azonosítója.' },
})

const PARTNER: JsonObject = objectSchema(
  {
    name: { ...TEXT, description: 'A vevő neve.' },
    address: objectSchema(
      {
        postCode: { ...TEXT, description: 'Irányítószám.' },
        city: { ...TEXT, description: 'Település.' },
        address: { ...TEXT, description: 'Utca, házszám.' },
        countryCode: { ...TEXT, description: 'Kétbetűs országkód, alapértelmezés: HU.' },
      },
      ['postCode', 'city', 'address'],
    ),
    emails: { ...EMAILS_PROPERTY, description: 'A vevő e-mail címei.' },
    taxcode: { ...TEXT, description: 'Adószám, például 12345678-2-42.' },
    taxType: { type: 'string', enum: [...MCP_TAX_TYPES], description: 'Adózási típus.' },
    phone: TEXT,
  },
  ['name', 'address'],
)

const PARTNER_ID: JsonObject = {
  ...ID_PROPERTY,
  description:
    'Meglévő partner azonosítója (list_partners). A partnerId és a partner közül egyet adj meg.',
}

const PARTNER_DESCRIPTION =
  'Új vagy meglévő vevő név és cím alapján. A tárca megkeresi: ha minden megadott mezőben egyezik egy meglévő partnerrel, azt használja, különben újat hoz létre.'

const VENDOR_ID: JsonObject = {
  ...TEXT,
  description:
    'Saját egyedi azonosító (például rendelésszám). Egy vendorId-val csak egy bizonylat készül. Ha nem adod meg, a tárca a bemenetből és a napból képez egyet.',
}

export const CONFIRMATION_PROPERTY: JsonObject = {
  ...TEXT,
  description:
    'Az előnézeti eszköz által adott megerősítő kód. Csak azután add meg, hogy a felhasználó jóváhagyta az előnézetet.',
}

export const TEXT_PROPERTY: JsonObject = TEXT

const DOCUMENT_PROPERTIES: Readonly<Record<string, JsonObject>> = {
  type: {
    type: 'string',
    enum: [...MCP_DOCUMENT_TYPES],
    description:
      'invoice (számla, alapértelmezés), proforma (díjbekérő) vagy advance (előlegszámla).',
  },
  vendorId: VENDOR_ID,
  partnerId: PARTNER_ID,
  partner: { ...PARTNER, description: PARTNER_DESCRIPTION },
  items: { type: 'array', items: DOCUMENT_ITEM, minItems: 1, maxItems: MAX_TOOL_ITEMS },
  blockId: { ...ID_PROPERTY, description: 'Számlatömb azonosítója (get_profile).' },
  bankAccountId: { ...ID_PROPERTY, description: 'Bankszámla azonosítója (get_profile).' },
  fulfillmentDate: { ...DATE_PROPERTY, description: 'Teljesítés dátuma, alapértelmezés: ma.' },
  dueDate: { ...DATE_PROPERTY, description: 'Fizetési határidő. A dueInDays helyett.' },
  dueInDays: {
    type: 'integer',
    minimum: 0,
    description: 'Fizetési határidő napokban mától, alapértelmezés: 8.',
  },
  paymentMethod: PAYMENT_METHOD_PROPERTY,
  language: {
    type: 'string',
    enum: [...DOCUMENT_LANGUAGES],
    description: 'A bizonylat nyelve, alapértelmezés: hu.',
  },
  currency: CURRENCY_PROPERTY,
  conversionRate: {
    type: 'number',
    description: 'Árfolyam nem forintos bizonylathoz (get_conversion_rate).',
  },
  electronic: { type: 'boolean', description: 'Elektronikus számla.' },
  comment: { ...TEXT, description: 'Megjegyzés a bizonylaton.' },
  orderNumber: { ...TEXT, description: 'Rendelésszám (a bizonylaton megjelenik).' },
  sendEmail: {
    type: 'boolean',
    description: 'A Billingo e-mailben elküldi-e a vevőnek. Alapértelmezés: false.',
  },
  advanceInvoiceIds: {
    type: 'array',
    items: ID_PROPERTY,
    description: 'Végszámlánál a beszámított előlegszámlák azonosítói.',
  },
}

const RECEIPT_PROPERTIES: Readonly<Record<string, JsonObject>> = {
  vendorId: VENDOR_ID,
  partnerId: PARTNER_ID,
  partner: { ...PARTNER, description: PARTNER_DESCRIPTION },
  name: { ...TEXT, description: 'A vevő neve a nyugtán (partner nélkül).' },
  emails: { ...EMAILS_PROPERTY, description: 'Címek az elektronikus nyugtához.' },
  blockId: { ...ID_PROPERTY, description: 'Nyugtatömb azonosítója (get_profile).' },
  paymentMethod: { ...PAYMENT_METHOD_PROPERTY, description: 'Fizetési mód, alapértelmezés: cash.' },
  currency: CURRENCY_PROPERTY,
  conversionRate: { type: 'number', description: 'Árfolyam nem forintos nyugtához.' },
  electronic: {
    type: 'boolean',
    description:
      'Elektronikus nyugta (true) vagy papíron átadott (false). Kötelező: a Billingo minden nyugtánál kéri.',
  },
  items: { type: 'array', items: RECEIPT_ITEM, minItems: 1, maxItems: MAX_TOOL_ITEMS },
}

export const DOCUMENT_SCHEMA: JsonObject = objectSchema(DOCUMENT_PROPERTIES, ['items'])

export const CREATE_DOCUMENT_SCHEMA: JsonObject = objectSchema(
  { ...DOCUMENT_PROPERTIES, confirmation: CONFIRMATION_PROPERTY },
  ['items', 'confirmation'],
)

export const RECEIPT_SCHEMA: JsonObject = objectSchema(RECEIPT_PROPERTIES, ['items', 'electronic'])

export const CREATE_RECEIPT_SCHEMA: JsonObject = objectSchema(
  { ...RECEIPT_PROPERTIES, confirmation: CONFIRMATION_PROPERTY },
  ['items', 'electronic', 'confirmation'],
)

export const PAGE_PROPERTIES: Readonly<Record<string, JsonObject>> = {
  page: { type: 'integer', minimum: 1, description: 'Oldalszám, alapértelmezés: 1.' },
  perPage: {
    type: 'integer',
    minimum: 1,
    maximum: 100,
    description: 'Elemek oldalanként, alapértelmezés: 25, legfeljebb 100.',
  },
}
