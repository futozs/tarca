import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createSpecValidator,
  createValidator,
  HANDLED_FORMATS,
  HANDLED_KEYWORDS,
  IGNORED_KEYWORDS,
  matchOperation,
  type OpenApiSchema,
  type OpenApiSpec,
  schemaUsage,
  unsupportedSchemaUsage,
  type ValidationDirection,
} from './openapi'

interface KeywordCase {
  readonly schema: OpenApiSchema
  readonly extra?: Readonly<Record<string, OpenApiSchema>>
  readonly direction?: ValidationDirection
  readonly valid: readonly unknown[]
  readonly invalid: readonly (readonly [unknown, string])[]
}

const TAX_NUMBER = '^([0-9]{8})-([12345])-([0-9]{2})$'

const KEYWORD_CASES: Readonly<Record<string, KeywordCase>> = {
  $ref: {
    schema: { $ref: '#/components/schemas/Vat' },
    extra: { Vat: { type: 'string', enum: ['27%', 'AAM'] } },
    valid: ['27%', 'AAM'],
    invalid: [['28%', 'Target: "28%" nincs az engedett értékek között']],
  },
  type: {
    schema: { type: 'integer' },
    valid: [3, -1],
    invalid: [
      [1.5, 'Target: integer típus kell, kapott: 1.5'],
      ['3', 'Target: integer típus kell, kapott: "3"'],
    ],
  },
  format: {
    schema: { type: 'string', format: 'date' },
    valid: ['2026-11-15'],
    invalid: [['2026-02-30', 'Target: nem YYYY-MM-DD dátum']],
  },
  nullable: {
    schema: { type: 'string', nullable: true },
    valid: [null, 'x'],
    invalid: [[3, 'Target: string típus kell, kapott: 3']],
  },
  enum: {
    schema: { enum: [58, 80] },
    valid: [58, 80],
    invalid: [
      [60, 'Target: 60 nincs az engedett értékek között'],
      ['58', 'Target: "58" nincs az engedett értékek között'],
    ],
  },
  properties: {
    schema: { type: 'object', properties: { amount: { type: 'integer' } } },
    valid: [{ amount: 1 }, {}],
    invalid: [
      [{ amount: 'x' }, 'Target.amount: integer típus kell, kapott: "x"'],
      [{ total: 1 }, 'Target.total: a sémában nem szereplő mező'],
    ],
  },
  required: {
    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    valid: [{ name: 'Fő' }],
    invalid: [[{}, 'Target.name: kötelező mező hiányzik']],
  },
  additionalProperties: {
    schema: { type: 'object', additionalProperties: { type: 'integer' } },
    valid: [{ a: 1, b: 2 }, {}],
    invalid: [[{ a: 'x' }, 'Target.a: integer típus kell, kapott: "x"']],
  },
  minProperties: {
    schema: { type: 'object', additionalProperties: true, minProperties: 1 },
    valid: [{ a: 1 }],
    invalid: [[{}, 'Target: kevesebb mező, mint 1']],
  },
  maxProperties: {
    schema: { type: 'object', additionalProperties: true, maxProperties: 1 },
    valid: [{ a: 1 }],
    invalid: [[{ a: 1, b: 2 }, 'Target: több mező, mint 1']],
  },
  items: {
    schema: { type: 'array', items: { type: 'integer' } },
    valid: [[1, 2], []],
    invalid: [[[1, 'x'], 'Target[1]: integer típus kell, kapott: "x"']],
  },
  minItems: {
    schema: { type: 'array', minItems: 1 },
    valid: [[1]],
    invalid: [[[], 'Target: kevesebb elem, mint 1']],
  },
  maxItems: {
    schema: { type: 'array', maxItems: 1 },
    valid: [[1], []],
    invalid: [[[1, 2], 'Target: több elem, mint 1']],
  },
  uniqueItems: {
    schema: { type: 'array', uniqueItems: true },
    valid: [
      [1, 2],
      [{ a: 1 }, { a: 2 }],
    ],
    invalid: [
      [
        [
          { a: 1, b: 2 },
          { b: 2, a: 1 },
        ],
        'Target: ismétlődő elemek',
      ],
    ],
  },
  oneOf: {
    schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
    valid: ['x', 3],
    invalid: [[true, 'Target: egyik oneOf ágnak sem felel meg']],
  },
  anyOf: {
    schema: {
      anyOf: [
        { type: 'string', maxLength: 1 },
        { type: 'string', minLength: 3 },
      ],
    },
    valid: ['a', 'abc'],
    invalid: [['ab', 'Target: egyik anyOf ágnak sem felel meg']],
  },
  allOf: {
    schema: {
      allOf: [
        { type: 'object', required: ['a'], properties: { a: { type: 'integer' } } },
        { type: 'object', properties: { b: { type: 'integer' } } },
      ],
    },
    valid: [{ a: 1, b: 2 }, { a: 1 }],
    invalid: [
      [{ b: 2 }, 'Target.a: kötelező mező hiányzik'],
      [{ a: 1, c: 3 }, 'Target.c: a sémában nem szereplő mező'],
    ],
  },
  not: {
    schema: { type: 'string', not: { enum: ['tilos'] } },
    valid: ['szabad'],
    invalid: [['tilos', 'Target: a not séma tiltja ezt az értéket']],
  },
  pattern: {
    schema: { type: 'string', pattern: TAX_NUMBER },
    valid: ['12345678-2-41'],
    invalid: [
      ['12345678-6-41', `Target: nem illeszkedik a mintára (${TAX_NUMBER})`],
      ['12345678', `Target: nem illeszkedik a mintára (${TAX_NUMBER})`],
    ],
  },
  minLength: {
    schema: { type: 'string', minLength: 2 },
    valid: ['ab', 'ő€'],
    invalid: [['😀', 'Target: rövidebb, mint 2']],
  },
  maxLength: {
    schema: { type: 'string', maxLength: 3 },
    valid: ['abc', '😀😀😀'],
    invalid: [['abcd', 'Target: hosszabb, mint 3']],
  },
  minimum: {
    schema: { type: 'number', minimum: 0 },
    valid: [0, 1],
    invalid: [[-0.5, 'Target: kisebb, mint 0']],
  },
  maximum: {
    schema: { type: 'integer', maximum: 100 },
    valid: [100],
    invalid: [[101, 'Target: nagyobb, mint 100']],
  },
  exclusiveMinimum: {
    schema: { type: 'number', minimum: 0, exclusiveMinimum: true },
    valid: [0.1],
    invalid: [[0, 'Target: nem nagyobb, mint 0']],
  },
  exclusiveMaximum: {
    schema: { type: 'number', maximum: 1, exclusiveMaximum: true },
    valid: [0.99],
    invalid: [[1, 'Target: nem kisebb, mint 1']],
  },
  multipleOf: {
    schema: { type: 'number', multipleOf: 0.5 },
    valid: [1.5, 2],
    invalid: [[1.2, 'Target: nem többszöröse ennek: 0.5']],
  },
  readOnly: {
    schema: {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'integer', readOnly: true }, name: { type: 'string' } },
    },
    direction: 'request',
    valid: [{ name: 'Fő' }],
    invalid: [[{ id: 1, name: 'Fő' }, 'Target.id: csak olvasható mező, kérésben nem küldhető']],
  },
  writeOnly: {
    schema: {
      type: 'object',
      required: ['secret'],
      properties: { secret: { type: 'string', writeOnly: true } },
    },
    direction: 'response',
    valid: [{}],
    invalid: [[{ secret: 'x' }, 'Target.secret: csak írható mező, válaszban nem szerepelhet']],
  },
}

