export const meta = {
  name: 'tarca-review',
  description: 'Adversarial review of tarca: four reviewers, one skeptic per dimension, then one fix agent',
  whenToUse:
    'Before a release or after a large change. args (optional): { focus: "paths or topic to concentrate on", fix: false to only report }',
  phases: [
    { title: 'Keresés', detail: 'négy független reviewer, egy-egy szempont' },
    { title: 'Cáfolás', detail: 'minden szempont leleteit egy szkeptikus próbálja megcáfolni' },
    { title: 'Javítás', detail: 'egy agent javítja a megerősített hibákat, teszttel' },
  ],
}

const focus = args && args.focus ? `\n\nConcentrate on: ${args.focus}. Still report anything critical you see elsewhere.` : ''
const shouldFix = !(args && args.fix === false)

const COMMON = `You are working in the tarca repository (the current working directory): a zero-dependency TypeScript client for the Billingo API v3, whose sibling and quality bar is ../kassza. Read AGENTS.md and agents/pitfalls.md first. If kezdo-docs/ exists (gitignored), kezdo-docs/00-OLVASS-EL.md, kezdo-docs/11-munkanaplo.md (the work log of every finding so far) and the live section at the end of kezdo-docs/02 hold the background. Live evidence: .research/probe/ outputs; spec: .spec-cache/ (npm run spec:fetch if missing); every known live deviation from the spec: scripts/spec-overrides.mjs.

You are a REVIEWER. Do NOT edit any tracked file, do NOT commit, do NOT run npm run e2e or any request against the real Billingo API. If you need to run tests or mutate code, do it only in a private copy: rsync -a --exclude node_modules --exclude .git ./ <a fresh temp dir>/ and symlink node_modules into it. Never print API keys, request headers or e-mail addresses.

Report only real, concrete defects: a specific input or state that produces a wrong result, a crash, a duplicate invoice, a lost error, a test that passes although the behaviour is broken, or a doc example that does not compile or lies. For each finding give file and line, the concrete failure scenario and your evidence (a command you ran and its result, the spec line, or the probe file). Style nits, speculative refactors and "could be cleaner" are not findings. An empty list is a valid answer.${focus}`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'number' },
          failureScenario: { type: 'string' },
          evidence: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['id', 'title', 'severity', 'file', 'failureScenario', 'evidence', 'suggestedFix'],
      },
    },
    coverage: { type: 'string' },
  },
  required: ['findings', 'coverage'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          real: { type: 'boolean' },
          reasoning: { type: 'string' },
          reproduction: { type: 'string' },
        },
        required: ['id', 'real', 'reasoning'],
      },
    },
  },
  required: ['verdicts'],
}

const DIMENSIONS = [
  {
    key: 'kontraktus',
    prompt:
      'Dimension: request and response correctness. For every resource method in src/, compare what it actually sends (path, method, query serialization, body field names after the camelCase/snake_case boundary in src/core/case.ts, defaults, Europe/Budapest dates) with the OpenAPI operation as corrected by scripts/spec-overrides.mjs and with what Billingo did live. Check response handling: 202 and empty bodies, PDF signature checks, pagination, polling bounds, payment semantics, enum and VAT mapping. Prove each finding against the fake (src/testing) in your private copy.',
  },
  {
    key: 'egyszer',
    prompt:
      'Dimension: exactly-once issuing, retry safety and error handling. Audit createOnce (documents and receipts), src/core/once-guard.ts and the lock store, the transport in src/core/context.ts (writes are never retried; GET retries on 429/5xx/network/timeout/202; Retry-After; abort and timeout propagation), error categorisation in src/core/errors.ts, empty 2xx bodies, nullIfNotFound, partners.findOrCreate and the search index lag, and the default block cache. Hunt for any path that can issue a second invoice, lose or mislabel an error, swallow a failure, hang, or leak a lock. Compare with ../kassza where tarca claims to mirror it. Prove each finding with a small test in your private copy.',
  },
  {
    key: 'tesztek',
    prompt:
      'Dimension: test honesty and fake fidelity. In your private copy make at least 25 meaningful mutations in the riskiest code (input conversion, createOnce, findOrCreate, payments, export polling, errors, retry rules, tests/openapi.ts validator, spec overrides, the fake in src/testing/fake/). Each surviving mutant (all tests still green) is a finding naming the missing assertion. Compare the fake Billingo with recorded live behaviour (.research/probe, kezdo-docs/11); a contradiction is a finding. Check that tests/e2e/steps assert real outcomes. Use TARCA_REQUIRE_SPEC=1 so spec-dependent tests cannot skip.',
  },
  {
    key: 'dokumentacio',
    prompt:
      'Dimension: docs and public API truthfulness. Extract every TypeScript code block from README.md, README.en.md, agents/*.md, agents/skills/tarca/SKILL.md, llms.txt and web/content/docs (if it exists) into your private copy and typecheck them against src/index.ts and src/testing/index.ts; run the main ones against createMockTarca. A snippet that does not compile or throws is a finding. Check prose claims (defaults, retry rules, error categories, counts, createOnce semantics, size limits, runtimes) against the code, and that every public export is documented in agents/api.md. README.md is generated from readme/template.md; report against the template.',
  },
]

