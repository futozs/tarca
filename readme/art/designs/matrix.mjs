import { el, icon, logoMark, num, svgDocument } from '../svg.mjs'
import { backdrop, backdropDefs, cardBorder, cardClip } from './parts.mjs'

const WIDTH = 1280
const RADIUS = 28
const NAME_X = 64
const GRID_X = 452
const CELL = 64
const ROW_HEIGHT = 56
const HEADER_BOTTOM = 296
const DEPS_X = 1150
const TITLE = 'Billingo kliensek az npm-en'

const FEATURES = [
  { group: 'Csomag', label: 'ESM és CJS' },
  { group: 'Csomag', label: 'TypeScript típusok' },
  { group: 'Csomag', label: 'Edge futtatás' },
  { group: 'API', label: 'Billingo API v3' },
  { group: 'API', label: '3.0.15 típusok' },
  { group: 'API', label: '429, Retry-After' },
  { group: 'Minőség', label: 'tesztek' },
  { group: 'Minőség', label: 'több fiók' },
  { group: 'Minőség', label: 'aktív fejlesztés' },
]

const PACKAGES = [
  {
    name: 'tarca',
    supported: FEATURES.map((_, index) => index),
    dependencies: 0,
    highlight: true,
  },
  { name: '@codingsans/billingo-client', supported: [1, 3], dependencies: 2 },
  { name: '@clientapi/billingo', supported: [0, 1, 3, 7], dependencies: 1 },
  { name: 'billingo_api_v3', supported: [3], unknown: [7], dependencies: 2 },
  { name: 'billingo-v3', supported: [3], unknown: [7], dependencies: 1 },
  { name: 'node-billingo', supported: [6], unknown: [7], dependencies: 9 },
]

const HEIGHT = HEADER_BOTTOM + PACKAGES.length * ROW_HEIGHT + 62

function columnCenter(index) {
  return GRID_X + index * CELL + CELL / 2
}

function groups() {
  const result = []
  FEATURES.forEach((feature, index) => {
    const last = result.at(-1)
    if (last && last.name === feature.group) last.end = index
    else result.push({ name: feature.group, start: index, end: index })
  })
  return result
}

function header(scope, theme) {
  const parts = [
    scope.text(TITLE, {
      font: 'heading',
      size: 34,
      x: NAME_X,
      y: 80,
      tracking: -0.015,
      fill: theme.ink,
    }),
    scope.text(
      'A publikált csomagok kódjában és az npm adataiban ellenőrizve, 2026 novemberében. A „–” jel: nem ellenőriztük.',
      {
        font: 'sans',
        size: 17,
        x: NAME_X,
        y: 112,
        fill: theme.muted,
      },
    ),
  ]
  for (const group of groups()) {
    const left = GRID_X + group.start * CELL + 6
    const right = GRID_X + (group.end + 1) * CELL - 6
    parts.push(
      scope.text(group.name.toLocaleUpperCase('hu-HU'), {
        font: 'monoMedium',
        size: 12.5,
        x: (left + right) / 2,
        y: 150,
        anchor: 'middle',
        tracking: 0.12,
        fill: theme.muted,
      }),
      el('path', {
        d: `M${left} 166V160H${right}V166`,
        fill: 'none',
        stroke: theme.ruleStrong,
        'stroke-width': 1.5,
      }),
    )
  }
  FEATURES.forEach((feature, index) => {
    parts.push(
      el(
        'g',
        {
          transform: `translate(${num(columnCenter(index) - 4)} ${HEADER_BOTTOM - 16}) rotate(-50)`,
        },
        scope.text(feature.label, { font: 'sansMedium', size: 14, fill: theme.ink2 }),
      ),
    )
  })
  parts.push(
    scope.text('függőség', {
      font: 'monoMedium',
      size: 12.5,
      x: DEPS_X,
      y: HEADER_BOTTOM - 16,
      anchor: 'middle',
      tracking: 0.04,
      fill: theme.muted,
    }),
  )
  return parts.join('')
}