const FORMAT_CASES: Readonly<
  Record<string, { readonly schema: OpenApiSchema } & Omit<KeywordCase, 'schema' | 'extra'>>
> = {
  date: {
    schema: { type: 'string', format: 'date' },
    valid: ['2026-11-15', '2024-02-29'],
    invalid: [
      ['2026.11.15', 'Target: nem YYYY-MM-DD dátum'],
      ['2025-02-29', 'Target: nem YYYY-MM-DD dátum'],
      ['2026-13-01', 'Target: nem YYYY-MM-DD dátum'],
    ],
  },
  'date-time': {
    schema: { type: 'string', format: 'date-time' },
    valid: ['2026-11-15T10:00:00Z', '2026-11-15 10:00:00', '2026-11-15T10:00:00.123+01:00'],
    invalid: [
      ['tegnap', 'Target: nem ISO dátum-idő'],
      ['2026-11-15T25:00:00Z', 'Target: nem ISO dátum-idő'],
      ['2026-11-31T10:00:00Z', 'Target: nem ISO dátum-idő'],
    ],
  },
  datetime: {
    schema: { type: 'string', format: 'datetime' },
    valid: ['2021-09-03 11:27:00'],
    invalid: [
      ['2021-09-03T11:27:00', 'Target: nem YYYY-MM-DD HH:MM:SS dátum-idő'],
      ['2021-09-03', 'Target: nem YYYY-MM-DD HH:MM:SS dátum-idő'],
      ['2021-09-03 24:00:00', 'Target: nem YYYY-MM-DD HH:MM:SS dátum-idő'],
    ],
  },
  email: {
    schema: { type: 'string', format: 'email' },
    valid: ['vevo@ceg.hu', 'a.b+c@d.e.hu'],
    invalid: [
      ['vevo@', 'Target: nem e-mail cím'],
      ['vevo ceg@ceg.hu', 'Target: nem e-mail cím'],
      ['vevo@ceg', 'Target: nem e-mail cím'],
    ],
  },
  float: {
    schema: { type: 'number', format: 'float' },
    valid: [1.5, -3.4e38],
    invalid: [[1e39, 'Target: kívül esik a float tartományon']],
  },
  int32: {
    schema: { type: 'integer', format: 'int32' },
    valid: [2_147_483_647, -2_147_483_648],
    invalid: [[2_147_483_648, 'Target: kívül esik az int32 tartományon']],
  },
  binary: {
    schema: { type: 'string', format: 'binary' },
    valid: ['%PDF-1.7'],
    invalid: [[3, 'Target: string típus kell, kapott: 3']],
  },
}

