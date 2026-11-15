export const meta = {
  name: 'tarca-docs',
  description: 'Write the tarca MDX documentation (web/content/docs) from kezdo-docs/10, with every example typechecked and run against the fake Billingo',
  whenToUse:
    'Phase 6 of the roadmap: the MDX docs before or alongside the website. args (optional): { sections?: string[] } to limit to some folders, e.g. ["bizonylatok", "receptek"]',
  phases: [
    { title: 'Terv', detail: 'oldallista, meta.json, közös minták és a példateszt váza' },
    { title: 'Írás', detail: 'szakaszonként egy író, diszjunkt mappákkal' },
    { title: 'Lektorálás', detail: 'magyar szöveg, tényellenőrzés, példák futtatása' },
    { title: 'Integráció', detail: 'README linkek, site-data, teljes CI' },
  ],
}

const only = args && Array.isArray(args.sections) ? args.sections : null

const GROUND = `You are working in the tarca repository (the current working directory): a zero-dependency TypeScript client for the Billingo API v3, sibling of ../kassza. Read AGENTS.md, agents/api.md, agents/recipes.md and agents/pitfalls.md. If kezdo-docs/ exists (gitignored), read kezdo-docs/00-OLVASS-EL.md, kezdo-docs/10-dokumentacio-terv.md (the page structure and rules for these docs), the "MDX dokumentáció" prompt in kezdo-docs/08-kezdo-promptok.md, kezdo-docs/12-kutatas-frissites.md and the live section of kezdo-docs/02. The format is copied from ../kassza/web/content/docs: MDX with frontmatter (title, description, official), one meta.json per folder (title, pages), the same MDX components (Callout, Cards, Tabs, Example). Load the magyar-szoveg and stop-slop skills before writing prose: natural Hungarian, Hungarian quote marks („…”), no em-dash chains, no reflexive groups of three, no marketing words. Every code example must typecheck against src/index.ts and run against the fake Billingo (tarca/testing). Wire samples (the JSON tarca sends and what Billingo answers) come from the fake or from anonymised e2e/probe outputs, never hand-written, never with real names, e-mails, tax numbers or keys. The docs must match the depth of kassza's docs (../kassza/web/content/docs, about 190 pages): besides the Billingo operations, every implemented subpath gets its pages the way kassza documents its own (fizetesek for tarca/payments; kiegeszitok for storage, stores, journal, node, batch, observe, the CLI and the MCP server; receptek for the recipes in agents/recipes.md and kezdo-docs/10). Only document what is implemented; no "coming soon" pages. Do not commit.`

const PLAN = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    sharedConventions: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          folder: { type: 'string' },
          pages: { type: 'array', items: { type: 'string' } },
          operations: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['folder', 'pages', 'operations'],
      },
    },
  },
  required: ['summary', 'sharedConventions', 'sections'],
}

phase('Terv')
const plan = await agent(
  `${GROUND}

Plan the docs and lay the shared groundwork, so that writers can work on separate folders in parallel:
1. Turn the structure in kezdo-docs/10 into a concrete page list per folder (kérés, válasz and minta pages per operation, as in kassza). Map every operation in src/core/operations.ts to its page; nothing may be left out.
2. Create web/content/docs/index.mdx, the root meta.json and every folder's meta.json with the final page order.
3. Create tests/docs-examples.test.ts modelled on ../kassza/tests/docs-examples.test.ts: one test per docs example, running it against createMockTarca or createFakeBillingoFetch, with the helpers writers will need. Add one example for the index page so the file is green.
4. Make sure readme/site-data.mjs reads the new pages (it already looks at web/content/docs) and that npm run readme:check still passes.
${only ? `Only these folders are in scope this run: ${only.join(', ')}.` : ''}
Return the section list (one entry per folder) and the shared conventions every writer must follow (component usage, how to cite official links, how to name examples in the test file).`,
  { label: 'terv', phase: 'Terv', schema: PLAN },
)

if (!plan) return { plan: null }
const sections = only ? plan.sections.filter((s) => only.includes(s.folder)) : plan.sections
const writers = []
const PER_WRITER = Math.max(1, Math.ceil(sections.length / 5))
for (let i = 0; i < sections.length; i += PER_WRITER) writers.push(sections.slice(i, i + PER_WRITER))
log(`${sections.length} mappa, ${writers.length} író`)

const written = await pipeline(
  writers,
  (batch, _item, index) =>
    agent(
      `${GROUND}

Write these folders of web/content/docs completely, following the plan and the shared conventions. Other writers are working on other folders at the same time: touch only your folders, and in tests/docs-examples.test.ts add only your own describe block (named after the folder) at the end of the file.

Shared conventions: ${plan.sharedConventions}

Your folders:
${JSON.stringify(batch, null, 2)}

For every operation: what you pass to tarca, what tarca sends on the wire, what Billingo returns, the live deviations that matter (null fields, 201 instead of 200, posPdf content type, partner search lag, 403 instead of 404), the errors you can get and how to handle them, and a runnable example that has a test. Run npx vitest run tests/docs-examples.test.ts -t "<your describe>" until it is green.`,
      { label: `iro:${index + 1}`, phase: 'Írás' },
    ),
  (report, batch, index) =>
    agent(
      `${GROUND}

You are the EDITOR for these folders: ${batch.map((s) => s.folder).join(', ')}. The writer reported:
${report}

1. Fact-check every claim against the code (src/), the corrected spec (scripts/spec-overrides.mjs, .spec-cache) and the live evidence. Fix anything false.
2. Read the prose aloud in your head as a Hungarian developer would: rewrite anything that sounds translated or machine-written (magyar-szoveg, stop-slop).
3. Make sure every example has a passing test in tests/docs-examples.test.ts and that the test would fail if the example broke (change one example once to see it go red, then restore).
Edit only these folders and their describe blocks. Return what you changed.`,
      { label: `lektor:${index + 1}`, phase: 'Lektorálás' },
    ),
)

phase('Integráció')
const integration = await agent(
  `${GROUND}

The docs folders are written and edited. Reports:
${written.join('\n---\n')}

Integrate: check that every meta.json lists exactly the pages that exist, that every operation in src/core/operations.ts has its pages, and that internal links resolve. Add {{links:...}} and {{more:...}} references to readme/template.md the way ../kassza/readme/template.md uses them, then npm run readme. Run TARCA_REQUIRE_SPEC=1 npm run ci; it must be green. If kezdo-docs/ exists, tick the docs item in kezdo-docs/07-roadmap.md and append the outcome to kezdo-docs/11-munkanaplo.md. Do not commit; return a summary and a suggested commit message (docs: ...).`,
  { label: 'integracio', phase: 'Integráció' },
)

return { plan, written, integration }
