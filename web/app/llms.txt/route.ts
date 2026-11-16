import { absoluteUrl } from '@/lib/docs-links'
import { withArticle } from '@/lib/hungarian'
import { buildLlmsSections, renderLlmsIndex, toLlmsLink } from '@/lib/llms'
import { OPERATION_COUNT, siteDescription } from '@/lib/operations'
import { site } from '@/lib/site'
import { source } from '@/lib/source'

export const revalidate = false

export function GET() {
  const sections = buildLlmsSections(source.getPageTree(), (item) => {
    const page = source.getNodePage(item)
    return page ? toLlmsLink(page, site.url) : undefined
  })

  const body = renderLlmsIndex({
    title: site.name,
    summary: siteDescription,
    details: [
      `A tárca független, nyílt forráskódú projekt (MIT), nem a Billingo fejleszti. Telepítés: \`npm install ${site.packageName}\`, az import neve \`${site.packageName}\`. A Billingo API v3 mind ${withArticle(OPERATION_COUNT)} műveletét lefedi. A Billingo API hivatalos leírása: ${site.officialDocs}`,
      `Minden dokumentációs oldal Markdownként is elérhető, ha az oldal URL-jéhez hozzáadod a \`.md\` kiterjesztést (a kezdőlapé \`/docs/index.md\`). A teljes dokumentáció egyetlen fájlban: ${absoluteUrl('/llms-full.txt', site.url)}`,
    ],
    sections,
    optional: [
      {
        title: 'Sandbox',
        url: absoluteUrl('/sandbox', site.url),
        description:
          'A tárca példái a böngészőben futnak, API kulcs nélkül, a tarcajs/testing hamis Billingója ellen.',
      },
      { title: 'GitHub', url: site.repo, description: 'Forráskód, hibabejelentés.' },
      {
        title: 'npm',
        url: site.npm,
        description: `A ${site.packageName} csomag, jelenlegi verzió: ${site.version}.`,
      },
      { title: 'Változásnapló', url: site.changelog },
      { title: 'Billingo API v3 (hivatalos leírás)', url: site.officialDocs },
    ],
  })

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
