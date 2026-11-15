import { describe, expect, test } from 'vitest'
import { MCP_NOW, MCP_SECRET } from '../../tests/mcp'
import { ToolInputError } from './arguments'
import { canonicalJson, createConfirmations, idempotencyKey } from './confirmation'

describe('megerősítő kódok', () => {
  test('a kanonikus JSON-ban a kulcsok sorrendje nem számít, az undefined mezők kimaradnak', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: undefined }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, { y: 1 }] }, b: 1 }),
    )
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]')
    expect(canonicalJson(undefined)).toBe('null')
  })

  test('a kulcsok sorrendjétől független, de az adatokhoz és a művelethez kötött', async () => {
    const confirmations = createConfirmations({ secret: MCP_SECRET, now: MCP_NOW })
    const issued = await confirmations.issue('create_document', { b: 2, a: 1 })

    await expect(
      confirmations.verify('create_document', { a: 1, b: 2 }, issued.token, 'preview_document'),
    ).resolves.toBe(issued.token)
    await expect(
      confirmations.verify('create_receipt', { a: 1, b: 2 }, issued.token, 'preview_receipt'),
    ).rejects.toThrow('eltérnek')
    await expect(
      confirmations.verify('create_document', { a: 1, b: 3 }, issued.token, 'preview_document'),
    ).rejects.toThrow('eltérnek')
    expect(issued.expiresAt).toBe('2026-11-16T09:15:00.000Z')
    expect(issued.token).toMatch(/^[0-9a-z]+\.[0-9a-f]{32}$/)
  })

  test('más titokkal készült kódot nem fogad el', async () => {
    const first = createConfirmations({ secret: `${MCP_SECRET}-egyik`, now: MCP_NOW })
    const second = createConfirmations({ secret: `${MCP_SECRET}-masik`, now: MCP_NOW })
    const issued = await first.issue('cancel_document', { id: 1 })

    await expect(
      second.verify('cancel_document', { id: 1 }, issued.token, 'preview_cancellation'),
    ).rejects.toThrow('eltérnek')
  })

  test('véletlen titokkal is működik, a lejárati idő beállítható, a lejárat napra pontos', async () => {
    let now = MCP_NOW()
    const confirmations = createConfirmations({ ttlMs: 1000, now: () => now })
    const issued = await confirmations.issue('create_receipt', {})

    await confirmations.verify('create_receipt', {}, issued.token, 'preview_receipt')
    now = new Date(now.getTime() + 1000)
    await confirmations.verify('create_receipt', {}, issued.token, 'preview_receipt')
    now = new Date(now.getTime() + 1)

    await expect(
      confirmations.verify('create_receipt', {}, issued.token, 'preview_receipt'),
    ).rejects.toThrow('lejárt')
  })

  test('a lejárati idő a kódba van írva: a meghosszabbított lejárat nem fogadható el', async () => {
    const confirmations = createConfirmations({ secret: MCP_SECRET, now: MCP_NOW })
    const issued = await confirmations.issue('create_document', { a: 1 })
    const [expires, signature] = issued.token.split('.')
    const forged = `${(Number.parseInt(expires ?? '', 36) + 60_000).toString(36)}.${signature}`

    await expect(
      confirmations.verify('create_document', { a: 1 }, forged, 'preview_document'),
    ).rejects.toThrow('eltérnek')
  })

  test('hiányzó és hibás formátumú kódra confirmation kategóriájú hibát ad, újraelőnézetet kér', async () => {
    const confirmations = createConfirmations({ secret: MCP_SECRET, now: MCP_NOW })

    const missing = confirmations.verify('send_document', {}, undefined, 'preview_send')
    const blank = confirmations.verify('send_document', {}, '  ', 'preview_send')
    const malformed = confirmations.verify('send_document', {}, 'nem-kod', 'preview_send')

    await expect(missing).rejects.toThrow('Hiányzik a megerősítő kód')
    await expect(blank).rejects.toThrow('Hiányzik a megerősítő kód')
    await expect(malformed).rejects.toThrow('formátuma érvénytelen')
    await expect(malformed).rejects.toMatchObject({
      category: 'confirmation',
      fields: ['confirmation'],
    })
    await expect(missing).rejects.toThrow('preview_send')
    await expect(missing).rejects.toBeInstanceOf(ToolInputError)
  })

  test('üres vagy 16 bájtnál rövidebb titkot beállítási hibával utasít el', () => {
    const create = (secret: string | Uint8Array) => () =>
      createConfirmations({ secret, now: MCP_NOW })

    expect(create('')).toThrow('confirmationSecret')
    expect(create('rövid-titok')).toThrow('legalább 16 bájt')
    expect(create(new Uint8Array(15))).toThrow('confirmationSecret')
    expect(create('')).toThrow(expect.objectContaining({ category: 'configuration' }))
    expect(create('ő'.repeat(8))).not.toThrow()
    expect(create(new Uint8Array(16))).not.toThrow()
  })

  test('nem pozitív egész lejárati időre TypeError-t dob', () => {
    expect(() => createConfirmations({ ttlMs: 0, now: MCP_NOW })).toThrow(TypeError)
    expect(() => createConfirmations({ ttlMs: 1.5, now: MCP_NOW })).toThrow(TypeError)
  })

  test('az elköltött kód másodszor nem költhető el, a visszaadott újra igen, a lejárt kikerül', async () => {
    let now = MCP_NOW()
    const confirmations = createConfirmations({ secret: MCP_SECRET, ttlMs: 1000, now: () => now })
    const first = await confirmations.issue('send_document', { id: 1 })

    expect(confirmations.spend(first.token)).toBe(true)
    expect(confirmations.spend(first.token)).toBe(false)
    confirmations.release(first.token)
    expect(confirmations.spend(first.token)).toBe(true)
    now = new Date(now.getTime() + 2000)
    const second = await confirmations.issue('send_document', { id: 2 })
    expect(confirmations.spend(second.token)).toBe(true)
    expect(confirmations.spend(first.token)).toBe(true)
  })

  test('az idempotencia-kulcs a művelettől, a naptól és a tartalomtól függ', async () => {
    const key = await idempotencyKey('create_receipt', '2026-11-16', { a: 1 })

    expect(key).toMatch(/^[0-9A-F]{20}$/)
    expect(await idempotencyKey('create_receipt', '2026-11-16', { a: 1 })).toBe(key)
    expect(await idempotencyKey('create_receipt', '2026-11-17', { a: 1 })).not.toBe(key)
    expect(await idempotencyKey('create_document', '2026-11-16', { a: 1 })).not.toBe(key)
    expect(await idempotencyKey('create_receipt', '2026-11-16', { a: 2 })).not.toBe(key)
  })
})
