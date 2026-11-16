import type { ImageResponseOptions } from 'next/server'

type OgFont = NonNullable<ImageResponseOptions['fonts']>[number]
type OgFontWeight = NonNullable<OgFont['weight']>

interface FontRequest {
  readonly family: string
  readonly weight: OgFontWeight
  readonly width?: number
}

const GOOGLE_FONTS_CSS_URL = 'https://fonts.googleapis.com/css2'
const FONT_SOURCE = /src:\s*url\((.+?)\)\s*format\('(?:truetype|opentype)'\)/

export const ogFontFamilies = {
  display: 'Archivo',
  sans: 'Public Sans',
  mono: 'JetBrains Mono',
} as const

const FONT_REQUESTS: readonly FontRequest[] = [
  { family: ogFontFamilies.display, weight: 800, width: 125 },
  { family: ogFontFamilies.sans, weight: 400 },
  { family: ogFontFamilies.sans, weight: 600 },
  { family: ogFontFamilies.mono, weight: 500 },
]

export function googleFontQuery({ family, weight, width }: FontRequest): string {
  const axes = width === undefined ? `wght@${weight}` : `wdth,wght@${width},${weight}`
  return new URLSearchParams({ family: `${family}:${axes}` }).toString()
}

async function fetchGoogleFont(request: FontRequest): Promise<OgFont> {
  const { family, weight } = request
  const cssResponse = await fetch(`${GOOGLE_FONTS_CSS_URL}?${googleFontQuery(request)}`)
  if (!cssResponse.ok) {
    throw new Error(
      `A(z) ${family} ${weight} betűtípus CSS-e nem tölthető le (HTTP ${cssResponse.status}).`,
    )
  }
  const fontUrl = FONT_SOURCE.exec(await cssResponse.text())?.[1]
  if (!fontUrl) {
    throw new Error(`A(z) ${family} ${weight} betűtípushoz nem érkezett TTF forrás.`)
  }
  const fontResponse = await fetch(fontUrl)
  if (!fontResponse.ok) {
    throw new Error(
      `A(z) ${family} ${weight} betűtípus fájlja nem tölthető le (HTTP ${fontResponse.status}).`,
    )
  }
  return { name: family, data: await fontResponse.arrayBuffer(), weight, style: 'normal' }
}

let pendingFonts: Promise<OgFont[]> | undefined

export function loadOgFonts(): Promise<OgFont[]> {
  pendingFonts ??= Promise.all(FONT_REQUESTS.map(fetchGoogleFont)).catch((error: unknown) => {
    pendingFonts = undefined
    throw error
  })
  return pendingFonts
}
