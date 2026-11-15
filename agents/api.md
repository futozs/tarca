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
