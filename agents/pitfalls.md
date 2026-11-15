# tarca pitfalls

## Duplicate and irreversible documents

- An issued invoice (and its cancellation) is reported to NAV automatically on a live profile and cannot be deleted, only cancelled. A second, accidental invoice is a real tax document.
- tarca retries only GET requests. Do not wrap a create call in your own retry loop, queue redelivery or `Promise.all` race.
- Give every document a `vendorId` derived from your order or payment ID. It is unique per Billingo company; a duplicate is rejected with HTTP 400. After a `network`, `timeout`, `server` or `unexpected_response` error on a create, look the document up by `vendorId` before doing anything else.
- Only drafts can be deleted. Partners, products, bank accounts and spendings can be deleted.
- Use `documents.createOnce` / `receipts.createOnce` instead of hand-rolled lookups: they handle the lookup, the 400 `Duplicate vendor id.` race and the uncertain failures. A vendorId stays reserved after cancellation, so re-issuing a cancelled order needs a new vendorId.
- A vendorId of `.` or `..` is rejected locally (`validation`, no request): the URL parser in `fetch` treats it as a path step, so `GET /documents/vendor/..` would become `GET /documents/` (the document list).
- `documents.get` on a deleted or unknown id answers 403 (`forbidden`), not 404. `findByVendorId` does answer `null` for an unknown vendorId.
- The document list is eventually consistent: a document issued a few seconds ago may be missing from `list()` for 15–30 seconds.
- Cancel newest first: a final invoice before its advance invoice. After `createModification` neither the original invoice nor the modification can be cancelled (400 `Cannot cancel the document`); correct it with another modification document instead.
- An invoice made with `createFromProforma` is already `paid`; recording a payment on it double-counts. A receipt is always `paid` as well.
- `payments.replace` is a full replace and `payments.add` is a read-then-write: let only one process write a document's payments at a time.

## Partners and search

- `GET /partners?query=` matches only the start of the words of the partner **name**, never the tax number or the e-mail. Use `partners.findOrCreate(input)` for invoicing: it compares every field you give and creates a new partner on any difference, so an invoice never carries stale buyer data.
- Billingo's partner search index lags: a partner created or renamed in the last 20–60 seconds is often missing from `list({ query })`, and after a delete `total` stays stale for minutes while `data` is already empty. `findOrCreate` right after a create can therefore make a harmless duplicate partner; never build "exists?" logic on an immediate search.
- `partners.guess()` is an upsert, not a search: it returns an existing partner only for an exactly equal name and creates a new one otherwise (also when the tax number matches). It always answers 201.
- A partner with documents can be deleted; the documents keep their embedded copy of the partner.

## Keys, profiles and plans

- One API key belongs to one Billingo company profile. For several companies, create one client per key.
- Keys are either read-only or read+write. A read-only key gets `forbidden` on writes.
- On a live profile, issuing documents through the API needs the paid "API + Tömeges" add-on, and proformas or e-invoices also need at least the Basic plan. Missing subscription gives category `subscription` (HTTP 402). Only writes count against the monthly API quota.
- For development use a **developer test profile** ("Fejlesztői teszt profil"): free, no NAV connection, documents stamped "TESZT". It can never be switched to live, so production needs a separate profile and key.

## Limits

- 300 requests per minute with a key, 60 without. Billingo sends `x-ratelimit-limit` and `x-ratelimit-remaining` only on binary responses (PDF, POS PDF, export download), never `x-ratelimit-reset`; JSON responses carry none of the `X-RateLimit-*` headers the spec declares. `rateLimit` on `onResponse` is therefore set only for those downloads. A 429 has category `rate_limit` and `retryAfterMs` when Billingo sends `Retry-After`.
- A freshly created document's PDF may not be ready for a few seconds: the download answers 202, which tarca reports as category `not_ready` (retryable). `documents.pdf` waits for it up to `maxWaitMs` (30 s) in total; the transport itself does not retry a 202. Live it was usually ready within 2 seconds.
- The POS PDF arrives as `application/octet-stream`; tarca checks the `%PDF` signature, not the content type.
- `documents.navStatus` returns `null` for the first seconds after issuing: Billingo has no NAV record yet and answers 404 `NavOnlineSzamla is not found.`.
- List endpoints return at most 100 items per page. Use `all()` to iterate every page.

## Data shapes

