# tarca API reference

Every Billingo API v3 operation is implemented: all 57 in `BILLINGO_OPERATIONS` (54 documented in the 3.0.14 and 3.0.15 specs, 3 undocumented document block routes verified live). The table at the end maps each operation to its method. Every method takes an optional last argument `options?: { signal?: AbortSignal }` (`pdf`, `posPdf`, `exports.run` and `createOnce` take an options object that extends it). Validation of your input happens before any request: a malformed body is a `validation` `BillingoError` with Hungarian `fieldErrors`; a malformed argument (page, date, `maxWaitMs`) is a `RangeError`.

## createTarca(options?)

```ts
import { createTarca } from 'tarca'

const tarca = createTarca({
  apiKey: process.env.BILLINGO_API_KEY,
  timeoutMs: 30_000,
  maxAttempts: 3,
  retryDelayMs: 1_000,
  hooks: {
    onRequest: (event) => {},
    onResponse: (event) => {},
    onError: (event) => {},
    onComplete: (event) => {},
    onWarning: (warning) => {},
  },
})
```

| Option | Default | Notes |
|---|---|---|
| `apiKey` | `BILLINGO_API_KEY` env | Required one way or the other, otherwise `configuration` error |
| `baseUrl` | `https://api.billingo.hu/v3` | |
| `fetch` | `globalThis.fetch` | Inject for tests or custom transports |
| `timeoutMs` | `30000` | Per attempt; an integer from 1 to 2147483647, anything else is a `configuration` error |
| `maxAttempts` | `3` (cap `5`) | GET only; writes always run once |
| `retryDelayMs` | `1000` | Exponential backoff with ±20% jitter; `Retry-After` wins when larger (up to 60 s) |
| `hooks` | none | Hook errors (a throw, or a rejected promise from an async hook) never break a request; they go to `onWarning`, whose own errors are swallowed |
| `defaults` | see below | Document defaults, validated here: an invalid value is a `configuration` error at `createTarca` time |
| `createOnceLock` | none | Optional cross-process lock for `createOnce` (a `KeyValueStore` with `setIfAbsent`, the same interface as kassza's stores) |

`defaults`: `blockId` (else the first `invoice` block, looked up once per client and cached; a failed lookup is not cached), `receiptBlockId` (else the first `receipt` block), `bankAccountId`, `paymentMethod` (else `'wire_transfer'` for documents and `'cash'` for receipts), `language` (`'hu'`), `currency` (`'HUF'`), `dueInDays` (`8`), `electronic` (`false`), `sendEmail` (`false`, sent as `settings.shouldSendEmail`).

Hook events: `{ operation, method, path, attempt, requestId }`, plus `status`, `durationMs`, `rateLimit` on `onResponse`, `error`, `willRetry` on `onError`, `outcome` on `onComplete`.

## tarca.documents

```ts
const { document, created } = await tarca.documents.createOnce({
  vendorId: 'ORDER-1001',
  partner: { name: 'Vevő Kft.', address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' } },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})
```

- `create(input: DocumentInput): Promise<Billingo.Document>`: `POST /documents`, never retried. `DocumentInput`:
  - `type`: `'invoice'` (default), `'proforma'`, `'advance'` or `'draft'`.
  - `partner`: a partner id, or a `PartnerInput` resolved with `partners.findOrCreate` (see there).
  - `items`: `{ name, quantity, netUnitPrice | grossUnitPrice (exactly one), vat, unit? = 'db', comment?, entitlement?, sku? }` or `{ productId, quantity, comment? }`. `vat` is a number (`27` → `'27%'`, `5.5` → `'5,5%'`, `13.5` → `'13,5%'`, only rates of `Billingo.Vat`) or a Billingo code (`'AAM'`, `'TAM'`, `'EU'`, `'EUK'`, `'F.AFA'`, …).
  - `fulfillmentDate` (default today in Budapest), exactly one of `dueDate` / `dueInDays` (default `defaults.dueInDays`, counted from today, the invoice date Billingo sets), all dates `Date` or `YYYY-MM-DD`.
  - `blockId`, `bankAccountId`, `paymentMethod`, `language`, `currency`, `electronic`: default from `defaults`. A non-HUF `currency` needs `conversionRate` (Billingo answers 422 otherwise).
  - `comment`, `sendEmail` (→ `settings.shouldSendEmail`), `orderNumber` (→ `settings.orderNumber`), `settings` (raw `Billingo.DocumentSettings`, `sendEmail` and `orderNumber` win), `advanceInvoiceIds` (→ `advanceInvoice`), `discountPercent` (→ `discount: { type: 'percent', value }`, not verified live), `vendorId`.
  - Invalid input is a `validation` error with Hungarian `fieldErrors` (`items.0.vat`, `dueDate`, …) before any request.
- `createRaw(insert: Billingo.DocumentInsert)`: sends the generated type as is.
- `createOnce(input & { vendorId }, options?): Promise<{ document, created }>`: exactly-once issuing. `GET /documents/vendor/{vendorId}` first: found → `created: false`. On 404 it issues. After an uncertain failure (`network`, `timeout`, `server`, `unexpected_response`) it looks the vendorId up again (twice, after `recoveryDelayMs`, default 1000 ms and 2000 ms): found → `created: true`, otherwise the original error is rethrown. On 400 `Duplicate vendor id. …` (another process won the race) it looks up again → `created: false`; if those lookups fail, the lookup error is thrown (its own category, for example a retryable `server`, `operation: 'GetDocumentByVendorId'`) with a hint that the document exists and `createOnce` should be called again. Block and partner resolution run before the POST, outside this recovery: their errors are thrown as they are, and `created: true` always means this call sent the POST. Any other 400 (for example the daily write quota) is rethrown untouched. Calls with the same vendorId on the same account and `fetch` in one process share one request (the second gets `created: false`); `createOnceLock` (or `options.lock`) adds a cross-process lock (`lockTtlSeconds` 600, `lockWaitMs` 10 000, then `in_progress`; an unreachable store gives `store_unavailable` unless `lockFailure: 'proceed'`, which warns through `onWarning` with `hook: 'createOnceLock'`). Options: `{ signal?, recoveryDelayMs?, lock?, lockTtlSeconds?, lockWaitMs?, lockFailure? }`. The signal also ends the wait for a shared block lookup and for a joined in-flight call at once. A vendorId of `.` or `..` is a `validation` error without a request (the URL parser would turn the lookup into `GET /documents/`).
- A vendorId stays reserved after the document is cancelled: `createOnce` then returns the cancelled document with `created: false` (check `document.cancelled`), and re-issuing needs a new vendorId. The vendorId space is shared by invoices and receipts.
- `get(id)`. A deleted or unknown id answers 403 (`forbidden`), not 404.
- `getByVendorId(vendorId)` (404 `Document is not found.` → `not_found`), `findByVendorId(vendorId)` (`null` on 404). The vendorId is trimmed and URL-encoded; `.` and `..` are a `RangeError` without a request.
- `list(query?)`, `all(query?)`: every filter of `GET /documents`: `blockId`, `partnerId`, `paymentMethod`, `paymentStatus`, `startDate`/`endDate` (invoice date), `paidStartDate`/`paidEndDate`, `fulfillmentStartDate`/`fulfillmentEndDate` (all `DateInput`), `startNumber`/`endNumber`, `startYear`/`endYear`, `type` (`'invoice'` or `'receipt'`), `query` (finds an invoice number), `lastModifiedDate` (`Date`, or a Budapest `'YYYY-MM-DD HH:MM:SS'` string; Billingo rejects other forms). Newest first. The list is eventually consistent: live, a fresh invoice appeared 15–30 s after issuing.
- `finalizeDraft(id, input)`: `PUT /documents/{id}` with the full body (Billingo answers 201 and keeps the id; `type` default `'invoice'`, not `'draft'`).
- `deleteDraft(id)` → 204. Only drafts can be deleted; issued documents are cancelled.
- Totals are Billingo's. Measured live: per-VAT-rate rounding; a gross-priced line gets `netUnitAmount` = the smallest 6-decimal number above gross/(1+rate) (`1270` at 27% → `1000.000001`, `10` → `7.874016`), its net is the line gross divided back; on a foreign-currency document `netAmountLocal` and `grossAmountLocal` are not rounded (`17104.0215`), `vatAmountLocal` is round(`vatAmount` × rate) and can differ by 1 Ft from the sum of the per-rate `vatRateVatAmountLocal` values (4024 vs 3890 + 135).
- `pdf(id, { maxWaitMs = 30000, signal }?): Promise<{ bytes, contentType, filename }>`: `GET /documents/{id}/download`. Billingo answers 202 while the PDF is being generated (live it was ready 1.6 s after issuing). The transport does not retry a 202; `pdf` waits 1, 2, 4, … s (capped by what is left of `maxWaitMs`, measured on the clock from the start of the call, honouring `signal`), then throws `not_ready` with `status: 202` and the last Billingo message. `maxWaitMs: 0` is one request. `filename` comes from `content-disposition` (`2026-1.pdf`). The bytes must start with `%PDF`, otherwise `unexpected_response`; the content type is never checked.
- `posPdf(id, { size: 58 | 80, signal? })`: `GET /documents/{id}/print/pos?size=…`. Live the content type is `application/octet-stream` while the bytes are a PDF, so only the `%PDF` signature is checked. Another `size` is a `validation` error without a request.
- `publicUrl(id): Promise<string>`: `https://api.billingo.hu/document-access/<token>`.
- `navStatus(id): Promise<Billingo.OnlineSzamlaStatus | null>`. On the developer test profile an issued invoice answers 200 `{ transactionId: '', status: 'no_online_szamla_settings', messages: [{ humanReadableMessage: 'NAV Online Számla összeköttetés nincs beállítva.', … }] }`. Right after issuing (live within ~3 s; after ~17 s there was a record) and for a document never reported, Billingo answers 404 `NavOnlineSzamla is not found.`: there is no NAV record yet, which is not an error, so tarca returns `null`. Any other error is thrown.
- `reminders(id): Promise<Billingo.DocumentReminderEventList>` (`{ sentReminders, upcomingReminders, sentPostalMail }`).
- `send(id, { emails }): Promise<Billingo.SendDocument>`: Billingo e-mails the document to exactly these addresses (at least one, checked locally). The answer echoes them. Never retried.
- `cancel(id, { reason?, recipients? }?): Promise<Billingo.Document>`: `POST /documents/{id}/cancel` (the guide's PUT answers 405). Returns the **cancellation document** (`type: 'cancellation'`, for a receipt `'receipt_cancellation'`, negative totals, a new number in the same block, `relatedDocuments` = the original's related documents plus the original). The original becomes `cancelled: true`, `correctionType: 'canceled'`, `paymentStatus: 'none'`, and its payments are cleared. `recipients` (checked e-mails) is sent comma-joined as `cancellationRecipients`; without input no body is sent. Cancel a final invoice before its advance invoice. After a modification document neither the original nor the modification can be cancelled: Billingo answers 400 `Cannot cancel the document (id:…)`, which tarca rethrows as `validation` with a Hungarian `hint` (every other field kept).
- `copy(id): Promise<Billingo.Document>` → 200: a new **draft** (`invoiceNumber: ''`, same items, comment and dates); finalize it with `finalizeDraft` or delete it with `deleteDraft`.
- `archive(id)`: `PUT /documents/{id}/archive` → 204, for proformas (also after they were converted). Archived proformas disappear from `list`.
- `createFromProforma(id, { fulfillmentDate?, dueDate? | dueInDays?, comment?, documentType?, documentFormat? }?)` → 201: the invoice made from a proforma. It comes back **paid** (`paymentStatus: 'paid'`) with `relatedDocuments` = the proforma. tarca always sends a body (the form verified live): `fulfillmentDate` defaults to today, `dueDate` to today + `defaults.dueInDays`.
- `createModification(id, { items, comment?, dueDate?, paymentMethod?, withoutFinancialFulfillment? })` → 201: a modification document (`type: 'modification'`) whose items are the **differences** (for example `{ name, netUnitPrice: -1000, quantity: 1, vat: 27 }`), item format as in `create`. The original then has `correctionType: 'modified'` and can no longer be cancelled, nor can the modification.
- `payments.list(id): Promise<Billingo.PaymentHistory[]>`: a bare array, each `{ date, price, paymentMethod, voucherNumber, conversionRate }` (live defaults `''` and `1`).
- `payments.replace(id, payments: PaymentInput[])`: `PUT` with a bare array, a **full replace** (omitted payments are deleted). `PaymentInput`: `{ date: DateInput, price, paymentMethod, voucherNumber?, conversionRate? }`, checked locally. The document's `paymentStatus` follows: `partially_paid` below the gross total, `paid` at it.
- `payments.add(id, payment)`: `list` then `replace` with the new payment appended. Not concurrency-safe: two writers on the same document can lose a payment, so let one process write a document's payments.
- `payments.clear(id)`: `DELETE` (live 200 `[]`, the guide says 204); `paymentStatus` goes back to `outstanding`.

## tarca.receipts

- `create(input: ReceiptInput)`: `POST /documents/receipt`. `ReceiptInput`: `type` (`'receipt'` default or `'draft'`), `vendorId?`, `partner?` (id or `PartnerInput`; without one Billingo attaches its shared `Magánszemély` partner), `name?`, `emails?`, `blockId` (default `defaults.receiptBlockId` or the first `receipt` block), `paymentMethod` (default `defaults.paymentMethod` or `'cash'`), `currency`, `conversionRate`, `electronic` (always sent: Billingo requires it), `items: { name, grossUnitPrice, vat, quantity? = 1, unit? = 'db' } | { productId, quantity? = 1 }`. Receipt prices are gross; `vat` is `5`, `18`, `27` or `'none'`, `'AAM'`, `'TAM'`.
- `createOnce(input & { vendorId }, options?)`: the same contract as `documents.createOnce`.
- `finalizeDraft(id, input)`: `PUT /documents/receipt/{id}` (201, same id).
- A receipt is `paymentStatus: 'paid'`, its due date is the issue date, `kobakReceiptStatus` starts `pending`.

## tarca.partners

- `list({ query?, page?, perPage? }): Promise<Page<Billingo.Partner>>`, `all({ query?, perPage? })`. `query` matches the start of the words of the partner **name** only, case-insensitively (`mwhw` finds `TARCA mwhwjef5 Kft`, `hwjef5` does not), never the tax number or the e-mail. Results are sorted by name. Billingo's search index lags: a partner created or renamed less than about a minute ago may be missing, and after a delete `total` and `lastPage` stay stale for minutes while `data` is already right.
- `get(id)`: an unknown or deleted id gives 404 `Partner is not found.` (`not_found`, so `nullIfNotFound` works).
- `create(input: PartnerInput)` → 201. `PartnerInput` is `Billingo.Partner` without `id`. `name` and `address: { postCode, city, address }` are required; `address.countryCode` defaults to `'HU'`. The tax number field is `taxcode` (Billingo's spelling). `taxType` must be uppercase (`'HAS_TAX_NUMBER'`, `'NO_TAX_NUMBER'`, `'FOREIGN'`); anything else is stored as `''`.
- `update(id, replacement: PartnerReplacement)`: PUT is a **full replace**. Every field left out is cleared (`phone` → `''`, `emails` → `[]`), so send the complete partner.
- `delete(id)` → 204. A partner with documents can be deleted too (soft delete: the documents keep their embedded copy of the partner).
- `guess(input)`: `POST /partners/guess` is an **upsert, not a search**. It answers 201 either way. It returns an existing partner only for an exactly equal name (through the same lagging index) and otherwise creates a new one, also when only the tax number or the e-mail matches. The returned `taxType` is always `''`, whatever is stored. Do not use it to look partners up.
- `findOrCreate(input: PartnerInput): Promise<{ partner, created }>`: reuse or create a partner for invoicing. It searches `list({ query: name })` (at most 3 pages of 100, never `guess`) and reuses a partner only when the stored data equals the input on every field the input specifies, nested settings included. Only whitespace (trimmed, collapsed) and e-mail case are normalised; e-mail order counts; fields the input omits are not compared; the default `countryCode: 'HU'` is compared. Otherwise it creates a new partner, so an invoice never shows stale buyer data (a document copies the partner's data when it is issued). Because of the index lag, a partner created less than about a minute earlier may not be found: the result is a harmless duplicate partner, never a wrong invoice. A blank name is a `validation` error without a request.

## tarca.products

- `list({ query?, page?, perPage? }): Promise<Page<Billingo.Product>>`, `all({ query?, perPage? })`. `query` searches the product name.
- `get(id)`: a deleted product gives 404 `Product is not found.` (`not_found`).
- `create(input: ProductInput)` → 201, `update(id, input: ProductInput)` (PUT, **full replace**: an omitted `comment` becomes `''`), `delete(id)` → 204.
- `ProductInput` is `Billingo.Product` without `id`, with **exactly one price**: `netUnitPrice` or `grossUnitPrice`. Billingo derives the other one from `vat` and answers 422 to none or both, so tarca rejects both cases (and a non-finite price) with a `validation` error before sending. A product from `get()` carries both prices: drop one before writing it back.
- Live values: `entitlement`, `connectProductId` and `purchasePrice` can be `null`; the create and update answers give `purchasePrice: null` where `get` and `list` give `0`.

## tarca.inventory

- `quantity(productId): Promise<Billingo.ProductQuantity>` (`{ availableQuantity }`). Without stock tracking (the developer test profile) Billingo answers 400 `Automatic order processing is disabled`; tarca throws a `validation` `BillingoError` with `status: 400`, that `apiMessage`, a Hungarian message and `hint`. The success shape is documented but not verified live.

## tarca.documentBlocks

- `list({ type?, page?, perPage? })`, `all({ type?, perPage? })`: `Page<Billingo.DocumentBlock>` with only `id, name, prefix, customField1, customField2, type`. `type` filters (`'invoice'`, `'receipt'`, …). The order is ascending id (oldest first), not what the spec describes. A fresh test profile has `Számlák` (`invoice`, empty prefix) and `Nyugták` (`receipt`, prefix `NYT`).
- `get(id): Promise<Billingo.DocumentBlockSchema>`: undocumented route, verified live. An unknown or deleted block answers 403 (`forbidden`), not 404.
- `create(input: DocumentBlockInput)` → 201 with the full block (the spec promises no body). `name`, `prefix` (may be `''` but must be present) and `type` are required. The name may contain only letters, digits and spaces (`TARCA E2E` works, `TARCA-E2E` is a 422); tarca rejects anything else with a `validation` error before sending. `customField1/2` are read-only on create; set them with `update`.
- `update(id, replacement: DocumentBlockReplacement)`: undocumented route, verified live. **Full replace**: omitted `customField1/2`, `senderName` and the flags fall back to their defaults. A block from `get()` can be written back (`update(id, { ...block, customField1: 'x' })`): tarca leaves out `id`, `picPath` and every `null` field, because Billingo answers `senderEmail: null` or `bccEmail: null` with 422.
- `delete(id)` → 204: undocumented route, verified live on a block without documents (afterwards `get` answers 403 and the list no longer has it). Deleting a block that holds documents is untested.

## tarca.bankAccounts

- `list({ page?, perPage? }): Promise<Page<Billingo.BankAccount>>`, where `Page<T>` is `{ data, total, perPage, currentPage, lastPage }` and `perPage` is at most 100.
- `all({ perPage? }): AsyncGenerator<Billingo.BankAccount>`
- `get(id)`, `create(input)`, `update(id, input)` (full replace), `delete(id)`
- `input`: `{ name, accountNumber, currency, accountNumberIban?, swift?, needQr? }`

## tarca.spendings

- `list(query?)`, `all(query?)`: `Page<Billingo.SpendingListItem>`. Filters use the spec names: `q`, `spendingDate` (`'invoice_date' | 'fulfillment_date' | 'due_date'`, which date `startDate`/`endDate` filter), `startDate`, `endDate` (`Date` or `YYYY-MM-DD`, Budapest), `paymentStatus` (`'all' | 'paid' | 'unpaid' | 'expired'`), `spendingType` (`'all' | 'manual' | 'nav'`), `categories`, `currencies`, `paymentMethods` (one value each), plus `page`, `perPage`. Verified live: the date range, `categories`, `paymentStatus`. `q` did not find an invoice number; what it searches is unverified.
- `get(id): Promise<Billingo.SpendingShow>` with `createdByNav` (the spec calls it `is_created_by_nav`).
- `create(input: SpendingInput)` → 201 `Billingo.Spending` (no `createdByNav`, `partner: null` without `partnerId`, `items: []`). `update(id, input)` (PUT, full replace: an omitted `comment` becomes `''`), `delete(id)` → 204.
- `SpendingInput` is `Billingo.SpendingSave` with `fulfillmentDate`, `invoiceDate`, `dueDate` and `paidAt?` as `Date` or `YYYY-MM-DD` (Budapest); a malformed or impossible date is a `validation` error with `fieldErrors` and no request. Billingo requires `conversionRate` (also for HUF: `1`), `invoiceNumber`, `invoiceDate` and `dueDate` although the spec marks them optional, so the type requires them. The HUF totals (`totalGrossHuf`, `totalVatAmountHuf`) are stored as sent (`totalGrossLocal`, `totalVatAmountLocal`), not converted.

## tarca.exports

- `create(input: ExportInput): Promise<{ id: string }>`: `POST /document-export`. `ExportInput` is `Billingo.CreateDocumentExport` (`queryType`, `startDate`, `endDate`, `exportType`, optional `documentBlockId`, number range, `paymentMethod`, `sortBy`, `otherOptions`, `filterExtra`) with the dates as `Date` or `YYYY-MM-DD` (a malformed or impossible date is a `validation` error with `fieldErrors` and no request). The id is a UUID string.
- `poll(id): Promise<Billingo.DocumentExportStatus>`: `{ id, state, message }`, `state` is `pending`, `processing`, `success`, `warning` or `fail`.
- `download(id): Promise<{ bytes, contentType, filename }>`: the raw file. `simple_csv` comes as `text/csv; charset=UTF-8`, starts with a UTF-8 BOM, separates fields with `;` and has a Hungarian header row; `filename` comes from `Content-Disposition` (`2026_11_15_15_06_59_export.csv`). tarca never rejects a file for its content type.
- `run(input, { maxWaitMs = 60_000, signal? }): Promise<{ id, state, message, bytes, contentType, filename }>`: create, poll after 1, 2, 4, 8 s and then every 5 s, download on `success` or `warning` (`message` carries the warning). `fail` throws a `server` error with Billingo's message; still running after `maxWaitMs` throws `not_ready` whose message names the id (the export keeps running, fetch it later with `poll` and `download`). The signal aborts the wait immediately. Live, a one-day CSV export was ready 1.7 s after creation.

## tarca.organization

- `get(): Promise<Billingo.OrganizationData>`: `{ taxCode, subscription, hasNavConnection, kobakReceiptFsEnabled, hasSuccessfulNavReceiptSubmission }`.

## tarca.utils

- `serverTime(): Promise<Billingo.ServerTime>`
- `checkTaxNumber(taxNumber: string): Promise<Billingo.TaxNumberCheckResponse>`: NAV lookup through Billingo. The number must be the full `NNNNNNNN-N-NN` form (otherwise a `validation` error without a request). Needs a live NAV connection; on a test profile Billingo answers 401, which tarca reports as category `nav_unavailable` (not `auth`, not retryable).
- `convertLegacyId(legacyId: number): Promise<Billingo.Id>`: v2 ID to v3 ID. Billingo answers every positive number with a deterministic id, also on a fresh test profile.

## tarca.currencies

- `rate({ from, to, date? }): Promise<{ from, to, rate, date }>`: `from`/`to` are `Billingo.Currency`, `date` is a `Date` or `YYYY-MM-DD` (Budapest).

## Helpers

- `tarca.verifyCredentials(): Promise<boolean>`: `false` on `auth`, throws on anything else.
- `nullIfNotFound(promise)`: resolves `null` for a `not_found` error (404), rethrows everything else. Billingo answers 403 (`forbidden`), not 404, for unknown or deleted documents and document blocks, so use `documents.findByVendorId` for documents.
- `toBillingoDate(date | 'YYYY-MM-DD')`, `todayInBudapest()`, `addBudapestDays(date, days)`, `toBudapestDate(date)`, `toBudapestTimestamp(date)`: Europe/Budapest dates.
- `isBillingoError(error)`, `BillingoError` fields: `category`, `status`, `operation`, `apiMessage`, `fieldErrors`, `traceId`, `retryAfterMs`, `rateLimit`, `requestId`, `hint`, `retryable`, `isNotFound`, `cause`.
- Error categories: `auth`, `nav_unavailable` (401 or 403 with Billingo's NAV connection message: the profile has no live NAV connection, the key is fine), `subscription`, `forbidden`, `not_found`, `validation`, `rate_limit`, `server`, `not_ready`, `network`, `timeout`, `configuration`, `unexpected_response` (an empty or non-JSON success body where JSON was expected; on a write the operation may still have happened), `in_progress` (another process holds the `createOnce` lock for this vendorId; call again later) and `store_unavailable` (the `createOnce` lock store failed; nothing was issued). Only `rate_limit`, `server`, `not_ready`, `network` and `timeout` are retryable.
- Exported input types: `DocumentInput`, `DocumentOnceInput`, `DraftFinalizeInput`, `DocumentItemInput` (`NetPricedItemInput`, `GrossPricedItemInput`, `ProductItemInput`), `VatInput`, `DocumentListQuery`, `CancelInput`, `SendInput`, `ModificationInput`, `ProformaConversionInput`, `PaymentInput`, `PdfOptions`, `PosPdfOptions`, `CreateOnceOptions`, `ReceiptInput`, `ReceiptOnceInput`, `ReceiptFinalizeInput`, `ReceiptItemInput`, `PartnerInput`, `PartnerReplacement`, `PartnerListQuery`, `ProductInput`, `ProductListQuery`, `DocumentBlockInput`, `DocumentBlockReplacement`, `DocumentBlockListQuery`, `BankAccountInput`, `SpendingInput`, `SpendingListQuery`, `ExportInput`, `ExportRunOptions`, `ConversionRateQuery`, `TarcaDefaults`, `KeyValueStore`, `PageQuery`, `RequestOptions`.
- `BILLINGO_OPERATIONS`: every Billingo operation (method, path, which spec version documents it).
- `import type { Billingo } from 'tarca'`: every schema of the official spec, camelCase, corrected where the live API differs (fields that come back `null`, `createdByNav` on spendings, fields Billingo requires although the spec marks them optional, and `DocumentBlockUpdate` for the undocumented document block PUT).

## Billingo operations → methods

| operationId | HTTP | tarca |
|---|---|---|
| `ListBankAccount` | `GET /bank-accounts` | `bankAccounts.list()`, `all()` |
| `CreateBankAccount` | `POST /bank-accounts` | `bankAccounts.create()` |
| `GetBankAccount` | `GET /bank-accounts/{id}` | `bankAccounts.get()` |
| `UpdateBankAccount` | `PUT /bank-accounts/{id}` | `bankAccounts.update()` |
| `DeleteBankAccount` | `DELETE /bank-accounts/{id}` | `bankAccounts.delete()` |
| `GetConversionRate` | `GET /currencies` | `currencies.rate()` |
| `ListDocumentBlock` | `GET /document-blocks` | `documentBlocks.list()`, `all()`; the default block of documents and receipts |
| `CreateDocumentBlock` | `POST /document-blocks` | `documentBlocks.create()` |
| `GetDocumentBlock` | `GET /document-blocks/{id}` (undocumented) | `documentBlocks.get()` |
| `UpdateDocumentBlock` | `PUT /document-blocks/{id}` (undocumented) | `documentBlocks.update()` |
| `DeleteDocumentBlock` | `DELETE /document-blocks/{id}` (undocumented) | `documentBlocks.delete()` |
| `Create` | `POST /document-export` | `exports.create()`, `run()` |
| `Poll` | `GET /document-export/{id}/poll` | `exports.poll()`, `run()` |
| `Download` | `GET /document-export/{id}/download` | `exports.download()`, `run()` |
| `ListDocument` | `GET /documents` | `documents.list()`, `all()` |
| `CreateDocument` | `POST /documents` | `documents.create()`, `createRaw()`, `createOnce()` |
| `CreateReceipt` | `POST /documents/receipt` | `receipts.create()`, `createOnce()` |
| `CreateReceiptFromDraft` | `PUT /documents/receipt/{id}` | `receipts.finalizeDraft()` |
| `GetDocumentByVendorId` | `GET /documents/vendor/{vendor_id}` | `documents.getByVendorId()`, `findByVendorId()`; `createOnce()` |
| `GetDocument` | `GET /documents/{id}` | `documents.get()` |
| `CreateDocumentFromDraft` | `PUT /documents/{id}` | `documents.finalizeDraft()` |
| `DeleteDocument` | `DELETE /documents/{id}` | `documents.deleteDraft()` |
| `ArchiveDocument` | `PUT /documents/{id}/archive` | `documents.archive()` |
| `CancelDocument` | `POST /documents/{id}/cancel` | `documents.cancel()` |
| `DocumentCopy` | `POST /documents/{id}/copy` | `documents.copy()` |
| `CreateDocumentFromProforma` | `POST /documents/{id}/create-from-proforma` | `documents.createFromProforma()` |
| `CreateModificationDocument` | `POST /documents/{id}/create-modification-document` | `documents.createModification()` |
| `DownloadDocument` | `GET /documents/{id}/download` | `documents.pdf()` |
| `GetOnlineSzamlaStatus` | `GET /documents/{id}/online-szamla` | `documents.navStatus()` |
| `GetPayment` | `GET /documents/{id}/payments` | `documents.payments.list()`, `add()` |
| `UpdatePayment` | `PUT /documents/{id}/payments` | `documents.payments.replace()`, `add()` |
| `DeletePayment` | `DELETE /documents/{id}/payments` | `documents.payments.clear()` |
| `PosPrint` | `GET /documents/{id}/print/pos` | `documents.posPdf()` |
| `GetPublicUrl` | `GET /documents/{id}/public-url` | `documents.publicUrl()` |
| `GetDocumentReminderEventList` | `GET /documents/{id}/reminders` | `documents.reminders()` |
| `SendDocument` | `POST /documents/{id}/send` | `documents.send()` |
| `GetProductQuantity` | `GET /inventory/product/{id}/quantity` | `inventory.quantity()` |
| `GetOrganizationData` | `GET /organization` | `organization.get()`, `verifyCredentials()` |
| `ListPartner` | `GET /partners` | `partners.list()`, `all()`, `findOrCreate()` |
| `CreatePartner` | `POST /partners` | `partners.create()`, `findOrCreate()` |
| `PartnerGuess` | `POST /partners/guess` | `partners.guess()` |
| `GetPartner` | `GET /partners/{id}` | `partners.get()` |
| `UpdatePartner` | `PUT /partners/{id}` | `partners.update()` |
| `DeletePartner` | `DELETE /partners/{id}` | `partners.delete()` |
| `ListProduct` | `GET /products` | `products.list()`, `all()` |
| `CreateProduct` | `POST /products` | `products.create()` |
| `GetProduct` | `GET /products/{id}` | `products.get()` |
| `UpdateProduct` | `PUT /products/{id}` | `products.update()` |
| `DeleteProduct` | `DELETE /products/{id}` | `products.delete()` |
| `SpendingList` | `GET /spendings` | `spendings.list()`, `all()` |
| `SpendingSave` | `POST /spendings` | `spendings.create()` |
| `SpendingShow` | `GET /spendings/{id}` | `spendings.get()` |
| `SpendingUpdate` | `PUT /spendings/{id}` | `spendings.update()` |
| `SpendingDelete` | `DELETE /spendings/{id}` | `spendings.delete()` |
| `CheckTaxNumber` | `GET /utils/check-tax-number/{tax_number}` | `utils.checkTaxNumber()` |
| `GetId` | `GET /utils/convert-legacy-id/{id}` | `utils.convertLegacyId()` |
| `GetServerTime` | `GET /utils/time` | `utils.serverTime()` |

## tarca/testing

Test helpers for code that uses tarca. Runtime-neutral and dependency-free, like the root entry; the root `tarca` entry never imports it.

### createMockTarca(options?)

```ts
import { createMockTarca } from 'tarca/testing'

const tarca = createMockTarca({ taxCode: '12345678-2-42' })
await tarca.bankAccounts.create({ name: 'Fő számla', accountNumber: '11773016-11111018', currency: 'HUF' })
tarca.failNext('bankAccounts.create')
```

- A `MockTarca` is the real `Tarca` client (same validation, same errors, same GET retries with no delay) running on a fresh `createFakeBillingoFetch()`, plus `calls`, `billingo`, `failNext(method, error?, { afterSuccess? })` and `reset()`.
- Method names look like `'bankAccounts.create'` and `'verifyCredentials'` (typed as `MockTarcaMethod`). Every method of `Tarca` is wrapped automatically, so new resources need no change here.
- `failNext` throws once, by default a `network` `BillingoError`, before the request is sent. With `afterSuccess: true` the call runs (the fake keeps the result) and then throws. On an `all()` iterator the error comes on the first step, or after the last item with `afterSuccess`.
- Options are the fake's options (except `apiKeys`) plus `credentialsValid` (`false`: every request gets 401, `verifyCredentials()` resolves `false`) and `defaults` (the same `TarcaDefaults` as `createTarca`, so the mock issues documents exactly like your production client).
- `tarca.billingo` is the underlying fake: inspect `requests`, `data` or inject wire-level faults there.

### createFakeBillingoFetch(options?)

```ts
import { createTarca } from 'tarca'
import { createFakeBillingoFetch } from 'tarca/testing'

const billingo = createFakeBillingoFetch()
const tarca = createTarca({ apiKey: 'test', fetch: billingo.fetch, retryDelayMs: 0 })
```

- An in-memory Billingo v3 behind a `fetch` that implements all 57 operations. It speaks the wire format: snake_case JSON, `X-API-KEY` required, Laravel pagination (`page`, `per_page` 1–100, default 25, `total`, `per_page`, `current_page`, `last_page`, `prev_page_url`, `next_page_url` with only `?page=N`, `null` at the ends), newest item first.
- Error bodies match Billingo: `{ error: { message } }` for 4xx, `{ error: { message, trace_id } }` for 5xx, `{ message: 'Validation Failed', errors: [{ field, message }] }` for 422 with Laravel messages. The known Billingo messages (from live runs, the spec or Billingo support) are in `FAKE_BILLINGO_MESSAGES`.
- Routing as measured live: an unknown path answers 404 `{ error: { message: '' } }` and a wrong method 405 (`The PATCH method is not supported for this route. Supported methods: GET, HEAD, PUT, DELETE.`), both before the key check; then a missing or unknown key gives 401. An unknown or foreign numeric id gives 403 with Billingo's permission message, not 404 (partners, products and spendings answer their live 404 instead).
- Implemented: `GetOrganizationData`, `GetServerTime`, `CheckTaxNumber` (422 for a malformed number, 401 with the NAV sandbox message without `hasNavConnection`, otherwise looked up in `taxpayers`), `GetId` (a deterministic id for any positive number, like the live API; `legacyIds` pins exact pairs), `GetConversionRate` (from `hufRates`), and full bank account CRUD (create answers 201 with the full object; PUT is a full replace).
- Partners, all six operations: `query` matches word prefixes of the name like Billingo, sorted by name, but the fake's index has no lag. The fake splits words at spaces and punctuation and accepts the query words in any order; the live probes do not settle those two details. `guess` answers 201 with the first partner of exactly the same name (`taxType: ''` in the answer) or creates one. Create and PUT (full replace) fill the live defaults; an unknown id gives 404 `Partner is not found.`. `data.partners` holds them.
- Products, all five operations: create and PUT (full replace) fill the live defaults and compute the other price from the VAT rate (rounded to cents); none or both prices is a 422; `query` matches a name substring; `get` and `list` read a `null` `purchase_price` back as `0`; a deleted or unknown product gives 404 `Product is not found.`. `GetProductQuantity` answers 400 `Automatic order processing is disabled` like the test profile, unless the `stock` option is given: then `{ available_quantity }` from `stock[sku]` (0 for an unlisted SKU).
- Spendings, all five operations: the live required fields and their 422 messages, `partner_id` must name a fake partner (embedded in the answer), HUF totals stored as sent, `created_by_nav: false` on `get` and in the list, every list filter (`q` searches the partner name only, newest first), an unknown id gives 404 `Spending is not found.`.
- Exports: `simple_csv` only (other formats answer 501). The first poll answers `pending`, later polls `success`; the download before that is a 404, after it a `text/csv; charset=UTF-8` file with a BOM, Billingo's header row and `inline; filename=<Budapest time>_export.csv`. The file has no data rows.
- Documents and receipts, all eight issuing and query operations: totals computed like the live API (see `tarca.documents`), numbering per block, type and year (`2026-1` in a block without prefix, `PREFIX / 2026-000001` with one, proformas `000001`, receipts `NYT-2026-1`), drafts without a number, `vendor_id` unique across documents (400 `Duplicate vendor id. (id:…)`), 404 `Document is not found.` for an unknown vendorId, 403 for an unknown id, the live 422 field order for an empty body (including `conversion_rate`, required unless `currency` is `HUF`), the embedded `partner` with `partnerShowType: null`, advance lines on final invoices, the shared `Magánszemély` partner for receipts without a partner, every list filter. Assumptions not verified live: a non-draft delete answers 400, unknown references in the body answer 422 `The selected … is invalid.`, a receipt line with VAT `none` answers 501, `discount` is stored but not applied to the totals, `type=invoice` lists everything outside receipt blocks, `query` matches the invoice number or partner name. `data.documents` holds `{ document, vendorId, issuedAt, modifiedAt, archived?, payments? }`.
- Document actions, all fourteen: `pdf` answers `application/pdf` and `posPdf` `application/octet-stream`, both a small real PDF named `<number>.pdf` (`size` must be 58 or 80); every binary response (also the export download) carries `x-ratelimit-limit: 300` and `x-ratelimit-remaining`, and JSON responses carry none, as live (`remaining` counts the key's requests in the last 60 s of the fake clock, an approximation of Billingo's window); `publicUrl` a stable `https://api.billingo.hu/document-access/<token>`; `navStatus` 404 `NavOnlineSzamla is not found.` for `navRecordDelayMs` (default 10 000 ms) after issuing, then 200 `no_online_szamla_settings` (or the document's own status with `hasNavConnection`); `send` echoes the checked addresses; `reminders` three empty lists; `cancel` creates the cancellation document with the live fields (`cancellation`, `receipt_cancellation`, negative totals, `paymentStatus: 'none'` on the original, whose `notificationStatus` stays as it was) and answers 400 `Cannot cancel the document (id:…)` after a modification; `copy` a fresh draft; `archive` and `createFromProforma` only for proformas (400 otherwise), the invoice comes back paid; `createModification` the difference document with `correctionType: 'modified'` on the original; payments are a full replace with `partially_paid`/`paid`/`outstanding` and `DELETE` answers 200 `[]`. Assumed, not measured: the 400 messages for archiving or converting a non-proforma and for modifying a cancelled document, the recipient 422 message, the draft PDF file name.
- Document blocks, all five operations: the list is ascending by id with the six list fields and filters by `type`; create, get and PUT return the full block with the live defaults; PUT is a full replace and answers `null` e-mails with 422; the name rule and the 422 messages are Billingo's; delete answers 204, after which the block gives 403.
- Fresh state is a new test profile: tax code `00000000-0-00`, `has_nav_connection: false`, subscription until tomorrow (Budapest), and two document blocks: 1 `Számlák` (`invoice`, no prefix) and 2 `Nyugták` (`receipt`, prefix `NYT`). Ids start at 1 per resource and per instance.
- Options: `now`, `apiKeys` (accept only these keys), `taxCode`, `hasNavConnection`, `subscription: { expirationDate?, features? }`, `hufRates` (HUF per unit, default `EUR 390, USD 360, GBP 460, CHF 410`), `taxpayers` (keyed by tax number or its first 8 digits), `legacyIds` (`{ [v2Id]: v3Id }`, overrides the derived id), `stock` (`{ [sku]: availableQuantity }`, turns on stock tracking), `navRecordDelayMs` (how long a fresh document has no NAV record), `faults`.
- `FakeBillingo` is `{ fetch, requests, data, count(operation?), counts(), fail(fault, { operation?, times?, afterSuccess? }), reset() }`. `requests` records `{ operation, method, path, query, body, status, faulted }` and never the key. `data` exposes the resources as read-only maps (`bankAccounts`, `documentBlocks`, `partners`, `products`, `spendings`, `documentExports`, `documents`).
- Faults: `'network'` (fetch rejects with `TypeError`), `'timeout'` (`TimeoutError`), `'notReady'` (202 with `Document PDF has not generated yet.`; the client does not retry it, only `documents.pdf` waits), or `{ status: 400–599, message? }` in Billingo's body shape. They match the next request of `operation` (or any request), FIFO, `times` in a row, after the key check. `afterSuccess` runs the operation first, so the state changes but the client sees the fault, which is how to test lost responses on writes.
