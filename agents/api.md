# tarca API reference

Only what is implemented in this version. Every method takes an optional last argument `options?: { signal?: AbortSignal }`.

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
| `timeoutMs` | `30000` | Per attempt |
| `maxAttempts` | `3` (cap `5`) | GET only; writes always run once |
| `retryDelayMs` | `1000` | Exponential backoff with ±20% jitter; `Retry-After` wins when larger (up to 60 s) |
| `hooks` | none | Hook errors never break a request; they go to `onWarning` |

Hook events: `{ operation, method, path, attempt, requestId }`, plus `status`, `durationMs`, `rateLimit` on `onResponse`, `error`, `willRetry` on `onError`, `outcome` on `onComplete`.

## tarca.organization

- `get(): Promise<Billingo.OrganizationData>`: `{ taxCode, subscription, hasNavConnection, kobakReceiptFsEnabled, hasSuccessfulNavReceiptSubmission }`.

## tarca.utils

- `serverTime(): Promise<Billingo.ServerTime>`
- `checkTaxNumber(taxNumber: string): Promise<Billingo.TaxNumberCheckResponse>`: NAV lookup through Billingo. Needs a live NAV connection; on a test profile Billingo answers 401.
- `convertLegacyId(legacyId: number): Promise<Billingo.Id>`: v2 ID to v3 ID.

## tarca.currencies

- `rate({ from, to, date? }): Promise<{ from, to, rate, date }>`: `from`/`to` are `Billingo.Currency`, `date` is a `Date` or `YYYY-MM-DD` (Budapest).

## tarca.bankAccounts

- `list({ page?, perPage? }): Promise<Page<Billingo.BankAccount>>`, where `Page<T>` is `{ data, total, perPage, currentPage, lastPage }` and `perPage` is at most 100.
- `all({ perPage? }): AsyncGenerator<Billingo.BankAccount>`
- `get(id)`, `create(input)`, `update(id, input)` (full replace), `delete(id)`
- `input`: `{ name, accountNumber, currency, accountNumberIban?, swift?, needQr? }`

## Helpers

- `tarca.verifyCredentials(): Promise<boolean>`: `false` on `auth`, throws on anything else.
- `nullIfNotFound(promise)`: resolves `null` for a 404.
- `toBillingoDate(date | 'YYYY-MM-DD')`, `todayInBudapest()`, `addBudapestDays(date, days)`.
- `isBillingoError(error)`, `BillingoError` fields: `category`, `status`, `operation`, `apiMessage`, `fieldErrors`, `traceId`, `retryAfterMs`, `rateLimit`, `hint`, `retryable`, `isNotFound`.
- `BILLINGO_OPERATIONS`: every Billingo operation (method, path, which spec version documents it).
- `import type { Billingo } from 'tarca'`: every schema of the official spec, camelCase.

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
- Options are the fake's options (except `apiKeys`) plus `credentialsValid` (`false`: every request gets 401, `verifyCredentials()` resolves `false`).
- `tarca.billingo` is the underlying fake: inspect `requests`, `data` or inject wire-level faults there.

### createFakeBillingoFetch(options?)

```ts
import { createTarca } from 'tarca'
import { createFakeBillingoFetch } from 'tarca/testing'

const billingo = createFakeBillingoFetch()
const tarca = createTarca({ apiKey: 'test', fetch: billingo.fetch, retryDelayMs: 0 })
```

- An in-memory Billingo v3 behind a `fetch`. It speaks the wire format: snake_case JSON, `X-API-KEY` required, Laravel pagination (`page`, `per_page` 1–100, default 25, `total`, `per_page`, `current_page`, `last_page`, `prev_page_url`, `next_page_url` with only `?page=N`, `null` at the ends), newest item first.
- Error bodies match Billingo: `{ error: { message } }` for 4xx, `{ error: { message, trace_id } }` for 5xx, `{ message: 'Validation Failed', errors: [{ field, message }] }` for 422 with Laravel messages. The known Billingo messages (from live runs, the spec or Billingo support) are in `FAKE_BILLINGO_MESSAGES`.
- Routing as measured live: an unknown path answers 404 `{ error: { message: '' } }` and a wrong method 405 (`The PATCH method is not supported for this route. Supported methods: GET, HEAD, PUT, DELETE.`), both before the key check; then a missing or unknown key gives 401. An unknown or foreign numeric id gives 403 with Billingo's permission message, not 404. A real Billingo operation the fake does not implement yet answers 501 naming the operation.
- Implemented: `GetOrganizationData`, `GetServerTime`, `CheckTaxNumber` (422 for a malformed number, 401 with the NAV sandbox message without `hasNavConnection`, otherwise looked up in `taxpayers`), `GetId` (from `legacyIds`), `GetConversionRate` (from `hufRates`), and full bank account CRUD (create answers 201 with the full object; PUT is a full replace).
- Fresh state is a new test profile: tax code `00000000-0-00`, `has_nav_connection: false`, subscription until tomorrow (Budapest), and two document blocks: 1 `Számlák` (`invoice`, no prefix) and 2 `Nyugták` (`receipt`, prefix `NYT`). Ids start at 1 per resource and per instance.
- Options: `now`, `apiKeys` (accept only these keys), `taxCode`, `hasNavConnection`, `subscription: { expirationDate?, features? }`, `hufRates` (HUF per unit, default `EUR 390, USD 360, GBP 460, CHF 410`), `taxpayers` (keyed by tax number or its first 8 digits), `legacyIds` (`{ [v2Id]: v3Id }`), `faults`.
- `FakeBillingo` is `{ fetch, requests, data, count(operation?), counts(), fail(fault, { operation?, times?, afterSuccess? }), reset() }`. `requests` records `{ operation, method, path, query, body, status, faulted }` and never the key. `data` exposes the resources as read-only maps (`bankAccounts`, `documentBlocks`).
- Faults: `'network'` (fetch rejects with `TypeError`), `'timeout'` (`TimeoutError`), `'notReady'` (202 with `Document PDF has not generated yet.`), or `{ status: 400–599, message? }` in Billingo's body shape. They match the next request of `operation` (or any request), FIFO, `times` in a row, after the key check. `afterSuccess` runs the operation first, so the state changes but the client sees the fault, which is how to test lost responses on writes.
