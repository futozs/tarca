import { describe, expect, test, vi } from 'vitest'
import { createTarca, type TarcaOptions } from '../client'
import type { CompleteEvent, TarcaHooks } from '../core/context'
import { BillingoError } from '../core/errors'
import type { KeyValueStore } from '../core/store'
import { createJournal, memoryJournal } from '../journal'
import type { PartnerInput } from '../partners/partners'
import { createFakeBillingoFetch } from '../testing'
import {
  combineHooks,
  createMetricsRegistry,
  MAX_OPEN_SPANS,
  type ObservedDocumentEvent,
  type ObserveSpan,
  type ObserveTracer,
  observe,
  SPAN_KIND_CLIENT,
  SPAN_STATUS_ERROR,
  SPAN_STATUS_OK,
} from './index'

const KEY = 'tarca-observe-titkos-kulcs-0000'
const NOW = new Date('2026-11-15T13:50:07Z')

const BUYER: PartnerInput = {
  name: 'Titkos Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['titok@pelda.hu'],
  taxcode: '12345678-2-42',
}

const INVOICE = {
  vendorId: 'OBS-1',
  partner: BUYER,
  items: [{ name: 'Termék', grossUnitPrice: 12_700, quantity: 1, vat: 27 }],
}

const SECRETS = ['Titkos', 'titok@pelda.hu', '12345678', KEY, 'OBS-1']

interface RecordedSpan {
  name: string
  kind: number | undefined
  attributes: Record<string, unknown>
  status?: { code: number; message?: string }
  exceptions: unknown[]
  ended: number
}

function recordingTracer(): ObserveTracer & { spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = []
  return {
    spans,
    startSpan(name, options) {
      const recorded: RecordedSpan = {
        name,
        kind: options?.kind,
        attributes: { ...options?.attributes },
        exceptions: [],
        ended: 0,
      }
      spans.push(recorded)
      const span: ObserveSpan = {
        setAttribute: (key, value) => {
          recorded.attributes[key] = value
        },
        setStatus: (status) => {
          recorded.status = status
        },
        recordException: (exception) => recorded.exceptions.push(exception),
        end: () => {
          recorded.ended += 1
        },
      }
      return span
    },
  }
}

interface LogLine {
  level: string
  data: Readonly<Record<string, unknown>>
  message: string
}

function recordingLogger() {
  const lines: LogLine[] = []
  const at = (level: string) => (data: Readonly<Record<string, unknown>>, message: string) => {
    lines.push({ level, data, message })
  }
  return { lines, logger: { debug: at('debug'), info: at('info'), warn: at('warn') } }
}

function setup(hooks: TarcaHooks, options: Partial<TarcaOptions> = {}) {
  const billingo = createFakeBillingoFetch({ now: () => NOW })
  const tarca = createTarca({
    apiKey: KEY,
    fetch: billingo.fetch,
    retryDelayMs: 0,
    hooks,
    ...options,
  })
  return { billingo, tarca }
}

function documentEvent(overrides: Partial<ObservedDocumentEvent> = {}): ObservedDocumentEvent {
  return {
    action: 'created',
    operation: 'CreateDocument',
    vendorId: 'OBS-1',
    document: { id: 7, type: 'invoice', invoiceNumber: '2026-7' },
    ...overrides,
  }
}

function completeEvent(error: BillingoError | undefined): CompleteEvent {
  return {
    operation: 'CreateDocument',
    method: 'POST',
    path: '/documents',
    attempt: 1,
    requestId: 'req-1',
    outcome: error ? 'error' : 'success',
    durationMs: 12,
    error,
    willRetry: false,
  }
}

const LEAKY_ERROR = new BillingoError('Hibás bizonylatadatok: partner.emails.0: „titok@pelda.hu”', {
  category: 'validation',
  status: 422,
  operation: 'CreateDocument',
  apiMessage: 'Duplicate vendor id. (OBS-1, Titkos Vevő Kft.)',
  traceId: 'trace-abc',
  hint: 'A titok@pelda.hu címet ellenőrizd.',
  fieldErrors: [{ field: 'partner.emails.0', message: 'Érvénytelen cím: titok@pelda.hu' }],
})

