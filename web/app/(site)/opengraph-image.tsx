import { ImageResponse } from 'next/og'
import { OG_IMAGE_SIZE } from '@/lib/docs-links'
import { loadOgFonts } from '@/lib/og-fonts'
import { docsOgImage } from '@/lib/og-image'
import { siteDescription } from '@/lib/operations'

export const alt = 'tárca: Billingo npm csomag és API v3 kliens TypeScripthez'
export const size = OG_IMAGE_SIZE
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    docsOgImage({
      title: 'Billingo, TypeScriptben',
      description: siteDescription,
      section: 'npm i tarcajs',
      route: '/',
    }),
    { ...OG_IMAGE_SIZE, fonts: await loadOgFonts() },
  )
}
