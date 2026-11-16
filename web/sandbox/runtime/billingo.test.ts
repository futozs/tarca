import { BILLINGO_OPERATIONS, createTarca } from 'tarcajs'
import { describe, expect, test } from 'vitest'
import { createSandboxBillingo, operationFor, prettyJson } from './billingo'
import type { SandboxRequest } from './protocol'

describe('a sandbox hamis Billingója', () => {
  test('minden művelet útvonalát a saját műveletére vezeti vissza', () => {
    for (const [operation, info] of Object.entries(BILLINGO_OPERATIONS)) {
      const path = info.path.replace(/\{[^}]+\}/g, '42')
      expect(operationFor(info.method, path), `${info.method} ${info.path}`).toBe(operation)
    }
  })

  test('a fix szakasz megelőzi a paramétert, az ismeretlen útvonal nem kap műveletet', () => {
    expect(operationFor('POST', '/documents/receipt')).toBe('CreateReceipt')
    expect(operationFor('GET', '/documents/vendor/RENDELES-1')).toBe('GetDocumentByVendorId')
    expect(operationFor('GET', '/documents/42')).toBe('GetDocument')
    expect(operationFor('PATCH', '/documents/42')).toBeUndefined()
    expect(operationFor('GET', '/nincs-ilyen')).toBeUndefined()
  })

  test('a JSON-t szépen tördeli, a nem JSON szöveget nem bántja', () => {
    expect(prettyJson('{"a":[1,true]}')).toBe('{\n  "a": [\n    1,\n    true\n  ]\n}')
    expect(prettyJson('nem json')).toBeUndefined()
  })

  test('rögzíti a kérést, a törzset és a Billingo válaszát', async () => {
    const seen: SandboxRequest[] = []
    const billingo = createSandboxBillingo({ onRequest: (request) => seen.push(request) })
    const tarca = createTarca({ apiKey: 'teszt', fetch: billingo.fetch })

    const partner = await tarca.partners.create({
      name: 'Vevő Kft.',
      address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
    })

    expect(seen).toEqual(billingo.requests)
    expect(seen).toHaveLength(1)
    const [request] = seen
    expect(request).toMatchObject({
      id: 1,
      operation: 'CreatePartner',
      method: 'POST',
      path: '/partners',
      status: 201,
      responseKind: 'json',
    })
    expect(JSON.parse(request?.requestBody ?? '')).toMatchObject({
      name: 'Vevő Kft.',
      address: { post_code: '1111' },
    })
    expect(JSON.parse(request?.responseBody ?? '')).toMatchObject({ id: partner.id })
    expect(request?.responseHeaders).toContainEqual(['content-type', 'application/json'])
  })

  test('a lekérdezés paramétereit külön adja, a PDF-et felismeri', async () => {
    const billingo = createSandboxBillingo()
    const tarca = createTarca({ apiKey: 'teszt', fetch: billingo.fetch })

    const szamla = await tarca.documents.create({
      partner: {
        name: 'Vevő Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      },
      items: [{ name: 'Munka', quantity: 1, netUnitPrice: 1_000, vat: 27 }],
    })
    await tarca.documents.pdf(szamla.id ?? 0)

    const search = billingo.requests.find((request) => request.operation === 'ListPartner')
    expect(search?.query).toContainEqual(['query', 'Vevő Kft.'])
    expect(billingo.requests.at(-1)).toMatchObject({
      operation: 'DownloadDocument',
      responseKind: 'pdf',
    })
  })

  test('a hálózati hibát is rögzíti, és továbbadja a hívónak', async () => {
    const billingo = createSandboxBillingo()
    const tarca = createTarca({ apiKey: 'teszt', fetch: billingo.fetch })
    billingo.fake.fail('network', { operation: 'CreatePartner' })

    await expect(
      tarca.partners.create({
        name: 'Vevő Kft.',
        address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
      }),
    ).rejects.toMatchObject({ category: 'network' })
    expect(billingo.requests.at(-1)).toMatchObject({
      status: 'network',
      responseKind: 'empty',
      responseBody: '',
    })
  })

  test('a pillanatkép a bizonylatokat a vendorId-val együtt adja', async () => {
    const billingo = createSandboxBillingo()
    const tarca = createTarca({ apiKey: 'teszt', fetch: billingo.fetch })

    await tarca.receipts.createOnce({
      vendorId: 'KASSZA-7',
      items: [{ name: 'Kávé', grossUnitPrice: 600, vat: 27 }],
    })

    expect(billingo.snapshot()).toMatchObject({
      documents: [
        { type: 'receipt', grossTotal: 600, vendorId: 'KASSZA-7', paymentStatus: 'paid' },
      ],
    })
  })
})
