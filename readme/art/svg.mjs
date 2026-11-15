const LOGO_STEM =
  'M212 150H300V416L289 400L278 416L267 400L256 416L245 400L234 416L223 400L212 416Z'
const LOGO_BAR =
  'M114 96H398Q416 96 416 114V174Q416 192 398 192H114Q96 192 96 174V114Q96 96 114 96Z'
const LOGO_DEFS = [
  '<linearGradient id="km-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B4656"/><stop offset="1" stop-color="#1A212B"/></linearGradient>',
  '<linearGradient id="km-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.34"/><stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0.08"/></linearGradient>',
  '<linearGradient id="km-stem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D9DFE7"/></linearGradient>',
  '<linearGradient id="km-bar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5C74FF"/><stop offset="1" stop-color="#2A45F5"/></linearGradient>',
  '<filter id="km-shadow" x="-25%" y="-20%" width="150%" height="160%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000000" flood-opacity="0.4"/></filter>',
].join('')

const ICONS = {
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  globe:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM3.6 9h16.8M3.6 15h16.8M12 3c-2.5 2.5-3.8 5.5-3.8 9s1.3 6.5 3.8 9c2.5-2.5 3.8-5.5 3.8-9S14.5 5.5 12 3z',
  book: 'M12 6.6C10.1 5.2 7.4 4.5 4 4.5v13.2c3.4 0 6.1.7 8 2.1 1.9-1.4 4.6-2.1 8-2.1V4.5c-3.4 0-6.1.7-8 2.1zM12 6.6v13.2',
  chefHat:
    'M7 21h10M7 17.5h10M7 21v-7.4a4.2 4.2 0 0 1 .7-8.2 4.8 4.8 0 0 1 8.6 0 4.2 4.2 0 0 1 .7 8.2V21',
  play: 'M8 5.6v12.8a.9.9 0 0 0 1.4.8l10-6.4a.9.9 0 0 0 0-1.6l-10-6.4A.9.9 0 0 0 8 5.6z',
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export function num(value, digits = 2) {
  const rounded = Number(value.toFixed(digits))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char])
}

export function attrs(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => ` ${key}="${typeof value === 'number' ? num(value) : escapeXml(value)}"`)
    .join('')
}

export function el(name, values = {}, children = '') {
  return children === ''
    ? `<${name}${attrs(values)}/>`
    : `<${name}${attrs(values)}>${children}</${name}>`
}

export function svgDocument({ width, height, title, description, style = '', defs = '', body }) {
  const head = el('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-labelledby': 'title desc',
  }).replace('/>', '>')
  return [
    head,
    `<title id="title">${escapeXml(title)}</title>`,
    `<desc id="desc">${escapeXml(description)}</desc>`,
    style ? `<style>${style.replace(/\s*\n\s*/g, '')}</style>` : '',
    defs ? `<defs>${defs}</defs>` : '',
    body,
    '</svg>',
    '',
  ]
    .filter((line, index, lines) => line !== '' || index === lines.length - 1)
    .join('\n')
}

export function icon(name, { x, y, size = 24, stroke = 'none', fill = 'none', width = 2 }) {
  const path = ICONS[name]
  if (!path) throw new Error(`Ismeretlen ikon: ${name}`)
  const scale = size / 24
  return el('path', {
    d: path,
    transform: `translate(${num(x)} ${num(y)}) scale(${num(scale, 4)})`,
    fill,
    stroke,
    'stroke-width': num(width / scale, 3),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })
}

export function logoMark({ x, y, size, ring }) {
  const scale = size / 512
  const ringStroke = ring
    ? el('rect', {
        x: 1,
        y: 1,
        width: 510,
        height: 510,
        rx: 111,
        fill: 'none',
        stroke: ring,
        'stroke-width': 2 / scale,
      })
    : ''
  return el(
    'g',
    { transform: `translate(${num(x)} ${num(y)}) scale(${num(scale, 5)})` },
    [
      `<defs>${LOGO_DEFS}</defs>`,
      el('rect', { width: 512, height: 512, rx: 112, fill: 'url(#km-tile)' }),
      el('rect', {
        x: 1.5,
        y: 1.5,
        width: 509,
        height: 509,
        rx: 110.5,
        fill: 'none',
        stroke: 'url(#km-rim)',
        'stroke-width': 3,
      }),
      el(
        'g',
        { filter: 'url(#km-shadow)' },
        el('path', { d: LOGO_STEM, fill: 'url(#km-stem)' }) +
          el('path', { d: LOGO_BAR, fill: 'url(#km-bar)' }),
      ),
      ringStroke,
    ].join(''),
  )
}

export function receiptPath({ x, y, width, height, tooth = 14, depth = 7, radius = 6 }) {
  const count = Math.max(1, Math.round(width / tooth))
  const step = width / count
  let d = `M${num(x + radius)} ${num(y)}H${num(x + width - radius)}`
  d += `A${radius} ${radius} 0 0 1 ${num(x + width)} ${num(y + radius)}V${num(y + height)}`
  for (let index = 0; index < count; index++)
    d += `l${num(-step / 2)} ${depth}l${num(-step / 2)} ${-depth}`
  d += `V${num(y + radius)}A${radius} ${radius} 0 0 1 ${num(x + radius)} ${num(y)}Z`
  return d
}

export function dotPattern(id, { gap = 24, radius = 1.2, color }) {
  const center = gap / 2
  return el(
    'pattern',
    { id, width: gap, height: gap, patternUnits: 'userSpaceOnUse' },
    el('circle', { cx: center, cy: center, r: radius, fill: color }),
  )
}
