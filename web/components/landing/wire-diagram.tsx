'use client'

import { type ComponentProps, useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import {
  checkDiagram,
  type EdgeGeometry,
  type EdgeInput,
  type EdgeSpec,
  hiddenClip,
  layoutEdges,
  type Point,
  parseEdges,
  parseFlow,
  parseRuns,
  relativeRect,
  runEdgeKeys,
  SHOWN_CLIP,
  travelOffsets,
} from './wire-geometry'

const SVG_NS = 'http://www.w3.org/2000/svg'
const DRAW_MS = 560
const MIN_DRAW_MS = 320
const DRAW_MS_PER_PX = 2.4
const PORT_FADE_MS = 160
const PAUSE_MS = 90
const RUN_GAP_MS = 360
const STAGGER_MS = 70
const AUTOSTART_MS = 350
const DOT_SAMPLES = 32
const VISIBLE_SHARE = 0.45
const TRAVEL_EASING = 'cubic-bezier(0.45, 0, 0.2, 1)'

interface Wire {
  readonly spec: EdgeSpec
  readonly path: SVGPathElement
  readonly ports: readonly [SVGCircleElement, SVGCircleElement]
  geometry: EdgeGeometry
  drawn: boolean
}

export interface WireDiagramProps extends ComponentProps<'div'> {
  readonly edges: string
  readonly runs?: string
  readonly autostart?: boolean
  readonly lightAll?: boolean
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, className: string) {
  const element = document.createElementNS(SVG_NS, name)
  element.setAttribute('class', className)
  return element
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })
}

function setPoint(circle: SVGCircleElement, [x, y]: Point) {
  circle.setAttribute('cx', String(x))
  circle.setAttribute('cy', String(y))
}

function isVisibleEnough(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false
  return (
    entry.intersectionRatio >= VISIBLE_SHARE ||
    entry.intersectionRect.height >= window.innerHeight * VISIBLE_SHARE
  )
}

