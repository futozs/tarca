import tarcaRelease from '../tarca-version.json' with { type: 'json' }

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel}`
  return 'http://localhost:3000'
}

export const site = {
  name: 'tárca',
  packageName: 'tarcajs',
  tagline: 'Billingo, TypeScriptben.',
  url: resolveSiteUrl(),
  version: tarcaRelease.version,
  repo: 'https://github.com/futozs/tarca',
  npm: 'https://www.npmjs.com/package/tarcajs',
  issues: 'https://github.com/futozs/tarca/issues',
  changelog: 'https://github.com/futozs/tarca/blob/main/CHANGELOG.md',
  editBase: 'https://github.com/futozs/tarca/edit/main/web/content/docs',
  officialDocs: 'https://developers.billingo.hu/post/api-v3',
  sibling: 'https://kasszajs.hu',
} as const

export const navLinks = [
  { href: '/docs', label: 'Dokumentáció', match: '/docs' },
  { href: '/sandbox', label: 'Sandbox', match: '/sandbox' },
  { href: '/docs/receptek', label: 'Receptek', match: '/docs/receptek' },
] as const

export function isNavLinkActive(pathname: string, match: string): boolean {
  if (match === '/docs') {
    return pathname.startsWith('/docs') && !pathname.startsWith('/docs/receptek')
  }
  return pathname === match || pathname.startsWith(`${match}/`)
}
