export type Flow = 'x' | 'y' | 'auto'
export type Side = 'l' | 'r' | 't' | 'b'
export type Axis = 'x' | 'y'
export type Point = readonly [x: number, y: number]

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface EdgeSpec {
  readonly key: string
  readonly from: string
  readonly to: string
  readonly dim: boolean
}

export interface EdgeGeometry {
  readonly axis: Axis
  readonly start: Point
  readonly end: Point
  readonly d: string
}

const EDGE_TOLERANCE = 1
const CURVE_PULL = 0.55
const MIN_PULL_X = 16
const MIN_PULL_Y = 12
const CLIP_BLEED = 12
const PORT_STEP = 16
const PORT_SPREAD = 0.7

export function parseFlow(value: string): Flow {
  const flow = value.trim()
  return flow === 'x' || flow === 'y' ? flow : 'auto'
}

export function parseEdges(source: string): readonly EdgeSpec[] {
  return source
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const [pair = '', style] = token.split(':')
      const [from, to, extra] = pair.split('>')
      if (!from || !to || extra !== undefined) throw new Error(`Hibás drót: ${token}`)
      if (style !== undefined && style !== 'dim') throw new Error(`Ismeretlen drótstílus: ${token}`)
      return { key: `${from}>${to}`, from, to, dim: style === 'dim' }
    })
}

export function parseRuns(source: string | undefined): readonly (readonly string[])[] {
  return (source ?? '')
    .split('|')
    .map((run) => run.trim())
    .filter(Boolean)
    .map((run) => run.split('>'))
}

export function runEdgeKeys(runs: readonly (readonly string[])[]): ReadonlySet<string> {
  return new Set(runs.flatMap((run) => run.slice(1).map((to, i) => `${run[i]}>${to}`)))
}

export function checkDiagram(edges: readonly EdgeSpec[], runs: readonly (readonly string[])[]) {
  const keys = new Set(edges.map((edge) => edge.key))
  for (const key of runEdgeKeys(runs)) {
    if (!keys.has(key)) throw new Error(`A futás olyan drótot használ, ami nincs az ábrán: ${key}`)
  }
}

export function sidesFor(a: Rect, b: Rect, flow: Flow): readonly [Side, Side] {
  if (flow === 'x') return b.x >= a.x + a.w / 2 ? ['r', 'l'] : ['l', 'r']
  if (flow === 'y') return b.y >= a.y + a.h / 2 ? ['b', 't'] : ['t', 'b']
  if (b.x >= a.x + a.w - EDGE_TOLERANCE) return ['r', 'l']
  if (b.x + b.w <= a.x + EDGE_TOLERANCE) return ['l', 'r']
  return b.y >= a.y + a.h / 2 ? ['b', 't'] : ['t', 'b']
}

export function axisOf(side: Side): Axis {
  return side === 'l' || side === 'r' ? 'x' : 'y'
}

export function anchor(rect: Rect, side: Side, along?: number): Point {
  if (side === 'l' || side === 'r') {
    const y = along === undefined ? rect.y + rect.h / 2 : clamp(along, rect.y, rect.y + rect.h)
    return [side === 'r' ? rect.x + rect.w : rect.x, y]
  }
  const x = along === undefined ? rect.x + rect.w / 2 : clamp(along, rect.x, rect.x + rect.w)
  return [x, side === 'b' ? rect.y + rect.h : rect.y]
}

export function curvePath([x1, y1]: Point, [x2, y2]: Point, axis: Axis): string {
  if (axis === 'x') {
    const pull = Math.max(MIN_PULL_X, Math.abs(x2 - x1) * CURVE_PULL) * Math.sign(x2 - x1 || 1)
    return `M${x1} ${y1} C${x1 + pull} ${y1} ${x2 - pull} ${y2} ${x2} ${y2}`
  }
  const pull = Math.max(MIN_PULL_Y, Math.abs(y2 - y1) * CURVE_PULL) * Math.sign(y2 - y1 || 1)
  return `M${x1} ${y1} C${x1} ${y1 + pull} ${x2} ${y2 - pull} ${x2} ${y2}`
}

