import { describe, expect, it } from 'vitest'
import {
  checkDiagram,
  type EdgeGeometry,
  type Flow,
  hiddenClip,
  layoutEdges,
  type Point,
  parseEdges,
  parseFlow,
  parseRuns,
  type Rect,
  runEdgeKeys,
  sidesFor,
  travelOffsets,
} from './wire-geometry'

function onEdge([x, y]: Point, r: Rect): boolean {
  const inX = x >= r.x && x <= r.x + r.w
  const inY = y >= r.y && y <= r.y + r.h
  const onVertical = (x === r.x || x === r.x + r.w) && inY
  const onHorizontal = (y === r.y || y === r.y + r.h) && inX
  return onVertical || onHorizontal
}

function edgeGeometry(a: Rect, b: Rect, flow: Flow, portY?: number): EdgeGeometry {
  const [placed] = layoutEdges([{ from: 'a', to: 'b', a, b, portY }], flow)
  if (!placed) throw new Error('nincs geometria')
  return placed.geometry
}

const layouts: Record<string, readonly [Rect, Rect]> = {
  'jobbra mellette': [
    { x: 0, y: 0, w: 120, h: 40 },
    { x: 200, y: 80, w: 100, h: 40 },
  ],
  'balra mellette': [
    { x: 300, y: 10, w: 80, h: 30 },
    { x: 20, y: 0, w: 120, h: 50 },
  ],
  alatta: [
    { x: 0, y: 0, w: 300, h: 200 },
    { x: 40, y: 260, w: 180, h: 60 },
  ],
  'fölötte, átfedve': [
    { x: 50, y: 300, w: 200, h: 60 },
    { x: 0, y: 0, w: 260, h: 80 },
  ],
}

describe('drótgeometria', () => {
  for (const [name, [a, b]] of Object.entries(layouts)) {
    for (const flow of ['x', 'y', 'auto'] as const satisfies readonly Flow[]) {
      it(`${name}, ${flow}: mindkét vége a doboz élén van`, () => {
        const geometry = edgeGeometry(a, b, flow)
        expect(onEdge(geometry.start, a)).toBe(true)
        expect(onEdge(geometry.end, b)).toBe(true)
      })
    }
  }

  it('a kódsor portja a doboz bal vagy jobb élén marad, a dobozon belül', () => {
    const code = { x: 0, y: 0, w: 400, h: 240 }
    const request = { x: 480, y: 20, w: 200, h: 60 }
    expect(edgeGeometry(code, request, 'auto', 112).start).toEqual([400, 112])
    expect(edgeGeometry(code, request, 'auto', 900).start).toEqual([400, 240])
  })

  it('függőleges dróthoz nem használja a sor portját', () => {
    const code = { x: 0, y: 0, w: 400, h: 240 }
    const request = { x: 0, y: 300, w: 200, h: 60 }
    expect(edgeGeometry(code, request, 'auto', 112).start).toEqual([200, 240])
  })

  it('auto irányban egymás mellett vízszintes, egymás alatt függőleges', () => {
    expect(sidesFor({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }, 'auto')).toEqual([
      'r',
      'l',
    ])
    expect(sidesFor({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 30, w: 10, h: 10 }, 'auto')).toEqual([
      'b',
      't',
    ])
  })

  it('a rejtett vágás a haladás irányából nyílik', () => {
    const [a, b] = layouts['jobbra mellette'] ?? []
    if (!a || !b) throw new Error('hiányzó elrendezés')
    expect(hiddenClip(edgeGeometry(a, b, 'x'))).toBe('inset(-12px 100% -12px -12px)')
    expect(hiddenClip(edgeGeometry(b, a, 'x'))).toBe('inset(-12px -12px -12px 100%)')
    expect(hiddenClip(edgeGeometry(a, b, 'y'))).toBe('inset(-12px -12px 100% -12px)')
  })

  it('a pötty kulcskockái monoton nőnek 0-tól 1-ig', () => {
    const geometry = edgeGeometry(
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 110, y: 50, w: 10, h: 10 },
      'x',
    )
    const samples: Point[] = [
      [10, 5],
      [40, 6],
      [35, 20],
      [80, 50],
      [110, 55],
    ]
    expect(travelOffsets(samples, geometry)).toEqual([0, 0.3, 0.3, 0.7, 1])
  })
})

describe('ábraleírás', () => {
  it('beolvassa a drótokat és a halvány stílust', () => {
    expect(parseEdges(' a>b  b>c:dim ')).toEqual([
      { key: 'a>b', from: 'a', to: 'b', dim: false },
      { key: 'b>c', from: 'b', to: 'c', dim: true },
    ])
  })

  it('elutasítja a hibás drótot', () => {
    expect(() => parseEdges('a>b>c')).toThrow(/Hibás drót/)
    expect(() => parseEdges('a>')).toThrow(/Hibás drót/)
    expect(() => parseEdges('a>b:bold')).toThrow(/stílus/)
  })

  it('a futásokból a bejárt drótok lesznek', () => {
    const runs = parseRuns('a>hub>out | b>hub>out')
    expect(runs).toEqual([
      ['a', 'hub', 'out'],
      ['b', 'hub', 'out'],
    ])
    expect([...runEdgeKeys(runs)]).toEqual(['a>hub', 'hub>out', 'b>hub'])
    expect(parseRuns(undefined)).toEqual([])
  })

  it('hibát dob, ha a futás nem létező drótot jár be', () => {
    expect(() => checkDiagram(parseEdges('a>b'), parseRuns('a>b>c'))).toThrow(/b>c/)
    expect(() => checkDiagram(parseEdges('a>b b>c'), parseRuns('a>b>c'))).not.toThrow()
  })

  it('egy él több drótja külön portot kap, sorrendben, a doboz élén', () => {
    const hub = { x: 200, y: 100, w: 120, h: 80 }
    const sources = [0, 1, 2, 3].map((i) => ({ x: 0, y: 40 * i, w: 100, h: 30 }))
    const geometries = layoutEdges(
      sources.map((a, i) => ({ from: `s${i}`, to: 'hub', a, b: hub })),
      'x',
    )
    const ends = geometries.map(({ geometry }) => geometry.end)
    for (const end of ends) expect(onEdge(end, hub)).toBe(true)
    expect(new Set(ends.map(([, y]) => y)).size).toBe(4)
    expect(ends.map(([, y]) => y)).toEqual([...ends.map(([, y]) => y)].sort((p, q) => p - q))
    for (const [i, { geometry }] of geometries.entries()) {
      expect(geometry.start).toEqual([100, 40 * i + 15])
    }
  })

  it('a szétosztott portok középre zárva, a doboz élén belül maradnak', () => {
    const hub = { x: 0, y: 0, w: 60, h: 20 }
    const targets = [0, 1, 2].map((i) => ({ x: 100, y: -50 + 50 * i, w: 40, h: 20 }))
    const starts = layoutEdges(
      targets.map((b, i) => ({ from: 'hub', to: `t${i}`, a: hub, b })),
      'x',
    ).map(({ geometry }) => geometry.start[1])
    expect(starts[1]).toBe(10)
    for (const y of starts) expect(y >= 0 && y <= 20).toBe(true)
  })

  it('a --flow ismeretlen értéke auto', () => {
    expect(parseFlow(' x ')).toBe('x')
    expect(parseFlow('y')).toBe('y')
    expect(parseFlow('')).toBe('auto')
    expect(parseFlow('diagonal')).toBe('auto')
  })
})
