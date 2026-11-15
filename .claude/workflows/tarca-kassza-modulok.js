export const meta = {
  name: 'tarca-kassza-modulok',
  description: 'Port kassza extension modules to tarca (CLI, MCP, payments, storage, stores, journal, node, batch, observe): plan, implement in disjoint groups, adversarial check, integrate',
  whenToUse:
    'Roadmap phases 4 and 5, or later when kassza gains a module tarca should mirror. args (optional): { groups?: string[] } to run only some of: cli-mcp, payments, tarolas, futtatas',
  phases: [
    { title: 'Terv', detail: 'a kassza modulok felmérése, Billingo-specifikus döntések, csoportok' },
    { title: 'Megvalósítás', detail: 'csoportonként egy agent, diszjunkt fájlokkal' },
    { title: 'Ellenőrzés', detail: 'szkeptikus mutációs és biztonsági ellenőrzés, javítással' },
    { title: 'Integráció', detail: 'alcsomagok, méret, smoke, README, docs, teljes CI, élő futás' },
  ],
}

const ALL_GROUPS = [
  {
    key: 'cli-mcp',
    scope:
      'The tarca CLI (bin "tarca": doctor, verify, document get, mcp; modelled on ../kassza/src/cli) and the tarca/mcp MCP server (../kassza/src/mcp: stateless, the 2026-07-28 MCP spec plus the legacy initialize handshake, read tools, write tools only with allowWrite and a preview confirmation code). Compare tool by tool with the official @billingo/billingo-mcp (https://github.com/octonull/billingo-mcp) and be better: previews, idempotent issuing through createOnce, Hungarian errors, edge runtimes. doctor checks the key, the profile (test or live), the NAV connection, document blocks, bank accounts and the subscription. Also the migrate-from-codingsans-billingo-client skill under agents/skills/.',
  },
  {
    key: 'payments',
    scope:
      'tarca/payments, modelled on ../kassza/src/payments: Stripe, SimplePay, Barion, Revolut and PayPal webhook verification and parsing (raw body, signature, timestamp tolerance, constant-time comparison, size limits), amounts in minor units, and issueForPayment: a paid payment becomes exactly one invoice or receipt through createOnce with the payment id as vendorId; a full refund cancels the document (documents.cancel); a partial refund becomes a modification document (documents.createModification) or a proposal, as kassza decides for its corrective invoice. Re-check every provider\'s current official webhook documentation on the web; do not trust kassza blindly.',
  },
  {
    key: 'tarolas',
    scope:
      'tarca/storage (and tarca/storage/fs) for saving document PDFs to S3, R2 (binding and S3 API), Vercel Blob, Supabase, UploadThing, memory and the file system, modelled on ../kassza/src/storage (zero dependencies: SigV4 over fetch); tarca/stores (shared stores for the createOnce lock and other state: Redis/Upstash, Cloudflare KV and Durable Objects, Vercel KV, memory, with a diagnose helper), modelled on ../kassza/src/stores; and tarca/journal, adapted from ../kassza/src/journal: Billingo reports to NAV itself, so the journal is an append-only record of every issued, cancelled and modified document (vendorId, id, number, totals, status) with reconciliation against documents.list, not a NAV summary.',
  },
  {
    key: 'futtatas',
    scope:
      'tarca/node (Node.js and Express adapters for web handlers, ../kassza/src/node), tarca/batch (bulk and recurring issuing that keeps Billingo\'s rate limit, exactly once per item through createOnce, resumable, ../kassza/src/batch) and tarca/observe (metrics and tracing from the client hooks, with keys and personal data redacted, ../kassza/src/observe).',
  },
]

const wanted = args && Array.isArray(args.groups) ? args.groups : null
const GROUPS = wanted ? ALL_GROUPS.filter((g) => wanted.includes(g.key)) : ALL_GROUPS

const GROUND = `You are working in the tarca repository (the current working directory): a zero-dependency TypeScript client for the Billingo API v3, the sibling of ../kassza (the official Számlázz.hu plugin and the quality bar). Read AGENTS.md, agents/api.md, agents/pitfalls.md and the relevant ../kassza modules, their tests and their docs (../kassza/AGENTS.md, ../kassza/agents/, ../kassza/readme/template.md). If kezdo-docs/ exists (gitignored), read kezdo-docs/00-OLVASS-EL.md, kezdo-docs/01 (what to take over from kassza and what is Számlázz.hu-specific), the 4th and 5th phases of kezdo-docs/07-roadmap.md and the end of kezdo-docs/11-munkanaplo.md.

Rules: zero runtime dependencies; src/ stays runtime-independent except subpaths that are Node-only by nature (tarca/node, tarca/storage/fs, the CLI); no comments in code; English identifiers, Hungarian error messages and test names; Europe/Budapest dates; camelCase public API; writes are never retried automatically; issuing always goes through createOnce with a stable vendorId. Every module gets unit tests that fail when the behaviour breaks, and every path that issues documents is tested against the fake Billingo (src/testing). Never print API keys, webhook secrets, request headers, bodies or e-mail addresses. Never call the live Billingo API or any payment provider from tests. Do not commit.`

