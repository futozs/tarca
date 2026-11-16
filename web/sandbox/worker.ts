import type { WorkerMessage, WorkerRequest } from './runtime/protocol'
import { runSandboxCode } from './runtime/run'
import { serialize } from './runtime/serialize'

const scope = self as unknown as {
  postMessage(message: WorkerMessage): void
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: PromiseRejectionEvent) => void,
  ): void
}

let activeRunId = 0

scope.addEventListener('unhandledrejection', (event) => {
  event.preventDefault()
  scope.postMessage({
    type: 'console',
    runId: activeRunId,
    entry: {
      level: 'error',
      args: [{ t: 'string', v: 'Kezeletlen Promise hiba:' }, serialize(event.reason)],
      time: 0,
    },
  })
})

scope.addEventListener('message', async (event) => {
  const request = event.data
  if (request.type !== 'run') return
  activeRunId = request.runId
  const result = await runSandboxCode(
    request.code,
    {
      onConsole: (entry) => scope.postMessage({ type: 'console', runId: request.runId, entry }),
      onRequest: (call) =>
        scope.postMessage({ type: 'request', runId: request.runId, request: call }),
    },
    { latencyMs: [60, 180] },
  )
  scope.postMessage({ type: 'done', runId: request.runId, result })
})

scope.postMessage({ type: 'ready' })