function cell(theme, { x, y, supported, unknown, highlight }) {
  if (unknown) {
    return el('path', {
      d: `M${num(x - 6)} ${num(y)}H${num(x + 6)}`,
      stroke: theme.muted,
      'stroke-width': 2,
      'stroke-linecap': 'round',
    })
  }
  if (!supported) {
    return el('circle', {
      cx: x,
      cy: y,
      r: 5,
      fill: 'none',
      stroke: theme.ruleStrong,
      'stroke-width': 1.5,
    })
  }
  const fill = highlight ? theme.accent : theme.ruleStrong
  const mark = highlight ? theme.brandInk : theme.name === 'dark' ? theme.muted : theme.paper
  return [
    el('circle', { cx: x, cy: y, r: 14, fill }),
    icon('check', { x: x - 9, y: y - 9, size: 18, stroke: mark, width: 2.8 }),
  ].join('')
}

function row(scope, theme, pack, index) {
  const top = HEADER_BOTTOM + index * ROW_HEIGHT
  const center = top + ROW_HEIGHT / 2
  const parts = []
  if (pack.highlight) {
    parts.push(
      el('rect', {
        x: 40,
        y: top + 4,
        width: WIDTH - 80,
        height: ROW_HEIGHT - 8,
        rx: 14,
        fill: theme.accentSoft,
        stroke: theme.accent,
        'stroke-opacity': 0.35,
      }),
      logoMark({ x: NAME_X, y: center - 15, size: 30 }),
      scope.text(pack.name, {
        font: 'display',
        size: 25,
        x: NAME_X + 42,
        y: center + 8.5,
        tracking: -0.02,
        fill: theme.ink,
      }),
    )
  } else {
    parts.push(
      el('path', {
        d: `M40 ${top}H${WIDTH - 40}`,
        stroke: theme.rule,
        'stroke-dasharray': index === 1 ? undefined : '3 5',
      }),
      scope.text(pack.name, {
        font: 'mono',
        size: 16,
        x: NAME_X,
        y: center + 5.5,
        fill: theme.ink2,
      }),
    )
  }
  const supported = new Set(pack.supported)
  const unknown = new Set(pack.unknown)
  FEATURES.forEach((_, column) => {
    parts.push(
      cell(theme, {
        x: columnCenter(column),
        y: center,
        supported: supported.has(column),
        unknown: unknown.has(column),
        highlight: pack.highlight,
      }),
    )
  })
  const scoreOptions = pack.highlight
    ? { font: 'monoBold', size: 20, fill: theme.accent }
    : { font: 'mono', size: 17, fill: theme.muted }
  parts.push(
    scope.text(String(pack.dependencies), {
      ...scoreOptions,
      x: DEPS_X,
      y: center + 6.5,
      anchor: 'middle',
    }),
  )
  return parts.join('')
}

function separators(theme) {
  return groups()
    .slice(1)
    .map((group) =>
      el('path', {
        d: `M${GRID_X + group.start * CELL} 176V${HEADER_BOTTOM + PACKAGES.length * ROW_HEIGHT}`,
        stroke: theme.rule,
        'stroke-dasharray': '2 6',
      }),
    )
    .join('')
}

function describe() {
  return PACKAGES.map((pack) => {
    const features = pack.supported.map((index) => FEATURES[index].label)
    const list = features.length > 0 ? features.join(', ') : 'egyik sem'
    return `${pack.name}: ${list}; ${pack.dependencies} futásidejű függőség`
  }).join('. ')
}

export function matrixDocument({ type, theme }) {
  const scope = type.scope()
  const body = el(
    'g',
    { 'clip-path': 'url(#matrix-card)' },
    [
      backdrop('matrix', theme, {
        width: WIDTH,
        height: HEIGHT,
        glow: { cx: 360, cy: HEADER_BOTTOM + 28, rx: 520, ry: 200 },
      }),
      header(scope, theme),
      separators(theme),
      ...PACKAGES.map((pack, index) => row(scope, theme, pack, index)),
    ].join(''),
  )
  return svgDocument({
    width: WIDTH,
    height: HEIGHT,
    title: TITLE,
    description: describe(),
    defs: [
      cardClip('matrix-card', { width: WIDTH, height: HEIGHT, radius: RADIUS }),
      backdropDefs('matrix', theme),
      scope.defs(),
    ].join(''),
    body: body + cardBorder(theme, { width: WIDTH, height: HEIGHT, radius: RADIUS }),
  })
}