- tarca uses camelCase; Billingo's JSON is snake_case. tarca converts both ways. Do not send snake_case keys yourself.
- Dates are `YYYY-MM-DD` in Europe/Budapest. Use `toBillingoDate()` instead of `toISOString().slice(0, 10)`, which gives the UTC date and is wrong around midnight.
- PUT replaces the whole resource. `update(id, input)` needs the complete object without its `id`, not just the changed fields: an omitted `comment`, `phone`, `emails`, IBAN or custom field is cleared. Only `documentBlocks.update` accepts the object returned by `get()` as is (tarca drops `id`, `picPath` and the `null` e-mail fields Billingo would reject).
- Products take exactly one price (`netUnitPrice` or `grossUnitPrice`); Billingo computes the other. A product from `get()` has both, so drop one before `update`.
- Spendings need `conversionRate` (`1` for HUF), `invoiceNumber`, `invoiceDate` and `dueDate` although the spec marks them optional. Document block names may contain only letters, digits and spaces.
- VAT codes are strings in Billingo (`'27%'`, `'5%'`, `'AAM'`, `'TAM'` …), see `Billingo.Vat`.
- Several fields that the official spec marks non-nullable come back as `null` (pagination URLs at the first and last page, `Document.discount`, `recurringId`, item `entitlement`, `sku`, `ean`, `dataEraserCodes`, partner `customBillingSettings.dueDays` and `documentCurrency`, product `entitlement`, `connectProductId`, `purchasePrice`, spending `partner`). The `Billingo` types already say `| null` for these, so check with `!= null`, not `!== undefined`.
- `checkTaxNumber` needs a live NAV connection. On a developer test profile it always fails with category `nav_unavailable` (HTTP 401), even with a valid key.

## Webhooks, stores and AI tools

- Payment webhooks verify the raw body. Mount them before `express.json()` (`toNodeHandler` from `tarcajs/node`), and never re-serialize the body before passing it on.
- Let a webhook answer 500 when issuing fails: the provider redelivers and `createOnce` returns the existing document. Do not catch and swallow errors in `onPayment`, except for a `refund-proposal`, a `refund-failed` or a `validation` error that needs a human.
- A refund whose payment has no document yet throws `in_progress` on purpose: the paid event may still be waiting for redelivery, and acknowledging the refund would let that redelivery issue a document for returned money. Acknowledge it only for payments that will never get a document. Barion is the exception: its callback is a snapshot of the whole payment (`includesPayment: true`) and no separate paid event comes after a refund, so a refund with no document first issues the payment's document from the same state, then cancels or modifies it.
- A Stripe refund can fail after `charge.refunded`, when tarca has already cancelled or modified the document. `charge.refund.updated` then gives `refund-failed`; correct the books by hand.
- Without a Stripe `apiKey`, `payment_intent.succeeded` issues nothing (`other`): its order relative to `checkout.session.completed` is not guaranteed, and it carries no buyer tax data.
- A partial refund without a `ledger` only gives a proposal. A `ledger` without `setIfAbsent` (Cloudflare KV, a plain get/set/delete store) is a `configuration` error for partial and full refunds alike, so the webhook answers 500 until you fix it: use a store with `setIfAbsent`. Billingo's modification invoice has no `vendorId`, so the ledger (or the comment marker search) is the only thing that prevents a second one; never delete a `tarca:refund:` key by hand while a refund is pending.
- `DocumentHookError` and `JournalWriteError` arrive after the document exists. Record `error.document` / `error.result`; never issue again.
- Cloudflare KV is eventually consistent and has no atomic write: it is fine for webhook dedupe, never for the `createOnce` lock, the journal or the refund ledger. `resilient: true` stores swallow errors and are unsuitable for the same three. Check a store with `diagnoseStore`.
- The MCP server's write tools need `allowWrite` and a confirmation code from a preview of the same input. On the edge, `authorize` and a `confirmationSecret` of at least 16 bytes are required, and the server must be created once per isolate, not per request.
- `toNodeHandler` without `onError` logs only an error summary; your own logs should not print BillingoError messages either, because a `validation` message can quote an e-mail address or a vendorId. `tarcajs/observe` redacts by default.

## Error categories

| Category | HTTP | Meaning | Retryable |
|---|---|---|---|
| `auth` | 401 | Missing or invalid API key | no |
| `nav_unavailable` | 401, 403 | The feature needs a live NAV connection the profile does not have (for example `checkTaxNumber` on a developer test profile). The key is valid; this is not an `auth` error | no |
| `subscription` | 402 | The plan does not allow the operation | no |
| `forbidden` | 403 | Read-only key, or an ID from another company | no |
| `not_found` | 404 | No such resource | no |
| `validation` | 400, 422 | Bad request; `fieldErrors` lists the fields for 422 | no |
| `rate_limit` | 429 | Too many requests | yes (GET) |
| `not_ready` | 202 | PDF not generated yet | yes (`documents.pdf` waits for it) |
| `server` | 5xx | Billingo error | yes (GET) |
| `network`, `timeout` | none | No answer; for writes, look the document up before retrying | yes (GET) |
| `configuration` | none | Missing key, invalid option | no |
| `in_progress` | none | `createOnce` with a lock: another process is issuing the same vendorId; call again later | no |
| `store_unavailable` | none | `createOnce` with a lock: the lock store failed, nothing was issued | no |
| `unexpected_response` | 2xx | The body was empty or not valid JSON where JSON was expected. On a write the operation may still have happened on Billingo's side: check before repeating it | no |