describe('observe', () => {
  test('kérésenként spant, metrikát és strukturált naplót ad, titok és személyes adat nélkül', async () => {
    const tracer = recordingTracer()
    const metrics = createMetricsRegistry()
    const { lines, logger } = recordingLogger()
    const { tarca } = setup(observe({ tracer, metrics, logger }))

    await tarca.documents.createOnce(INVOICE)

    expect(tracer.spans.map((span) => span.name)).toEqual([
      'billingo GetDocumentByVendorId',
      'billingo ListDocumentBlock',
      'billingo ListPartner',
      'billingo CreatePartner',
      'billingo CreateDocument',
    ])
    expect(tracer.spans.every((span) => span.ended === 1)).toBe(true)
    expect(tracer.spans.every((span) => span.kind === SPAN_KIND_CLIENT)).toBe(true)
    const [lookup, , , , create] = tracer.spans
    expect(create?.attributes).toMatchObject({
      'billingo.operation': 'CreateDocument',
      'http.request.method': 'POST',
      'url.template': '/documents',
      'billingo.attempt': 1,
      'billingo.request_id': expect.any(String),
      'http.response.status_code': 201,
    })
    expect(create?.status).toEqual({ code: SPAN_STATUS_OK })
    expect(lookup?.attributes).toMatchObject({
      'url.template': '/documents/vendor/{vendor_id}',
      'billingo.error.category': 'not_found',
      'http.response.status_code': 404,
    })
    expect(lookup?.status).toEqual({ code: SPAN_STATUS_ERROR, message: 'not_found' })

    const prometheus = metrics.renderPrometheus()
    expect(prometheus).toContain(
      'tarca_requests_total{operation="CreateDocument",outcome="success"} 1',
    )
    expect(prometheus).toContain(
      'tarca_requests_total{operation="GetDocumentByVendorId",outcome="not_found"} 1',
    )
    expect(prometheus).toContain('# TYPE tarca_request_duration_ms histogram')
    expect(prometheus).toContain('tarca_request_duration_ms_count{operation="CreatePartner"} 1')

    const serialized = JSON.stringify([lines, tracer.spans, prometheus])
    for (const secret of SECRETS) expect(serialized).not.toContain(secret)
    expect(
      lines.filter((line) => line.level === 'info' && line.data.event === 'tarca.request'),
    ).toHaveLength(4)
    expect(lines.find((line) => line.level === 'warn')?.data).toMatchObject({
      event: 'tarca.request',
      operation: 'GetDocumentByVendorId',
      errorCategory: 'not_found',
      status: 404,
      retryable: false,
    })
  })

  test('a hiba üzenetét, tippjét, apiMessage-ét és mezőhibáinak szövegét redact mellett nem naplózza, csak a mezőneveket', () => {
    const tracer = recordingTracer()
    const { lines, logger } = recordingLogger()
    const hooks = observe({ tracer, logger })
    hooks.onRequest?.(completeEvent(LEAKY_ERROR))
    hooks.onComplete?.(completeEvent(LEAKY_ERROR))

    expect(lines[0]?.data).toEqual({
      event: 'tarca.request',
      operation: 'CreateDocument',
      method: 'POST',
      path: '/documents',
      attempt: 1,
      requestId: 'req-1',
      outcome: 'error',
      durationMs: 12,
      willRetry: false,
      errorCategory: 'validation',
      retryable: false,
      status: 422,
      traceId: 'trace-abc',
      fields: ['partner.emails.0'],
    })
    expect(tracer.spans[0]?.attributes).toMatchObject({
      'billingo.trace_id': 'trace-abc',
      'billingo.error.category': 'validation',
      'http.response.status_code': 422,
    })
    const serialized = JSON.stringify([lines, tracer.spans])
    for (const secret of ['titok@pelda.hu', 'Titkos', 'OBS-1']) {
      expect(serialized).not.toContain(secret)
    }
  })

  test('redact: false esetén a teljes hibát naplózza és a spanra is a valódi hibát teszi', () => {
    const tracer = recordingTracer()
    const { lines, logger } = recordingLogger()
    const hooks = observe({ tracer, logger, redact: false })
    hooks.onRequest?.(completeEvent(LEAKY_ERROR))
    hooks.onComplete?.(completeEvent(LEAKY_ERROR))

    expect(lines[0]?.data).toMatchObject({
      errorMessage: LEAKY_ERROR.message,
      hint: LEAKY_ERROR.hint,
      apiMessage: LEAKY_ERROR.apiMessage,
      fieldErrors: LEAKY_ERROR.fieldErrors,
    })
    expect(tracer.spans[0]?.exceptions).toEqual([LEAKY_ERROR])
    expect(tracer.spans[0]?.status?.message).toBe(LEAKY_ERROR.message)
  })

  test('a Billingo hibaüzenetében érkező vendorId és név a valódi kliensen át sem kerül a naplóba', async () => {
    const { lines, logger } = recordingLogger()
    const tracer = recordingTracer()
    const { billingo, tarca } = setup(observe({ logger, tracer }))
    billingo.fail(
      { status: 400, message: 'Duplicate vendor id. (OBS-1, Titkos Vevő Kft., titok@pelda.hu)' },
      { operation: 'CreateDocument' },
    )

    await expect(tarca.documents.create({ ...INVOICE, partner: 1 })).rejects.toMatchObject({
      category: 'validation',
    })

    const serialized = JSON.stringify([lines, tracer.spans])
    for (const secret of SECRETS) expect(serialized).not.toContain(secret)
    expect(lines.at(-1)?.data).toMatchObject({
      operation: 'CreateDocument',
      errorCategory: 'validation',
      status: 400,
    })
  })

  test('azonos sóval a vendorId-hivatkozás folyamatok között egyezik, redact: false esetén nyílt', async () => {
    const refs: unknown[] = []
    for (const options of [
      { refSalt: 's' },
      { refSalt: 's' },
      { refSalt: 'masik' },
      { redact: false },
    ]) {
      const { lines, logger } = recordingLogger()
      await observe({ ...options, logger }).onDocument(documentEvent())
      refs.push(lines[0]?.data.vendorRef)
    }
    expect(refs[0]).toMatch(/^hmac:[0-9a-f]{16}$/)
    expect(refs[0]).toBe(refs[1])
    expect(refs[2]).not.toBe(refs[0])
    expect(refs[3]).toBe('OBS-1')
  })

  test('a bizonylateseményt típus és művelet szerint számolja és naplózza, vendorId nélkül is', async () => {
    const metrics = createMetricsRegistry()
    const { lines, logger } = recordingLogger()
    const hooks = observe({ metrics, logger })

    await hooks.onDocument(documentEvent())
    await hooks.onDocument(
      documentEvent({
        action: 'cancelled',
        vendorId: undefined,
        document: { id: 8, type: 'cancellation', invoiceNumber: '2026-8' },
      }),
    )
    await hooks.onDocument(documentEvent({ vendorId: '  ', document: {} }))
    await hooks.onDocument(
      documentEvent({ action: 'finalized', document: { id: 9, type: 'draft', invoiceNumber: '' } }),
    )

    const prometheus = metrics.renderPrometheus()
    expect(prometheus).toContain('tarca_documents_total{action="created",type="invoice"} 1')
    expect(prometheus).toContain('tarca_documents_total{action="cancelled",type="cancellation"} 1')
    expect(prometheus).toContain('tarca_documents_total{action="created",type="unknown"} 1')
    expect(lines.map((line) => line.message)).toEqual([
      'tarca: invoice created 2026-7',
      'tarca: cancellation cancelled 2026-8',
      'tarca: unknown created',
      'tarca: draft finalized',
    ])
    expect(lines[3]?.data).not.toHaveProperty('number')
    expect(lines[1]?.data).toEqual({
      event: 'tarca.document',
      type: 'cancellation',
      action: 'cancelled',
      operation: 'CreateDocument',
      documentId: 8,
      number: '2026-8',
    })
    expect(lines[2]?.data.vendorRef).toBeUndefined()
  })

  test('újrapróbálást, 429-et és váratlan választ számol', async () => {
    const metrics = createMetricsRegistry()
    const { billingo, tarca } = setup(observe({ metrics }))
    billingo.fail({ status: 429 }, { operation: 'GetOrganizationData' })
    await tarca.organization.get()

    const empty = createTarca({
      apiKey: KEY,
      fetch: async () => new Response('', { status: 200 }),
      hooks: observe({ metrics }),
    })
    await expect(empty.utils.serverTime()).rejects.toMatchObject({
      category: 'unexpected_response',
    })

    const prometheus = metrics.renderPrometheus()
    expect(prometheus).toContain('tarca_retries_total{operation="GetOrganizationData"} 1')
    expect(prometheus).toContain('tarca_rate_limited_total{operation="GetOrganizationData"} 1')
    expect(prometheus).toContain(
      'tarca_requests_total{operation="GetOrganizationData",outcome="rate_limit"} 1',
    )
    expect(prometheus).toContain('tarca_unexpected_response_total{operation="GetServerTime"} 1')
  })

  test('a createOnce zár hibáját tárolóhibaként és figyelmeztetésként számolja, a tároló hibaüzenetét nem naplózza', async () => {
    const metrics = createMetricsRegistry()
    const { lines, logger } = recordingLogger()
    const values = new Map<string, string>()
    const lock: KeyValueStore = {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value)
      },
      delete: (key) => {
        values.delete(key)
      },
      setIfAbsent: (key, value) => {
        if (values.has(key)) return false
        values.set(key, value)
        return true
      },
      deleteIfEquals: () => {
        throw new Error('redis://felhasznalo:jelszo@redis.belso:6379 nem érhető el')
      },
    }
    const { tarca } = setup(observe({ metrics, logger }), { createOnceLock: lock })

    await expect(tarca.documents.createOnce(INVOICE)).resolves.toMatchObject({ created: true })

    const prometheus = metrics.renderPrometheus()
    expect(prometheus).toContain('tarca_lock_errors_total 1')
    expect(prometheus).toContain('tarca_warnings_total{hook="createOnceLock"} 1')
    const warning = lines.find((line) => line.data.event === 'tarca.warning')
    expect(warning?.data).toEqual({
      event: 'tarca.warning',
      hook: 'createOnceLock',
      operation: 'CreateDocument',
      errorName: 'Error',
    })
    expect(warning?.message).toContain('createOnce zárat')
    expect(JSON.stringify(lines)).not.toContain('jelszo')
  })

  test('a nem zártól jövő figyelmeztetést nem számolja zárhibának', () => {
    const metrics = createMetricsRegistry()
    observe({ metrics }).onWarning?.({ hook: 'onDocument', operation: 'CreateDocument', error: 1 })
    const prometheus = metrics.renderPrometheus()
    expect(prometheus).toContain('tarca_warnings_total{hook="onDocument"} 1')
    expect(prometheus).not.toContain('tarca_lock_errors_total')
  })

  test('a figyelmeztetés hibáját redact: false esetén teljesen, egyébként csak a nevével naplózza', () => {
    const open = recordingLogger()
    const closed = recordingLogger()
    const warning = {
      hook: 'onComplete' as const,
      operation: 'GetDocument' as const,
      error: 'nyers szöveg titok@pelda.hu',
    }
    observe({ logger: open.logger, redact: false }).onWarning?.(warning)
    observe({ logger: closed.logger }).onWarning?.(warning)
    expect(open.lines[0]?.data).toMatchObject({
      errorName: 'string',
      errorMessage: 'nyers szöveg titok@pelda.hu',
    })
    expect(open.lines[0]?.message).toBe('tarca: figyelmeztetés (onComplete)')
    expect(closed.lines[0]?.data).toEqual({
      event: 'tarca.warning',
      hook: 'onComplete',
      operation: 'GetDocument',
      errorName: 'string',
    })
  })

  test('megszakított kérésnél is lezárja a spant, és error kimenettel számolja', async () => {
    const tracer = recordingTracer()
    const metrics = createMetricsRegistry()
    const controller = new AbortController()
    const tarca = createTarca({
      apiKey: KEY,
      fetch: async () => {
        controller.abort(new Error('mégse'))
        throw controller.signal.reason
      },
      hooks: observe({ tracer, metrics }),
    })

    await expect(tarca.organization.get({ signal: controller.signal })).rejects.toThrow('mégse')
    expect(tracer.spans[0]?.ended).toBe(1)
    expect(tracer.spans[0]?.status).toEqual({ code: SPAN_STATUS_ERROR })
    expect(metrics.renderPrometheus()).toContain(
      'tarca_requests_total{operation="GetOrganizationData",outcome="error"} 1',
    )
  })

  test('a hibás tracer, logger vagy metrika sem töri meg a kérést', async () => {
    const boom = () => {
      throw new Error('rossz eszköz')
    }
    const warnings: unknown[] = []
    const hooks = combineHooks(
      observe({
        tracer: { startSpan: boom },
        logger: { info: boom, warn: boom, debug: boom },
        metrics: { counter: boom, histogram: boom },
        logRequests: true,
      }),
      { onWarning: (warning) => warnings.push(warning) },
    )
    const { tarca } = setup(hooks)
    await expect(tarca.documents.createOnce(INVOICE)).resolves.toMatchObject({ created: true })
    expect(warnings).toEqual([])
  })

  test('a dobó span is lezárul, nem marad nyitva', async () => {
    const tracer = recordingTracer()
    const broken: ObserveTracer = {
      startSpan(name, options) {
        const span = tracer.startSpan(name, options)
        return {
          ...span,
          setStatus: () => {
            throw new Error('rossz span')
          },
        }
      },
    }
    const { tarca } = setup(observe({ tracer: broken }))
    await tarca.organization.get()
    await tarca.organization.get()
    expect(tracer.spans.map((span) => span.ended)).toEqual([1, 1])
  })

  test('a logRequests a kérés indulását is naplózza', async () => {
    const { lines, logger } = recordingLogger()
    const { tarca } = setup(observe({ logger, logRequests: true }))
    await tarca.organization.get()
    expect(lines.map((line) => [line.level, line.data.event])).toEqual([
      ['debug', 'tarca.request.start'],
      ['info', 'tarca.request'],
    ])
    expect(lines[0]?.data).toEqual({
      event: 'tarca.request.start',
      operation: 'GetOrganizationData',
      method: 'GET',
      path: '/organization',
      attempt: 1,
      requestId: expect.any(String),
    })
  })

  test('sok nyitva maradt span sem nő korlát nélkül', () => {
    const tracer = recordingTracer()
    const hooks = observe({ tracer })
    for (let index = 0; index < MAX_OPEN_SPANS + 5; index++) {
      hooks.onRequest?.({
        operation: 'GetDocument',
        method: 'GET',
        path: '/documents/{id}',
        attempt: 1,
        requestId: `r${index}`,
      })
    }
    expect(tracer.spans.filter((span) => span.ended === 1)).toHaveLength(5)
    expect(tracer.spans.slice(0, 5).every((span) => span.ended === 1)).toBe(true)
  })

  test('a lezárt spant elfelejti: sok befejezett kérés után sincs kétszer lezárt span', () => {
    const tracer = recordingTracer()
    const hooks = observe({ tracer })
    for (let index = 0; index < MAX_OPEN_SPANS + 5; index++) {
      const event = { ...completeEvent(undefined), requestId: `r${index}` }
      hooks.onRequest?.(event)
      hooks.onComplete?.(event)
    }
    expect(tracer.spans).toHaveLength(MAX_OPEN_SPANS + 5)
    expect(tracer.spans.every((span) => span.ended === 1)).toBe(true)
  })

  test('console loggerrel sem dob', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { tarca } = setup(observe({ logger: console }))
    await tarca.organization.get()
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tarca.request', operation: 'GetOrganizationData' }),
      expect.stringContaining('sikeres'),
    )
    info.mockRestore()
  })
})

