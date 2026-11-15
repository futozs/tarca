import { describe, expect, test } from 'vitest'
import {
  DEFAULT_MAX_WEBHOOK_BYTES,
  parseJsonObject,
  plainResponse,
  readRawBody,
  resolveMaxBodyBytes,
} from './body'
import { WebhookVerificationError } from './errors'

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function streamed(chunks: readonly string[]): Request {
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    body: streamOf(chunks),
    duplex: 'half',
  }
  return new Request('https://bolt.example.hu/webhook', init)
}

describe('readRawBody', () => {
  test('a nyers törzset változatlanul, UTF-8-ként adja vissza', async () => {
    const body = '{"név":"Kovács Éva","összeg":1000}'
    const request = new Request('https://bolt.example.hu/webhook', { method: 'POST', body })
    expect(await readRawBody(request, 'stripe')).toBe(body)
  })

  test('több darabban érkező törzset is összerak', async () => {
    expect(await readRawBody(streamed(['{"a":', '1,"b"', ':"ő"}']), 'stripe')).toBe(
      '{"a":1,"b":"ő"}',
    )
  })

  test('a darabhatáron kettévágott ékezetes karaktert is helyesen dekódolja', async () => {
    const bytes = new TextEncoder().encode('{"b":"ő"}')
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 7))
          controller.enqueue(bytes.slice(7))
          controller.close()
        },
      }),
      duplex: 'half',
    }
    const request = new Request('https://bolt.example.hu/webhook', init)
    expect(await readRawBody(request, 'stripe')).toBe('{"b":"ő"}')
  })

  test('üres törzsre üres stringet ad', async () => {
    const request = new Request('https://bolt.example.hu/webhook', { method: 'POST' })
    expect(await readRawBody(request, 'paypal')).toBe('')
  })

  test('a Content-Length alapján már olvasás előtt elutasítja a túl nagy törzset', async () => {
    const request = new Request('https://bolt.example.hu/webhook', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(DEFAULT_MAX_WEBHOOK_BYTES + 1) },
    })
    await expect(readRawBody(request, 'stripe')).rejects.toMatchObject({
      name: 'WebhookVerificationError',
      reason: 'payload_too_large',
      provider: 'stripe',
    })
  })

  test('olvasás közben is leállítja a megadott méretnél nagyobb törzset', async () => {
    await expect(readRawBody(streamed(['12345', '67890']), 'barion', 8)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    )
  })

  test('a túl nagy törzs folyamát lezárja, nem olvassa tovább', async () => {
    const encoder = new TextEncoder()
    let pulled = 0
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(encoder.encode('12345'))
      },
      cancel() {
        cancelled = true
      },
    })
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half' }

    await expect(
      readRawBody(new Request('https://bolt.example.hu/webhook', init), 'stripe', 8),
    ).rejects.toMatchObject({ reason: 'payload_too_large' })
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThan(5)
  })

  test('a pontosan megengedett méretű törzset még elfogadja', async () => {
    const request = new Request('https://bolt.example.hu/webhook', {
      method: 'POST',
      body: '12345678',
    })
    expect(await readRawBody(request, 'barion', 8)).toBe('12345678')
  })

  test('érvénytelen maxBodyBytes értékre TypeError-t dob', () => {
    expect(resolveMaxBodyBytes(undefined)).toBe(1_048_576)
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveMaxBodyBytes(value)).toThrow(TypeError)
    }
  })
})

describe('parseJsonObject', () => {
  test('JSON objektumot ad vissza', () => {
    expect(parseJsonObject('stripe', '{"id":"evt_1"}')).toEqual({ id: 'evt_1' })
  })

  test('érvénytelen JSON-ra invalid_payload hibát dob, és az üzenet nem idéz a törzsből', () => {
    const body = '{"email":"titkos.vevo@pelda.hu", nem json'
    const error = (() => {
      try {
        parseJsonObject('revolut', body)
      } catch (caught) {
        return caught
      }
      return undefined
    })()
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect(error).toMatchObject({ reason: 'invalid_payload', provider: 'revolut' })
    const message = error instanceof Error ? error.message : ''
    expect(message).toBe('A webhook törzse nem érvényes JSON.')
    expect(message).not.toContain('titkos')
    expect(message).not.toContain('nem json')
  })

  test('tömbre, nullra és primitívre is hibát dob', () => {
    for (const payload of ['[]', 'null', '42', '"szöveg"']) {
      expect(() => parseJsonObject('paypal', payload)).toThrow(WebhookVerificationError)
    }
  })
})

describe('plainResponse', () => {
  test('UTF-8 szöveges választ ad a megadott státusszal', async () => {
    const response = plainResponse(400, 'Hibás aláírás')
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await response.text()).toBe('Hibás aláírás')
  })
})
