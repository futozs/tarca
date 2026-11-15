import * as batch from '../dist/batch/index.js'
import * as root from '../dist/index.js'
import * as journal from '../dist/journal/index.js'
import * as mcp from '../dist/mcp/index.js'
import * as observe from '../dist/observe/index.js'
import * as paymentsBarion from '../dist/payments/barion.js'
import * as payments from '../dist/payments/index.js'
import * as paymentsPayPal from '../dist/payments/paypal.js'
import * as paymentsRevolut from '../dist/payments/revolut.js'
import * as paymentsSimplePay from '../dist/payments/simplepay.js'
import * as paymentsStripe from '../dist/payments/stripe.js'
import * as storage from '../dist/storage/index.js'
import * as stores from '../dist/stores/index.js'
import * as testing from '../dist/testing/index.js'
import { runSmoke } from './smoke-core.mjs'

export default {
  async fetch() {
    try {
      const checks = await runSmoke({
        root,
        testing,
        batch,
        observe,
        storage,
        stores,
        journal,
        mcp,
        payments,
        paymentsStripe,
        paymentsSimplePay,
        paymentsBarion,
        paymentsRevolut,
        paymentsPayPal,
      })
      return Response.json({ ok: true, checks })
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        },
        { status: 500 },
      )
    }
  },
}