describe('combineHooks', () => {
  test('minden hookot meghív, az onDocument-et sorban, és a hibát a végén dobja', async () => {
    const calls: string[] = []
    const first = {
      onDocument: async () => {
        await Promise.resolve()
        calls.push('napló')
        throw new Error('napló hiba')
      },
      onRequest: () => {
        calls.push('a')
      },
    }
    const second = {
      onDocument: () => {
        calls.push('logger')
      },
      onRequest: () => {
        calls.push('b')
        throw new Error('b hiba')
      },
      onDocumentError: 'throw' as const,
    }
    const combined = combineHooks(first, undefined, second, { onDocumentError: 'warn' as const })

    expect(() =>
      combined.onRequest?.({
        operation: 'GetDocument',
        method: 'GET',
        path: '/documents/{id}',
        attempt: 1,
        requestId: 'x',
      }),
    ).toThrow('b hiba')
    await expect(Promise.resolve(combined.onDocument?.({} as never))).rejects.toThrow('napló hiba')
    expect(calls).toEqual(['a', 'b', 'napló', 'logger'])
    expect(combined.onDocumentError).toBe('warn')
    expect(combineHooks()).toEqual({})
    expect(combineHooks(undefined, { onRequest: undefined })).toEqual({})
  })

  test('több hibánál az elsőt dobja, eseménynél és onDocument-nél is', async () => {
    const thrower = (message: string) => () => {
      throw new Error(message)
    }
    const combined = combineHooks(
      { onComplete: thrower('első'), onDocument: thrower('első napló') },
      { onComplete: thrower('második'), onDocument: thrower('második napló') },
    )
    expect(() => combined.onComplete?.(completeEvent(undefined))).toThrow('első')
    await expect(Promise.resolve(combined.onDocument?.({} as never))).rejects.toThrow('első napló')
  })

  test('ha egy kezelő szinkron dob, a másik aszinkron elutasítása sem marad kezeletlen', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const combined = combineHooks(
        {
          onComplete: async () => {
            throw new Error('aszinkron')
          },
        },
        {
          onComplete: () => {
            throw new Error('szinkron')
          },
        },
      )
      expect(() => combined.onComplete?.(completeEvent(undefined))).toThrow('szinkron')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  test('a nem függvény értékű, ismeretlen kulcsnál is az utolsó érvényes', () => {
    const first = { onRequest: undefined, futureSetting: 'első' }
    const last = { onRequest: undefined, futureSetting: 'utolsó' }
    const combined: Record<string, unknown> = { ...combineHooks(first, last) }
    expect(combined.futureSetting).toBe('utolsó')
  })

  test('az onDocumentError beállítás, nem esemény: függvényként is az utolsó érvényes', () => {
    const first = { onRequest: undefined, onDocumentError: () => undefined }
    const last = { onRequest: undefined, onDocumentError: () => undefined }
    expect(combineHooks(first, last, { onDocumentError: undefined }).onDocumentError).toBe(
      last.onDocumentError,
    )
  })

  test('az ismeretlen, jövőbeli hookkulcsot is láncolja', () => {
    const calls: string[] = []
    const future = { onRequest: undefined, onFuture: (event: string) => calls.push(`1:${event}`) }
    const other = { onRequest: undefined, onFuture: (event: string) => calls.push(`2:${event}`) }
    const combined: Record<string, unknown> = { ...combineHooks(future, other) }
    const handler = combined.onFuture
    if (typeof handler !== 'function') throw new Error('a hook hiányzik')
    handler('x')
    expect(calls).toEqual(['1:x', '2:x'])
  })

  test('az aszinkron hook elutasítását a kliens onWarning-ja kapja meg, nem marad kezeletlen', async () => {
    const warnings: unknown[] = []
    const { tarca } = setup(
      combineHooks(
        {
          onComplete: async () => {
            throw new Error('aszinkron hiba')
          },
        },
        { onComplete: () => undefined, onWarning: (warning) => warnings.push(warning) },
      ),
    )
    await tarca.organization.get()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warnings).toEqual([
      expect.objectContaining({ hook: 'onComplete', error: expect.any(Error) }),
    ])
  })

  test('a kliens onDocument eseményét a napló és az observe is megkapja', async () => {
    const metrics = createMetricsRegistry()
    const { lines, logger } = recordingLogger()
    const journal = createJournal(memoryJournal(), { now: () => NOW })
    const { tarca } = setup(
      combineHooks(observe({ metrics, logger, refSalt: 's' }), {
        onDocument: (event) => journal.record(event),
      }),
    )

    const { document } = await tarca.documents.createOnce(INVOICE)
    await tarca.receipts.createOnce({
      vendorId: 'OBS-2',
      items: [{ name: 'Tagdíj', grossUnitPrice: 5_000, vat: 27 }],
    })

    const prometheus = metrics.renderPrometheus()
    expect(prometheus).toContain('tarca_documents_total{action="created",type="invoice"} 1')
    expect(prometheus).toContain('tarca_documents_total{action="created",type="receipt"} 1')
    const logged = lines.filter((line) => line.data.event === 'tarca.document')
    expect(logged.map((line) => line.data)).toEqual([
      {
        event: 'tarca.document',
        type: 'invoice',
        action: 'created',
        operation: 'CreateDocument',
        documentId: document.id,
        number: document.invoiceNumber,
        vendorRef: expect.stringMatching(/^hmac:[0-9a-f]{16}$/),
      },
      expect.objectContaining({ type: 'receipt', operation: 'CreateReceipt' }),
    ])
    expect(JSON.stringify(lines)).not.toContain('OBS-')
    const entries = await journal.entries({ from: '2026-11-01', to: '2026-11-30' })
    expect(entries.map((entry) => [entry.vendorId, entry.source])).toEqual([
      ['OBS-1', 'hook'],
      ['OBS-2', 'hook'],
    ])
  })

  test('a kliensben az observe és a saját hook együtt fut', async () => {
    const metrics = createMetricsRegistry()
    const seen: string[] = []
    const { tarca } = setup(
      combineHooks(observe({ metrics }), {
        onComplete: (event) => {
          seen.push(event.operation)
        },
      }),
    )
    await tarca.organization.get()
    expect(seen).toEqual(['GetOrganizationData'])
    expect(metrics.renderPrometheus()).toContain(
      'tarca_requests_total{operation="GetOrganizationData",outcome="success"} 1',
    )
  })
})