function validatorFor(schema: OpenApiSchema, extra: Readonly<Record<string, OpenApiSchema>> = {}) {
  return createValidator({ ...extra, Target: schema })
}

describe('OpenAPI séma-validátor, kulcsszavanként', () => {
  test('minden kezelt kulcsszónak van pozitív és negatív esete', () => {
    expect(Object.keys(KEYWORD_CASES).sort()).toEqual([...HANDLED_KEYWORDS].sort())
    for (const item of Object.values(KEYWORD_CASES)) {
      expect(item.valid.length).toBeGreaterThan(0)
      expect(item.invalid.length).toBeGreaterThan(0)
    }
  })

  test('a kezelt és a figyelmen kívül hagyott kulcsszavak nem fedik egymást', () => {
    expect(HANDLED_KEYWORDS.filter((keyword) => keyword in IGNORED_KEYWORDS)).toEqual([])
  })

  test.each(Object.entries(KEYWORD_CASES))('%s', (_, item) => {
    const { validate } = validatorFor(item.schema, item.extra)
    const options = { direction: item.direction ?? 'request' }
    for (const value of item.valid) expect(validate('Target', value, options)).toEqual([])
    for (const [value, message] of item.invalid) {
      expect(validate('Target', value, options)).toContain(message)
    }
  })
})

describe('OpenAPI formátumok', () => {
  test('minden kezelt formátumnak van esete', () => {
    expect(Object.keys(FORMAT_CASES).sort()).toEqual([...HANDLED_FORMATS].sort())
  })

  test.each(Object.entries(FORMAT_CASES))('%s', (_, item) => {
    const { validate } = validatorFor(item.schema)
    for (const value of item.valid) expect(validate('Target', value)).toEqual([])
    for (const [value, message] of item.invalid)
      expect(validate('Target', value)).toEqual([message])
  })

  test('a formátum csak a saját típusára vonatkozik', () => {
    const { validate } = validatorFor({ format: 'date' })
    expect(validate('Target', 20261115)).toEqual([])
  })
})

