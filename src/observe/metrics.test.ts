import { describe, expect, test } from 'vitest'
import { createMetricsRegistry, DEFAULT_DURATION_BUCKETS_MS } from './index'

describe('createMetricsRegistry', () => {
  test('Prometheus szövegformátumot ad, címke-escape-pel és kumulatív hisztogrammal', () => {
    const registry = createMetricsRegistry([100, 10, 10])
    registry.counter('tarca_warnings_total', { hook: 'a"b\\c\nd' })
    registry.counter('sajat_total')
    registry.counter('sajat_total', undefined, 2)
    registry.histogram('tarca_request_duration_ms', 5, { operation: 'x' })
    registry.histogram('tarca_request_duration_ms', 50, { operation: 'x' })
    registry.histogram('tarca_request_duration_ms', 500, { operation: 'x' })

    expect(registry.renderPrometheus()).toBe(
      [
        '# TYPE sajat_total counter',
        'sajat_total 3',
        '# HELP tarca_warnings_total Figyelmeztetések forrás szerint',
        '# TYPE tarca_warnings_total counter',
        'tarca_warnings_total{hook="a\\"b\\\\c\\nd"} 1',
        '# HELP tarca_request_duration_ms Billingo próbálkozások időtartama ezredmásodpercben',
        '# TYPE tarca_request_duration_ms histogram',
        'tarca_request_duration_ms_bucket{operation="x",le="10"} 1',
        'tarca_request_duration_ms_bucket{operation="x",le="100"} 2',
        'tarca_request_duration_ms_bucket{operation="x",le="+Inf"} 3',
        'tarca_request_duration_ms_sum{operation="x"} 555',
        'tarca_request_duration_ms_count{operation="x"} 3',
        '',
      ].join('\n'),
    )
    registry.reset()
    expect(registry.renderPrometheus()).toBe('')
  })

  test('a címkéket név szerint rendezi, így a sorrendjük nem hoz létre új sorozatot', () => {
    const registry = createMetricsRegistry()
    registry.counter('tarca_requests_total', { outcome: 'success', operation: 'GetDocument' })
    registry.counter('tarca_requests_total', { operation: 'GetDocument', outcome: 'success' })
    expect(registry.renderPrometheus()).toContain(
      'tarca_requests_total{operation="GetDocument",outcome="success"} 2',
    )
  })

  test('a határra eső érték a vödörbe tartozik (le: kisebb vagy egyenlő)', () => {
    const registry = createMetricsRegistry([10, 100])
    registry.histogram('tarca_request_duration_ms', 10)
    registry.histogram('tarca_request_duration_ms', 100)
    const lines = registry.renderPrometheus().split('\n')
    expect(lines).toContain('tarca_request_duration_ms_bucket{le="10"} 1')
    expect(lines).toContain('tarca_request_duration_ms_bucket{le="100"} 2')
  })

  test('a nulla növelés érvényes, a sorozatot nullával létrehozza', () => {
    const registry = createMetricsRegistry()
    registry.counter('tarca_retries_total', { operation: 'GetDocument' }, 0)
    expect(registry.renderPrometheus()).toContain('tarca_retries_total{operation="GetDocument"} 0')
  })

  test('az alapértelmezett határokkal minden vödröt kiír', () => {
    const registry = createMetricsRegistry()
    registry.histogram('tarca_request_duration_ms', 70_000)
    const lines = registry.renderPrometheus().split('\n')
    expect(
      lines.filter((line) => line.startsWith('tarca_request_duration_ms_bucket')),
    ).toHaveLength(DEFAULT_DURATION_BUCKETS_MS.length + 1)
    expect(lines).toContain('tarca_request_duration_ms_bucket{le="60000"} 0')
    expect(lines).toContain('tarca_request_duration_ms_bucket{le="+Inf"} 1')
  })

  test('érvénytelen névre, címkére és értékre hibát dob', () => {
    const registry = createMetricsRegistry()
    expect(() => registry.counter('rossz név')).toThrow(TypeError)
    expect(() => registry.counter('ok_total', { 'rossz-címke': 'x' })).toThrow(TypeError)
    expect(() => registry.counter('ok_total', { le: 'x' })).toThrow(TypeError)
    expect(() => registry.counter('ok_total', { __name__: 'x' })).toThrow(TypeError)
    expect(() => registry.counter('ok_total', undefined, -1)).toThrow(TypeError)
    expect(() => registry.counter('ok_total', undefined, Number.NaN)).toThrow(TypeError)
    expect(() => registry.histogram('ok', Number.NaN)).toThrow(TypeError)
    expect(() => createMetricsRegistry([1, Number.POSITIVE_INFINITY])).toThrow(TypeError)
    expect(registry.renderPrometheus()).toBe('')
  })

  test('egy név nem lehet egyszerre számláló és hisztogram', () => {
    const registry = createMetricsRegistry()
    registry.counter('kettos')
    expect(() => registry.histogram('kettos', 1)).toThrow('számlálóként')
    registry.histogram('masik', 1)
    expect(() => registry.counter('masik')).toThrow('hisztogramként')
  })
})
