# tarca (English overview)

tarca is a zero-dependency TypeScript client for the [Billingo](https://www.billingo.hu) API v3, a Hungarian invoicing service. The main README is in Hungarian, because the domain (Hungarian VAT, NAV reporting, receipt rules) is Hungarian. This page is a short entry point for developers who do not read Hungarian.

tarca is an independent open-source project. It is not made by Billingo and is not affiliated with or endorsed by Billingo.

```bash
npm install tarca
```

```ts
import { createTarca } from 'tarca'

const tarca = createTarca() // reads BILLINGO_API_KEY

const company = await tarca.utils.checkTaxNumber('12345676-2-41')

if (company.result === 'validation_ok') {
  console.log(company.taxpayerName, company.addresses?.[0]?.city)
}
```

## Status

tarca is 0.x and under active development. The API may still change between 0.x releases; see the [changelog](CHANGELOG.md) (in Hungarian).

Available today:

- Organization data: `tarca.organization.get()`
- Utilities: `tarca.utils.serverTime()`, `checkTaxNumber()`, `convertLegacyId()`
- Exchange rates: `tarca.currencies.rate({ from, to, date })`
- Bank accounts: `tarca.bankAccounts.list()`, `all()`, `get()`, `create()`, `update()`, `delete()`
- `verifyCredentials()` and `nullIfNotFound()`
- Full TypeScript types generated from the official OpenAPI spec (3.0.14 and 3.0.15): `import type { Billingo } from 'tarca'`

Planned: documents (invoices, proformas, advance invoices, drafts, receipts, cancellations, modifications, copies, sending, PDFs, POS printing, public URLs, payments, NAV status, exactly-once `createOnce` via `vendorId`), partners, products, document blocks, spendings, export, inventory, a fake Billingo for tests (`tarca/testing`), a CLI and an MCP server. The goal is all 54 documented operations of the API, plus the 2 undocumented ones that work in production.

## How it behaves

- Zero runtime dependencies, native `fetch`. ESM and CommonJS builds. CI runs the built package on Node.js 22+, Bun, Deno and Cloudflare workerd.
- Each `createTarca()` instance has its own API key and settings, so one process can serve several Billingo accounts.
- Field names are camelCase in TypeScript; tarca converts to and from Billingo's snake_case at the boundary.
- Reads (GET) are retried after 429, 5xx, network errors and timeouts, honouring `Retry-After`, 3 attempts by default. Writes (POST, PUT, DELETE) are never retried automatically.
- Errors are `BillingoError` with a `category` (`auth`, `subscription`, `forbidden`, `not_found`, `validation`, `rate_limit`, `server`, `not_ready`, `network`, `timeout`, `configuration`, `unexpected_response`), plus `fieldErrors`, `traceId` and a `hint`. Messages are in Hungarian.
- Hooks (`onRequest`, `onResponse`, `onError`, `onComplete`, `onWarning`) never receive the API key.
- Sends no telemetry.

License: MIT.
