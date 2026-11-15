export const meta = {
  name: 'tarca-web',
  description: 'Build the tarca website (web/, tarcajs.hu) as the sibling of kassza/web: same architecture, fumadocs docs, sandbox and content, with a reworked design',
  whenToUse:
    'Roadmap phase 6, after the tarca-docs workflow. Run first with { stage: "irany" } (design direction and a static mock for the owner to approve), then with { stage: "epites" } to build. Optional: { direction: "owner notes on the look", skipReview: true }',
  phases: [
    { title: 'Irány', detail: 'a kassza web felmérése, új vizuális irány, statikus minta jóváhagyásra' },
    { title: 'Váz', detail: 'Next.js és fumadocs a kassza web mintájára, tokenek, közös elemek' },
    { title: 'Részek', detail: 'főoldal, docs, sandbox párhuzamosan' },
    { title: 'Integráció', detail: 'SEO, llms, Vercel, CI, böngészős ellenőrzés' },
    { title: 'Átnézés', detail: 'design review az irány ellen, majd javítás' },
  ],
}

const stage = args && args.stage === 'epites' ? 'epites' : 'irany'
const ownerDirection = args && args.direction ? `\nThe owner's notes on the look: ${args.direction}` : ''
const skipReview = Boolean(args && args.skipReview)

const GROUND = `You are working in the tarca repository (the current working directory). tarca is the zero-dependency TypeScript client for the Billingo API v3 and the sibling ("tesó") of ../kassza, the Számlázz.hu client. The tarca website goes in web/ and is the sibling of ../kassza/web.

What the owner asked for:
- The same website as kassza: the same architecture, the same page types (landing page, fumadocs documentation, sandbox, recipes, llms.txt, llms-full.txt, Markdown variants of docs pages, Open Graph images, search, sitemap) and the same kind of content.
- The landing page tells the same story with tarca's facts: why tarca (the "Miért tárca?" list from readme/template.md: all operations, no double invoice, zero dependencies, runs everywhere, types from the official spec corrected to live behaviour, rate limits, one error type, a fake Billingo for tests), issuing an invoice in a few lines first, createOnce, the comparison with the other Billingo packages, payments, runtimes, testing. The copy may follow kassza's landing copy closely, adapted to Billingo; every number and claim must be true for tarca (counts are generated from src/core/operations.ts and readme/site-data.mjs, never typed).
- The documentation is built exactly like kassza's: fumadocs (fumadocs-core, fumadocs-mdx, fumadocs-ui, fumadocs-twoslash), the same source.config.ts setup (Shiki theme, Twoslash, lastModified from git), the same components/docs and components/mdx inventory, content from web/content/docs.
- The design is reworked: recognisably a sibling of kassza (same quality, same information architecture), but not a recolour of it. Its own composition, motifs and rhythm, built on tarca's brand: the blue #314EFF, assets/logo.svg and the visual language of the README hero (readme/art, readme/assets/hero-light.svg).
- Light mode only: the owner does not want a dark mode on the website. No dark color tokens, no theme switch, no prefers-color-scheme: dark styles, no next-themes; fumadocs and Shiki are configured for the light theme only. Code blocks may stay dark panels as a design element, but the page itself is always light.

Read before anything else: ../kassza/web/README.md, package.json, next.config.mts, source.config.ts, vercel.json, app/, components/ (landing, docs, mdx, sandbox, site), lib/, sandbox/, scripts/, styles/, and ../kassza/.github/workflows/web.yml. Next.js there is newer than your training data: read web/node_modules/next/dist/docs/ (or ../kassza/web/node_modules/next/dist/docs/) before using any Next.js API. If kezdo-docs/ exists (gitignored), read kezdo-docs/00-OLVASS-EL.md, the "Weboldal" prompt in kezdo-docs/08-kezdo-promptok.md and the 6th phase of kezdo-docs/07-roadmap.md.

Fixed technical decisions:
- Sandbox: the user's code runs in a Web Worker against the real tarca package, with fetch bound to createFakeBillingoFetch from tarca/testing. There is no simulator to write; the fake covers every operation.
- Package source: web/tarca-version.json. If tarca is on npm (npm view tarca version), it holds that version and the install script installs it like ../kassza/web/scripts/install-kassza.mjs. Otherwise it holds { "version": "local" } and the script builds and packs the repository root (npm run build && npm pack) into web/node_modules/tarca. scripts/release.mjs already updates web/tarca-version.json on release.
- Vercel: Root Directory web, only main deploys, ignoreCommand skips builds without web/ changes (copy ../kassza/web/vercel.json). The package CI and release ignore web/.
- Hungarian copy: load the magyar-szoveg and stop-slop skills; Hungarian quote marks, no marketing words, no em-dash chains, no invented numbers, users or testimonials.
- Owner's design rules: no generic template look (no centered hero plus gradient blob, no uniform card grids, no default shadcn or Tailwind look, no purple-blue gradients), real hierarchy, a deliberate type pairing, designed hover, focus and active states, prefers-reduced-motion respected, animate only transform, opacity, clip-path and filter, accessible by default.
- Do not commit.${ownerDirection}`

