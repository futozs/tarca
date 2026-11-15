import { format } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { hmacHex } from '../core/crypto'
import { BillingoError } from '../core/errors'
import type { KeyValueStore } from '../core/store'
import { plainResponse } from './body'
import {
  isPaymentProviderError,
  isWebhookVerificationError,
  PaymentProviderError,
  WebhookVerificationError,
} from './errors'
import { stripeWebhook } from './stripe'
import type { PaymentEvent, PaymentWarning } from './types'
import {
  assertWebhookOptions,
  DEFAULT_DEDUPE_TTL_SECONDS,
  deliverPayment,
  respondToWebhook,
  WEBHOOK_DEDUPE_KEY_PREFIX,
  webhookDedupeKey,
} from './webhook'

afterEach(() => {
  vi.restoreAllMocks()
})

function memoryStore(): KeyValueStore & { readonly ttls: number[] } {
  const values = new Map<string, string>()
  const ttls: number[] = []
  return {
    ttls,
    get: (key) => values.get(key),
    set: (key, value, ttl) => {
      ttls.push(ttl)
      values.set(key, value)
    },
    delete: (key) => {
      values.delete(key)
    },
  }
}

describe('respondToWebhook', () => {
  test('sikeres futásnál a futtatott válaszát adja vissza', async () => {
    const response = await respondToWebhook({}, async () => plainResponse(200, 'OK'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('OK')
  })

  test('hitelesítési hibára 400-at ad, és nem hívja az onError-t', async () => {
    const onError = vi.fn()
    const response = await respondToWebhook({ onError }, async () => {
      throw new WebhookVerificationError('stripe', 'invalid_signature', 'Rossz aláírás.')
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Rossz aláírás.')
    expect(onError).not.toHaveBeenCalled()
  })

  test('más hibára 500-at ad, a hibát az onError kapja, a válasz nem árul el részletet', async () => {
    const onError = vi.fn()
    const failure = new PaymentProviderError('barion', 'Nem érhető el.')
    const response = await respondToWebhook({ onError }, async () => {
      throw failure
    })
    expect(response.status).toBe(500)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(await response.text()).not.toContain('Nem érhető el.')
  })

  test('onError nélkül a konzolra csak biztonságos összefoglalót naplóz, üzenet és törzs nélkül', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = new BillingoError('Hibás partner: emails.0: „titkos@pelda.hu”', {
      category: 'validation',
      status: 422,
      operation: 'CreatePartner',
    })
    const response = await respondToWebhook({}, async () => {
      throw failure
    })
    expect(response.status).toBe(500)
    expect(consoleError).toHaveBeenCalledOnce()
    const printed = format(...(consoleError.mock.calls[0] ?? []))
    expect(printed).toContain('validation')
    expect(printed).toContain('CreatePartner')
    expect(printed).not.toContain('titkos')
    await respondToWebhook({}, async () => {
      throw new Error('vevo@pelda.hu')
    })
    expect(format(...(consoleError.mock.calls[1] ?? []))).not.toContain('vevo@pelda.hu')
  })

  test('ha az onError maga dob vagy elutasít, akkor is 500-at ad', async () => {
    const throwing = await respondToWebhook(
      {
        onError: () => {
          throw new Error('a naplózó is hibás')
        },
      },
      async () => {
        throw new Error('eredeti hiba')
      },
    )
    const rejecting = await respondToWebhook(
      { onError: () => Promise.reject(new Error('aszinkron naplózó hiba')) },
      async () => {
        throw new Error('eredeti hiba')
      },
    )
    expect(throwing.status).toBe(500)
    expect(rejecting.status).toBe(500)
  })
})

describe('hibatípusok', () => {
  test('a típusőrök csak a saját példányaikra igazak', () => {
    expect(
      isWebhookVerificationError(new WebhookVerificationError('paypal', 'missing_signature', 'x')),
    ).toBe(true)
    expect(isWebhookVerificationError(new Error('x'))).toBe(false)
    expect(isPaymentProviderError(new PaymentProviderError('paypal', 'x'))).toBe(true)
    expect(isPaymentProviderError(new Error('x'))).toBe(false)
  })

  test('a PaymentProviderError megőrzi a státuszt és az okot', () => {
    const cause = new TypeError('fetch failed')
    const error = new PaymentProviderError('paypal', 'Hiba.', 503, cause)
    expect(error.status).toBe(503)
    expect(error.cause).toBe(cause)
    expect(error.provider).toBe('paypal')
    expect(new PaymentProviderError('paypal', 'Hiba.').cause).toBeUndefined()
  })
})

describe('assertWebhookOptions', () => {
  test('az onPayment hiányára, ismeretlen fizetési módra és rossz méretekre TypeError-t dob', () => {
    expect(() => assertWebhookOptions({ onPayment: vi.fn() })).not.toThrow()
    expect(() => assertWebhookOptions({ onPayment: undefined as unknown as () => void })).toThrow(
      TypeError,
    )
    expect(() =>
      assertWebhookOptions({ onPayment: vi.fn(), method: 'kartya' as unknown as 'cash' }),
    ).toThrow(TypeError)
    expect(() => assertWebhookOptions({ onPayment: vi.fn(), maxBodyBytes: 0 })).toThrow(TypeError)
    expect(() => assertWebhookOptions({ onPayment: vi.fn(), dedupeTtlSeconds: 0 })).toThrow(
      TypeError,
    )
  })
})

describe('deliverPayment ismétlés-szűrővel', () => {
  const PAYMENT: PaymentEvent = {
    provider: 'stripe',
    kind: 'paid',
    id: 'pi_1',
    eventId: 'evt_1',
    method: 'stripe',
    raw: {},
  }

  test('tároló nélkül mindig feldolgoz', async () => {
    const onPayment = vi.fn()
    expect(await deliverPayment({ onPayment }, PAYMENT)).toBe(true)
    expect(await deliverPayment({ onPayment }, PAYMENT)).toBe(true)
    expect(onPayment).toHaveBeenCalledTimes(2)
  })

  test('a sikeresen feldolgozott eseményt az újraküldéskor átugorja', async () => {
    const dedupe = memoryStore()
    const onPayment = vi.fn()
    const prepare = vi.fn((payment: PaymentEvent) => payment)

    expect(await deliverPayment({ onPayment, dedupe }, PAYMENT, prepare)).toBe(true)
    expect(await deliverPayment({ onPayment, dedupe }, PAYMENT, prepare)).toBe(false)

    expect(onPayment).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledOnce()
    expect(await dedupe.get(webhookDedupeKey(PAYMENT))).toBe('1')
    expect(webhookDedupeKey(PAYMENT)).toBe(`${WEBHOOK_DEDUPE_KEY_PREFIX}stripe:evt_1`)
    expect(WEBHOOK_DEDUPE_KEY_PREFIX).toBe('tarca:evt:')
  })

  test('ha a feldolgozás elbukik, nem jelöli meg, így az újraküldés újra próbálja', async () => {
    const dedupe = memoryStore()
    const onPayment = vi.fn().mockRejectedValueOnce(new Error('Billingo hiba'))

    await expect(deliverPayment({ onPayment, dedupe }, PAYMENT)).rejects.toThrow('Billingo hiba')
    expect(await deliverPayment({ onPayment, dedupe }, PAYMENT)).toBe(true)
    expect(onPayment).toHaveBeenCalledTimes(2)
  })

  test('eventId nélküli eseményt mindig feldolgoz', async () => {
    const dedupe = memoryStore()
    const onPayment = vi.fn()
    const payment = { ...PAYMENT, eventId: undefined }
    await deliverPayment({ onPayment, dedupe }, payment)
    await deliverPayment({ onPayment, dedupe }, payment)
    expect(onPayment).toHaveBeenCalledTimes(2)
  })

  test('a beállított TTL-lel jelöl, az alapértelmezett 7 nap', async () => {
    const dedupe = memoryStore()
    await deliverPayment({ onPayment: vi.fn(), dedupe }, PAYMENT)
    await deliverPayment(
      { onPayment: vi.fn(), dedupe, dedupeTtlSeconds: 60.5 },
      { ...PAYMENT, eventId: 'evt_2' },
    )
    expect(dedupe.ttls).toEqual([DEFAULT_DEDUPE_TTL_SECONDS, 61])
    expect(DEFAULT_DEDUPE_TTL_SECONDS).toBe(604_800)
    await expect(
      deliverPayment({ onPayment: vi.fn(), dedupe, dedupeTtlSeconds: 0 }, PAYMENT),
    ).rejects.toThrow(TypeError)
  })

  test('a tároló hibája figyelmeztetés, a feldolgozás megtörténik', async () => {
    const warnings: PaymentWarning[] = []
    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error('le')),
      set: () => Promise.reject(new Error('le')),
      delete: () => undefined,
    }
    const onPayment = vi.fn()
    expect(
      await deliverPayment(
        { onPayment, dedupe: broken, onWarning: (warning) => warnings.push(warning) },
        PAYMENT,
      ),
    ).toBe(true)
    expect(onPayment).toHaveBeenCalledOnce()
    expect(warnings.map((warning) => [warning.kind, warning.operation])).toEqual([
      ['dedupe', 'get'],
      ['dedupe', 'set'],
    ])
  })

  test('onWarning nélkül a tárolóhibát a konzolra írja, a hibaobjektum nélkül', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await deliverPayment(
      {
        onPayment: vi.fn(),
        dedupe: {
          get: () => Promise.reject(new Error('redis://titok@host')),
          set: () => {},
          delete: () => {},
        },
      },
      PAYMENT,
    )
    expect(warn).toHaveBeenCalledOnce()
    expect(format(...(warn.mock.calls[0] ?? []))).not.toContain('titok')
  })

  test('a dobó vagy elutasító onWarning sem töri meg a feldolgozást', async () => {
    const onPayment = vi.fn()
    const broken: KeyValueStore = {
      get: () => Promise.reject(new Error('le')),
      set: () => undefined,
      delete: () => undefined,
    }
    await deliverPayment(
      {
        onPayment,
        dedupe: broken,
        onWarning: () => {
          throw new Error('figyelmeztetés hiba')
        },
      },
      PAYMENT,
    )
    await deliverPayment(
      { onPayment, dedupe: broken, onWarning: () => Promise.reject(new Error('aszinkron')) },
      PAYMENT,
    )
    expect(onPayment).toHaveBeenCalledTimes(2)
  })
})

describe('stripeWebhook ismétlés-szűrővel', () => {
  test('ugyanaz az esemény másodszor nem hívja az onPayment-et, de 200-at ad', async () => {
    const secret = 'whsec_dedupe'
    const nowSeconds = 1_790_000_000
    const payload = JSON.stringify({
      id: 'evt_dedupe',
      object: 'event',
      type: 'checkout.session.completed',
      created: nowSeconds,
      livemode: false,
      data: {
        object: {
          id: 'cs_dedupe',
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 1000,
          currency: 'huf',
        },
      },
    })
    const signed = `t=${nowSeconds},v1=${await hmacHex('SHA-256', secret, `${nowSeconds}.${payload}`)}`
    const onPayment = vi.fn()
    const handler = stripeWebhook({
      secret,
      now: () => nowSeconds * 1000,
      onPayment,
      dedupe: memoryStore(),
    })
    const request = () =>
      new Request('https://bolt.example.hu/webhook', {
        method: 'POST',
        body: payload,
        headers: { 'stripe-signature': signed },
      })

    expect((await handler(request())).status).toBe(200)
    expect((await handler(request())).status).toBe(200)
    expect(onPayment).toHaveBeenCalledOnce()
  })
})