describe('OpenAPI validátor viselkedése', () => {
  test('a null csak nullable sémában engedett, a nullable oneOf-tartóban is', () => {
    const { validate } = createValidator({
      Plain: { type: 'string' },
      Wrapped: { nullable: true, oneOf: [{ $ref: '#/components/schemas/Kind' }] },
      Kind: { type: 'string', enum: ['a'] },
    })
    expect(validate('Plain', null)).toEqual(['Plain: null nem engedett'])
    expect(validate('Wrapped', null)).toEqual([])
    expect(validate('Wrapped', 'a')).toEqual([])
    expect(validate('Wrapped', 'b')[0]).toBe('Wrapped: egyik oneOf ágnak sem felel meg')
  })

  test('a readOnly mező a válaszban kötelező, a writeOnly a kérésben', () => {
    const readOnly = validatorFor(KEYWORD_CASES.readOnly?.schema ?? {})
    expect(readOnly.validate('Target', { name: 'Fő' }, { direction: 'response' })).toEqual([
      'Target.id: kötelező mező hiányzik',
    ])
    expect(readOnly.validate('Target', { id: 1, name: 'Fő' }, { direction: 'response' })).toEqual(
      [],
    )
    const writeOnly = validatorFor(KEYWORD_CASES.writeOnly?.schema ?? {})
    expect(writeOnly.validate('Target', {}, { direction: 'request' })).toEqual([
      'Target.secret: kötelező mező hiányzik',
    ])
  })

  test('az additionalProperties: true bármit enged, a false és a hiánya szigorú, a properties nélküli objektum szabad', () => {
    const { validate } = createValidator({
      Open: { type: 'object', properties: { a: { type: 'integer' } }, additionalProperties: true },
      Closed: { type: 'object', properties: {}, additionalProperties: false },
      Free: { type: 'object' },
    })
    expect(validate('Open', { a: 1, b: 'x' })).toEqual([])
    expect(validate('Closed', { b: 1 })).toEqual(['Closed.b: a sémában nem szereplő mező'])
    expect(validate('Free', { b: 1 })).toEqual([])
  })

  test('laza módban az extra mező és az opcionális null figyelmeztetés, minden más hiba', () => {
    const { report } = createValidator({
      Account: {
        type: 'object',
        required: ['name', 'currency'],
        properties: {
          name: { type: 'string' },
          currency: { type: 'string', enum: ['HUF', 'EUR'] },
          date: { type: 'string', format: 'date' },
          url: { type: 'string' },
        },
      },
    })
    const value = { name: null, currency: 'USD', date: 'tegnap', url: null, extra: 1 }

    expect(report('Account', value, { direction: 'response', mode: 'lenient' })).toEqual({
      errors: [
        'Account.name: null nem engedett',
        'Account.currency: "USD" nincs az engedett értékek között',
        'Account.date: nem YYYY-MM-DD dátum',
      ],
      warnings: [
        'Account.url: null, pedig a spec szerint nem nullable',
        'Account.extra: a sémában nem szereplő mező',
      ],
    })
    expect(report('Account', value, { direction: 'response', mode: 'strict' })).toEqual({
      errors: [
        'Account.name: null nem engedett',
        'Account.currency: "USD" nincs az engedett értékek között',
        'Account.date: nem YYYY-MM-DD dátum',
        'Account.url: null nem engedett',
        'Account.extra: a sémában nem szereplő mező',
      ],
      warnings: [],
    })
    expect(report('Account', { currency: 'HUF' }, { mode: 'lenient' }).errors).toEqual([
      'Account.name: kötelező mező hiányzik',
    ])
    const either = createValidator({
      Either: {
        anyOf: [
          { type: 'object', properties: { a: { type: 'integer' } } },
          { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } } },
        ],
      },
    })
    expect(either.report('Either', { a: 1, b: 2, c: 3 }, { mode: 'lenient' })).toEqual({
      errors: [],
      warnings: ['Either.c: a sémában nem szereplő mező'],
    })
  })

  test('kitakart módban az üzenet csak útvonalat és típust tartalmaz, értéket soha', () => {
    const { report } = createValidator({
      Partner: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'integer' },
          kind: { type: 'string', enum: ['a'] },
          tags: { type: 'object', additionalProperties: { type: 'integer' } },
        },
      },
    })
    const result = report(
      'Partner',
      { name: 'TITKOS NÉV', kind: 'TITKOS', tags: { 'TITKOS-KULCS': 'x' } },
      { direction: 'response', mode: 'lenient', redact: true },
    )

    expect(result.errors).toEqual([
      'Partner.name: integer típus kell, kapott: string',
      'Partner.kind: nincs az engedett értékek között',
      'Partner.tags.*: integer típus kell, kapott: string',
    ])
    expect(JSON.stringify(result)).not.toContain('TITKOS')
  })

  test('a oneOf ágat szigorúan választja, laza módban a legközelebbi ágat fogadja el', () => {
    const { report } = createValidator({
      Check: {
        oneOf: [{ $ref: '#/components/schemas/Valid' }, { $ref: '#/components/schemas/Loose' }],
      },
      Valid: {
        type: 'object',
        required: ['tax_number', 'result'],
        properties: {
          tax_number: { type: 'string' },
          result: { type: 'string', enum: ['validation_ok'] },
          name: { type: 'string' },
        },
      },
      Loose: {
        type: 'object',
        properties: { tax_number: { type: 'string' }, result: { type: 'string' } },
      },
    })
    const ok = { tax_number: '1', result: 'validation_ok', name: 'Kft.' }
    const invalid = { tax_number: '1', result: 'invalid_tax_number' }
    const extended = { ...ok, extra: 1 }

    expect(report('Check', ok, { direction: 'response', mode: 'lenient' })).toEqual({
      errors: [],
      warnings: [],
    })
    expect(report('Check', invalid, { direction: 'response', mode: 'strict' }).errors).toEqual([])
    expect(report('Check', extended, { direction: 'response', mode: 'lenient' })).toEqual({
      errors: [],
      warnings: ['Check.extra: a sémában nem szereplő mező'],
    })
    expect(report('Check', extended, { direction: 'response', mode: 'strict' }).errors[0]).toBe(
      'Check: egyik oneOf ágnak sem felel meg',
    )
    const ambiguous = createValidator({
      Any: { oneOf: [{ type: 'string' }, { type: 'string' }] },
      Twins: {
        oneOf: [
          { type: 'object', properties: { a: { type: 'integer' } } },
          { type: 'object', properties: { a: { type: 'number' } } },
        ],
      },
    })
    expect(ambiguous.validate('Any', 'x')).toEqual(['Any: több oneOf ágnak is megfelel (2)'])
    expect(ambiguous.report('Any', 'x', { mode: 'lenient' }).errors).toEqual([
      'Any: több oneOf ágnak is megfelel (2)',
    ])
    expect(ambiguous.report('Twins', { a: 1, x: 1 }, { mode: 'lenient' }).errors).toEqual([
      'Twins: több oneOf ágnak is megfelel (2)',
    ])
  })

  test('a nem kezelt kulcsszó, típus, formátum és hivatkozás programhiba, nem csendes átengedés', () => {
    const cases: [OpenApiSchema, string][] = [
      [
        { type: 'object', discriminator: { propertyName: 'type' } } as OpenApiSchema,
        'discriminator',
      ],
      [{ type: 'string', 'x-nullable': true } as OpenApiSchema, 'x-nullable'],
      [{ type: 'uuid' }, 'Nem kezelt séma típus'],
      [{ type: ['string', 'null'] } as unknown as OpenApiSchema, 'Nem kezelt séma típus'],
      [{ type: 'string', format: 'uuid' }, 'Nem kezelt formátum: uuid'],
      [{ type: 'number', minimum: 0, exclusiveMinimum: 0 } as unknown as OpenApiSchema, 'logikai'],
      [{ $ref: '#/components/schemas/Nincs' }, 'Ismeretlen hivatkozás'],
      [{ $ref: 'external.json#/Partner' }, 'Csak belső hivatkozás'],
      [{ $ref: '#/components/schemas/Kind', nullable: true }, 'A $ref mellett nem kezelt kulcsszó'],
      [{ $ref: '#/components/schemas/Loop' }, 'Körkörös'],
    ]
    for (const [schema, message] of cases) {
      const { validate } = createValidator({
        Target: schema,
        Kind: { type: 'string' },
        Loop: { $ref: '#/components/schemas/Loop' },
      })
      expect(() => validate('Target', 'x')).toThrow(message)
    }
  })
})

