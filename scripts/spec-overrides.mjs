const PROBE_DAY = '2026-11-15'

function probe(...refs) {
  return refs.map((ref) => ({ source: 'probe', ref, date: PROBE_DAY }))
}

const BINARY = { type: 'string', format: 'binary' }
const BLOCK = { $ref: '#/components/schemas/DocumentBlockSchema' }
const ID_PARAMETER = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }
const UNAUTHORIZED = { $ref: '#/components/responses/Unauthorized' }
const UNAUTHORIZED_EVIDENCE = {
  source: 'route-probe',
  ref: 'kulcs nélküli útvonal-próba: 401, nem 404 (kezdo-docs/12, R)',
  date: PROBE_DAY,
}

function paginationUrls(schema, reason, evidence) {
  return {
    kind: 'nullable',
    schema,
    properties: ['prev_page_url', 'next_page_url'],
    reason,
    evidence,
  }
}

const EDGE_PAGES =
  'Az első és az utolsó oldalon a lapozó URL null, a spec nem nullable stringet ír.'

export const SPEC_OVERRIDES = [
  paginationUrls('BankAccountList', EDGE_PAGES, [
    ...probe('138-bank-accounts-list.json'),
    { source: 'mcp', ref: 'tests/fixtures/live/bank_accounts.json', date: '2026-10-14' },
    { source: 'e2e', ref: 'npm run e2e, ListBankAccount (2 figyelmeztetés)', date: PROBE_DAY },
  ]),
  paginationUrls(
    'DocumentBlockList',
    EDGE_PAGES,
    probe('007-blocks-list.json', '132-blocks-list-before-delete-probe.json'),
  ),
  paginationUrls(
    'DocumentList',
    EDGE_PAGES,
    probe('078-documents-list-payment-status-paid.json', '102-documents-list-block-id.json'),
  ),
  paginationUrls(
    'PartnerList',
    EDGE_PAGES,
    probe('026-partner-list-query-full-name.json', '044-partner-list-query-runid-later.json'),
  ),
  paginationUrls('ProductList', EDGE_PAGES, probe('013-product-list-query-runid.json')),
  paginationUrls(
    'SpendingList',
    EDGE_PAGES,
    probe('021-spending-list-q-number.json', '022-spending-list-date-filters.json'),
  ),
  {
    kind: 'nullable',
    schema: 'Document',
    properties: ['discount', 'recurring_id'],
    reason: 'Kedvezmény és ismétlődés nélküli bizonylaton mindkettő null.',
    evidence: probe('064-document-create-invoice-i1.json', '066-document-get-i1.json'),
  },
  {
    kind: 'nullable',
    schema: 'DocumentItem',
    properties: ['entitlement', 'sku', 'ean', 'data_eraser_codes'],
    reason: 'Termék nélküli tételen ezek a mezők null értékkel jönnek.',
    evidence: probe('064-document-create-invoice-i1.json', '066-document-get-i1.json'),
  },
  {
    kind: 'nullable',
    schema: 'PartnerCustomBillingSettings',
    properties: ['due_days', 'document_currency'],
    reason: 'Egyedi számlázási beállítás nélküli partneren mindkettő null.',
    evidence: probe('002-partner-create-a.json', '004-partner-get-a.json'),
  },
  {
    kind: 'nullable',
    schema: 'Product',
    properties: ['entitlement', 'connect_product_id', 'purchase_price'],
    reason: 'A meg nem adott jogcím, kapcsolt termék és beszerzési ár null.',
    evidence: probe('011-product-create.json', '012-product-get.json', '014-product-put-full.json'),
  },
  {
    kind: 'nullable',
    schema: 'Spending',
    properties: ['partner'],
    reason: 'Partner nélküli költség létrehozásakor a partner null.',
    evidence: probe('019-spending-create.json'),
  },
  {
    kind: 'nullable',
    schema: 'SpendingShow',
    properties: ['partner'],
    reason: 'Partner nélküli költség lekérésekor a partner null.',
    evidence: probe('020-spending-get.json'),
  },
  {
    kind: 'nullable',
    schema: 'SpendingListItem',
    properties: ['partner'],
    reason: 'A költséglistában a partner nélküli tétel partnere null.',
    evidence: probe('022-spending-list-date-filters.json'),
  },
  {
    kind: 'nullable',
    schema: 'DocumentBlockSchema',
    properties: ['pic_path', 'bank_account_id'],
    reason: 'Logó és bankszámla nélküli tömbön mindkettő null.',
    evidence: probe(
      '047-block-create-tarca-e2e-space.json',
      '049-block-get.json',
      '134-block-create-for-delete.json',
    ),
  },
  {
    kind: 'rename',
    schema: 'SpendingShow',
    from: 'is_created_by_nav',
    to: 'created_by_nav',
    reason: 'A költség lekérésekor a mező neve created_by_nav, a spec is_created_by_nav-ot ír.',
    evidence: [
      ...probe('020-spending-get.json'),
      { source: 'mcp', ref: 'tests/fixtures/live/spending.json', date: '2026-10-14' },
    ],
  },
  {
    kind: 'rename',
    schema: 'SpendingListItem',
    from: 'is_created_by_nav',
    to: 'created_by_nav',
    reason: 'A költséglista elemeiben a mező neve created_by_nav, a spec is_created_by_nav-ot ír.',
    evidence: [
      ...probe('022-spending-list-date-filters.json'),
      { source: 'mcp', ref: 'tests/fixtures/live/spendings.json', date: '2026-10-14' },
    ],
  },
  {
    kind: 'required',
    schema: 'ReceiptInsert',
    properties: ['electronic'],
    reason: 'Az electronic nélküli nyugtára 422 jön, a spec opcionálisnak írja (alapértéke false).',
    evidence: [
      {
        source: 'mcp',
        ref: 'tests/live/behaviour.test.ts: billingo_create_receipt: electronic is required',
        date: PROBE_DAY,
      },
    ],
  },
  {
    kind: 'required',
    schema: 'SpendingSave',
    properties: ['conversion_rate', 'invoice_number', 'invoice_date', 'due_date'],
    reason: 'Ezek nélkül a költségre 422 jön, forintos költségnél is.',
    evidence: probe('018-spending-create-base-only.json'),
  },
  {
    kind: 'required',
    schema: 'Partner',
    properties: ['name', 'address'],
    reason:
      'Név és cím nélkül a partnerre 422 jön; a 3.0.15 Partner sémájának nincs required listája.',
    evidence: probe('031-partner-guess-empty.json'),
  },
  {
    kind: 'required',
    schema: 'DocumentBlockSchema',
    properties: ['name', 'prefix', 'type'],
    reason:
      'Üres törzsre a tömb létrehozása 422: a név és a típus kötelező, az előtagnak jelen kell lennie.',
    evidence: probe('133-block-create-empty.json'),
  },
  {
    kind: 'required',
    schema: 'DocumentInsert',
    properties: ['items'],
    reason: 'Tételek nélkül a bizonylatra 422 jön („The items field is required.”).',
    evidence: probe('083-document-finalize-draft-empty-body.json'),
  },
  {
    kind: 'status',
    operation: 'CreateDocumentFromDraft',
    from: '200',
    to: '201',
    reason: 'A piszkozat véglegesítése 201-et ad, a spec 200-at ír.',
    evidence: probe('084-document-finalize-draft-full.json'),
  },
  {
    kind: 'status',
    operation: 'CreateReceiptFromDraft',
    from: '200',
    to: '201',
    reason: 'A nyugta piszkozat véglegesítése 201-et ad, a spec 200-at ír.',
    evidence: probe('097-receipt-finalize-draft.json'),
  },
  {
    kind: 'response',
    operation: 'GetDocumentByVendorId',
    status: '404',
    response: { $ref: '#/components/responses/NotFound' },
    reason:
      'Ismeretlen vendor_id-ra 404 „Document is not found.” jön, a spec nem dokumentál 404-et; erre épül a findByVendorId és a createOnce.',
    evidence: [
      {
        source: 'mcp',
        ref: 'tests/fixtures/live/document_vendor_missing.json',
        date: '2026-10-14',
      },
      {
        source: 'e2e',
        ref: 'npm run e2e, bizonylatok: kiállítás, findByVendorId hiányzó vendorId-ra null',
        date: PROBE_DAY,
      },
    ],
  },
  {
    kind: 'response',
    operation: 'GetDocument',
    status: '403',
    response: { $ref: '#/components/responses/Forbidden' },
    reason:
      'A törölt piszkozat lekérése 403 („You do not have permission… Or any ID in request is invalid…”), nem 404; a spec 403-at nem dokumentál.',
    evidence: [
      {
        source: 'e2e',
        ref: 'npm run e2e, bizonylatok: kiállítás, a törölt piszkozat lekérése',
        date: PROBE_DAY,
      },
    ],
  },
  {
    kind: 'content',
    operation: 'CreateDocumentBlock',
    status: '201',
    mediaType: 'application/json',
    schema: BLOCK,
    reason: 'A tömb létrehozása a teljes tömböt adja vissza, a spec törzs nélküli 201-et ír.',
    evidence: probe('047-block-create-tarca-e2e-space.json', '134-block-create-for-delete.json'),
  },
  {
    kind: 'content',
    operation: 'PosPrint',
    status: '200',
    mediaType: 'application/octet-stream',
    replaces: 'application/pdf',
    schema: BINARY,
    reason:
      'A POS PDF tartalomtípusa application/octet-stream (a tartalom PDF), nem application/pdf.',
    evidence: probe('069-pos-print-58.json', '070-pos-print-80.json'),
  },
  {
    kind: 'content',
    operation: 'Download',
    status: '200',
    mediaType: 'text/csv',
    schema: BINARY,
    reason:
      'A CSV export text/csv; charset=UTF-8 tartalomtípussal, BOM-mal jön; a spec csak application/*-ot ír.',
    evidence: probe('108-export-download.json'),
  },
  {
    kind: 'schema',
    name: 'DocumentBlockUpdate',
    basedOn: 'DocumentBlockSchema',
    schema: {
      type: 'object',
      required: ['name', 'prefix', 'type'],
      properties: {
        name: { type: 'string' },
        prefix: { type: 'string' },
        type: { $ref: '#/components/schemas/DocumentBlockType' },
        custom_field1: { type: 'string' },
        custom_field2: { type: 'string' },
        template_id: { type: 'integer' },
        normal_notification_id: { type: 'integer' },
        proforma_notification_id: { type: 'integer' },
        generated: { type: 'boolean' },
        invoice_number_format: { $ref: '#/components/schemas/InvoiceNumberFormat' },
        sender_email: { type: 'string', format: 'email' },
        sender_name: { type: 'string' },
        bcc_email: { type: 'string', format: 'email' },
        create_invoice_from_paid_proforma: { type: 'boolean' },
        fulfillment_date_from_proforma_payment_date: { type: 'boolean' },
        attach_xml_to_invoice_pdf: { type: 'boolean' },
        advance_paid_instant: { type: 'boolean' },
        financial_fulfillment_highlight: {
          $ref: '#/components/schemas/FinancialFulfillmentHighlight',
        },
        entitlements_in_document_comment: { type: 'boolean' },
        bank_account_id: { type: 'integer' },
      },
    },
    reason:
      'A nem dokumentált PUT /document-blocks/{id} teljes csere: name, prefix (jelen) és type kell, a custom_field1/2 írható, a null sender_email és bcc_email 422, ezért kimarad.',
    evidence: probe(
      '050-block-put-full-custom-field.json',
      '052-block-put-minimal.json',
      '055-block-put-non-null-fields.json',
      '057-block-put-required-only.json',
    ),
  },
  {
    kind: 'operation',
    path: '/document-blocks/{id}',
    method: 'get',
    operation: {
      operationId: 'GetDocumentBlock',
      parameters: [ID_PARAMETER],
      responses: {
        200: { content: { 'application/json': { schema: BLOCK } } },
        401: UNAUTHORIZED,
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
    reason:
      'A tömb lekérése működik, de egyik spec sem írja le; ismeretlen vagy törölt tömbre 403 jön.',
    evidence: [
      ...probe('049-block-get.json', '136-block-get-after-delete.json'),
      UNAUTHORIZED_EVIDENCE,
    ],
  },
  {
    kind: 'operation',
    path: '/document-blocks/{id}',
    method: 'put',
    operation: {
      operationId: 'UpdateDocumentBlock',
      parameters: [ID_PARAMETER],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/DocumentBlockUpdate' } },
        },
      },
      responses: {
        200: { content: { 'application/json': { schema: BLOCK } } },
        401: UNAUTHORIZED,
        422: { $ref: '#/components/responses/UnprocessableEntity' },
      },
    },
    reason: 'A tömb módosítása (teljes csere) működik, de egyik spec sem írja le.',
    evidence: [
      ...probe(
        '050-block-put-full-custom-field.json',
        '052-block-put-minimal.json',
        '055-block-put-non-null-fields.json',
        '057-block-put-required-only.json',
      ),
      UNAUTHORIZED_EVIDENCE,
    ],
  },
  {
    kind: 'operation',
    path: '/document-blocks/{id}',
    method: 'delete',
    operation: {
      operationId: 'DeleteDocumentBlock',
      parameters: [ID_PARAMETER],
      responses: {
        204: {},
        401: UNAUTHORIZED,
      },
    },
    reason:
      'A bizonylat nélküli tömb törlése 204, utána a tömb nincs a listában, a lekérése 403; egyik spec sem írja le.',
    evidence: [
      ...probe(
        '135-block-delete-fresh.json',
        '136-block-get-after-delete.json',
        '137-blocks-list-after-delete-probe.json',
      ),
      UNAUTHORIZED_EVIDENCE,
    ],
  },
]
