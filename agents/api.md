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
    onDocument: (event) => journal.record(event),
    onDocumentError: 'warn',
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

`onDocument(event)` runs once for every new document Billingo returned, and tarca awaits it before the method resolves. `DocumentEvent` is `{ action, operation, document, vendorId?, sourceId? }`: `action` is `'created'` (`documents.create`, `createRaw`, `createOnce` only when `created: true`, also after an uncertain failure that the lookup resolved; `receipts.create`, `receipts.createOnce`), `'finalized'` (`finalizeDraft`, `receipts.finalizeDraft`), `'converted'` (`createFromProforma`), `'copied'` (`copy`, a draft), `'cancelled'` (`cancel`; `document` is the cancellation, `sourceId` the original) or `'modified'` (`createModification`). `vendorId` is set when the call had one; `sourceId` on converted, copied, cancelled and modified. Payments are not documents and emit nothing; a failed write emits nothing. `onDocumentError`: `'warn'` (default; the error goes to `onWarning` as `{ hook: 'onDocument' }`, or to `console.warn` when there is no `onWarning`, and the call succeeds), `'throw'` (the call rejects with `DocumentHookError`, which carries `event`, `document` and `number`: the document exists, so record it from the error and never issue it again) or a function `(error, event) => …` (if it throws too, `DocumentHookError`). Any other value is a `configuration` error at `createTarca` time. `createMockTarca({ hooks })` behaves the same.

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
- `DocumentHookError` (`event`, `document`, `number`, `cause`) and `isDocumentHookError(error)`: thrown by a write in `onDocumentError: 'throw'` mode when the `onDocument` hook failed after Billingo created the document. Types: `DocumentEvent`, `DocumentAction`, `DocumentHook`, `DocumentErrorMode`, `DocumentErrorHandler`.
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
- Options are the fake's options (except `apiKeys`) plus `credentialsValid` (`false`: every request gets 401, `verifyCredentials()` resolves `false`), `defaults` (the same `TarcaDefaults` as `createTarca`, so the mock issues documents exactly like your production client) and `hooks` (passed to the real client, so `onDocument` and `onDocumentError` behave as in production).
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

## tarca/batch

Issues many documents exactly once, paced under Billingo's rate limit. Runtime-neutral; the root `tarca` entry never imports it.

```ts
import { billingPeriodAt, runBatch } from 'tarca/batch'

const period = billingPeriodAt({ interval: 'month', anchor: '2026-01-31' }, new Date())
const result = await runBatch(tarca, {
  items: subscriptions.map((subscription) => ({
    key: `SUB-${subscription.id}-${period.start}`,
    document: () => ({ kind: 'invoice', input: invoiceFor(subscription, period) }),
  })),
})
```

