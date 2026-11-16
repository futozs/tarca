import { brandColors } from '@/lib/brand'
import { LogoArt } from '@/lib/logo-art'
import { ogFontFamilies } from '@/lib/og-fonts'

const LONG_TITLE_LENGTH = 32
const DESCRIPTION_LIMIT = 150
const DESCRIPTION_LIMIT_LONG_TITLE = 96
const ROUTE_SEGMENT_LIMIT = 18
const TOOTH_WIDTH = 24
const TOOTH_DEPTH = 12
const BAR_WIDTH = 296
const LEAF_WIDTH = 216
const LEAF_HEIGHT = 252

const ogColors = {
  leaf: '#f3f5fd',
  rule: '#c6cce4',
  blueInk: '#2b3fd9',
} as const

interface DocsOgImageProps {
  readonly title: string
  readonly description?: string | undefined
  readonly section?: string | undefined
  readonly route: string
}

export function truncateText(text: string, limit: number): string {
  const normalized = text.trim()
  if (normalized.length <= limit) return normalized
  const cut = normalized.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  const wordSafe = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${wordSafe.replace(/[\s,.;:]+$/, '')}…`
}

export function ogTitleSize(title: string): number {
  if (title.length <= 16) return 72
  if (title.length <= LONG_TITLE_LENGTH) return 58
  return 46
}

export function ogDescriptionLimit(title: string): number {
  return title.length > LONG_TITLE_LENGTH ? DESCRIPTION_LIMIT_LONG_TITLE : DESCRIPTION_LIMIT
}

export function ogRouteLines(url: string): string[] {
  return url
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const line = `/${segment}`
      return line.length <= ROUTE_SEGMENT_LIMIT
        ? line
        : `${line.slice(0, ROUTE_SEGMENT_LIMIT - 1)}…`
    })
}

export function tornLeafPath(width: number, height: number): string {
  const teeth = Math.floor(width / TOOTH_WIDTH)
  const zigzag = Array.from({ length: teeth }, (_, index) => {
    const right = width - index * TOOTH_WIDTH
    return `L${right - TOOTH_WIDTH / 2} ${height} L${right - TOOTH_WIDTH} ${height - TOOTH_DEPTH}`
  })
  return `M0 0 H${width} V${height - TOOTH_DEPTH} ${zigzag.join(' ')} Z`
}

function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      {LogoArt({ id: 'og' })}
    </svg>
  )
}

function HangingLeaf({ route }: { route: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 60,
        right: 80,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: BAR_WIDTH,
      }}
    >
      <div
        style={{
          display: 'flex',
          width: BAR_WIDTH,
          height: 52,
          borderRadius: 14,
          background: brandColors.blue,
        }}
      />
      <div
        style={{ display: 'flex', position: 'relative', width: LEAF_WIDTH, height: LEAF_HEIGHT }}
      >
        <svg
          width={LEAF_WIDTH}
          height={LEAF_HEIGHT}
          viewBox={`0 0 ${LEAF_WIDTH} ${LEAF_HEIGHT}`}
          style={{ position: 'absolute', top: 0, left: 0 }}
          aria-hidden="true"
        >
          <path
            d={tornLeafPath(LEAF_WIDTH, LEAF_HEIGHT)}
            fill={ogColors.leaf}
            stroke={ogColors.rule}
            strokeWidth={2}
          />
        </svg>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            position: 'absolute',
            top: 30,
            left: 22,
            right: 22,
          }}
        >
          {ogRouteLines(route).map((line) => (
            <span
              key={line}
              style={{
                display: 'flex',
                color: ogColors.blueInk,
                fontFamily: ogFontFamilies.mono,
                fontWeight: 500,
                fontSize: 16,
                whiteSpace: 'nowrap',
              }}
            >
              {line}
            </span>
          ))}
          <span
            style={{
              display: 'flex',
              marginTop: 14,
              width: 132,
              height: 6,
              borderRadius: 3,
              background: ogColors.rule,
            }}
          />
          <span
            style={{
              display: 'flex',
              width: 92,
              height: 6,
              borderRadius: 3,
              background: ogColors.rule,
            }}
          />
        </div>
      </div>
    </div>
  )
}

export function docsOgImage({ title, description, section, route }: DocsOgImageProps) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '64px 80px',
        background: brandColors.paper,
        color: brandColors.ink,
        fontFamily: ogFontFamilies.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <LogoMark size={60} />
        <span
          style={{
            fontFamily: ogFontFamilies.display,
            fontWeight: 800,
            fontSize: 40,
            letterSpacing: -1.2,
          }}
        >
          tárca
        </span>
        <span style={{ marginLeft: 10, color: brandColors.muted, fontSize: 26 }}>Dokumentáció</span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
          width: 640,
        }}
      >
        {section ? (
          <span
            style={{ color: ogColors.blueInk, fontWeight: 600, fontSize: 26, marginBottom: 16 }}
          >
            {section}
          </span>
        ) : null}
        <span
          style={{
            fontFamily: ogFontFamilies.display,
            fontWeight: 800,
            fontSize: ogTitleSize(title),
            lineHeight: 1.04,
            letterSpacing: -2,
          }}
        >
          {title}
        </span>
        {description ? (
          <span style={{ marginTop: 22, color: brandColors.muted, fontSize: 26, lineHeight: 1.4 }}>
            {truncateText(description, ogDescriptionLimit(title))}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <span
          style={{
            display: 'flex',
            padding: '8px 16px',
            borderRadius: 8,
            background: brandColors.blue,
            color: brandColors.onBlue,
            fontFamily: ogFontFamilies.mono,
            fontWeight: 500,
            fontSize: 22,
          }}
        >
          npm i tarcajs
        </span>
        <span style={{ color: brandColors.muted, fontSize: 22 }}>
          TypeScript kliens a Billingo API v3-hoz
        </span>
      </div>

      <HangingLeaf route={route} />
    </div>
  )
}
