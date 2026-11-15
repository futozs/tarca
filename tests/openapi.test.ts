import { describe, expect, test } from 'vitest'
import { createValidator, type OpenApiSchema } from './openapi'

const schemas: Record<string, OpenApiSchema> = {
  Item: {
    type: 'object',
    required: ['name', 'vat'],
    properties: {
      name: { type: 'string', maxLength: 5 },
      vat: { $ref: '#/components/schemas/Vat' },
      quantity: { type: 'number', minimum: 0, maximum: 10 },
      date: { type: 'string', format: 'date' },
      at: { type: 'string', format: 'date-time' },
      note: { type: 'string', nullable: true },
    },
  },
  ProductRef: {
    type: 'object',
    required: ['product_id'],
    properties: { product_id: { type: 'integer' } },
  },
  Vat: { type: 'string', enum: ['27%', 'AAM'] },
  Line: {
    oneOf: [{ $ref: '#/components/schemas/Item' }, { $ref: '#/components/schemas/ProductRef' }],
  },
  Loose: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
  Both: { allOf: [{ $ref: '#/components/schemas/ProductRef' }] },
  Free: { type: 'object', additionalProperties: true, properties: {} },
  Lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
  Flag: { type: 'boolean' },
}

const { validate } = createValidator(schemas)

describe('OpenAPI szerződés-validátor', () => {
  test('a helyes értékre nincs hiba', () => {
    expect(
      validate('Item', {
        name: 'Póló',
        vat: '27%',
        quantity: 2,
        date: '2026-11-15',
        at: '2026-11-15 10:00:00',
        note: null,
      }),
    ).toEqual([])
    expect(validate('Lines', [{ product_id: 3 }, { name: 'A', vat: 'AAM' }])).toEqual([])
    expect(validate('Loose', 3)).toEqual([])
    expect(validate('Both', { product_id: 1 })).toEqual([])
    expect(validate('Free', { barmi: 1 })).toEqual([])
    expect(validate('Flag', true)).toEqual([])
  })

  test('jelzi az ismeretlen és hiányzó mezőt, a rossz típust, formátumot és határt', () => {
    expect(
      validate('Item', {
        name: 'Túl hosszú',
        vat: '28%',
        quantity: 11,
        date: '2026.11.15',
        at: 'tegnap',
        extra: 1,
      }),
    ).toEqual([
      'Item.name: hosszabb, mint 5',
      'Item.vat: "28%" nincs az engedett értékek között',
      'Item.quantity: nagyobb, mint 10',
      'Item.date: nem YYYY-MM-DD dátum',
      'Item.at: nem ISO dátum-idő',
      'Item.extra: a sémában nem szereplő mező',
    ])
    expect(validate('Item', { vat: 'AAM', quantity: -1, note: 3 })).toEqual([
      'Item.name: kötelező mező hiányzik',
      'Item.quantity: kisebb, mint 0',
      'Item.note: string típus kell, kapott: 3',
    ])
    expect(validate('ProductRef', { product_id: 1.5 })).toEqual([
      'ProductRef.product_id: integer típus kell, kapott: 1.5',
    ])
    expect(validate('ProductRef', null)).toEqual(['ProductRef: null nem engedett'])
  })

  test('a oneOf pontosan egy ágat fogad el', () => {
    expect(validate('Line', { product_id: 'x' })[0]).toBe('Line: egyik oneOf ágnak sem felel meg')
    expect(validate('Loose', true)).toEqual(['Loose: egyik anyOf ágnak sem felel meg'])
    const ambiguous = createValidator({
      Any: { oneOf: [{ type: 'string' }, { type: 'string' }] },
    })
    expect(ambiguous.validate('Any', 'x')).toEqual(['Any: több oneOf ágnak is megfelel (2)'])
  })

  test('az ismeretlen hivatkozás programhiba', () => {
    expect(() => validate('Nincs', {})).toThrow('Ismeretlen séma hivatkozás')
  })
})