export interface EdgeInput {
  readonly from: string
  readonly to: string
  readonly a: Rect
  readonly b: Rect
  readonly portY?: number
}

interface Placed<T extends EdgeInput> {
  readonly input: T
  readonly fromSide: Side
  readonly toSide: Side
  readonly along: [start: number | undefined, end: number | undefined]
}

interface PortSlot {
  readonly edge: Placed<EdgeInput>
  readonly end: 0 | 1
  readonly order: number
}

function centerAlong(rect: Rect, axis: Axis): number {
  return axis === 'x' ? rect.y + rect.h / 2 : rect.x + rect.w / 2
}

export function layoutEdges<T extends EdgeInput>(
  inputs: readonly T[],
  flow: Flow,
): { readonly input: T; readonly geometry: EdgeGeometry }[] {
  const groups = new Map<string, { rect: Rect; axis: Axis; slots: PortSlot[] }>()
  const claim = (node: string, side: Side, rect: Rect, slot: PortSlot) => {
    const key = `${node}:${side}`
    const group = groups.get(key) ?? { rect, axis: axisOf(side), slots: [] }
    group.slots.push(slot)
    groups.set(key, group)
  }
  const placed = inputs.map((input): Placed<T> => {
    const [fromSide, toSide] = sidesFor(input.a, input.b, flow)
    const axis = axisOf(fromSide)
    const fixedStart = axis === 'x' ? input.portY : undefined
    const edge: Placed<T> = { input, fromSide, toSide, along: [fixedStart, undefined] }
    if (fixedStart === undefined) {
      claim(input.from, fromSide, input.a, { edge, end: 0, order: centerAlong(input.b, axis) })
    }
    claim(input.to, toSide, input.b, { edge, end: 1, order: centerAlong(input.a, axis) })
    return edge
  })
  for (const { rect, axis, slots } of groups.values()) {
    if (slots.length < 2) continue
    slots.sort((p, q) => p.order - q.order)
    const length = axis === 'x' ? rect.h : rect.w
    const step = Math.min(PORT_STEP, (length * PORT_SPREAD) / (slots.length - 1))
    const middle = centerAlong(rect, axis)
    for (const [i, slot] of slots.entries()) {
      slot.edge.along[slot.end] = middle + (i - (slots.length - 1) / 2) * step
    }
  }
  return placed.map(({ input, fromSide, toSide, along }) => {
    const start = anchor(input.a, fromSide, along[0])
    const end = anchor(input.b, toSide, along[1])
    const axis = axisOf(fromSide)
    return { input, geometry: { axis, start, end, d: curvePath(start, end, axis) } }
  })
}

export function hiddenClip({ axis, start, end }: EdgeGeometry): string {
  const b = `-${CLIP_BLEED}px`
  if (axis === 'x') {
    return end[0] >= start[0] ? `inset(${b} 100% ${b} ${b})` : `inset(${b} ${b} ${b} 100%)`
  }
  return end[1] >= start[1] ? `inset(${b} ${b} 100% ${b})` : `inset(100% ${b} ${b} ${b})`
}

export const SHOWN_CLIP = `inset(-${CLIP_BLEED}px)`

export function travelOffsets(samples: readonly Point[], geometry: EdgeGeometry): number[] {
  const { axis, start, end } = geometry
  const index = axis === 'x' ? 0 : 1
  const span = end[index] - start[index]
  let reached = 0
  return samples.map((point, i) => {
    if (i === 0) return 0
    if (i === samples.length - 1) return 1
    const raw = span === 0 ? i / (samples.length - 1) : (point[index] - start[index]) / span
    reached = clamp(Math.max(reached, raw), 0, 1)
    return reached
  })
}

export function relativeRect(inner: DOMRectReadOnly, outer: DOMRectReadOnly): Rect {
  return { x: inner.left - outer.left, y: inner.top - outer.top, w: inner.width, h: inner.height }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
