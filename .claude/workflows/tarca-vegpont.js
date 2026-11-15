export const meta = {
  name: 'tarca-vegpont',
  description: 'Implement or update Billingo operations in tarca end to end: research, implement in disjoint groups, adversarial check, integrate',
  whenToUse:
    'A new or changed Billingo operation, a SwaggerHub version bump or a drift watcher issue. args: { operations?: string[], context?: "what changed, e.g. the drift issue text" }',
  phases: [
    { title: 'Felderítés', detail: 'spec, changelog, élő bizonyíték, csoportosítás' },
    { title: 'Megvalósítás', detail: 'csoportonként egy agent, diszjunkt fájlokkal' },
    { title: 'Ellenőrzés', detail: 'szkeptikus mutációs és spec-ellenőrzés csoportonként' },
    { title: 'Integráció', detail: 'teljes CI, élő e2e, docs, munkanapló' },
  ],
}

const operations = args && Array.isArray(args.operations) ? args.operations : []
const context = args && args.context ? args.context : ''

const GROUND = `You are working in the tarca repository (the current working directory): a zero-dependency TypeScript client for the Billingo API v3, sibling of ../kassza. Read AGENTS.md, agents/pitfalls.md and the uj-vegpont and spec-valtozas skills in .claude/skills/. If kezdo-docs/ exists (gitignored), read kezdo-docs/00-OLVASS-EL.md and the end of kezdo-docs/11-munkanaplo.md first. Never print API keys, request headers, bodies or e-mail addresses. Never retry writes. Never edit src/generated/billingo.ts by hand. No comments in code; Hungarian error messages and test names. Do not commit.`

const GROUPS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    specChanges: { type: 'string' },
    liveEvidenceNeeded: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          operations: { type: 'array', items: { type: 'string' } },
          ownedFiles: { type: 'array', items: { type: 'string' } },
          sharedInsertions: { type: 'array', items: { type: 'string' } },
          decisions: { type: 'string' },
        },
        required: ['key', 'operations', 'ownedFiles', 'decisions'],
      },
    },
  },
  required: ['summary', 'groups'],
}

phase('Felderítés')
const plan = await agent(
  `${GROUND}

Task: find out exactly what must change in tarca, and split the work into groups that own disjoint files.
${operations.length ? `Operations named by the owner: ${operations.join(', ')}.` : 'No operation was named: run npm run spec:fetch and npm run drift, and work out the changes yourself.'}
${context ? `Context from the owner: ${context}` : ''}

Steps:
1. npm run spec:fetch, then diff the new spec against src/core/operations.ts, src/generated/billingo.ts and scripts/spec-overrides.mjs. Read the Billingo changelog (https://developers.billingo.hu/changelogs) and the official MCP (https://github.com/octonull/billingo-mcp) for behaviour the spec does not show.
2. Decide what live evidence is still missing. You may write and run at most one guarded probe script under .research/probe/ (copy the guard from the existing probes: GET /organization first, abort unless has_nav_connection is false and tax_code equals BILLINGO_E2E_TAX_CODE, at least 1.5 s between requests, no retries, outputs to .research/probe/out without secrets). Record what it proved.
3. Group the operations so each group owns its own resource files (src/<resource>/, its tests, its fake module in src/testing/fake/, its e2e step file in tests/e2e/steps/). Shared files (src/client.ts, src/index.ts, src/core/operations.ts, src/testing/fake/registry.ts, tests/e2e/suite.ts) get only small insertions, listed per group.
4. If kezdo-docs/11-munkanaplo.md exists, append (cat >>) what you found.`,
  { label: 'felderites', phase: 'Felderítés', schema: GROUPS },
)

if (!plan || plan.groups.length === 0) {
  return { plan, groups: [], integration: null }
}
log(`${plan.groups.length} csoport: ${plan.groups.map((g) => g.key).join(', ')}`)

const results = await pipeline(
  plan.groups,
  (group) =>
    agent(
      `${GROUND}

Implement this group end to end with the uj-vegpont skill: resource method, input checks, unit test, contract test (requests validated against the corrected spec by tests/openapi.ts), fake Billingo behaviour, e2e step, agents/api.md and readme/template.md sections. Other agents are working on other groups in parallel: touch only your owned files, and make only the listed small insertions in shared files.

Group: ${JSON.stringify(group, null, 2)}
Research summary: ${plan.summary}
Spec changes: ${plan.specChanges || 'see research'}

Prove every test can fail: break the code once per behaviour and see the test go red. Run npx vitest run on your files and npm run typecheck. Report the public API you added and anything the integrator must know.`,
      { label: `vegpont:${group.key}`, phase: 'Megvalósítás' },
    ),
  (report, group) =>
    agent(
      `${GROUND}

You are a SKEPTIC checking another agent's work on group "${group.key}" (${group.operations.join(', ')}). Its report:
${report}

Try to break it. In a private copy (rsync without node_modules and .git, symlink node_modules) mutate the new code at least 10 ways and list every mutant the tests miss. Check the request bodies against .spec-cache and scripts/spec-overrides.mjs, and the fake against recorded live behaviour. Then fix every confirmed gap directly in the repository (tests first), staying inside the group's owned files. Return what you found and what you fixed.`,
      { label: `ellenorzes:${group.key}`, phase: 'Ellenőrzés' },
    ),
)

phase('Integráció')
const integration = await agent(
  `${GROUND}

All groups are implemented and checked. Reports:
${results.map((r, i) => `--- ${plan.groups[i].key} ---\n${r}`).join('\n')}

Integrate: resolve any conflicts in shared files, keep the coverage ratchet in tests/coverage.test.ts at 0 missing operations, regenerate types (npm run spec:types) and the README (npm run readme), update agents/api.md, agents/recipes.md, llms.txt and README.en.md where the public API changed. Then run TARCA_REQUIRE_SPEC=1 npm run ci, npm run smoke, npm run size, node scripts/generate-types.mjs --check and npm run drift; all must be green. Run npm run e2e once (live, guarded test profile; on 402 stop and report). If kezdo-docs/ exists, append the outcome to kezdo-docs/11-munkanaplo.md and tick kezdo-docs/07-roadmap.md. Do not commit; return a summary with the suggested conventional commit message(s).`,
  { label: 'integracio', phase: 'Integráció' },
)

return { plan, groups: results, integration }