phase('Irány')
const direction = await agent(
  `${GROUND}

Load the impeccable skill, and the hallmark skill for the landing page. Run ../kassza/web locally (npm install, npm run dev in ../kassza/web) and look at its landing page, a docs page and the sandbox in the browser at 375 px and 1440 px. Inventory every landing section and component and what it communicates.

${stage === 'irany' ? 'Then design the sibling, without building the site yet:' : 'If web/DESIGN.md already exists and the owner approved it, keep it and only fill gaps. Otherwise design the sibling:'}
1. Write web/DESIGN.md: the direction in a few sentences and how it differs from kassza and why; light-only color tokens around #314EFF; the type pairing (different from kassza's Bricolage Grotesque and Geist unless there is a strong reason); spacing scale; motion rules; the landing page section by section (what each section shows, which kassza section it corresponds to, and the copy draft in Hungarian); the docs and sandbox layouts; which ../kassza/web files are copied as is, adapted or replaced.
2. Build a static, self-contained mock of the landing page (web/design-mock/index.html, light only, real copy, real code samples from readme/template.md) so the owner can judge the look before any app code exists. Check it in the browser at 375 px and 1440 px and fix what looks off.
Return the paths, a short description of the direction, and the main differences from kassza.`,
  { label: 'irany', phase: 'Irány' },
)

if (stage === 'irany') {
  log('Az irány és a statikus minta kész; építéshez futtasd újra { stage: "epites" } argumentummal.')
  return { stage, direction }
}

phase('Váz')
const scaffold = await agent(
  `${GROUND}

Direction: ${direction}

Build the skeleton every later agent needs, following web/DESIGN.md: web/package.json with the same stack and pinned versions as ../kassza/web (names adjusted), the tarca install script and web/tarca-version.json, next.config.mts, source.config.ts and lib/source.ts copied from kassza's fumadocs setup, tsconfig, biome.json, vitest config, styles/tokens.css from DESIGN.md, app/layout.tsx, the site chrome (components/site: navigation, footer, search, logo; no theme switch), lib/site.ts and an empty landing page that renders. Delete web/design-mock/ once its look is carried into the real components. npm install in web/, then npm run typecheck and npm run build must pass. Return the file map and the commands later agents should use.`,
  { label: 'vaz', phase: 'Váz' },
)

