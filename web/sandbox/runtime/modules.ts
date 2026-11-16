import * as tarca from 'tarcajs'
import * as batch from 'tarcajs/batch'
import * as journal from 'tarcajs/journal'
import * as observe from 'tarcajs/observe'
import * as payments from 'tarcajs/payments'
import * as barion from 'tarcajs/payments/barion'
import * as paypal from 'tarcajs/payments/paypal'
import * as revolut from 'tarcajs/payments/revolut'
import * as simplepay from 'tarcajs/payments/simplepay'
import * as stripe from 'tarcajs/payments/stripe'
import * as storage from 'tarcajs/storage'
import * as stores from 'tarcajs/stores'
import * as testing from 'tarcajs/testing'
import type { SandboxBillingo } from './billingo'

export const SANDBOX_API_KEY = 'sandbox-billingo-kulcs-0000'

export const SANDBOX_MODULE_IDS = [
  'tarcajs',
  'tarcajs/testing',
  'tarcajs/payments',
  'tarcajs/payments/stripe',
  'tarcajs/payments/simplepay',
  'tarcajs/payments/barion',
  'tarcajs/payments/revolut',
  'tarcajs/payments/paypal',
  'tarcajs/storage',
  'tarcajs/stores',
  'tarcajs/journal',
  'tarcajs/batch',
  'tarcajs/observe',
  'tarca-sandbox',
] as const

export function createSandboxModules(billingo: SandboxBillingo): Record<string, unknown> {
  const { fake } = billingo
  return {
    tarcajs: tarca,
    'tarcajs/testing': testing,
    'tarcajs/payments': payments,
    'tarcajs/payments/stripe': stripe,
    'tarcajs/payments/simplepay': simplepay,
    'tarcajs/payments/barion': barion,
    'tarcajs/payments/revolut': revolut,
    'tarcajs/payments/paypal': paypal,
    'tarcajs/storage': storage,
    'tarcajs/stores': stores,
    'tarcajs/journal': journal,
    'tarcajs/batch': batch,
    'tarcajs/observe': observe,
    'tarca-sandbox': {
      billingo: {
        fail: fake.fail,
        count: fake.count,
        counts: fake.counts,
        get data() {
          return fake.data
        },
      },
      apiKey: SANDBOX_API_KEY,
    },
  }
}

export interface SandboxGlobals {
  restore(): void
}

export function installSandboxGlobals(billingo: SandboxBillingo): SandboxGlobals {
  const scope = globalThis as unknown as {
    fetch: typeof globalThis.fetch
    process?: { env?: Record<string, string | undefined> } | undefined
  }
  const previousFetch = scope.fetch
  const previousProcess = scope.process
  const previousKey = previousProcess?.env?.BILLINGO_API_KEY
  scope.fetch = billingo.fetch
  if (previousProcess?.env) {
    previousProcess.env.BILLINGO_API_KEY = SANDBOX_API_KEY
  } else {
    scope.process = { env: { BILLINGO_API_KEY: SANDBOX_API_KEY } }
  }
  return {
    restore() {
      scope.fetch = previousFetch
      if (previousProcess?.env) {
        if (previousKey === undefined) delete previousProcess.env.BILLINGO_API_KEY
        else previousProcess.env.BILLINGO_API_KEY = previousKey
      } else {
        scope.process = previousProcess
      }
    },
  }
}