- `runBatch(tarca, options): Promise<BatchResult>`. `tarca` only needs `documents.createOnce`, `documents.findByVendorId` and `receipts.createOnce` (`BatchApi`), so `createMockTarca()` works too.
- Items: `{ key, document: () => BatchDocument | Promise<BatchDocument> }`, where `BatchDocument` is `{ kind: 'invoice', input: DocumentInput }` or `{ kind: 'receipt', input: ReceiptInput }`. The trimmed `key` becomes the `vendorId`; an input whose own `vendorId` differs fails that item (`validation`). Empty or duplicate keys reject the whole run before any request (`validation`, `fieldErrors: [{ field: 'items.N.key' }]`).
- Every item goes through `documents.createOnce` / `receipts.createOnce`, so a rerun never duplicates: already issued items come back `existing`.
- Options: `concurrency` (1–4, default 1), `ratePerMinute` (item starts per minute, default 30, at most 60; starts are spaced `60000 / ratePerMinute` ms apart on the clock, also with concurrency), `dryRun`, `defaults` (`TarcaDefaults`, used only by `dryRun`; pass the same as `createTarca`), `journal` (`{ track(vendorId, run) }`; every issue runs through it), `once` (the `createOnce` lock options: `lock`, `lockTtlSeconds`, `lockWaitMs`, `lockFailure`), `signal`, `onProgress(progress)`, `recoveryDelayMs`, `now` (the pacing clock). An invalid option rejects with `configuration` before any request.
- Why 30 per minute: Billingo allows 300 requests per minute per key, counting every request (GETs too) and shared with webhooks. One item costs 2–6 requests (vendorId lookup, partner search 1–3 pages, partner POST, document POST; the default block is cached), so 30 items is at most 180 requests.
- Stops (remaining items `skipped` with `stopped.reason`) on `rate_limit` (writes are never retried, rerun later with the same keys), `auth`, `forbidden` (read-only key or another company's id), `subscription` (402: no "API + Tömeges" add-on or the monthly write quota is used up), `configuration` and `store_unavailable`. `in_progress` (another process holds the lock) skips only that item. Any other error, including an uncertain one that `createOnce` could not resolve, fails only that item. When the document was issued but something after it failed (the `onDocument` hook with `onDocumentError: 'throw'`, or the journal write: `DocumentHookError`, `JournalWriteError`), the item stays `created` (or `existing`), counts in `grossTotals` and carries that error in `error`: the document exists, never reissue it.
- Partners: Billingo's partner search lags 20–60 seconds after a create, so a second `findOrCreate` for the same new buyer would create a duplicate partner. Within a run the batch remembers the partner id of every inline `PartnerInput` (canonical JSON, `countryCode` defaulting to `HU`) once an item has issued a document with it, and passes the id to later items; with `concurrency > 1` later items wait for the first. A partner of an `existing` document is not reused.
- Abort: `signal` stops new items and the pacing wait; items already running finish (the signal is not passed into `createOnce`, so no POST is cut off mid-flight).
- `dryRun: true`: Billingo has no preview endpoint, so it validates locally with the same rules as `createOnce` (`prepareDocument`, the receipt check), looks the `vendorId` up (one paced GET) and estimates totals with Billingo's rounding model. It never writes, not even drafts (drafts count against the write quota). Items come back `existing` (Billingo's own numbers) or `validated` (estimate). No estimate (`grossTotal: undefined`) for product lines, `discountPercent`, `advanceInvoiceIds` and receipt lines with VAT `none`.
- `BatchResult`: `{ dryRun, items, created, existing, validated, failed, skipped, stopped?, grossTotals }`. Each `BatchItemResult` has `key`, `status`, `kind?`, `document?`, `number?`, `grossTotal?`, `currency?`, `error?`, `reason?`. `grossTotals` sums Billingo's `grossTotal` per currency (`{ HUF: 25400, EUR: 381.26 }`), never across currencies.
- `onProgress` gets `{ total, done, created, existing, validated, failed, skipped, key, status }` after every item; an error it throws is ignored.
- Recurring periods (client-side; Billingo's own recurring invoices, `recurringId`, are not in API v3): `billingPeriod(options, index)`, `billingPeriodAt(options, date)`, `billingPeriodsBetween(options, from, to)`, `todayPeriod(options, now?)` with `{ interval: 'week' | 'month' | 'quarter' | 'year', anchor, paymentDueInDays? }`. A period is `{ index, interval, start, end, dueDate?, key }` in Budapest dates; month ends never drift (anchor `2026-01-31` gives `2026-02-28`, then `2026-03-31`), leap years give February 29. Invalid input throws `validation`.

## tarca/observe

Structured logs, OpenTelemetry-compatible spans and Prometheus metrics from tarca's hooks. Zero dependencies, runtime-neutral, never sends anything anywhere.

```ts
import { trace } from '@opentelemetry/api'
import { combineHooks, createMetricsRegistry, observe } from 'tarca/observe'

const metrics = createMetricsRegistry()
const tarca = createTarca({
  hooks: combineHooks(observe({ logger, tracer: trace.getTracer('tarca'), metrics }), ownHooks),
})
metrics.renderPrometheus()
```

- `observe({ logger?, tracer?, metrics?, redact = true, refSalt?, logRequests? }): ObserveHooks` returns `onRequest`, `onResponse`, `onComplete`, `onWarning` and `onDocument`.
- Logger: any `{ debug?, info?, warn?, error? }` with `(data, message)` methods (pino, console). Events: `tarca.request` (info on success, warn on failure; `operation`, `method`, `path` (template), `attempt`, `requestId`, `outcome`, `durationMs`, `willRetry`), `tarca.request.start` (debug, only with `logRequests`), `tarca.warning` (`hook`, `operation`), `tarca.document` (`type`, `action`, `documentId`, `number`, `vendorRef`).
- Redaction (`redact`, on by default): the API key is never in any event. For errors only `errorCategory`, `status`, `traceId`, `retryable` and `fields` (the names of the failed fields) are logged, never `message`, `hint`, `apiMessage` or field messages, because they can quote a vendorId, a name or an e-mail address. A warning's error is logged as `errorName` only. A `vendorId` appears as `vendorRef: 'hmac:<16 hex>'`, HMAC-SHA-256 with `refSalt` (random per process when omitted; the same salt gives the same ref across processes). `redact: false` logs everything in clear, and spans then get the real error.
- Spans: one per attempt, `billingo <operationId>`, kind client, attributes `billingo.operation`, `http.request.method`, `url.template` (for example `/documents/vendor/{vendor_id}`, no values), `billingo.attempt`, `billingo.request_id`, `http.response.status_code`; on error `billingo.error.category`, `billingo.trace_id`, a sanitized exception and status `SPAN_STATUS_ERROR`. Aborted requests close their span too; at most `MAX_OPEN_SPANS` (1000) stay open, the oldest is ended first. `ObserveTracer` is structural, so `trace.getTracer()` from `@opentelemetry/api` fits.
- Metrics: `tarca_requests_total{operation,outcome}` (`success` or the error category), `tarca_request_duration_ms{operation}` (histogram), `tarca_retries_total{operation}`, `tarca_rate_limited_total{operation}`, `tarca_unexpected_response_total{operation}`, `tarca_lock_errors_total` (`createOnceLock` warnings), `tarca_warnings_total{hook}`, `tarca_documents_total{type,action}` (from `onDocument`).
- A throwing tracer, logger or metrics object never breaks a request.
- `createMetricsRegistry(buckets = DEFAULT_DURATION_BUCKETS_MS): MetricsRegistry` with `counter(name, labels?, value = 1)`, `histogram(name, value, labels?)`, `renderPrometheus()` (text format 0.0.4 with `# HELP` from `METRIC_HELP`, escaped label values, cumulative buckets) and `reset()`. Invalid metric or label names (`le` and `__*` are reserved), negative counter increments, non-finite values and a name used as both counter and histogram throw `TypeError`.
- `combineHooks(...hooks)`: chains every hook key, including ones added later. Event hooks run in order and the first error is rethrown after all ran (an async rejection reaches tarca's `onWarning`); `onDocument` handlers are awaited one after another; `onDocumentError` is a setting, so the last one given wins. `undefined` arguments are skipped.

## tarca/node

Adapts web-standard `(Request) => Response` handlers (payment webhooks, the MCP HTTP handler) to Node's `http`, Express, NestJS and Fastify. Only type imports from `node:http`, so the module itself has no Node dependency.

```ts
import { toNodeHandler } from 'tarca/node'
import { stripeWebhook } from 'tarca/payments/stripe'

app.post('/webhooks/stripe', toNodeHandler(stripeWebhook({ secret, onPayment })))
app.use(express.json())
```

- `toNodeHandler(handler, { trustProxy?, onError? }): (request, response, next?) => Promise<void>`. On a handler error it calls Express's `next(error)` when given; otherwise it reports to `onError` and answers 500 `text/plain` unless headers were already sent. A throwing `onError` is ignored. Without `onError` it writes only a summary to `console.error`: the error's `name`, plus `category`, `status` and `operation` for a `BillingoError` and the message of a `NodeBodyError`, never another error's message (it can quote an e-mail address or a vendorId).
- The raw body is streamed, so signatures verify byte for byte. It uses `rawBody` (NestJS `rawBody: true`), an `express.raw()` `Buffer`/`Uint8Array`, an `ArrayBuffer` or a string body as is. A body already parsed into an object by `express.json()` throws `NodeBodyError` (Hungarian message: move the route before `express.json()` or use `express.raw({ type: '*/*' })`), as does a body consumed without being passed on. Express 4's empty `{}` placeholder falls back to the unread stream.
- `toWebRequest(request, { trustProxy? }): Request`: URL from `originalUrl ?? url`, `Host` (or HTTP/2 `:authority`), and the socket's TLS; `X-Forwarded-Proto` / `X-Forwarded-Host` only with `trustProxy: true`. HTTP/2 pseudo-headers are dropped, multi-value headers kept, GET and HEAD have no body.
- `writeWebResponse(response, target)`: status, headers (several `Set-Cookie` kept separate) and body; an empty body ends without a chunk.

## tarca/storage

Saves document PDFs to object storage. Runtime-neutral (S3 is signed with SigV4 over `fetch`); `fsStorage` lives in the Node-only `tarca/storage/fs`. The root `tarca` entry never imports either.

```ts
import { s3FetchStorage, storeDocumentPdf } from 'tarca/storage'

const storage = s3FetchStorage({ bucket, region: 'auto', endpoint, accessKeyId, secretAccessKey })
const file = await storeDocumentPdf(tarca, storage, document)
```

- `storeDocumentPdf(tarca, storage, documentOrId, { key?, maxWaitMs?, signal? }): Promise<StoredFile>`: computes the key (`documentPdfKey`), downloads with `documents.pdf(id, { maxWaitMs, signal })` (which waits for the 202 "PDF not ready", 30 s by default, and then throws `not_ready`) and stores it with `storePdf`. With a number and no `key` it first calls `documents.get(id)`. `tarca` only needs `documents.get` and `documents.pdf` (`DocumentPdfSource`).
- `documentPdfKey(document, { prefix? })`: `<prefix>/<folder>/YYYY/MM/<number>.pdf`, year and month from `invoiceDate`, the number sanitized (`sanitizeKeySegment`: accents removed, anything but `A-Za-z0-9._-` becomes `-`). Folders by `DocumentType`: `invoice` `szamlak`, `proforma` `szamlak/dijbekero`, `advance` `szamlak/elolegszamla`, `modification` `szamlak/modosito`, `cancellation` `szamlak/sztorno`, `receipt` `nyugtak`, `receipt_cancellation` `nyugtak/sztorno`, `offer` `arajanlatok`, `order_form` `megrendelok`, `waybill` `szallitolevelek`, `dossier` `dossziek`, `cert_of_completion` and `d_cert_of_completion` `teljesitesigazolasok`. Drafts (`draft`, `draft_offer`, `draft_order_form`, `draft_waybill`, or no `invoiceNumber`), an unknown type or a missing `invoiceDate` throw `StorageError` (`operation: 'key'`); an impossible date throws `RangeError`.
- `storePdf(storage, key, bytes)`: refuses content without the `%PDF` signature (`StorageError`, nothing stored). `isPdf(bytes)`.
- `StorageAdapter`: `put(key, bytes, { contentType }) → StoredFile { key, url?, size, contentType }`, optional `get(key) → Uint8Array | undefined`, `delete(key)`, `getUrl(key, { expiresInSeconds? })`. `CompleteStorageAdapter` has all four.
- Keys go through `assertStorageKey`: rejected (`StorageError`, `operation: 'key'`) when empty, longer than 1024, starting with `/`, containing `\`, a control character, or an empty, `.` or `..` segment, also when the dot is percent-encoded (`%2e%2e`, `.%2E`: the URL parser of SDKs that put the key into the URL unencoded would treat it as a path step). Every adapter takes `prefix`.
- Adapters: `s3FetchStorage({ bucket, region, accessKeyId, secretAccessKey, sessionToken?, endpoint?, forcePathStyle?, publicBaseUrl?, prefix?, fetch? })` (AWS S3 virtual-hosted, path-style for dotted buckets or a custom `endpoint` such as R2, MinIO, Backblaze; presigned `getUrl` up to `S3_MAX_PRESIGN_SECONDS`, 7 days; missing options are a `configuration` `BillingoError`), `s3Storage({ client, bucket, commands, getSignedUrl?, publicBaseUrl?, prefix? })` (your AWS SDK v3 client), `r2BindingStorage(bucket, { publicBaseUrl?, prefix? })` (Workers binding; no signed URLs), `vercelBlobStorage({ put, del?, head?, access, token?, allowOverwrite = true, cacheControlMaxAge?, prefix? })` (no random suffix; `access` is passed to every call; a private store returns no `url` and `getUrl` throws, serve it with `@vercel/blob` `get()` or `presignUrl()`), `supabaseStorage({ client, bucket, public?, upsert = true, cacheControl?, prefix? })` (signed URLs up to `SUPABASE_MAX_SIGNED_URL_SECONDS`), `uploadthingStorage({ utapi, acl?, contentDisposition?, prefix? })` (the key is the `customId`, at most `UPLOADTHING_MAX_CUSTOM_ID_LENGTH` 128; `getUrl` uses `generateSignedURL`, at most 7 days), `memoryStorage({ publicBaseUrl?, prefix? })` (`files`, `clear()`), and `fsStorage({ directory, publicBaseUrl?, prefix? })` from `tarca/storage/fs` (atomic write through a temp file, `pathFor(key)`; refuses to write, read or delete outside `directory`, also through symlinks).
- Errors: `StorageError { operation: 'put' | 'get' | 'delete' | 'getUrl' | 'key', key, status?, cause }`, `isStorageError`, `guardStorageCall(service, operation, key, call)` for your own adapter. Messages never contain credentials.
- `signAwsRequest()` and `presignAwsUrl()` are exported for other SigV4 uses (verified against AWS's published test vectors).

## tarca/stores

`KeyValueStore` adapters for the `createOnce` lock (`createOnceLock`), the journal, webhook dedupe and the refund ledger. Runtime-neutral; never imports the client.

```ts
import { Redis } from '@upstash/redis'
import { diagnoseStore, upstashRedisStore } from 'tarca/stores'

const store = upstashRedisStore(Redis.fromEnv(), { prefix: 'app1:', timeoutMs: 2_000 })
const tarca = createTarca({ createOnceLock: store })
await diagnoseStore(store)
```

- `KeyValueStore`: `get`, `set(key, value, ttlSeconds)`, `delete`, optional atomic `setIfAbsent`, `increment(key, ttlSeconds)`, `deleteIfEquals`. Same interface as kassza's stores.
- `upstashRedisStore(redis, options?)`, `ioredisStore(redis, options?)`, `nodeRedisStore(client, options?)`: TTL in whole seconds (at least 1, a non-finite TTL becomes 1); the atomic operations are Lua scripts through the client's `eval` and exist only when the client has `eval`. `upstashRedisStore` turns Upstash's automatic deserialization back into the stored string (numbers, booleans and JSON objects). Vercel KV is sunset (moved to Upstash Redis in December 2024, `@vercel/kv` deprecated): use Vercel Marketplace Redis with `upstashRedisStore`.
- `cloudflareKvStore(namespace, options?)`: no atomic operations, TTL at least `CLOUDFLARE_KV_MIN_TTL_SECONDS` (60), eventually consistent. Not usable for the lock, the journal or the refund ledger.
- `durableObjectStore(stub)` plus `handleDurableObjectStoreRequest(storage, request)` inside the Durable Object: all six operations, atomic because a Durable Object is single-threaded; expired entries are deleted on read.
- `customStore(store, options?)` adds `prefix` and error handling to your own store. `memoryStore()` is in-process only (tests, single instance). `storeCapabilities(store)` reports which atomic operations exist.
- Adapter options (`StoreAdapterOptions`): `prefix`, `timeoutMs` (integer 1–2147483647 ms; a slower operation fails), `onError({ operation, key, error })` (every failure is reported), `resilient` (default `false`: every failure is thrown, so the lock answers `store_unavailable` and nothing is issued; `true`: `get`, `set` and `delete` failures are swallowed, `get` returns `undefined`, the atomic operations still throw). `resilientStore(store, { onError?, timeoutMs? })` is the same wrapper; without `onError` it warns on the console. An invalid `timeoutMs` is a `configuration` error.
- `diagnoseStore(store, { keyPrefix?, now? }): Promise<StoreDiagnosis>` writes, reads and deletes a temporary `tarca:diagnose:<random>` key, tests every atomic operation and cleans up. Result: `{ ok, capabilities, suitableFor: { createOnceLock, journal, webhookDedupe, refundLedger }, latencyMs, problems }`. `createOnceLock` and `refundLedger` need a working `setIfAbsent`, `journal` a working `increment`, `webhookDedupe` only reliable reads and writes. A store that swallows errors fails the read-back check.

## tarca/journal

An append-only record of every issued, cancelled and modified document, reconciled against Billingo's document list. Billingo reports to NAV itself, so this is not a NAV summary. Runtime-neutral; never imports the client.

```ts
import { createJournal, kvJournal } from 'tarca/journal'

const journal = createJournal(kvJournal(store))
const tarca = createTarca({ hooks: { onDocument: (event) => journal.record(event), onDocumentError: 'throw' } })
const result = await journal.track(vendorId, () => tarca.documents.createOnce({ ...input, vendorId }))
await journal.settle(tarca)
await journal.reconcile(tarca, { from: '2026-10-01', to: '2026-10-31' })
```

- `createJournal(storage, { now? }): Journal`. Storage: `kvJournal(store, { prefix = 'tarca:journal:', retentionDays = 400, reservationTtlDays = 30 })` (needs `increment`, else a `configuration` error; uses `setIfAbsent` when present), `memoryJournal()`, or your own `JournalStorage` (`getEntry(id)`, `putEntry(entry) → boolean`, `listEntries(range)`, `putReservation`, `deleteReservation(vendorId)`, `listReservations(range)`, optional `indexEntry(entry)`; `putEntry` must never overwrite). `kvJournal` writes each day-index slot with `setIfAbsent`, or with `set` checked by reading it back, so a store that swallows errors (`resilientStore`) fails the write (`store_unavailable`) instead of leaving an entry no listing shows.
- `JournalEntry`: `{ id, vendorId?, number, type, action, date, relatedIds, grossTotal, netTotal, currency, conversionRate?, paymentStatus?, recordedAt, source }`. `id` is the Billingo document id and the key; `date` is `invoiceDate`; `relatedIds` are `relatedDocuments` plus the event's `sourceId`; `netTotal` is `summary.netAmount`; `recordedAt` a Budapest timestamp; `source` is `'hook' | 'track' | 'settle' | 'reconcile' | 'manual'`. No buyer data. A document missing one of these fields throws `TypeError` instead of recording zeros.
- `record(eventOrDocument)`: idempotent by id, never overwrites. Drafts are skipped (also the draft from `copy`), proformas are recorded. Cancellations and modifications are their own entries; the original's later state (paid, cancelled) is only reported by `reconcile`.
- `track(vendorId, run)`: reserves the `vendorId` (a pending item, dated today in Budapest), runs `run`, records the returned `Document` or `createOnce` result with `source: 'track'` and clears the reservation. A definite `BillingoError` from `run` clears a reservation this call created; an uncertain one (`network`, `timeout`, `server`, `unexpected_response`), `in_progress`, `store_unavailable`, a `GetDocumentByVendorId` error (the document may exist), any non-Billingo error or a crash keeps it pending. A reservation another call created is never cleared on failure. When recording fails after a successful `run`, it throws `JournalWriteError { vendorId, result, cause }` and keeps the reservation. An empty `vendorId` is a `RangeError` before `run`.
- `reserve(vendorId)`, `release(vendorId)`, `pending(range?)` (default: the last 30 Budapest days).
- `settle(tarca, { range?, releaseNotFound? })`: looks each pending `vendorId` up with `documents.findByVendorId`, records it with `source: 'settle'` and clears it. Not found stays pending unless `releaseNotFound`. Returns `{ recorded, notFound, failed: [{ reservation, error }] }`; a lookup error fails only that item.
- `entries({ from, to, type? })`: sorted by date, then number. Ranges are Budapest `YYYY-MM-DD` dates, at most `MAX_JOURNAL_RANGE_DAYS` (366); anything else is a `RangeError`.
- `reconcile(tarca, { from, to, dryRun?, graceSeconds = 120, signal? })`: reads `documents.all({ startDate, endDate, perPage: 100 })` (drafts skipped) and compares by id. `added`: only in Billingo, recorded with `source: 'reconcile'` unless `dryRun`; an entry the storage holds but does not list is re-indexed through `indexEntry` (a storage without it throws). `missing`: only in the journal and recorded more than `graceSeconds` ago (the list lags 15–30 s); since issued documents cannot be deleted, this means a wrong key or profile. A proforma missing from the list is looked up with `documents.get` first, because archived proformas leave the list. `mismatched`: `number`, `type`, `grossTotal` or `currency` differ (`{ id, fields, journal, billingo }`). `changed`: paid or cancelled since recording (`{ id, number, cancelled, recordedPaymentStatus, paymentStatus }`); entries are never rewritten. `matched`: the count without a mismatch. `tarca` only needs `documents.all` and `documents.get`.

## tarca/payments

Issues a receipt or an invoice from a Stripe, SimplePay, Barion, Revolut or PayPal payment, exactly once, without the providers' SDKs. Runtime-neutral (Web Crypto, `fetch`); `issueForPayment` is a standalone function, not a client method, so the root stays small. Subpaths: `tarca/payments` (shared), `tarca/payments/stripe`, `/simplepay`, `/barion`, `/revolut`, `/paypal`.

```ts
import { issueForPayment } from 'tarca/payments'
import { stripeWebhook } from 'tarca/payments/stripe'

export const POST = stripeWebhook({
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
  apiKey: process.env.STRIPE_SECRET_KEY,
  dedupe: store,
  onPayment: (payment) => issueForPayment(tarca, payment, { vat: 27, ledger: store }),
})
```

- **Webhook handlers** are `(request: Request) => Promise<Response>`: `stripeWebhook({ secret, apiKey?, toleranceSeconds = 300 })`, `simplePayWebhook({ secretKey? | merchants?, fetchDetails = true, sandbox? })`, `barionWebhook({ posKey, sandbox? })`, `revolutWebhook({ secret, apiKey, apiVersion = '2026-08-17', toleranceMs = 300000 })`, `payPalWebhook({ webhookId, clientId, clientSecret, fetchOrder = true })`. Shared options: `onPayment` (required), `onError`, `onWarning`, `dedupe?: KeyValueStore` (key `tarca:evt:<provider>:<eventId>`, TTL `dedupeTtlSeconds` = 7 days, marked only after `onPayment` succeeds; store errors are warnings), `maxBodyBytes` (1 MiB, checked on `Content-Length` and while streaming), `method?: PaymentMethod`, `fetch?`. Responses: 400 for a bad signature or payload (`onPayment` never runs), 200 (Revolut 204, SimplePay the signed IPN echo with `receiveDate`), 500 when anything after verification throws, so the provider redelivers. Stripe and Revolut secrets can be arrays (rotation). Invalid setup throws `TypeError` at creation. Error messages, warnings and the default console log never contain secrets, signature headers, bodies or e-mail addresses.
- **Verification**: Stripe `Stripe-Signature` `t=…,v1=…` (every `v1`, unsigned `secret`/`destination`/`payload` debug entries and unknown entries are ignored; thin v2 events become `kind: 'other'`). Stripe events: `checkout.session.completed` (paid) and `checkout.session.async_payment_succeeded` → `paid`, `payment_intent.succeeded` → `paid` (without `apiKey` the webhook delivers it as `other`, because a PaymentIntent carries no buyer data and whichever event arrives first would fix receipt versus invoice; with `apiKey` it is enriched from its Checkout session), `charge.refunded` → `refunded` / `partially-refunded`, `charge.refund.updated`, `refund.updated`, `refund.failed` with refund status `failed` or `canceled` → `refund-failed` (`refunds: [{ id: <re_…>, amount }]`). SimplePay base64 HMAC-SHA384 of the raw body (`Signature`), one key per merchant. Barion has no signature: the callback's `paymentId` is checked by `GET /v4/Payment/{id}/PaymentState` with `x-pos-key`. Revolut `Revolut-Signature: v1=<hex>` over `v1.{timestamp}.{body}`, millisecond timestamp, 5 minutes both ways. PayPal `POST /v1/notifications/verify-webhook-signature` with the raw event embedded byte for byte. All comparisons use `timingSafeEqual`.
- **`PaymentEvent`**: `{ provider, kind: 'paid' | 'refunded' | 'partially-refunded' | 'refund-failed' | 'failed' | 'other', id, eventId?, eventType?, orderRef?, amount?, refundedAmount?, refunds?, paidAt?, method, customer?, items?, raw }`. `id` is what identifies the payment and its refunds alike: Stripe the `payment_intent`, SimplePay the transaction, Barion the `PaymentId`, Revolut the original order, PayPal the capture. `method` is a Billingo `PaymentMethod`: `stripe`, `simple_pay` (`wire_transfer` for WIRE), `barion` (`wire_transfer` for BankTransfer), `revolut`, `paypal`.
- **Amounts** are `PaymentAmount = { value, minor, currency }`: `minor` is an integer in the currency's ISO 4217 minor unit, `value = minor / 10^exponent`. Every comparison is on `minor`, without tolerance. `fromMinorUnits(minor, currency, 'iso4217' | 'stripe')` (Stripe HUF is two-decimal: 127000 = 1270 Ft; Stripe ISK/UGX are converted to ISO), `parseDecimalAmount(string | number, currency)` (rejects more decimals than the currency has), `currencyExponent`, `isBillingoCurrency`. Line items carry `totalGross: PaymentAmount`; refunds `{ id, amount, refundedBefore?, createdAt? }`. Stripe refund ids are `<charge>:<cumulative amount_refunded>`, so two Stripe events about the same refund map to one id.
- **`issueForPayment(tarca, payment, options): Promise<IssuedDocument>`**. `tarca` is structural: `documents` (`createOnce`, `findByVendorId`, `get`, `list`, `cancel`, `createModification`, `payments.replace`), `receipts.createOnce`, `currencies.rate`. The vendorId is `paymentVendorId(payment)` = `<PROVIDER>-<id>`, or `<PROVIDER>-h<16 hex of sha256(id)>` when the id has characters outside `[A-Za-z0-9_.:-]` or the result exceeds 64; `options.vendorId` overrides. Options: `vat`, `vatFor(item)`, `items` (gross unit prices), `fallbackItemName`, `document: 'auto' | 'receipt' | 'invoice'`, `partner` (id or `PartnerInput`), `buyerIsBusiness`, `invoiceRequested`, `cashRegisterRequired`, `currency`, `conversionRate`, `method`, `allowAmountMismatch`, `partialRefund: 'auto' | 'proportional' | 'skip'`, `refundItems(context)`, `ledger`, `receipt` and `invoice` (extra `receipts.createOnce` / `documents.createOnce` fields), plus the `createOnce` options (`signal`, `recoveryDelayMs`, `lock`, …).
- **Paid**: local validation first (currency is a Billingo `Currency`, `value` and `minor` agree, every item has a VAT rate, `vatFor` → item `vat` → `vat`, never guessed; the items' gross sum under Billingo's line rounding equals `amount.minor` unless `allowAmountMismatch`; an item total that does not divide by its quantity becomes one line `Name (3 db)`). Then `findByVendorId`: an existing document returns `created: false` (a cancelled one is `skipped`). Otherwise a foreign currency gets `conversionRate` or `currencies.rate({ from, to: 'HUF', date: fulfilment date })` (reported in `conversion`), `chooseDocument` decides (900 000 Ft, tax-numbered or business buyer, `invoiceRequested` → invoice; `cashRegisterRequired` → `validation`), and `receipts.createOnce` or `documents.createOnce` issues it. An invoice whose `paymentStatus` is not `paid` gets `payments.replace(id, [{ date: paidAt (Budapest), price: document.grossTotal, paymentMethod, conversionRate }])`; `paymentRecorded` says so. `DocumentInsert.paid` is not used. Results: `{ kind: 'receipt' | 'invoice', vendorId, created, document, decision, conversion, paymentRecorded? }`.
- **Buyer**: `partnerFromCustomer(customer)` needs name, postcode, city, street and a two-letter country (or none: Billingo's default HU). Hungarian tax number → `taxcode: '12345678-1-23'`, `taxType: 'HAS_TAX_NUMBER'`; EU or foreign number → `FOREIGN`; none → `NO_TAX_NUMBER`; a business without a number gets no `taxType`. A Hungarian buyer with only an EU (`HU…`) or malformed number is a `validation` error. Receipts are issued without a partner.
- **Refunded**: no document → `in_progress` error (the paid event has not been processed yet; the webhook answers 500 and the provider redelivers the refund; for a payment that will never get a document, acknowledge this error in `onPayment`); already `cancelled` → `{ kind: 'cancellation', created: false }`; otherwise `documents.cancel(id)` exactly once: calls for the same vendorId on one client run one after another, and with a `ledger` (needs `setIfAbsent`, else `configuration`) a `tarca:refund:` key reserved for 10 minutes keeps a second process from POSTing at the same time (it reads the document: cancelled → `created: false`, else `in_progress`; a ledger error is `store_unavailable` before any request). After an uncertain error it waits `recoveryDelayMs`, reads the document again and the `cancelled` flag decides (`created: true`); if that is undecidable the original error is rethrown, never a second POST. A modified invoice (`correctionType: 'modified'`, or Billingo's 400 `Cannot cancel the document…`) is not cancelled: the remaining amount (items minus the related modifications in `documents.list`) gets a modification with refund id `teljes`. When the original says `modified` but the lagging list shows no modification yet → `in_progress` (redelivery); when the search would need more than 5 pages → `validation`, never a modification for the full amount.
- **Refund failed** (`refund-failed`, Stripe only): no write. With a document → `{ kind: 'refund-failed', vendorId, document, reason }` for a human: the cancellation or modification issued for that refund is not reversed. Without one → `skipped`. Stripe refund ids stay `<charge>:<cumulative amount_refunded>`; after a failed refund lowers `amount_refunded`, a later refund of the same cumulative amount maps to the failed one's ledger entry.
- **Partially refunded**: needs `payment.refunds` (else `skipped`); no document → `in_progress`, as for a full refund; a receipt or several VAT rates without `refundItems` / `partialRefund: 'proportional'` → `{ kind: 'refund-proposal', document, documentId, refunds: [{ refundId, amount, items }], reason }`; no `ledger` → proposal with the reason. Otherwise one modification per refund id through `createModificationOnce`: one line per VAT rate, quantity 1, negative gross unit price, split by `allocateRefund` (exact, path-independent, never more than an item's original). Result `{ kind: 'modification', vendorId, originalId, created, modifications: [{ refundId, modificationId, created, amount, grossTotal }] }`. `failed` and `other` → `skipped`.
- **`createModificationOnce(tarca, { documentId, vendorId, refundId, items, ledger, comment?, paymentMethod? })`**: `CreateModificationDocument` has no `vendor_id` and the document list lags 15–30 s, so it needs a `KeyValueStore` with `setIfAbsent` (else `configuration`). Key `refundLedgerKey(vendorId, documentId, refundId)` = `tarca:refund:<sha256>`, value `{ state: 'pending' | 'done', modificationId, grossTotal }`, TTL 30 days. A `done` entry returns at once (`created: false`). Otherwise it reserves the key, then searches `documents.list({ partnerId, startDate })` (the original's partner and invoice date, at most 5 pages of 100) for a `modification` whose `relatedDocuments` contains the original and whose comment has the marker `(Visszatérítés <vendorId> <refundKey>)`, so an expired or lost ledger entry never leads to a second modification; a match is marked done and returned with `created: false`, a failed search releases the reservation. Only then it POSTs with the marker and marks the entry done. Only a definite `BillingoError` (a Billingo 4xx or a local `validation` error) releases the reservation. Everything else (network, timeout, 5xx, `unexpected_response`, an abort reason, any non-Billingo error) keeps it and recovers through the same list search; not found → `in_progress` error (the webhook answers 500, the provider redelivers). A `DocumentHookError` (the `onDocument` hook failed after Billingo created the modification) is marked done with its document id and rethrown. Each new modification costs one `GetDocument` and one list call more than the POST. It never issues twice. Ledger read errors are `store_unavailable` before any request. Billingo's list `type` filter does not accept `modification`, so a partner with more than 500 later documents and an expired ledger entry can still hide an old modification.
- **Other exports**: `chooseDocument`, `RECEIPT_MAX_GROSS_HUF`, `allocateRefund(items, refundMinor, { refundedBeforeMinor })`, `hungarianTaxNumber`, `readRawBody`, `deliverPayment`, `respondToWebhook`, `webhookDedupeKey`, `WebhookVerificationError { provider, reason }`, `PaymentProviderError { provider, status }`, and per provider the verifiers, parsers and API helpers (`verifyStripeSignature`, `parseStripeEvent`, `stripePaymentEvent`, `fetchStripeLineItems`, `simplePaySignature`, `simplePayIpnResponse`, `querySimplePayTransaction`, `verifySimplePayRedirect`, `fetchBarionPaymentState`, `barionPaymentEvent`, `verifyRevolutSignature`, `fetchRevolutOrder`, `revolutPaymentEvent`, `payPalApi`, `verifyPayPalWebhook`, `payPalPaymentEvent`, …).

## tarca/mcp and the CLI

### The `tarca` command (Node 22+)

```bash
npx tarca doctor [--tax-code <adószám>] [--defaults <file.json>] [--check-update] [--json | --report]
npx tarca verify
npx tarca document get <id> | --vendor <vendorId>
npx tarca mcp [--allow-write] [--defaults <file.json>]
```

- Reads `BILLINGO_API_KEY`. `tarca help`, and `--help` or `-h` anywhere before `--` (`tarca doctor --help`), print the usage with exit 0, without a key or a request. Exit codes: 0 success, 1 error (or a failed doctor check), 2 usage error. Messages are Hungarian; a Billingo error prints its `hint` (`Tipp:`) and `traceId`.
- `doctor` reads only, with at most 3 Billingo GETs (`organization.get`, `documentBlocks.list`, `bankAccounts.list`) and `maxAttempts: 1`. Checks, each `ok`, `warn`, `fail` or `skip`: `node` (22+), `timezone` (Europe/Budapest ICU data), `api-key` (missing: fail and the rest is skipped; surrounding whitespace: warn; only the length is printed, never the key), `auth` (401: fail with the hint to create a V3 key under Beállítások → API kulcsok), `clock` (the `Date` header against the local clock: up to 2 s ok, up to 30 s warn, above fail, because fulfillment and due dates are Budapest calendar days computed locally), `profile`, `nav`, `subscription` (see `summarizeProfile` below), `environment` (`NODE_ENV=test` or `development` on a NAV-connected profile: warn), `document-blocks` (no `invoice` block: fail; no `receipt` block: warn; with `--defaults`, `blockId` and `receiptBlockId` must exist with the right type), `bank-accounts` (none: warn; prints the count and currencies, never account numbers; with `--defaults`, `bankAccountId` must exist) and, with `--check-update`, `update` (`registry.npmjs.org/tarca/latest`, skipped on a network error). `--tax-code` is compared with the company's tax code (8 digits match the prefix) and never printed. `--report` is a secret-free Markdown table for an issue.
- Not checked, because reading cannot prove it: whether the key is read-only or read+write, and whether a live profile has the "API + Tömeges" add-on (only a write answering 402 proves it is missing). doctor says so instead of guessing.
- `document get` prints the document as JSON. An unknown or foreign id (Billingo answers 403, not 404) and an unknown vendorId exit with 1 and a Hungarian message.
- `--defaults` takes a `TarcaDefaults` JSON file (`-` reads stdin, except for `mcp`, where stdin carries the protocol and `-` is a usage error); unknown keys, wrong types and invalid values are rejected before anything runs.

### createTarcaMcpServer(options?)

```ts
import { createTarcaMcpServer } from 'tarca/mcp'

const server = createTarcaMcpServer({ apiKey: process.env.BILLINGO_API_KEY, allowWrite: false })
const connection = server.connect()
const reply = await connection.handleLine(line)
```

- A runtime-neutral Model Context Protocol server: no `node:` imports, WebCrypto only. Options are `TarcaOptions` plus `allowWrite` (default `false`), `confirmationSecret` (string or bytes, at least 16 bytes, otherwise a `configuration` error; default a random per-process secret), `confirmationTtlMs` (default 900 000), `recoveryDelayMs` (default 1000) and `now`. `defaults` and `recoveryDelayMs` are validated at creation (`configuration` error); the Billingo client is created lazily on the first tool call, so a missing key only fails the tools that call Billingo.
- `connect({ protocolVersion? })` returns `{ handle(message), handleLine(line) }`. Protocol: the stateless 2026-07-28 revision (`server/discover`, `tools/list`, `tools/call`, each with `_meta["io.modelcontextprotocol/protocolVersion"]` and `_meta["io.modelcontextprotocol/clientCapabilities"]`; an unknown modern version is `-32022` with the supported list) and the legacy `initialize` handshake (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05) with `ping`. Batches, ignored notifications and client responses, `-32700`, `-32600`, `-32601`, `-32602`, one-page `tools/list` (a `cursor` is `-32602`). A legacy `protocolVersion` passed to `connect` starts the session initialized (used by the HTTP handler).
- `server.tools` lists `{ name, title, write }`; `server.allowWrite`, `server.hasConfirmationSecret`.
- Tool results: success is two text blocks (a Hungarian summary and the JSON data) plus `structuredContent`. A tool error is `isError: true` with two text blocks and **no** `structuredContent`: the Hungarian message (with `Tipp:` when there is a hint) and `{"error":{"category","status","retryable","traceId","fields"}}`, where `fields` are field names only, never values. Categories are the `BillingoError` categories plus `invalid_input` (malformed tool arguments), `confirmation` (missing, malformed, expired or mismatched code), `refused` (the document's state does not allow the action), `write_disabled` and `internal`.

### Tools (21)

Read tools (always listed, `readOnlyHint: true`):

| Tool | What it does |
|---|---|
| `get_profile` | organization, blocks, bank accounts (id, name, currency; no account numbers, no tax code), the profile estimate and findings, the server's defaults |
| `list_documents` | `type` (`invoice` or `receipt`), `paymentStatus`, `partnerId`, `blockId`, `startDate`, `endDate`, `query`, `page`, `perPage` (≤ 100); newest first, a fresh document can be missing for 15–30 s |
| `get_document` | exactly one of `id` or `vendorId`; optional `includePayments`, `includeNavStatus`, `includePublicUrl` (one GET each). An unknown id (403) or vendorId is `{ found: false }` |
| `list_partners`, `get_partner` | `query` matches only the start of the words of the name |
| `list_products`, `get_product` | `includeStock` adds `inventory.quantity` (`null` without stock tracking) |
| `list_spendings`, `get_spending` | read only |
| `check_tax_number` | needs a live NAV connection; on a test profile it is a `nav_unavailable` tool error |
| `get_conversion_rate` | `currencies.rate`, `to` defaults to HUF |

Previews (listed always, read-only, each returns a confirmation code):

| Tool | Checks before any write |
|---|---|
| `preview_document` | tarca's own validation (`prepareDocument`, Hungarian `fieldErrors`), the block (given, `defaults.blockId` or the first `invoice` block; wrong type or unknown id is an error), the partner (`partnerId` must exist; an inline partner is reused only when every given field matches, as `findOrCreate` does), product items (prices from the product), the vendorId (given, or `MCP-` + the first 20 hex of `sha256(action, Budapest day, canonical input)`) and whether a document already has it, line and total amounts with Billingo's rounding model, labelled as an estimate. Types: `invoice`, `proforma`, `advance` |
| `preview_receipt` | the same for receipts: receipt block, gross prices, VAT `5`, `18`, `27`, `none`, `AAM`, `TAM`; `electronic` is required |
| `preview_cancellation` | refuses an already cancelled document, a cancellation, a modification, an original with a modification (`correctionType: 'modified'`), a draft and a proforma; warns to cancel newest first for advance and final invoices |
| `preview_payment` | outstanding = gross total − recorded payments; 0 or less means nothing to do (no code). Refuses receipts (always paid), cancelled documents and other types |
| `preview_send` | shows the document and the recipients (1–10 addresses) |

Writes (listed and callable only with `allowWrite`; each needs the code of its preview for exactly the same input, bound with HMAC-SHA256 over the action, the expiry, the preview's Budapest day and the canonical JSON of the input plus what the preview resolved from the clock and the server's defaults: for `create_document` the Budapest day, the block setting and the prepared body with its fulfillment and due dates; for `create_receipt` the vendorId, block setting, currency and payment method. A code from before midnight, or from an instance with other defaults, is a `confirmation` error and needs a new preview):

| Tool | Exactly once because |
|---|---|
| `create_document` | `documents.createOnce` with the preview's vendorId and its fulfillment and due dates (the code guarantees they are unchanged). `created: false` when the vendorId exists; `recovered: true` when Billingo's answer was lost and the lookup found the document |
| `create_receipt` | `receipts.createOnce`, same vendorId rule |
| `cancel_document` | the code is spent like `send_document`'s, so one code sends at most one POST, also for concurrent calls (a definite failure frees it, an uncertain one does not; per instance in HTTP mode). It reads the document first (already cancelled: no write); after an uncertain error or a 400 it reads it again and decides by `cancelled`, without a second POST |
| `mark_document_paid` | `payments.replace` with the existing payments plus one for the outstanding amount; the code is also bound to the outstanding amount, so a change since the preview needs a new preview; already paid: no write; after an uncertain error the payments are read back |
| `send_document` | a used code is remembered in the process and never sends twice (a definite failure frees it, an uncertain one does not). In HTTP mode across several instances this memory is per instance |

MCP defaults: `sendEmail` is `false` unless the tool input says `true`, even when `defaults.sendEmail` is `true`.

Deliberately not offered: `download_document` and `pos_print` (binary PDF in the model context; `get_document` gives the public URL), document reminders and `export_documents` (rare; the export is an asynchronous file, use `exports.run`), `create_modification_document` (a modification has no vendorId, exactly once needs a durable ledger), `create_document_from_proforma` (what a second conversion returns is not verified live), finalizing drafts, copy, delete, archive, deleting payments, and all partner, product, spending, bank account and document block writes (master data belongs to the Billingo UI or the library; inline partners are handled by `findOrCreate`).

### createTarcaMcpHandler(server, options)

```ts
import { createTarcaMcpHandler, createTarcaMcpServer, type TarcaMcpHandler } from 'tarca/mcp'

let handler: TarcaMcpHandler | undefined

export default {
  fetch(request: Request, env: Env) {
    handler ??= createTarcaMcpHandler(
      createTarcaMcpServer({ apiKey: env.BILLINGO_API_KEY, confirmationSecret: env.MCP_SECRET }),
      {
        authorize: (incoming) =>
          Boolean(env.MCP_TOKEN) &&
          incoming.headers.get('authorization') === `Bearer ${env.MCP_TOKEN}`,
      },
    )
    return handler(request)
  },
}
```

- Guard the token: without `Boolean(env.MCP_TOKEN)`, an unset token turns the check into `Bearer undefined`, which anyone can send. Create the server once per isolate, not per request: `send_document` remembers used codes in the server instance.

- `(request: Request) => Promise<Response>` for the Streamable HTTP POST on Cloudflare Workers, Vercel Edge, Deno and Bun. Order: only `POST` (anything else 405 with `Allow: POST`), the `Origin` header when present must be in `allowedOrigins` (default none, against DNS rebinding; otherwise 403), `authorize(request)` must resolve `true` (401; a throwing `authorize` is a 500 without details), `content-type: application/json` (415), the body at most `maxBodyBytes` (default 1 MiB, 413, measured while reading), valid UTF-8 JSON (400, `-32700`). Each request gets a fresh connection; a legacy client is served when it sends `MCP-Protocol-Version`. A notification-only body answers 202 without a body.
- `authorize` is required (a server-side Billingo key behind an anonymous endpoint would let anyone read or issue documents) and so is `confirmationSecret` on the server (a random per-process secret cannot verify a code issued by another instance). Both are `configuration` errors at creation.

### summarizeProfile(organization, { now, taxCode? }), profileFindings(summary)

- Billingo has no test-profile flag. Live, a developer test profile reads `hasNavConnection: false`, `features: []` and an expiration date of tomorrow. `kind` is `live` (NAV connection), `test` (no NAV, no features) or `live-without-nav` (features but no NAV).
- Findings: `profile` (fail when `taxCode` does not match; the tax code is never in a message), `nav` (warn on a live-looking profile without NAV), `subscription` (expired: fail, because writes get 402; within 14 days on a NAV-connected profile: warn; a non-test profile without an `api_limit_*` feature: warn, stating that only a write answering 402 proves the add-on is missing; the `api_limit_*` tier is listed). `doctor` and `get_profile` share this.
