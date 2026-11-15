# tarca for AI coding agents

`tarca` is a zero-dependency TypeScript client for the Billingo API v3, a Hungarian invoicing service. It is the sibling of `kassza` (the Számlázz.hu client) and follows the same patterns. It is an independent open-source project, not a Billingo product.

Status: 0.x, under development. Implemented today:

- `tarca.organization.get()`: the organization behind the API key (tax code, subscription, NAV connection).
- `tarca.utils.serverTime()`, `tarca.utils.checkTaxNumber(taxNumber)`, `tarca.utils.convertLegacyId(legacyId)`.
- `tarca.currencies.rate({ from, to, date })`.
- `tarca.bankAccounts.list/all/get/create/update/delete`.
- `tarca.verifyCredentials()`, `nullIfNotFound()`, `BillingoError`, request hooks, and TypeScript types for every Billingo schema (`import type { Billingo } from 'tarca'`).

Documents (invoices, proformas, receipts, cancellations, PDFs, payments), partners, products, document blocks, spendings and exports are planned next. Check [api.md](./api.md) for what exists in the installed version before using a method.

It runs on Node 22+, Bun, Deno, Cloudflare Workers and Vercel Edge.

## Read in this order

1. [pitfalls.md](./pitfalls.md): hard rules. Follow them or you will issue duplicate invoices that are reported to NAV.
2. [api.md](./api.md): every method, input and output.
3. [recipes.md](./recipes.md): setup, error handling, pagination, tests.

A ready-made Claude Code skill is in [skills/tarca/SKILL.md](./skills/tarca/SKILL.md). Copy the `skills/tarca` folder into `.claude/skills/` in the user's project.

## The five things to get right

1. Create the client once, on the server only: `createTarca()`. It reads `BILLINGO_API_KEY` (a V3 key from Billingo: Beállítások → API kulcsok). Never ship the key to a browser.
2. Never retry a document create yourself. tarca retries only GET requests. For exactly-once issuing, give every document a `vendorId` derived from the order ID, and look it up before issuing again.
3. Branch on `BillingoError.category`, not on message text. Log `traceId`; Billingo support asks for it.
4. PUT endpoints replace the whole resource: pass the full object to `update`.
5. Develop and test against a Billingo developer test profile, never a live profile. In unit tests, mock `fetch` instead of calling the API.