const PLAN = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          subpaths: { type: 'array', items: { type: 'string' } },
          kasszaSources: { type: 'array', items: { type: 'string' } },
          ownedFiles: { type: 'array', items: { type: 'string' } },
          sharedInsertions: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'string' },
          dropped: { type: 'string' },
        },
        required: ['key', 'subpaths', 'kasszaSources', 'ownedFiles', 'decisions'],
      },
    },
  },
  required: ['summary', 'groups'],
}

phase('Terv')
const plan = await agent(
  `${GROUND}

Plan the port of these kassza modules to tarca, one entry per group, in this order:
${GROUPS.map((g) => `- ${g.key}: ${g.scope}`).join('\n')}

For each group: read the kassza sources and tests, list the tarca subpaths (package.json exports) it adds, the files it will own (src/<module>/, its tests, any agents/skills folder), the small insertions it needs in shared files (package.json exports and bin, tsdown entries, scripts/size-limits.json, scripts/smoke-core.mjs, tests/public-api.test.ts, src/testing if a fake is needed), and every decision where Billingo differs from Számlázz.hu (how a refund maps to cancel or modification, what the journal records, which MCP tools exist, what doctor checks, which Billingo limits batch must keep). State what you drop from kassza and why, so nothing is silently left out. Write the plan to kezdo-docs/13-kiegeszitok-terv.md if kezdo-docs/ exists, and append a short entry to kezdo-docs/11-munkanaplo.md (cat >>).`,
  { label: 'terv', phase: 'Terv', schema: PLAN },
)

if (!plan || plan.groups.length === 0) return { plan, groups: [], integration: null }
log(`${plan.groups.length} csoport: ${plan.groups.map((g) => g.key).join(', ')}`)

const results = await pipeline(
  plan.groups,
  (group) =>
    agent(
      `${GROUND}

Implement this group completely. Other agents are implementing the other groups at the same time: touch only your owned files and make only your listed small insertions in shared files (re-read a shared file right before editing it, and keep the edit minimal).

Group plan:
${JSON.stringify(group, null, 2)}

Overall plan summary: ${plan.summary}

Port behaviour, not just code: go through the kassza tests of each module and carry over every case that still applies (they encode real bugs kassza already hit). Add a section for each new subpath to readme/template.md in the kassza README style (collapsible <details> recipes) and to agents/api.md. Prove the important tests can fail by breaking the code once each. Run npx vitest run on your files, npm run typecheck and npm run lint before returning. Report the public API you added, the decisions you made and anything the integrator must know.`,
      { label: `modul:${group.key}`, phase: 'Megvalósítás' },
    ),
  (report, group) =>
    agent(
      `${GROUND}

You are a SKEPTIC checking another agent's work on group "${group.key}" (subpaths: ${group.subpaths.join(', ')}). Its report:
${report}

Try to break it:
1. In a private copy (rsync without node_modules and .git, symlink node_modules) mutate the new code at least 15 meaningful ways and list every mutant the tests miss.
2. Diff the behaviour against the kassza module case by case: every kassza test case that applies but has no tarca equivalent is a gap.
3. Security: webhook signature checks (raw body, constant time, timestamp window, replay), secrets never logged or put in errors, MCP writes impossible without allowWrite and a valid confirmation code, path traversal in storage keys, redaction in observe.
4. Exactly-once: no path in payments or batch can issue a second document for the same payment or item, including after an uncertain failure.
Then fix every confirmed gap directly in the repository, tests first, staying inside the group's owned files. Return what you found, what you fixed and anything left open.`,
      { label: `ellenorzes:${group.key}`, phase: 'Ellenőrzés' },
    ),
)

phase('Integráció')
const integration = await agent(
  `${GROUND}

All groups are implemented and checked. Reports:
${results.map((r, i) => `--- ${plan.groups[i].key} ---\n${r}`).join('\n')}

Integrate:
- Resolve conflicts in shared files; every new subpath is in package.json exports, the tsdown entries, scripts/size-limits.json (a measured budget each; the root package must not pull any of them in), the smoke checks (Node ESM and CJS, Bun, Deno and workerd for the runtime-independent ones) and tests/public-api.test.ts. The CLI bin works from the built package (node dist/cli.js doctor --help).
- README (readme/template.md, then npm run readme): the new sections in the kassza style and order, the comparison table and the "Miért tárca?" list updated, the "Tervben" list reduced to what is really left. README.en.md, agents/api.md, agents/recipes.md, agents/pitfalls.md, agents/skills/tarca/SKILL.md, llms.txt and AGENTS.md (architecture) updated.
- Run TARCA_REQUIRE_SPEC=1 npm run ci, npm run smoke, bun scripts/smoke.mjs, npm run size, node scripts/generate-types.mjs --check and npm run drift; all must be green. If miniflare is available (npm install --no-save miniflare@4.20260730.0), run node scripts/smoke-workerd.mjs too.
- One guarded live run on the Billingo developer test profile: npm run e2e, and the built CLI's doctor command with the test key from the environment (read only). Never print the key, headers, bodies or e-mail addresses; on 402 stop and report.
- If kezdo-docs/ exists: tick the finished items in kezdo-docs/07-roadmap.md and append the outcome to kezdo-docs/11-munkanaplo.md.
Do not commit. Return a summary, the live results and one suggested conventional commit message per group.`,
  { label: 'integracio', phase: 'Integráció' },
)

return { plan, groups: results, integration }
