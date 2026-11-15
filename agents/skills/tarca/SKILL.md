---
name: tarca
description: Work with the Billingo API v3 (Hungarian invoicing) through the tarca npm package. Use when code reads Billingo organization data, bank accounts, exchange rates or tax numbers, issues or queries Billingo documents (számla, díjbekérő, nyugta, sztornó), handles BillingoError, or mentions billingo.hu, Billingo API or BILLINGO_API_KEY.
---

# tarca: Billingo integration

Before writing code, read the package docs from `node_modules/tarca/agents/`:

- `pitfalls.md`: hard rules, always read it.
- `api.md`: exact method signatures. Use only methods listed there; tarca is 0.x and some Billingo resources are not implemented yet.
- `recipes.md`: setup, errors, pagination, tests.

## Non-negotiable rules

1. Create one server-side client with `createTarca()`. The key comes from `BILLINGO_API_KEY`. Never import tarca in client-side code.
2. Never retry a write (create, update, delete, cancel, send) yourself. tarca retries only GET requests.
3. Give every document a `vendorId` derived from the order ID, and look it up by `vendorId` before issuing again after an uncertain failure.
4. Branch on `BillingoError.category`, not on message text, and log `traceId`.
5. `update` replaces the whole resource: pass the complete object.
6. Use `toBillingoDate()` for dates, never `toISOString().slice(0, 10)`.
7. Develop against a Billingo developer test profile. Unit tests inject `fetch`; they never call the real API.

## Checklist before finishing

- [ ] The key is read from the environment and never logged.
- [ ] Every create path is idempotent through `vendorId`.
- [ ] Errors are handled by category, and `validation` errors surface `fieldErrors`.
- [ ] List code uses `all()` or loops pages with `perPage` at most 100.
- [ ] There is a unit test with an injected `fetch`.