export function WireDiagram({
  edges,
  runs,
  autostart = false,
  lightAll = false,
  className,
  children,
  ...rest
}: WireDiagramProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const layer = layerRef.current
    if (!root || !layer) return
    const specs = parseEdges(edges)
    const runList = parseRuns(runs)
    checkDiagram(specs, runList)
    const nodes = new Map<string, HTMLElement>()
    for (const element of root.querySelectorAll<HTMLElement>('[data-node]')) {
      if (element.dataset.node) nodes.set(element.dataset.node, element)
    }
    const nodeOf = (id: string): HTMLElement => {
      const node = nodes.get(id)
      if (!node) throw new Error(`Hiányzó doboz az ábrán: ${id}`)
      return node
    }

    const abort = new AbortController()
    const { signal } = abort
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animations: Animation[] = []
    const animate = (
      element: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => {
      const animation = element.animate(keyframes, options)
      animations.push(animation)
      return animation
    }

    const dotElement = svgElement('circle', 'wd-dot')
    dotElement.setAttribute('r', '5.5')
    const wires: Wire[] = specs.map((spec) => {
      const tone = spec.dim ? ' is-dim' : ''
      const group = svgElement('g', 'wd-edge')
      group.setAttribute('data-edge', spec.key)
      const path = svgElement('path', `wd-wire${tone}`)
      const ports = [
        svgElement('circle', `wd-port${tone}`),
        svgElement('circle', `wd-port${tone}`),
      ] as const
      for (const port of ports) port.setAttribute('r', '3.5')
      group.append(path, ...ports)
      if (spec.dim) layer.prepend(group)
      else layer.append(group)
      return {
        spec,
        path,
        ports,
        geometry: { axis: 'x', start: [0, 0], end: [0, 0], d: '' },
        drawn: reduce,
      }
    })
    layer.append(dotElement)

    const layout = () => {
      const frame = root.getBoundingClientRect()
      layer.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`)
      const flow = parseFlow(getComputedStyle(root).getPropertyValue('--flow'))
      const inputs = wires.map((wire): EdgeInput & { readonly wire: Wire } => {
        const from = nodeOf(wire.spec.from)
        const to = nodeOf(wire.spec.to)
        const portSelector = from.dataset.portY
        const portElement = portSelector ? from.querySelector(portSelector) : null
        const portRect = portElement
          ? relativeRect(portElement.getBoundingClientRect(), frame)
          : null
        return {
          wire,
          from: wire.spec.from,
          to: wire.spec.to,
          a: relativeRect(from.getBoundingClientRect(), frame),
          b: relativeRect(to.getBoundingClientRect(), frame),
          portY: portRect ? portRect.y + portRect.h / 2 : undefined,
        }
      })
      for (const { input, geometry } of layoutEdges(inputs, flow)) {
        const { wire } = input
        wire.geometry = geometry
        wire.path.setAttribute('d', wire.geometry.d)
        setPoint(wire.ports[0], wire.geometry.start)
        setPoint(wire.ports[1], wire.geometry.end)
        if (!wire.drawn) wire.path.style.clipPath = hiddenClip(wire.geometry)
      }
    }

    const light = (id: string) => nodes.get(id)?.classList.add('is-lit')
    const show = (tag: string) => {
      for (const element of root.querySelectorAll(`[data-show="${tag}"]`)) {
        element.classList.add('is-shown')
      }
    }

    const travel = (wire: Wire): Keyframe[] => {
      const total = wire.path.getTotalLength()
      const samples: Point[] = Array.from({ length: DOT_SAMPLES + 1 }, (_, i) => {
        const point = wire.path.getPointAtLength((total * i) / DOT_SAMPLES)
        return [point.x, point.y]
      })
      const offsets = travelOffsets(samples, wire.geometry)
      return samples.map(([x, y], i) => ({
        transform: `translate(${x}px, ${y}px)`,
        offset: offsets[i] ?? 1,
      }))
    }

    const draw = async (wire: Wire, dot: 'none' | 'enter' | 'continue') => {
      const duration = Math.min(
        DRAW_MS,
        Math.max(MIN_DRAW_MS, wire.path.getTotalLength() * DRAW_MS_PER_PX),
      )
      const timing = { duration, easing: TRAVEL_EASING, fill: 'forwards' } as const
      if (dot !== 'none') animate(dotElement, travel(wire), timing)
      if (dot === 'enter') {
        animate(dotElement, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1 }], {
          duration,
          fill: 'forwards',
        })
      }
      if (wire.drawn) {
        await wait(duration, signal)
        return
      }
      animate(wire.ports[0], [{ opacity: 0 }, { opacity: 1 }], {
        duration: PORT_FADE_MS,
        fill: 'forwards',
      })
      const reveal = animate(
        wire.path,
        [{ clipPath: hiddenClip(wire.geometry) }, { clipPath: SHOWN_CLIP }],
        timing,
      )
      await reveal.finished
      wire.drawn = true
      wire.path.style.clipPath = ''
      animate(wire.ports[1], [{ opacity: 0 }, { opacity: 1 }], {
        duration: PORT_FADE_MS,
        fill: 'forwards',
      })
    }

    const runKeys = runEdgeKeys(runList)
    const wireOf = (from: string, to: string): Wire => {
      const wire = wires.find((item) => item.spec.key === `${from}>${to}`)
      if (!wire) throw new Error(`Hiányzó drót: ${from}>${to}`)
      return wire
    }

    const finish = () => {
      for (const wire of wires) {
        wire.drawn = true
        wire.path.style.clipPath = ''
      }
      for (const [index, run] of runList.entries()) {
        for (const id of run) {
          light(id)
          show(id)
        }
        show(`r${index + 1}`)
      }
      if (lightAll) for (const wire of wires) light(wire.spec.to)
      root.dataset.played = ''
    }

    const play = async () => {
      const statics = wires.filter((wire) => !runKeys.has(wire.spec.key))
      await Promise.all(
        statics.map(async (wire, i) => {
          await wait(i * STAGGER_MS, signal)
          await draw(wire, 'none')
          if (lightAll) light(wire.spec.to)
        }),
      )
      for (const [index, run] of runList.entries()) {
        const [first, ...rest] = run
        if (first === undefined) continue
        light(first)
        let previous = first
        for (const [step, id] of rest.entries()) {
          await draw(wireOf(previous, id), step === 0 ? 'enter' : 'continue')
          light(id)
          show(id)
          await wait(PAUSE_MS, signal)
          previous = id
        }
        animate(dotElement, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })
        show(`r${index + 1}`)
        await wait(RUN_GAP_MS, signal)
      }
      root.dataset.played = ''
    }

    const start = () => {
      play().catch((error: unknown) => {
        if (!signal.aborted) throw error
      })
    }

    layout()
    const resize = new ResizeObserver(layout)
    resize.observe(root)
    for (const node of nodes.values()) resize.observe(node)
    document.fonts.ready.then(() => {
      if (!signal.aborted) layout()
    })

    let intersection: IntersectionObserver | undefined
    if (reduce) {
      finish()
    } else {
      for (const wire of wires) for (const port of wire.ports) port.style.opacity = '0'
      if (autostart) {
        wait(AUTOSTART_MS, signal).then(start, () => {})
      } else {
        intersection = new IntersectionObserver(
          (entries) => {
            if (!entries.some(isVisibleEnough)) return
            intersection?.disconnect()
            start()
          },
          { threshold: [0, 0.15, 0.3, VISIBLE_SHARE, 0.6] },
        )
        intersection.observe(root)
      }
    }

    return () => {
      abort.abort()
      resize.disconnect()
      intersection?.disconnect()
      for (const animation of animations) animation.cancel()
      layer.replaceChildren()
      for (const node of nodes.values()) node.classList.remove('is-lit')
      for (const element of root.querySelectorAll('.is-shown')) element.classList.remove('is-shown')
      delete root.dataset.played
    }
  }, [edges, runs, autostart, lightAll])

  return (
    <div ref={rootRef} className={cn('wd', className)} {...rest}>
      {children}
      <svg ref={layerRef} className="wd-wires" aria-hidden="true" focusable="false" />
    </div>
  )
}