const SYNTHETIC_SPEC = {
  info: { version: 'teszt' },
  paths: {
    '/bank-accounts': {
      post: {
        operationId: 'CreateBankAccount',
        requestBody: { $ref: '#/components/requestBodies/Account' },
        responses: {
          '201': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } },
          },
          '4XX': { $ref: '#/components/responses/ClientError' },
        },
      },
    },
    '/bank-accounts/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      get: {
        operationId: 'GetBankAccount',
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } },
          },
          default: { $ref: '#/components/responses/ClientError' },
        },
      },
      delete: { operationId: 'DeleteBankAccount', responses: { '204': {} } },
      put: { operationId: 'GetServerTime', responses: {} },
    },
    '/currencies': {
      get: {
        operationId: 'GetConversionRate',
        parameters: [
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { $ref: '#/components/schemas/Currency' },
          },
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'size', in: 'query', schema: { enum: [58, 80] } },
          { name: 'paid', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': {} },
      },
    },
    '/documents/{id}/download': {
      get: {
        operationId: 'DownloadDocument',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
          },
          '202': { $ref: '#/components/responses/ClientError' },
        },
      },
    },
    '/documents/{id}/payments': {
      put: {
        operationId: 'UpdatePayment',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/Payment' } },
            },
          },
        },
        responses: {},
      },
      delete: {
        operationId: 'DeletePayment',
        parameters: [{ name: 'X-Trace', in: 'header', schema: { type: 'string' } }],
        responses: {},
      },
    },
    '/documents/{id}/cancel': {
      post: {
        operationId: 'CancelDocument',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
        },
        responses: {},
      },
    },
    '/document-export': {
      post: {
        operationId: 'Create',
        requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } },
        responses: {},
      },
    },
  },
  components: {
    schemas: {
      Account: {
        type: 'object',
        required: ['name', 'currency'],
        properties: {
          id: { type: 'integer', readOnly: true },
          name: { type: 'string' },
          currency: { $ref: '#/components/schemas/Currency' },
        },
      },
      Currency: { type: 'string', enum: ['HUF', 'EUR'] },
      Payment: {
        type: 'object',
        required: ['price'],
        properties: { price: { type: 'number' } },
      },
      ClientErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'object', properties: { message: { type: 'string' } } },
        },
      },
    },
    requestBodies: {
      Account: {
        required: true,
        content: {
          'application/json; charset=utf-8': {
            schema: { $ref: '#/components/schemas/Account' },
          },
        },
      },
    },
    responses: {
      ClientError: {
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ClientErrorResponse' } },
        },
      },
    },
  },
} as unknown as OpenApiSpec

