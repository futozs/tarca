# tarca (English overview)

tarca is a zero-dependency TypeScript client for the [Billingo](https://www.billingo.hu) API v3, a Hungarian invoicing service. The main README is in Hungarian, because the domain (Hungarian VAT, NAV reporting, receipt rules) is Hungarian. This page is a short entry point for developers who do not read Hungarian.

tarca is an independent open-source project. It is not made by Billingo and is not affiliated with or endorsed by Billingo.

```bash
npm install tarca
```

```ts
import { createTarca } from 'tarca'

const tarca = createTarca() // reads BILLINGO_API_KEY

const invoice = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    emails: ['vevo@ceg.hu'],
  },
  items: [{ name: 'Web development', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

console.log(invoice.invoiceNumber, invoice.grossTotal)
```

tarca finds the partner or creates it, and fills in the document block, the fulfillment date, the 8-day payment deadline and the VAT code. Invalid input is rejected before the request is sent.

For webshops and webhooks, use `createOnce()` with the order ID as `vendorId`. It looks the document up first, so running the same call twice (a webhook delivered twice, a retried job) never issues a second invoice.

## Status

tarca is 0.x. All 57 Billingo API v3 operations are implemented: the 54 documented in the 3.0.14 and 3.0.15 OpenAPI specs plus 3 undocumented document block routes that work in production. Every operation runs in a live end-to-end test against a Billingo developer test profile. The API may still change between 0.x releases; see the [changelog](CHANGELOG.md) (in Hungarian).

- Documents: invoices, proformas, advance and final invoices, drafts, copies, cancellations, modification documents, `createOnce` (exactly-once issuing through `vendorId`), PDF and POS PDF download, public URLs, sending by e-mail, reminders, NAV status, payments (`tarca.documents.*`)
- Receipts: `tarca.receipts.create()`, `createOnce()`, `finalizeDraft()`
- Partners (including `findOrCreate()`), products, inventory, document blocks, bank accounts, spendings, exports
- Organization data, tax number check, server time, legacy ID conversion, exchange rates
- `tarca/testing`: an in-memory fake Billingo (`createFakeBillingoFetch()`) and `createMockTarca()` for your own tests
- Full TypeScript types generated from the official OpenAPI spec, corrected where the live API differs: `import type { Billingo } from 'tarca'`

Add-ons, each a separate subpath that the root `tarca` entry never loads:

- `tarca/payments` (`/stripe`, `/simplepay`, `/barion`, `/revolut`, `/paypal`): verifies the provider's webhook without its SDK and issues a receipt or an invoice exactly once, with the payment id as `vendorId`. Refunds become a cancellation or, for a partial refund, a modification invoice.
- `tarca/storage` and `tarca/storage/fs` (Node): stores document PDFs in S3, Cloudflare R2, Vercel Blob, Supabase, UploadThing or on disk. S3 is signed with SigV4 over `fetch`, no AWS SDK.
- `tarca/stores`: Upstash, Redis, Durable Object and Cloudflare KV adapters for the cross-process `createOnce` lock, the journal, webhook dedupe and the refund ledger.
- `tarca/journal`: an append-only record of every issued, cancelled and modified document, reconciled against Billingo.
- `tarca/batch`: bulk and recurring invoicing, exactly once and paced under the rate limit, with a dry run.
- `tarca/observe`: redacted structured logs, OpenTelemetry-compatible spans and Prometheus metrics.
- `tarca/node`: mounts the web-standard handlers under Node `http`, Express, NestJS and Fastify with the raw body intact.
- `tarca/mcp` and the `tarca` command: `npx tarca doctor` checks the key, profile, NAV connection, subscription and document blocks read-only; `npx tarca mcp` is an MCP server for AI assistants that issues documents only with `--allow-write` and a confirmation code from a preview.

Planned: a documentation website.

## How it behaves

- Zero runtime dependencies, native `fetch`. ESM and CommonJS builds. CI runs the built package on Node.js 22+, Bun, Deno and Cloudflare workerd.
- Each `createTarca()` instance has its own API key and settings, so one process can serve several Billingo accounts.
- Field names are camelCase in TypeScript; tarca converts to and from Billingo's snake_case at the boundary.
- Reads (GET) are retried after 429, 5xx, network errors and timeouts, honouring `Retry-After`, 3 attempts by default. Writes (POST, PUT, DELETE) are never retried automatically.
- Errors are `BillingoError` with a `category` (`auth`, `nav_unavailable`, `subscription`, `forbidden`, `not_found`, `validation`, `rate_limit`, `server`, `not_ready`, `network`, `timeout`, `configuration`, `unexpected_response`, `in_progress`, `store_unavailable`), plus `fieldErrors`, `traceId` and a `hint`. Messages are in Hungarian.
- Hooks (`onRequest`, `onResponse`, `onError`, `onComplete`, `onWarning`, and `onDocument` for every new document) never receive the API key.
- Sends no telemetry.

License: MIT.