phase('Keresés')
const reviewed = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(`${COMMON}\n\n${d.prompt}\n\nUse finding ids like ${d.key}-1, ${d.key}-2.`, {
      label: `review:${d.key}`,
      phase: 'Keresés',
      schema: FINDINGS,
    }),
  async (review, d) => {
    if (!review || review.findings.length === 0) {
      return { key: d.key, findings: [], verdicts: [], coverage: review ? review.coverage : 'agent failed' }
    }
    const verdict = await agent(
      `${COMMON}\n\nYou are a SKEPTIC. Another reviewer reported the findings below for the dimension "${d.key}". For each one, try hard to refute it: read the code, check whether the scenario is reachable through the public API, whether the spec or live evidence says what the reviewer claims, and whether an existing test already covers it. Reproduce it in a private copy when possible. Mark real=true only if you confirmed the defect concretely; default to real=false when the evidence is weak. Put the exact reproduction in reproduction.\n\nFindings:\n${JSON.stringify(review.findings, null, 2)}`,
      { label: `cafolas:${d.key}`, phase: 'Cáfolás', schema: VERDICTS },
    )
    return { key: d.key, findings: review.findings, verdicts: verdict ? verdict.verdicts : [], coverage: review.coverage }
  },
)

const all = reviewed.filter(Boolean)
const confirmed = []
const rejected = []
for (const r of all) {
  for (const f of r.findings) {
    const v = r.verdicts.find((x) => x.id === f.id)
    if (v && v.real) confirmed.push({ ...f, verification: v })
    else rejected.push({ id: f.id, title: f.title, reason: v ? v.reasoning : 'no verdict' })
  }
}
log(`${confirmed.length} megerősített, ${rejected.length} elvetett lelet`)

const coverage = all.map((r) => ({ key: r.key, coverage: r.coverage }))
if (confirmed.length === 0 || !shouldFix) {
  return { confirmed, rejected, coverage, fix: null }
}

phase('Javítás')
const fix = await agent(
  `You are working in the tarca repository (the current working directory). Read AGENTS.md and agents/pitfalls.md first. An adversarial review found the defects below, and an independent skeptic confirmed each one. Fix every one at the root cause.

Rules:
- For each finding, first write or tighten a test that fails on the current code, then fix the code. Prove it by temporarily reverting the fix once.
- Project conventions: no comments in code, English identifiers, Hungarian error messages and test names, Europe/Budapest dates, never edit src/generated/billingo.ts by hand (npm run spec:types), README.md only via readme/template.md and npm run readme, never retry writes automatically.
- If after reading the code you disagree that a finding is a defect, leave it and explain why.
- At the end run TARCA_REQUIRE_SPEC=1 npm run ci, npm run smoke, npm run size and node scripts/generate-types.mjs --check; all must be green.
- If a fix changes what goes over the wire, run npm run e2e exactly once at the end (live, guarded developer test profile). Never print the API key, headers, bodies or e-mail addresses. On 402 stop and report.
- If kezdo-docs/11-munkanaplo.md exists, append (cat >>) a "## <today> review-javitas" section: each finding, root cause, fix and guarding test, plus the rejected findings in one line each.
- Do NOT commit or push.

Confirmed findings:
${JSON.stringify(confirmed, null, 2)}`,
  {
    label: 'javitas',
    phase: 'Javítás',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        fixed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              rootCause: { type: 'string' },
              fix: { type: 'string' },
              guardingTest: { type: 'string' },
            },
            required: ['id', 'fix', 'guardingTest'],
          },
        },
        notFixed: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] },
        },
        checks: { type: 'string' },
        liveRun: { type: 'string' },
        filesChanged: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'fixed', 'notFixed', 'checks', 'filesChanged'],
    },
  },
)

return { confirmed, rejected, coverage, fix }
