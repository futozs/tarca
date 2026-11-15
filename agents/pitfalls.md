# tarca pitfalls

## Duplicate and irreversible documents

- An issued invoice (and its cancellation) is reported to NAV automatically on a live profile and cannot be deleted, only cancelled. A second, accidental invoice is a real tax document.
- tarca retries only GET requests. Do not wrap a create call in your own retry loop, queue redelivery or `Promise.all` race.
- Give every document a `vendorId` derived from your order or payment ID. It is unique per Billingo company; a duplicate is rejected with HTTP 400. After a `network`, `timeout`, `server` or `unexpected_response` error on a create, look the document up by `vendorId` before doing anything else.
- Only drafts can be deleted. Partners, products, bank accounts and spendings can be deleted.

## Keys, profiles and plans

- One API key belongs to one Billingo company profile. For several companies, create one client per key.
- Keys are either read-only or read+write. A read-only key gets `forbidden` on writes.
- On a live profile, issuing documents through the API needs the paid "API + Tömeges" add-on, and proformas or e-invoices also need at least the Basic plan. Missing subscription gives category `subscription` (HTTP 402). Only writes count against the monthly API quota.
- For development use a **developer test profile** ("Fejlesztői teszt profil"): free, no NAV connection, documents stamped "TESZT". It can never be switched to live, so production needs a separate profile and key.

## Limits

- 300 requests per minute with a key, 60 without. The `X-RateLimit-*` headers declared in the spec are not sent in practice; a 429 has category `rate_limit` and `retryAfterMs` when Billingo sends `Retry-After`.
- A freshly created document's PDF may not be ready for a few seconds: the download answers 202, which tarca reports as category `not_ready` (retryable).
- List endpoints return at most 100 items per page. Use `all()` to iterate every page.

## Data shapes

- tarca uses camelCase; Billingo's JSON is snake_case. tarca converts both ways. Do not send snake_case keys yourself.
- Dates are `YYYY-MM-DD` in Europe/Budapest. Use `toBillingoDate()` instead of `toISOString().slice(0, 10)`, which gives the UTC date and is wrong around midnight.
- PUT replaces the whole resource. `update(id, input)` needs the complete object, not just the changed fields.
- VAT codes are strings in Billingo (`'27%'`, `'5%'`, `'AAM'`, `'TAM'` …), see `Billingo.Vat`.

## Error categories

| Category | HTTP | Meaning | Retryable |
|---|---|---|---|
| `auth` | 401 | Missing or invalid API key | no |
| `subscription` | 402 | The plan does not allow the operation | no |
| `forbidden` | 403 | Read-only key, or an ID from another company | no |
| `not_found` | 404 | No such resource | no |
| `validation` | 400, 422 | Bad request; `fieldErrors` lists the fields for 422 | no |
| `rate_limit` | 429 | Too many requests | yes (GET) |
| `not_ready` | 202 | PDF not generated yet | yes (GET) |
| `server` | 5xx | Billingo error | yes (GET) |
| `network`, `timeout` | none | No answer; for writes, look the document up before retrying | yes (GET) |
| `configuration` | none | Missing key, invalid option | no |
| `unexpected_response` | 2xx | The body was not valid JSON | no |