const spec = createSpecValidator(SYNTHETIC_SPEC, {})

describe('műveletszintű szerződés (szintetikus spec)', () => {
  test('a kéréstörzset a requestBody hivatkozásán és a JSON tartalomtípuson át találja meg', () => {
    expect(spec.requestErrors('CreateBankAccount', { name: 'Fő', currency: 'HUF' })).toEqual([])
    expect(spec.requestErrors('CreateBankAccount', { id: 1, name: 'Fő', currency: 'USD' })).toEqual(
      [
        'Account.id: csak olvasható mező, kérésben nem küldhető',
        'Account.currency: "USD" nincs az engedett értékek között',
      ],
    )
    expect(spec.requestErrors('CreateBankAccount', undefined)).toEqual([
      'CreateBankAccount: kötelező kéréstörzs hiányzik',
    ])
  })

  test('a beágyazott tömbsémát is ellenőrzi, a nem kötelező törzs hiányozhat', () => {
    expect(spec.requestErrors('UpdatePayment', [{ price: 1 }])).toEqual([])
    expect(spec.requestErrors('UpdatePayment', [{}])).toEqual([
      'UpdatePayment[0].price: kötelező mező hiányzik',
    ])
    expect(spec.requestErrors('CancelDocument', undefined)).toEqual([])
    expect(spec.requestErrors('CancelDocument', {})).toEqual([
      'Payment.price: kötelező mező hiányzik',
    ])
  })

  test('törzs nélküli műveletnél a törzs hiba, a nem JSON kéréstörzs programhiba', () => {
    expect(spec.requestErrors('GetBankAccount', undefined)).toEqual([])
    expect(spec.requestErrors('GetBankAccount', {})).toEqual([
      'GetBankAccount: a spec szerint nincs kéréstörzse, mégis érkezett',
    ])
    expect(() => spec.requestErrors('Create', {})).toThrow('nem JSON')
  })

  test('az útvonal- és query-paramétereket típus szerint alakítja és ellenőrzi', () => {
    const query = (search: string) => new URLSearchParams(search)
    expect(spec.parameterErrors('GetBankAccount', { path: { id: '5' }, query: query('') })).toEqual(
      [],
    )
    expect(
      spec.parameterErrors('GetBankAccount', { path: { id: 'abc' }, query: query('') }),
    ).toEqual(['GetBankAccount útvonal.id: integer típus kell, kapott: "abc"'])
    expect(
      spec.parameterErrors('GetConversionRate', {
        path: {},
        query: query('from=EUR&date=2026-11-13&size=80&paid=true'),
      }),
    ).toEqual([])
    expect(
      spec.parameterErrors('GetConversionRate', {
        path: {},
        query: query('date=2026.11.13&size=60&paid=igen&per_page=5&date=2026-11-13'),
      }),
    ).toEqual([
      'GetConversionRate query.date: többször szerepel',
      'GetConversionRate query.date: nem YYYY-MM-DD dátum',
      'GetConversionRate query.size: 60 nincs az engedett értékek között',
      'GetConversionRate query.paid: boolean típus kell, kapott: "igen"',
      'GetConversionRate query.per_page: a spec-ben nem szereplő query paraméter',
      'GetConversionRate query.from: kötelező paraméter hiányzik',
    ])
  })

  test('a spec által le nem írt útvonal-paraméter hiba, a nem kezelt paraméterhely programhiba', () => {
    expect(
      spec.parameterErrors('UpdatePayment', { path: {}, query: new URLSearchParams() }),
    ).toEqual(['UpdatePayment útvonal.id: hiányzik'])
    expect(() =>
      spec.parameterErrors('DeletePayment', { path: { id: '1' }, query: new URLSearchParams() }),
    ).toThrow('nem kezelt paraméterhely: header')
  })

  test('a választ státusz, tartomány (4XX) és default szerint választja', () => {
    expect(
      spec.responseErrors(
        'CreateBankAccount',
        201,
        { id: 1, name: 'Fő', currency: 'HUF' },
        {
          mode: 'strict',
          contentType: 'application/json; charset=utf-8',
        },
      ),
    ).toEqual({ errors: [], warnings: [] })
    expect(
      spec.responseErrors(
        'CreateBankAccount',
        422,
        { error: { message: 'x' } },
        { mode: 'strict' },
      ),
    ).toEqual({ errors: [], warnings: [] })
    expect(
      spec.responseErrors('GetBankAccount', 404, { error: { message: 1 } }, { mode: 'strict' })
        .errors,
    ).toEqual(['ClientErrorResponse.error.message: string típus kell, kapott: 1'])
  })

  test('a nem dokumentált státusz szigorúan hiba, lazán figyelmeztetés', () => {
    expect(spec.responseErrors('CreateBankAccount', 500, {}, { mode: 'strict' })).toEqual({
      errors: ['CreateBankAccount 500: a státusz nincs dokumentálva'],
      warnings: [],
    })
    expect(spec.responseErrors('CreateBankAccount', 500, {}, { mode: 'lenient' })).toEqual({
      errors: [],
      warnings: ['CreateBankAccount 500: a státusz nincs dokumentálva'],
    })
  })

  test('üres, bináris és JSON válasz: a tartalomtípusnak és a törzsnek is stimmelnie kell', () => {
    expect(spec.responseErrors('DeleteBankAccount', 204, undefined, { mode: 'strict' })).toEqual({
      errors: [],
      warnings: [],
    })
    expect(spec.responseErrors('DeleteBankAccount', 204, {}, { mode: 'strict' }).errors).toEqual([
      'DeleteBankAccount 204: a spec szerint üres válasz, mégis van törzse',
    ])
    expect(
      spec.responseErrors('DownloadDocument', 200, undefined, {
        mode: 'strict',
        contentType: 'application/pdf',
      }).errors,
    ).toEqual([])
    expect(
      spec.responseErrors(
        'DownloadDocument',
        200,
        { error: {} },
        {
          mode: 'strict',
          contentType: 'application/json',
        },
      ).errors,
    ).toEqual([
      'DownloadDocument 200: nem dokumentált tartalomtípus (application/json), a spec szerint: application/pdf',
    ])
    expect(
      spec.responseErrors('DownloadDocument', 202, undefined, {
        mode: 'strict',
        contentType: 'application/json',
      }).errors,
    ).toEqual(['DownloadDocument 202: hiányzik a JSON választörzs'])
  })

  test('a művelet keresése: rossz operationId, hiányzó útvonal és nem dokumentált művelet', () => {
    expect(() => spec.operation('UpdateBankAccount')).toThrow(
      'a spec ezen az útvonalon a(z) GetServerTime műveletet írja le',
    )
    expect(() => spec.operation('ListPartner')).toThrow('ListPartner: nincs a spec-ben')
    expect(() => spec.operation('GetDocumentBlock')).toThrow('UNDOCUMENTED_SCHEMAS')
    const mapped = createSpecValidator(SYNTHETIC_SPEC, {
      GetDocumentBlock: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Payment' } } },
          },
        },
      },
    })
    expect(mapped.responseErrors('GetDocumentBlock', 200, {}, { mode: 'strict' }).errors).toEqual([
      'Payment.price: kötelező mező hiányzik',
    ])
    expect(
      mapped.parameterErrors('GetDocumentBlock', {
        path: { id: '1' },
        query: new URLSearchParams(),
      }),
    ).toEqual([])
  })
})

