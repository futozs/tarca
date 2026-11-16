import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DOCS_DIR: string = join(import.meta.dirname, '../../web/content/docs')

export type DocsEntryKind = 'page' | 'folder'

export interface DocsTree {
  readonly entries: ReadonlyMap<string, DocsEntryKind>
  readonly mdxPages: readonly string[]
  readonly problems: readonly string[]
}

interface Meta {
  readonly title: string
  readonly pages: readonly string[]
}

const SLUG_SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/

function readMeta(folder: string): Meta {
  const raw: unknown = JSON.parse(readFileSync(join(DOCS_DIR, folder, 'meta.json'), 'utf8'))
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('title' in raw) ||
    typeof raw.title !== 'string' ||
    !('pages' in raw) ||
    !Array.isArray(raw.pages) ||
    !raw.pages.every((page: unknown) => typeof page === 'string')
  ) {
    throw new Error(`Hibás meta.json: web/content/docs/${folder}`)
  }
  return { title: raw.title, pages: raw.pages }
}

function childSlug(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`
}

function listFiles(suffix: string): string[] {
  return readdirSync(DOCS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith(suffix))
    .map((file) => file.replaceAll('\\', '/'))
    .sort()
}

export function pageSlug(file: string): string {
  return file.replace(/\.mdx$/, '').replace(/(^|\/)index$/, '')
}

export function loadDocsTree(): DocsTree {
  const entries = new Map<string, DocsEntryKind>()
  const problems: string[] = []
  const visited: string[] = []

  function walk(folder: string): void {
    visited.push(folder)
    const meta = readMeta(folder)
    if (new Set(meta.pages).size !== meta.pages.length) {
      problems.push(`Ismétlődő oldal a meta.json-ban: ${folder || '(gyökér)'}`)
    }
    for (const name of meta.pages) {
      if (folder === '' && name === 'index') {
        entries.set('', 'page')
        continue
      }
      if (!SLUG_SEGMENT.test(name)) {
        problems.push(`Érvénytelen oldalnév: ${childSlug(folder, name)}`)
        continue
      }
      const slug = childSlug(folder, name)
      if (existsSync(join(DOCS_DIR, slug, 'meta.json'))) {
        entries.set(slug, 'folder')
        walk(slug)
      } else {
        entries.set(slug, 'page')
      }
    }
  }

  walk('')
  const metaFolders = listFiles('meta.json').map((file) =>
    file === 'meta.json' ? '' : file.slice(0, -'/meta.json'.length),
  )
  for (const folder of metaFolders) {
    if (!visited.includes(folder)) {
      problems.push(`Egyik meta.json sem hivatkozik erre a mappára: ${folder}`)
    }
  }
  return { entries, mdxPages: listFiles('.mdx').map(pageSlug), problems }
}

export function docsPageExists(slug: string): boolean {
  const base = slug === '' ? 'index' : slug
  return existsSync(join(DOCS_DIR, `${base}.mdx`)) || existsSync(join(DOCS_DIR, base, 'index.mdx'))
}
