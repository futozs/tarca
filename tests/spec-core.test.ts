import { describe, expect, test } from 'vitest'
import {
  canonicalJson,
  compareVersions,
  mergeSpecs,
  registryVersions,
  specOperations,
  trackedVersions,
} from '../scripts/spec-core.mjs'
import { renderSchema, renderTypes, typeOf } from '../scripts/types-core.mjs'

const registry = {
  apis: [
    { properties: [{ type: 'X-Version', value: '3.0.15' }] },
    { properties: [{ type: 'X-Version', value: '3.0.2' }] },
    { properties: [{ type: 'X-Version', value: 'test' }] },
    { properties: [{ type: 'X-Version', value: '3.0.14' }] },
    { properties: [] },
  ],
}

function spec(version: string, paths: object, schemas: object) {
  return { info: { version }, paths, components: { schemas } }
}

describe('spec segédfüggvények', () => {
  test('a verziókat számszerűen rendezi, és csak a figyelt verziókat tartja meg', () => {
    expect(compareVersions('3.0.9', '3.0.14')).toBeLessThan(0)
    expect(compareVersions('3.0', '3.0.0')).toBe(0)
    expect(registryVersions(registry)).toEqual(['3.0.2', '3.0.14', '3.0.15'])
    expect(trackedVersions(['3.0.2', '3.0.14', '3.0.15'], '3.0.14')).toEqual(['3.0.14', '3.0.15'])
    expect(registryVersions(undefined)).toEqual([])
  })

  test('a műveleteket útvonal szerint rendezve sorolja fel', () => {
    const operations = specOperations(
      spec(
        '1',
        {
          '/b': { get: { operationId: 'B' }, parameters: [] },
          '/a': { post: { operationId: 'A' } },
        },
        {},
      ),
    )
    expect(operations).toEqual([
      { id: 'A', method: 'POST', path: '/a' },
      { id: 'B', method: 'GET', path: '/b' },
    ])
  })

  test('az összevonás megtartja a régi verzió eltűnt útvonalait és sémáit', () => {
    const merged = mergeSpecs([
      spec('3.0.15', { '/p': { post: { operationId: 'New' } } }, { A: { type: 'string' } }),
      spec(
        '3.0.14',
        { '/p': { get: { operationId: 'Old' } }, '/q': {} },
        { A: { type: 'integer' }, B: {} },
      ),
    ])
    expect(merged.info.version).toBe('3.0.14+3.0.15')
    expect(Object.keys(merged.paths['/p'] ?? {})).toEqual(['get', 'post'])
    expect(merged.components.schemas.A).toEqual({ type: 'string' })
    expect(merged.components.schemas.B).toEqual({})
    expect(() => mergeSpecs([])).toThrow('npm run spec:fetch')
  })

  test('a kanonikus JSON független a kulcsok sorrendjétől', () => {
    expect(canonicalJson({ b: [1, { d: 1, c: 2 }], a: null })).toBe(
      canonicalJson({ a: null, b: [1, { c: 2, d: 1 }] }),
    )
  })
})

describe('típusgenerátor', () => {
  test('a sémákból readonly camelCase TypeScript típust készít', () => {
    expect(
      renderSchema('Item', {
        type: 'object',
        required: ['unit_price'],
        properties: {
          unit_price: { type: 'number' },
          vat: { $ref: '#/components/schemas/Vat' },
          tags: { type: 'array', items: { type: 'string' } },
          kind: { nullable: true, oneOf: [{ $ref: '#/a/A' }, { $ref: '#/a/B' }] },
          lines: { type: 'array', items: { oneOf: [{ $ref: '#/a/A' }, { $ref: '#/a/B' }] } },
          meta: { type: 'object' },
          nested: { type: 'object', properties: { a_b: { type: 'boolean' } } },
          size: { enum: [58, 80] },
          both: { allOf: [{ $ref: '#/a/A' }, { $ref: '#/a/B' }] },
          one: { allOf: [{ $ref: '#/a/A' }] },
          any: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
          raw: {},
          odd: { type: 'file' },
        },
      }),
    ).toBe(
      'export interface Item { readonly unitPrice: number; readonly vat?: Vat; readonly tags?: readonly string[]; readonly kind?: A | B | null; readonly lines?: readonly (A | B)[]; readonly meta?: Readonly<Record<string, unknown>>; readonly nested?: { readonly aB?: boolean }; readonly size?: 58 | 80; readonly both?: (A & B); readonly one?: A; readonly any?: number | string; readonly raw?: unknown; readonly odd?: unknown }',
    )
    expect(renderSchema('Vat', { type: 'string', enum: ['27%', "it's", '27%'] })).toBe(
      "export type Vat = '27%' | 'it\\'s'",
    )
    expect(renderSchema('List', { type: 'array', items: { type: 'integer' } })).toBe(
      'export type List = readonly number[]',
    )
    expect(typeOf(undefined)).toBe('unknown')
    expect(
      renderTypes({ components: { schemas: { B: { type: 'string' }, A: { type: 'boolean' } } } }),
    ).toBe('export type A = boolean\n\nexport type B = string\n')
    expect(renderTypes({})).toBe('\n')
  })
})