describe('útvonal → művelet', () => {
  const url = (path: string) => new URL(`https://api.billingo.hu/v3${path}`)

  test('a metódus és az útvonal-sablon alapján egyértelműen azonosít', () => {
    expect(matchOperation('GET', url('/bank-accounts/5'))).toEqual({
      operation: 'GetBankAccount',
      pathParams: { id: '5' },
    })
    expect(matchOperation('POST', url('/documents/receipt'))).toEqual({
      operation: 'CreateReceipt',
      pathParams: {},
    })
    expect(matchOperation('put', url('/documents/receipt/7'))).toEqual({
      operation: 'CreateReceiptFromDraft',
      pathParams: { id: '7' },
    })
    expect(matchOperation('GET', url('/documents/vendor/ORDER%201'))).toEqual({
      operation: 'GetDocumentByVendorId',
      pathParams: { vendor_id: 'ORDER 1' },
    })
    expect(matchOperation('GET', url('/currencies?from=EUR'))).toEqual({
      operation: 'GetConversionRate',
      pathParams: {},
    })
  })

  test('ismeretlen útvonal, rossz metódus vagy más host esetén hibát dob', () => {
    expect(() => matchOperation('GET', url('/nincs-ilyen'))).toThrow('Nincs ilyen Billingo művelet')
    expect(() => matchOperation('GET', url('/documents/vendor/download'))).toThrow(
      'Több művelet is illeszkedik: GetDocumentByVendorId, DownloadDocument',
    )
    expect(() => matchOperation('PATCH', url('/bank-accounts/5'))).toThrow('Nincs ilyen')
    expect(() => matchOperation('GET', url('/bank-accounts/'))).toThrow('Nincs ilyen')
    expect(() => matchOperation('GET', new URL('https://example.com/v3/bank-accounts'))).toThrow(
      'nem a Billingo API-ra megy',
    )
  })
})

