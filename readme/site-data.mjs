import { readdir, readFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)
const DOCS_DIR = new URL('web/content/docs/', ROOT)
const CATALOG = new URL('web/sandbox/examples/catalog.ts', ROOT)
const RECIPES_META = new URL('web/content/docs/receptek/meta.json', ROOT)
const OPERATIONS = new URL('src/core/operations.ts', ROOT)

async function ifExists(read, fallback) {
  try {
    return await read()
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

function frontmatterValue(source, key) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? ''
  const line = block.split(/\r?\n/).find((item) => item.startsWith(`${key}:`))
  return line
    ?.slice(key.length + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
}

function pageSlug(file) {
  return file
    .replaceAll('\\', '/')
    .replace(/\.mdx$/, '')
    .replace(/(^|\/)index$/, '')
}

async function loadDocsPages() {
  const files = await ifExists(() => readdir(DOCS_DIR, { recursive: true }), [])
  const pages = new Map()
  for (const file of files.filter((item) => item.endsWith('.mdx')).sort()) {
    const source = await readFile(new URL(file, DOCS_DIR), 'utf8')
    const slug = pageSlug(file)
    const title = frontmatterValue(source, 'title')
    if (!title) throw new Error(`A(z) web/content/docs/${file} oldalnak nincs title mezője.`)
    pages.set(slug, { slug, title, description: frontmatterValue(source, 'description') ?? '' })
  }
  return pages
}

async function loadSandboxExamples() {
  const source = await ifExists(() => readFile(CATALOG, 'utf8'), '')
  const pattern = /slug: '([^']+)',\s*title: '([^']+)',\s*group: '([^']+)'/g
  const examples = [...source.matchAll(pattern)].map(([, slug, title, group]) => ({
    slug,
    title,
    group,
  }))
  const declared = source.match(/\bslug: '/g)?.length ?? 0
  if (examples.length !== declared) {
    throw new Error(
      `A sandbox katalógusból ${declared} példából csak ${examples.length} olvasható be (web/sandbox/examples/catalog.ts).`,
    )
  }
  return examples
}

async function loadRecipes(pages) {
  const meta = await ifExists(async () => JSON.parse(await readFile(RECIPES_META, 'utf8')), {
    pages: [],
  })
  return meta.pages.map((name) => {
    const page = pages.get(`receptek/${name}`)
    if (!page) throw new Error(`A receptek/meta.json ismeretlen oldalra hivatkozik: ${name}`)
    return page
  })
}

export function hungarianArticle(count) {
  const digits = String(count)
  const vowel =
    digits.startsWith('5') || count === 1 || (digits.length === 4 && digits.startsWith('1'))
  return vowel ? 'az' : 'a'
}

export async function loadOperationCounts() {
  const source = await readFile(OPERATIONS, 'utf8')
  const ids = source.match(/^ {2}\| '\w+'$/gm)?.length ?? 0
  const specs = [...source.matchAll(/\bspec: '([\w.-]+)'/g)].map(([, spec]) => spec)
  if (ids === 0 || specs.length !== ids) {
    throw new Error(
      `A src/core/operations.ts nem olvasható be: ${ids} OperationId, ${specs.length} spec jelölés.`,
    )
  }
  return {
    total: ids,
    article: hungarianArticle(ids),
    undocumented: specs.filter((spec) => spec === 'undocumented').length,
  }
}

export async function loadSiteData() {
  const pages = await loadDocsPages()
  const [examples, recipes, operations] = await Promise.all([
    loadSandboxExamples(),
    loadRecipes(pages),
    loadOperationCounts(),
  ])
  return { pages, examples, recipes, operations }
}
