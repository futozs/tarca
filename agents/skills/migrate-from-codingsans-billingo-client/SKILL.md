---
name: migrate-from-codingsans-billingo-client
description: Migrate a codebase from the @codingsans/billingo-client npm package to tarca. Use when the user asks to replace, upgrade or migrate away from @codingsans/billingo-client, or when code imports OpenAPI, DocumentService, PartnerService or another *Service class from '@codingsans/billingo-client' and the user wants tarca instead.
---

# Migrate from @codingsans/billingo-client to tarca

Read `node_modules/tarcajs/agents/pitfalls.md` and `node_modules/tarcajs/agents/api.md` first.

`@codingsans/billingo-client` 2.1.0 is generated from the Billingo spec 3.0.14: static service classes, a global `OpenAPI` config, snake_case models, `axios` and `form-data` required at runtime but not declared as dependencies. tarca is one client object per API key, camelCase in and out, zero dependencies.

## Find the usage

Search for `from '@codingsans/billingo-client'`, `require('@codingsans/billingo-client')`, `OpenAPI.HEADERS`, `OpenAPI.BASE`, `OpenAPI.TOKEN`, `ApiError`, `CancelablePromise` and the ten services: `BankAccountService`, `CurrencyService`, `DocumentService`, `DocumentBlockService`, `DocumentExportService`, `OrganizationService`, `PartnerService`, `ProductService`, `SpendingService`, `UtilService`. List every call site to the user before editing. The method names below come from the package's `lib/client/services/*.d.ts` (2.1.0); if the installed version differs, read its `.d.ts` files and adapt the table.

## Mapping

| @codingsans/billingo-client | tarca |
|---|---|
| `OpenAPI.HEADERS = { 'X-API-KEY': key }`, `OpenAPI.BASE` | one shared `createTarca({ apiKey, baseUrl? })` per API key (or `BILLINGO_API_KEY`) |
| `BankAccountService.listBankAccount(page, perPage)` | `tarca.bankAccounts.list({ page, perPage })`, or `all()` to iterate every page |
| `createBankAccount(body)`, `getBankAccount(id)`, `updateBankAccount(id, body)`, `deleteBankAccount(id)` | `bankAccounts.create(input)`, `get(id)`, `update(id, input)` (full replace), `delete(id)` |
| `CurrencyService.getConversionRate(from, to, date?)` | `currencies.rate({ from, to, date? })` → `{ from, to, rate, date }` |
| `DocumentBlockService.listDocumentBlock(page, perPage, type)` | `documentBlocks.list({ page, perPage, type })`; tarca also has `get`, `create`, `update`, `delete` |
| `DocumentExportService.create(body)`, `poll(id)`, `download(id)` | `exports.create(input)`, `poll(id)`, `download(id)`, or `exports.run(input)` for all three with waiting |
| `DocumentService.listDocument(page, perPage, blockId, partnerId, …)` (19 positional arguments) | `documents.list({ page, perPage, blockId, partnerId, paymentStatus, startDate, … })` with named filters, or `all()` |
| `DocumentService.createDocument(body)` | `documents.createOnce({ vendorId, partner, items, … })`; `createRaw(insert)` only when the user must keep a raw `DocumentInsert` |
| `DocumentService.createReceipt(body)` | `receipts.createOnce({ vendorId, items, … })` |
| `createReceiptFromDraft(id, body)`, `createDocumentFromDraft(id, body)` | `receipts.finalizeDraft(id, input)`, `documents.finalizeDraft(id, input)` |
| `getDocumentByVendorId(vendorId)` | `documents.getByVendorId(vendorId)`, or `findByVendorId(vendorId)` which resolves `null` on 404 |
| `getDocument(id)` | `documents.get(id)`; an unknown id answers 403 (`forbidden`), not 404 |
| `deleteDocument(id)`, `archiveDocument(id)`, `documentCopy(id)` | `documents.deleteDraft(id)`, `archive(id)`, `copy(id)` |
| `cancelDocument(id, body?)` | `documents.cancel(id, { reason?, recipients? })` |
| `createDocumentFromProforma(id, body?)`, `createModificationDocument(id, body)` | `documents.createFromProforma(id, input?)`, `documents.createModification(id, input)` |
| `downloadDocument(id)` (`Blob`, or `ClientError` while the PDF is not ready) | `documents.pdf(id)` → `{ bytes, contentType, filename }`; it waits for Billingo's 202 itself |
| `posPrint(id, size)` | `documents.posPdf(id, { size })` |
| `getPublicUrl(id)` → `{ public_url }` | `documents.publicUrl(id)` → the URL string |
| `getOnlineSzamlaStatus(id)` | `documents.navStatus(id)` (`null` while Billingo has no NAV record yet) |
| `getPayment(id)`, `updatePayment(id, body)`, `deletePayment(id)` | `documents.payments.list(id)`, `replace(id, payments)` (full replace), `clear(id)`; `add(id, payment)` appends |
| `sendDocument(id, body?)` | `documents.send(id, { emails })` |
| `OrganizationService.getOrganizationData()` | `organization.get()`; `verifyCredentials()` to check the key |
| `PartnerService.listPartner(page, perPage, query)`, `createPartner`, `getPartner`, `updatePartner`, `deletePartner` | `partners.list({ query, page, perPage })`, `create`, `get`, `update` (full replace), `delete`; `partners.findOrCreate(input)` for invoicing |
| `ProductService.listProduct(page, perPage, query)`, `createProduct`, `getProduct`, `updateProduct`, `deleteProduct` | `products.list`, `create`, `get`, `update`, `delete` (exactly one of `netUnitPrice` / `grossUnitPrice`) |
| `SpendingService.spendingList(q, page, perPage, …)`, `spendingSave`, `spendingShow`, `spendingUpdate`, `spendingDelete` | `spendings.list({ q, … })`, `create`, `get`, `update`, `delete` |
| `UtilService.checkTaxNumber(taxNumber)`, `getId(id)`, `getServerTime()` | `utils.checkTaxNumber(taxNumber)`, `utils.convertLegacyId(id)`, `utils.serverTime()` |
| snake_case models (`partner_id`, `block_id`, `gross_total`) | camelCase (`partnerId`, `blockId`, `grossTotal`); types from `import type { Billingo } from 'tarcajs'` |
| `ApiError` (`status`, `body`) | `BillingoError`: branch on `category`, log `traceId`, read `fieldErrors` for 422 |
| `CancelablePromise#cancel()` | `options.signal` (an `AbortSignal`) as the last argument of every method |