describe('séma-kulcsszavak felmérése', () => {
  test('a séma minden helyén (komponens, paraméter, fejléc, tartalom) összegyűjti a kulcsszavakat', () => {
    const usage = schemaUsage({
      paths: {
        '/x': {
          get: {
            parameters: [{ name: 'q', in: 'query', schema: { type: 'string', pattern: '^a$' } }],
            responses: {
              '200': {
                headers: { 'X-Limit': { schema: { type: 'integer', format: 'int32' } } },
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { oneOf: [{ type: 'string', minLength: 1 }] } },
                    example: { schema: { 'nem-kulcsszo': true } },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          A: {
            type: 'object',
            properties: { b: { type: 'string', format: 'email', nullable: true } },
          },
        },
      },
    })

    expect([...usage.keywords.keys()].sort()).toEqual([
      'format',
      'items',
      'minLength',
      'nullable',
      'oneOf',
      'pattern',
      'properties',
      'type',
    ])
    expect([...usage.formats.keys()].sort()).toEqual(['email', 'int32'])
    expect(usage.keywords.get('pattern')).toEqual(['#/paths//x/get/parameters/0/schema'])
  })

  test('jelzi az ismeretlen kulcsszót, formátumot és típust, a helyükkel együtt', () => {
    expect(
      unsupportedSchemaUsage({
        components: {
          schemas: {
            A: { type: 'object', discriminator: { propertyName: 'kind' } },
            B: { type: 'string', format: 'uuid', 'x-extra': 1 },
            C: { type: ['string', 'null'] },
            D: { type: 'string', description: 'rendben', example: 'x' },
          },
        },
      }),
    ).toEqual([
      'kulcsszó discriminator: #/components/schemas/A',
      'kulcsszó x-extra: #/components/schemas/B',
      'formátum uuid: #/components/schemas/B',
      'típus ["string","null"]: #/components/schemas/C',
    ])
  })
})

describe('hiányzó spec', () => {
  afterEach(() => {
    vi.doUnmock('node:fs')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function importWithoutSpec() {
    vi.resetModules()
    vi.doMock('node:fs', async (original) => ({
      ...(await original<typeof import('node:fs')>()),
      existsSync: () => false,
    }))
    return import('./openapi')
  }

  test('a szerződés-segédek hibát dobnak, nem adnak üres (mindig zöld) eredményt', async () => {
    vi.stubEnv('TARCA_REQUIRE_SPEC', '')
    const module = await importWithoutSpec()

    expect(module.SPEC_AVAILABLE).toBe(false)
    expect(() => module.contractErrors('BankAccount', {})).toThrow('Nincs letöltött Billingo spec')
    expect(() => module.requestErrors('CreateBankAccount', {})).toThrow('npm run spec:fetch')
    expect(() =>
      module.parameterErrors('GetBankAccount', { path: { id: '1' }, query: new URLSearchParams() }),
    ).toThrow('npm run spec:fetch')
    expect(() => module.responseErrors('GetBankAccount', 200, {}, { mode: 'strict' })).toThrow(
      'npm run spec:fetch',
    )
  })

  test('szigorú módban (TARCA_REQUIRE_SPEC=1) már a betöltés elbukik', async () => {
    vi.stubEnv('TARCA_REQUIRE_SPEC', '1')
    await expect(importWithoutSpec()).rejects.toThrow('TARCA_REQUIRE_SPEC=1')
  })
})
