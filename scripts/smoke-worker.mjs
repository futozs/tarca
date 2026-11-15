import * as root from '../dist/index.js'
import { runSmoke } from './smoke-core.mjs'

export default {
  async fetch() {
    try {
      const checks = await runSmoke({ root })
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
