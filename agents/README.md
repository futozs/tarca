# tarca for AI coding agents

`tarca` is a zero-dependency TypeScript client for the Billingo API v3, a Hungarian invoicing service. It is the sibling of `kassza` (the Számlázz.hu client) and follows the same patterns. It is an independent open-source project, not a Billingo product.

Status: 0.x. Every Billingo API v3 operation is implemented (57: the 54 documented in the 3.0.14 and 3.0.15 specs plus 3 undocumented document block routes verified live), and every one runs in a live end-to-end test on a Billingo developer test profile:

- `tarca.documents`: invoices, proformas, advance and final invoices, drafts, `createOnce` (exactly-once issuing by `vendorId`), get and list, PDF and POS PDF, public URL, e-mail sending, reminders, NAV status, cancellation, copy, archive, invoice from proforma, modification documents, and `documents.payments`.
- `tarca.receipts`: receipts, with or without a partner, `createOnce`, drafts.
- `tarca.partners` (with `findOrCreate`), `tarca.products`, `tarca.inventory`, `tarca.documentBlocks`, `tarca.bankAccounts`, `tarca.spendings`, `tarca.exports`.
- `tarca.organization`, `tarca.utils` (server time, tax number check, legacy ID), `tarca.currencies`.
- `tarca.verifyCredentials()`, `nullIfNotFound()`, `BillingoError`, request hooks, and TypeScript types for every Billingo schema (`import type { Billingo } from 'tarca'`).
- `tarca/testing`: `createMockTarca()` and `createFakeBillingoFetch()`, an in-memory Billingo for the user's own tests.

The API may still change between 0.x releases; [api.md](./api.md) is the reference for the installed version.

It runs on Node 22+, Bun, Deno, Cloudflare Workers and Vercel Edge.

## Read in this order

1. [pitfalls.md](./pitfalls.md): hard rules. Follow them or you will issue duplicate invoices that are reported to NAV.
2. [api.md](./api.md): every method, input and output.
3. [recipes.md](./recipes.md): webshop invoices, proforma to invoice, receipts, PDFs, exports, error handling, tests.

A ready-made Claude Code skill is in [skills/tarca/SKILL.md](./skills/tarca/SKILL.md). Copy the `skills/tarca` folder into `.claude/skills/` in the user's project.

## The five things to get right

1. Create the client once, on the server only: `createTarca()`. It reads `BILLINGO_API_KEY` (a V3 key from Billingo: Beállítások → API kulcsok). Never ship the key to a browser.
2. Never retry a document create yourself. tarca retries only GET requests. Issue through `documents.createOnce` / `receipts.createOnce` with a `vendorId` derived from the order or payment ID: they look the document up first and recover after uncertain failures.
3. Branch on `BillingoError.category`, not on message text. Log `traceId`; Billingo support asks for it.
4. PUT endpoints replace the whole resource: pass the full object to `update`.
5. Develop and test against a Billingo developer test profile, never a live profile. In unit tests use `createMockTarca()` from `tarca/testing` instead of calling the API.
