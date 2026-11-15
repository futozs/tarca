---
name: tarca
description: Work with the Billingo API v3 (Hungarian invoicing) through the tarca npm package. Use when code issues or queries Billingo documents (számla, díjbekérő, előlegszámla, nyugta, sztornó, módosító számla), records payments, downloads PDFs, manages partners, products, document blocks, bank accounts or spendings, runs exports, handles BillingoError, turns Stripe, SimplePay, Barion, Revolut or PayPal payments into Billingo documents, stores document PDFs, runs bulk or recurring invoicing, sets up the tarca MCP server or CLI, tests Billingo code with tarca/testing, or mentions billingo.hu, Billingo API or BILLINGO_API_KEY.
---

# tarca: Billingo integration

Before writing code, read the package docs from `node_modules/tarca/agents/`:

- `pitfalls.md`: hard rules, always read it.
- `api.md`: exact method signatures for all 57 Billingo operations. Use only methods listed there; tarca is 0.x and names may still change between minor versions.
- `recipes.md`: webshop invoice with `createOnce`, proforma to invoice, receipts, PDFs and storage, exports, payment webhooks, serverless locks, the journal, monthly batches, MCP, logging, tests.

## Non-negotiable rules

1. Create one server-side client with `createTarca()`. The key comes from `BILLINGO_API_KEY`. Never import tarca in client-side code.
2. Never retry a write (create, update, delete, cancel, send) yourself. tarca retries only GET requests.
3. Issue documents with `documents.createOnce` / `receipts.createOnce` and a `vendorId` derived from the order or payment ID. Never call `documents.create` in a retry loop.
4. Branch on `BillingoError.category`, not on message text, and log `traceId`.
5. `update` replaces the whole resource: pass the complete object.
6. Use `toBillingoDate()` for dates, never `toISOString().slice(0, 10)`.
7. Develop against a Billingo developer test profile. Unit tests use `createMockTarca()` from `tarca/testing`; they never call the real API.
8. Payment provider webhooks use the `tarca/payments` handlers with `issueForPayment`; partial refunds need a `ledger` store with `setIfAbsent`. Under Express or NestJS wrap them with `toNodeHandler` from `tarca/node`, before `express.json()`.
9. With several instances (serverless, edge), pass a shared `createOnceLock` from `tarca/stores` (Redis, Upstash or a Durable Object; not Cloudflare KV).
10. `DocumentHookError` and `JournalWriteError` mean the document exists: record it, never issue it again.

## Checklist before finishing

- [ ] The key is read from the environment and never logged.
- [ ] Every create path goes through `createOnce` with a stable `vendorId`.
- [ ] Errors are handled by category, and `validation` errors surface `fieldErrors`.
- [ ] List code uses `all()` or loops pages with `perPage` at most 100.
- [ ] Non-retryable webhook errors (`validation`, a `refund-proposal`) go to a human instead of being rethrown forever.
- [ ] PDFs are stored with `tarca/storage` or fetched again with `documents.pdf`, not kept as base64 in the database.
- [ ] There is a unit test with `createMockTarca()`, including a `failNext(..., { afterSuccess: true })` case for the issuing path.