## Rules while migrating

1. Create one tarca client per API key and share it (`export const tarca = createTarca()`). The global `OpenAPI` config allowed one Billingo company per process; with tarca a second company is a second `createTarca({ apiKey })`. Remove every write to `OpenAPI.*`.
2. Every `DocumentService.createDocument` and `createReceipt` becomes `documents.createOnce` / `receipts.createOnce` with a stable `vendorId` derived from the user's order or payment ID. Ask the user when no stable ID exists; never invent a random one, because a retried request would then issue a second document that is reported to NAV.
3. Delete custom retry loops, `p-retry` wrappers and queue redelivery around creates. tarca retries only GET requests and recovers uncertain create failures through the `vendorId`.
4. Replace hand-built `DocumentInsert` bodies with tarca's input where it is simpler: `partner` can be an object (tarca finds or creates the partner), `blockId` defaults to the first invoice block, VAT can be a number (`27` → `'27%'`). Keep `netUnitPrice` or `grossUnitPrice` exactly as the user had it (`unit_price` with `unit_price_type: 'net'` or `'gross'`); never convert prices by hand.
5. Convert snake_case field access to camelCase everywhere the result is read (`document.gross_total` → `document.grossTotal`, `public_url` → the returned string).
6. Replace `catch (error) { if (error instanceof ApiError && error.status === …) }` and message parsing with `isBillingoError(error)` and `error.category` (`auth`, `validation`, `forbidden`, `subscription`, `rate_limit`, …). Keep `error.traceId` in logs; Billingo support asks for it.
7. Replace PDF download code that polls or retries `downloadDocument` with `documents.pdf(id)`; it returns a `Uint8Array`, not a `Blob`. Use `new Response(pdf.bytes)` or `Buffer.from(pdf.bytes)` where the old code needed a body or a buffer.
8. Update tests to `createMockTarca()` or `createFakeBillingoFetch()` from `tarcajs/testing` instead of mocking the static services or axios.
9. Remove `@codingsans/billingo-client` from `package.json` only after every call site is migrated. Remove `axios` and `form-data` only after the user confirms nothing else in the project uses them (they were often installed only to satisfy this package).
