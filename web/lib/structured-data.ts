import { OPERATION_COUNT, siteDescription } from './operations'
import { site } from './site'

export function siteStructuredData(): string {
  const author = { '@type': 'Person', name: 'Futó Zsombor', url: 'https://futozs.hu' }
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${site.url}/#website`,
      url: site.url,
      name: 'tárca',
      alternateName: ['tarcajs', 'tárca Billingo kliens'],
      inLanguage: 'hu',
      description: siteDescription,
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': `${site.url}/#software`,
      name: 'tarcajs',
      alternateName: 'tárca',
      description: `Billingo npm csomag: TypeScript kliens a Billingo API v3-hoz, mind ${OPERATION_COUNT} művelettel.`,
      url: site.url,
      codeRepository: site.repo,
      programmingLanguage: ['TypeScript', 'JavaScript'],
      runtimePlatform: ['Node.js', 'Bun', 'Deno', 'Cloudflare Workers'],
      license: 'https://opensource.org/licenses/MIT',
      keywords: 'billingo, billingo api, billingo npm, billingo typescript, számlázás, nyugta, NAV',
      version: site.version,
      sameAs: [`https://www.npmjs.com/package/tarcajs`, site.repo],
      author,
    },
  ]
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
    /</g,
    '\\u003c',
  )
}
