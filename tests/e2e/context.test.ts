import { describe, expect, test } from 'vitest'
import type { Tarca } from '../../src/client'
import type { RequestEvent } from '../../src/core/context'
import { BillingoError } from '../../src/core/errors'
import type { OperationId } from '../../src/core/operations'
import { createE2eRun, type StepRegistrar } from './context'

class Skipped extends Error {}

interface Registered {
  readonly name: string
  readonly run: (skip: () => never) => Promise<void>
}

function collectingRun(email?: string) {
  const steps: Registered[] = []
  const register: StepRegistrar = (name, run) => {
    steps.push({ name, run })
  }
  const run = createE2eRun({ taxCode: '12345678', email, runId: 'TESZT', register })
  const execute = async (index: number): Promise<'ok' | 'skipped' | unknown> => {
    const step = steps[index]
    if (!step) throw new Error(`Nincs ${index}. lépés`)
    try {
      await step.run(() => {
        throw new Skipped()
      })
      return 'ok'
    } catch (error) {
      return error instanceof Skipped ? 'skipped' : error
    }
  }
  return { run, steps, execute }
}

function request(operation: OperationId): RequestEvent {
  return { operation, method: 'GET', path: '/', attempt: 1, requestId: 'r' }
}

describe('az e2e futás környezete', () => {
  test('a nevek és a vendorId a futás azonosítóját hordozzák', () => {
    const ctx = collectingRun().run.group('a')

    expect(ctx.name()).toBe('TARCA-E2E TESZT')
    expect(ctx.name('módosítva')).toBe('TARCA-E2E TESZT módosítva')
    expect(ctx.vendorId('szamla')).toBe('TARCA-E2E-TESZT-szamla')
    expect(ctx.runId).toBe('TESZT')
    expect(ctx.taxCode).toBe('12345678')
  })

  test('a hiányzó előzmény, e-mail és kliens hangos hiba, nem csendes kihagyás', () => {
    const ctx = collectingRun().run.group('a')

    expect(ctx.required(5, 'x')).toBe(5)
    expect(() => ctx.required(undefined, 'partner id')).toThrow('partner id')
    expect(() => ctx.email()).toThrow('BILLINGO_E2E_EMAIL')
    expect(() => ctx.tarca).toThrow('még nem jött létre')
    expect(collectingRun('cim@teszt.hu').run.group('a').email()).toBe('cim@teszt.hu')
  })

  test('a csoportok neve egyedi, és az állapotot megosztják', () => {
    const { run } = collectingRun()
    const first = run.group('a')
    first.state.partnerId = 9

    expect(run.group('b').state.partnerId).toBe(9)
    expect(() => run.group('a')).toThrow('azonos a neve')
  })

  test('a kliens a connect után érhető el', () => {
    const { run } = collectingRun()
    const tarca = {} as Tarca
    run.connect(tarca)

    expect(run.group('a').tarca).toBe(tarca)
  })
})

describe('lépésláncok', () => {
  test('a lánc az első hibánál megáll, a többi csoport fut tovább', async () => {
    const { run, execute } = collectingRun()
    const step = run.group('a').groupSteps()
    const other = run.group('b').groupSteps()
    const failure = new Error('elromlott')
    step('első', async () => {
      throw failure
    })
    step('második', async () => {})
    other('harmadik', async () => {})

    expect(await execute(0)).toBe(failure)
    expect(await execute(1)).toBe('skipped')
    expect(await execute(2)).toBe('ok')
    expect(run.fatal).toBe(false)
  })

  test('a kritikus csoport hibája és az auth, subscription, rate_limit hiba az egész futást leállítja', async () => {
    for (const [critical, error] of [
      [true, new Error('őr')],
      [false, new BillingoError('kulcs', { category: 'auth' })],
      [false, new BillingoError('csomag', { category: 'subscription' })],
      [false, new BillingoError('lassíts', { category: 'rate_limit' })],
    ] as const) {
      const { run, execute } = collectingRun()
      run.group('a').groupSteps({ critical })('hibás', async () => {
        throw error
      })
      run.group('b').groupSteps()('utána', async () => {})

      expect(await execute(0)).toBe(error)
      expect(run.fatal).toBe(true)
      expect(await execute(1)).toBe('skipped')
    }
  })

  test('a nav_unavailable és a validation hiba nem állítja le a futást', async () => {
    for (const category of ['nav_unavailable', 'validation', 'not_found'] as const) {
      const { run, execute } = collectingRun()
      run.group('a').groupSteps()('hibás', async () => {
        throw new BillingoError('x', { category })
      })

      await execute(0)
      expect(run.fatal).toBe(false)
    }
  })

  test('a műveleteket a futó lépés csoportjához is hozzárendeli', async () => {
    const { run, execute } = collectingRun()
    run.group('a').groupSteps()('kér', async () => {
      run.hooks.onRequest?.(request('GetServerTime'))
    })
    run.group('b')

    run.hooks.onRequest?.(request('GetOrganizationData'))
    await execute(0)

    expect([...run.seen]).toEqual(['GetOrganizationData', 'GetServerTime'])
    expect([...(run.seenByGroup.get('a') ?? [])]).toEqual(['GetServerTime'])
    expect([...(run.seenByGroup.get('b') ?? [])]).toEqual([])
  })
})