const PARTS = [
  {
    key: 'fooldal',
    prompt:
      'Build the landing page (app/(site)/, components/landing/) section by section as web/DESIGN.md specifies, using kassza\'s components/landing as the reference for content and behaviour, not for looks. Code samples are real, typechecked tarca code: the issuing example first, then createOnce. The invoice shown next to the code is produced by the fake Billingo at build time, not hand-written. Check it in the browser at 375 px and 1440 px wide.',
  },
  {
    key: 'docs',
    prompt:
      'Build the documentation exactly like ../kassza/web: app/docs/[[...slug]], components/docs (sidebar tree, table of contents, breadcrumbs, pagination, page actions), components/mdx (Callout, Cards, Tabs, CodeBlock, Example, FlowDiagram, ReferenceTables, TryIt; replace kassza\'s Számlázz-specific RoundingCalculator and ValidatorPlayground with tarca equivalents only if the docs use them), Twoslash code blocks, the static search index (app/api/search), Markdown variants (app/docs-md, proxy.ts), Open Graph images (app/og) and lib/llms.ts. Every page in web/content/docs must render. Check it in the browser at 375 px and 1440 px.',
  },
  {
    key: 'sandbox',
    prompt:
      'Build the sandbox (app/sandbox, components/sandbox, sandbox/runtime, sandbox/examples with catalog.ts, sandbox/worker.ts, scripts/build-sandbox.mjs) modelled on ../kassza/web/sandbox, with the fake Billingo from tarca/testing instead of a simulator: the worker binds createTarca({ apiKey, fetch }) to createFakeBillingoFetch, and every example shows the code, the console output, the JSON tarca sent and the fake Billingo answer. One example per common task (invoice, createOnce, proforma then invoice, receipt, cancel, payment, PDF, partner findOrCreate, export, error handling, and the payments and storage subpaths if they exist). npm run sandbox:build runs every example and fails on any error. Strict CSP with no network access for the runtime. Check it in the browser.',
  },
]

const parts = await parallel(
  PARTS.map((part) => () =>
    agent(
      `${GROUND}

Direction: ${direction}
Skeleton: ${scaffold}

${part.prompt}

Other agents are building the other parts at the same time: touch only your own directories; shared files (app/layout.tsx, components/site, styles/tokens.css, package.json) get only small additions. Write vitest tests for logic (runtime, catalog, search, llms, sample data). Run npm run lint, npm run typecheck and npm test in web/ before returning. Return what you built, what is left and anything the integrator must know.`,
      { label: `resz:${part.key}`, phase: 'Részek' },
    ),
  ),
)

phase('Integráció')
const integration = await agent(
  `${GROUND}

Parts reports:
${parts.map((p, i) => `--- ${PARTS[i].key} ---\n${p}`).join('\n')}

Integrate the site: app/sitemap.ts, app/robots.ts, app/llms.txt and app/llms-full.txt, not-found page, icon, analytics as in kassza, web/vercel.json, .github/workflows/web.yml (lint, typecheck, test, build on web/** changes; the package ci.yml and release.yml must ignore web/**), web/README.md in the style of ../kassza/web/README.md. In readme/config.json and readme/template.md, link the docs, the sandbox and the recipes the way the kassza README does (the "Weboldal, sandbox és receptek" section, recipe buttons from readme/art), then npm run readme. In web/ run npm run ci; in the repository root run npm run ci; both must be green. Start the dev server and check the landing page, a docs page and the sandbox in the browser at 375 px and 1440 px; fix layout bugs you see. If kezdo-docs/ exists, tick the website items in kezdo-docs/07-roadmap.md and append the outcome to kezdo-docs/11-munkanaplo.md. Return a summary.`,
  { label: 'integracio', phase: 'Integráció' },
)

if (skipReview) return { stage, direction, scaffold, parts, integration, review: null, fixes: null }

phase('Átnézés')
const review = await agent(
  `${GROUND}

Review the finished website against web/DESIGN.md, the owner's design rules and ../kassza/web as the quality bar. Run it (npm run dev in web/) and look at every page type at 375 px and 1440 px, keyboard only and with reduced motion. Any dark mode remnant (dark tokens, theme switch, prefers-color-scheme: dark rules) is a finding. Compare the content with the kassza site: anything kassza's site explains that tarca's site leaves out without a Billingo reason is a finding. Return an ordered list of material fixes (what, where, why), most important first. Do not edit files.`,
  { label: 'atnezes', phase: 'Átnézés', agentType: 'impeccable:impeccable-finish-reviewer' },
)

const fixes = await agent(
  `${GROUND}

A design reviewer returned these fixes for the website:
${review}

Apply every material fix, check each in the browser at 375 px and 1440 px, then run npm run ci in web/ and in the repository root. Return what you changed and anything you chose not to change, with the reason.`,
  { label: 'javitas', phase: 'Átnézés' },
)

return { stage, direction, scaffold, parts, integration, review, fixes }
