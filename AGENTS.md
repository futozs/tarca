# AGENTS.md

This file guides AI agents that work **on this repository**. If you only *use* the `tarca` package, read [agents/README.md](./agents/README.md) instead.

## What this is

`tarca` is a zero-dependency TypeScript client for the **Billingo API v3** (Hungarian invoicing). It is the sibling of [`kassza`](https://github.com/futozs/kassza) (the official Számlázz.hu plugin) and copies its engineering: the same CI, live e2e, drift watcher, release flow, generated README and AI-ready docs. Someone who knows kassza should feel at home in tarca. tarca is an independent open-source project, not a Billingo product; never describe it as official.

Official sources: the developer portal https://developers.billingo.hu, the API guide https://developers.billingo.hu/post/api-v3, the changelog https://developers.billingo.hu/changelogs and the OpenAPI spec on SwaggerHub (`Billingo/Billingo`, default version 3.0.14, newest 3.0.15). Billingo's own MCP server (`@billingo/billingo-mcp`, https://github.com/octonull/billingo-mcp, MIT) documents real API behaviour in its live tests; read it before implementing a resource, but do not copy its code.

`kezdo-docs/` (gitignored) holds the research, the decisions, the roadmap and the starter prompts of the founding session. If it exists, read `kezdo-docs/00-OLVASS-EL.md` first.

## Commands

```bash
npm test
npm run spec:fetch
npm run spec:types
npm run readme
npm run e2e
npm run ci
```

- `npm test` runs Vitest. The live e2e (`tests/e2e/live.test.ts`) is excluded.
- `npm run spec:fetch` downloads every tracked OpenAPI version (the SwaggerHub default and anything newer) into `.spec-cache/`. The contract tests need it; without it they are skipped, unless `TARCA_REQUIRE_SPEC=1` (CI sets it), which turns a missing spec into a failure.
- `npm run spec:types` regenerates `src/generated/billingo.ts` from `.spec-cache/` (`scripts/generate-types.mjs`, `scripts/types-core.mjs`). Never edit that file by hand. CI runs it with `--check`, so any change to Billingo's spec fails CI until the types are regenerated and the client is adapted.
- `npm run drift` compares upstream sources with `scripts/drift.lock.json`: the SwaggerHub version list and default version, the sha256 of every tracked spec, the version numbers on the developer changelog, the `@billingo/billingo-mcp` version, and an **unauthenticated route probe** of all operations (a missing route answers 404, an existing one 401 or 405; about 80 seconds, paced under the 60 requests/minute anonymous limit). `--skip-routes` skips the probe. After adapting tarca to a change, run `npm run drift -- --update`. Only hashes and version numbers are stored, never docs text.
- `npm run readme` regenerates the README images in `readme/assets/` and then `README.md` (see [README](#readme)).
- `npm run e2e` runs the live scenario against a Billingo **developer test profile**. It needs `BILLINGO_TEST_API_KEY` and `BILLINGO_E2E_TAX_CODE` (see `.env.example`), and it is not part of `npm run ci`. See [E2E](#e2e).
- `npm run ci` runs lint, typecheck, the README sync check, coverage (at least 80%), build, publint and attw.
- `npm run smoke` runs `scripts/smoke.mjs` against the built `dist` (ESM and CommonJS). CI runs the same file under Bun and Deno, and `scripts/smoke-workerd.mjs` inside Cloudflare workerd (Miniflare).
- `npm run size` measures the gzip size of every entry point against `scripts/size-limits.json`.
- `npm run stats` prints npm downloads, GitHub dependents and stars. The package sends no telemetry and must never get any.
- `npm run commitlint` checks the commit messages since `origin/main`. `npm install` enables the local `commit-msg` hook.

## Layout

| Path | Contents |
|---|---|
| `src/core/context.ts` | Transport: `X-API-KEY`, JSON in snake_case, retries (GET only), timeout, abort, hooks |
| `src/core/operations.ts` | `BILLINGO_OPERATIONS`: every operation (operationId → method, path, which spec documents it) |
| `src/core/errors.ts` | `BillingoError`, status → category, the three Billingo error body shapes |
| `src/core/case.ts`, `src/core/url.ts` | camelCase ↔ snake_case conversion, path and query building |
| `src/core/pagination.ts` | `Page`, `list` + `all` (async iteration, `perPage` up to 100) |
| `src/core/dates.ts` | `Europe/Budapest` dates (`toBillingoDate`) |
| `src/generated/billingo.ts` | Generated spec types (camelCase, readonly). Exported as `import type { Billingo } from 'tarca'` |
| `src/<resource>/` | One folder per resource (`bank-accounts`, `currencies`, `organization`, `utils`, …), each a `create<X>Api(context)` factory |
| `src/client.ts` | `createTarca()`, which wires every resource to one context |
| `tests/helpers.ts` | `mockBillingo` (captures requests, scripted replies) and `createTestContext` |
| `tests/openapi.ts` | Strict OpenAPI validator and `contractErrors(schema, body)` against the fresh spec |
| `tests/spec-contract.test.ts` | The operations table and every field name against the spec |
| `tests/coverage.test.ts` | Implemented operations must have an e2e step or a justified exclusion; the number of unimplemented operations may only shrink |
| `tests/fake-billingo.ts` | A minimal in-memory Billingo for the fake e2e run (grows into `tarca/testing`) |
| `tests/e2e/` | `suite.ts` (the scenario), `guard.ts` (test profile guard), `throttle.ts`, `live.test.ts` (real API, only via `npm run e2e`), `fake.test.ts` (the same scenario against the fake, part of `npm test`) |
| `scripts/` | spec fetch and type generation, drift, release, changelog, commitlint, coverage badges, size, smoke, stats, e2e runner |
| `agents/` | Docs shipped in the npm package for AI agents of package users |
| `readme/` | README source: `template.md`, `config.json`, the `build.mjs` renderer, the `art/` SVG generator and the generated `assets/` |
| `web/content/docs/` | MDX docs (planned, same format as kassza); the website comes later |

## Conventions

- **No comments in code**: no `//`, no `/* */`, no JSDoc.
- English identifiers, Hungarian error messages, Hungarian test names.
- TypeScript is strict, with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `isolatedDeclarations`, so exported functions need explicit return types.
- Biome: single quotes, no semicolons, 100-column lines.
- Zero runtime dependencies. Keep `src/` runtime-neutral: no `Buffer`, no `node:` imports.
- The public API is camelCase; the wire format is snake_case. Convert only at the boundary (`toApiCase`, `fromApiCase`). Response types come from `src/generated/billingo.ts`; `context.json<T>()` is the single place where a response is trusted to match the spec.
- **Never retry a write.** The transport retries only GET (429, 5xx, network, timeout, 202 not ready), at most `maxAttempts` (default 3, cap 5), honouring `Retry-After` up to 60 seconds. A retried `POST /documents` issues a second invoice that is reported to NAV and can only be cancelled, never deleted. Exactly-once issuing goes through `vendorId` (`GET /documents/vendor/{vendor_id}`).
- PUT endpoints replace the whole resource; `update` methods take the full object.
- Every new operation needs: an entry in `BILLINGO_OPERATIONS` (already there for all known ones), a method on its resource API, a unit test with `mockBillingo`, a contract test (`contractErrors`) for every request body, an e2e step in `tests/e2e/suite.ts` (or a reason in `E2E_EXCLUDED`), the fake extended accordingly, and the ratchet number in `tests/coverage.test.ts` lowered.
- Every module has colocated `*.test.ts` files. Tests never call the real Billingo API, with one exception: `tests/e2e/live.test.ts`.
- When a public API changes, update `readme/template.md` (then `npm run readme`), `agents/api.md` and `agents/recipes.md` in the same change.

## E2E

`npm run e2e` is the only thing that proves the client still matches what Billingo really answers.

- It runs only against a Billingo **developer test profile** ("Fejlesztői teszt profil"): free, never switchable to live, no NAV connection, documents stamped "TESZT". Billingo has no separate sandbox host; the test profile uses the production API.
- The first step (`tests/e2e/guard.ts`) calls `organization.get()` and stops everything unless `hasNavConnection === false` and `taxCode` equals `BILLINGO_E2E_TAX_CODE`. Never weaken this guard.
- Variables: `BILLINGO_TEST_API_KEY` (read+write V3 key of the test profile), `BILLINGO_E2E_TAX_CODE`, `BILLINGO_E2E_EMAIL` (the only address the send step may mail), `BILLINGO_E2E_DELAY_MS` (default 1500). `scripts/e2e.mjs` loads `.env` and fails loudly when the key or the tax code is missing.
- Each group of steps stops at its first failure; an `auth`, `subscription` or `rate_limit` error stops the whole run. No retries and no loops: issued invoices cannot be deleted, only cancelled.
- It is gentle: requests are spaced at least 1.5 seconds apart (`tests/e2e/throttle.ts`), far under the 300 requests/minute limit. Names carry the `TARCA-E2E <runId>` prefix and are cleaned up where Billingo allows it.
- The last test fails when any operation in `E2E_OPERATIONS` never ran.
- `.github/workflows/e2e.yml` is a reusable workflow called by `.github/workflows/full-check.yml` (the **full check**: every Monday at 05:17 UTC, by hand, and before every release). The full check runs `ci.yml` in full (Node 22, 24, 26, strict spec mode, type sync check, size, publint, attw, Bun, Deno and workerd smoke), `scripts/drift.mjs` as a gate, and the live e2e after `ci` is green.
- The key lives only in the GitHub **environment** `e2e`, restricted to `main`. Pull requests and forks never get it. Never print the key, request headers or bodies in test output: Actions logs of a public repository are public.
- The owner's one-time setup is in `.github/BEALLITAS.md`.

## README

`README.md` is generated. Never edit it by hand: edit `readme/template.md` and run `npm run readme`. CI fails when `README.md` is out of sync (`npm run readme:check`). The images are generated by `readme/art/` from the website fonts (cached in `node_modules/.cache`); the brand blue is `#314EFF` and the logo is `assets/logo.svg`. The coverage badges read shields.io endpoint JSON from the `badges` branch, which `.github/workflows/badges.yml` force-pushes after every push to `main`; never commit to that branch by hand.

## Releasing

Identical to kassza. `scripts/release.mjs` picks the next version from the Conventional Commits since the last `v*` tag (`feat` minor, `fix` and `perf` patch, `!` or `BREAKING CHANGE` major; minor while on 0.x), runs `npm run ci`, writes `package.json` and `CHANGELOG.md`, publishes, waits for the registry, then commits `release: vX.Y.Z`, tags and pushes. `.github/workflows/release.yml` runs it for every push to `main` after the full check is green, and exits early when there is no releasable commit. The jump from 0.x to 1.0.0 needs `TARCA_ALLOW_STABLE=1` (the `stable` checkbox of the manual run).

`package.json` has `"private": true` until the first release, so nothing can be published by accident. Removing it is the owner's decision.

Write commit messages as Conventional Commits (`feat: ...`, `fix: ...`), with no AI attribution.
