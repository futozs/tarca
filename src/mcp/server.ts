import { createTarca, type Tarca, type TarcaOptions } from '../client'
import type { ErrorEvent } from '../core/context'
import { configurationError, isBillingoError } from '../core/errors'
import { TARCA_VERSION } from '../core/version'
import { resolveDefaults } from '../documents/defaults'
import { DEFAULT_RECOVERY_DELAY_MS } from '../documents/once'
import { ToolInputError } from './arguments'
import { createConfirmations } from './confirmation'
import {
  failure,
  isJsonObject,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  type JsonObject,
  type JsonRpcResponse,
  MCP_LEGACY_VERSIONS,
  MCP_MODERN_VERSIONS,
  MCP_SUPPORTED_VERSIONS,
  MCP_UNSUPPORTED_PROTOCOL_VERSION,
  McpProtocolError,
  type McpRequest,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  parseMcpMessage,
  protocolFailure,
  success,
} from './protocol'
import { type McpTool, type McpToolContext, plainJson } from './tool-kit'
import { TARCA_MCP_TOOLS } from './tools'

export interface TarcaMcpServerOptions extends TarcaOptions {
  readonly allowWrite?: boolean | undefined
  readonly confirmationSecret?: string | Uint8Array | undefined
  readonly confirmationTtlMs?: number | undefined
  readonly recoveryDelayMs?: number | undefined
  readonly now?: (() => Date) | undefined
}

export interface McpToolInfo {
  readonly name: string
  readonly title: string
  readonly write: boolean
}

export interface McpConnectOptions {
  readonly protocolVersion?: string | undefined
}

export interface McpConnection {
  handle(message: unknown): Promise<JsonRpcResponse | readonly JsonRpcResponse[] | undefined>
  handleLine(line: string): Promise<string | undefined>
}

export interface TarcaMcpServer {
  readonly tools: readonly McpToolInfo[]
  readonly allowWrite: boolean
  readonly hasConfirmationSecret: boolean
  connect(options?: McpConnectOptions): McpConnection
}

export interface McpToolError {
  readonly category: string
  readonly status: number | null
  readonly retryable: boolean
  readonly traceId: string | null
  readonly fields: readonly string[]
}

interface Session {
  legacyVersion: string | undefined
}

const SERVER_INFO: JsonObject = {
  name: 'tarca',
  title: 'tarca: Billingo számlák és nyugták',
  version: TARCA_VERSION,
}

const LIST_TTL_MS = 3_600_000

const INSTRUCTIONS = [
  'A tárca a Billingo API v3-on keresztül kérdez le és állít ki számlákat, díjbekérőket és nyugtákat. Független, nyílt forráskódú projekt, nem a Billingo terméke.',
  'Kezdd a get_profile eszközzel: megmutatja, hogy fejlesztői teszt vagy éles profilon dolgozol, és milyen számlatömbök és bankszámlák vannak.',
  'Minden írás előtt hívd meg a megfelelő előnézeti eszközt (preview_document, preview_receipt, preview_cancellation, preview_payment, preview_send), mutasd meg az eredményt a felhasználónak, és csak a kifejezett jóváhagyása után hívd az író eszközt a kapott confirmation kóddal, pontosan ugyanazokkal az adatokkal.',
  'Az író eszközök csak akkor érhetők el, ha a szervert TARCA_MCP_ALLOW_WRITE=1 beállítással vagy a tarca mcp --allow-write kapcsolóval indították. Próbához fejlesztői teszt profilt ajánlunk: éles profilon a kiállított számlát a Billingo jelenti a NAV-nak, és csak sztornózni lehet.',
].join(' ')

const WRITE_DISABLED_MESSAGE =
  'Az író eszközök ki vannak kapcsolva, semmi nem történt. A kiállításhoz, sztornóhoz, befizetéshez és kiküldéshez indítsd a szervert a TARCA_MCP_ALLOW_WRITE=1 környezeti változóval (vagy a tarca mcp --allow-write kapcsolóval).'

function describeError(error: unknown): { readonly text: string; readonly info: McpToolError } {
  if (error instanceof ToolInputError) {
    return {
      text: error.message,
      info: {
        category: error.category,
        status: null,
        retryable: false,
        traceId: null,
        fields: error.fields,
      },
    }
  }
  if (isBillingoError(error)) {
    return {
      text: error.hint ? `${error.message}\nTipp: ${error.hint}` : error.message,
      info: {
        category: error.category,
        status: error.status ?? null,
        retryable: error.retryable,
        traceId: error.traceId ?? null,
        fields: error.fieldErrors.map((entry) => entry.field),
      },
    }
  }
  if (error instanceof RangeError) {
    return {
      text: error.message,
      info: {
        category: 'invalid_input',
        status: null,
        retryable: false,
        traceId: null,
        fields: [],
      },
    }
  }
  return {
    text: `Váratlan hiba: ${error instanceof Error ? error.message : String(error)}`,
    info: { category: 'internal', status: null, retryable: false, traceId: null, fields: [] },
  }
}

function toolError(text: string, info: McpToolError): JsonObject {
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify({ error: info }) },
    ],
    isError: true,
  }
}

function modernVersionOf(params: JsonObject): string | undefined {
  const meta = params._meta
  if (!isJsonObject(meta) || !(META_PROTOCOL_VERSION in meta)) return undefined
  const version = meta[META_PROTOCOL_VERSION]
  if (typeof version !== 'string' || version.trim() === '') {
    throw new McpProtocolError(
      JSON_RPC_INVALID_PARAMS,
      `A _meta["${META_PROTOCOL_VERSION}"] mezőnek nem üres szövegnek kell lennie.`,
    )
  }
  if (!MCP_MODERN_VERSIONS.includes(version)) {
    throw new McpProtocolError(MCP_UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
      data: { supported: [...MCP_SUPPORTED_VERSIONS], requested: version },
    })
  }
  if (!isJsonObject(meta[META_CLIENT_CAPABILITIES])) {
    throw new McpProtocolError(
      JSON_RPC_INVALID_PARAMS,
      `Hiányzik a kötelező _meta["${META_CLIENT_CAPABILITIES}"] mező.`,
    )
  }
  return version
}

function toolDefinition(tool: McpTool): JsonObject {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, ...tool.annotations },
  }
}

function resolveRecoveryDelay(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RECOVERY_DELAY_MS
  if (!Number.isFinite(value) || value < 0) {
    throw configurationError(
      `A recoveryDelayMs értéke nemnegatív szám legyen, kapott: ${String(value)}`,
    )
  }
  return value
}

export function createTarcaMcpServer(options: TarcaMcpServerOptions = {}): TarcaMcpServer {
  const allowWrite = options.allowWrite === true
  const now = options.now ?? (() => new Date())
  const recoveryDelayMs = resolveRecoveryDelay(options.recoveryDelayMs)
  const defaults = resolveDefaults(options.defaults)
  const confirmations = createConfirmations({
    secret: options.confirmationSecret,
    ttlMs: options.confirmationTtlMs,
    now,
  })
  let client: Tarca | undefined
  const context: McpToolContext = {
    client: () => {
      client ??= createTarca(options)
      return client
    },
    observedClient: () => {
      const errors: ErrorEvent[] = []
      const onError = options.hooks?.onError
      const tarca = createTarca({
        ...options,
        hooks: {
          ...options.hooks,
          onError: (event) => {
            errors.push(event)
            onError?.(event)
          },
        },
      })
      return { tarca, errors }
    },
    defaults,
    confirmations,
    now,
    recoveryDelayMs,
  }
  const visibleTools = TARCA_MCP_TOOLS.filter((tool) => allowWrite || !tool.write)

  const listTools = (params: JsonObject): JsonObject => {
    if (params.cursor !== undefined) {
      throw new McpProtocolError(
        JSON_RPC_INVALID_PARAMS,
        'Érvénytelen cursor: az eszközlista egyetlen oldalból áll.',
      )
    }
    return { tools: visibleTools.map(toolDefinition) }
  }

  const callTool = async (params: JsonObject): Promise<JsonObject> => {
    const name = params.name
    if (typeof name !== 'string') {
      throw new McpProtocolError(JSON_RPC_INVALID_PARAMS, 'Hiányzik az eszköz neve (name).')
    }
    const tool = TARCA_MCP_TOOLS.find((candidate) => candidate.name === name)
    if (!tool) throw new McpProtocolError(JSON_RPC_INVALID_PARAMS, `Ismeretlen eszköz: ${name}`)
    const args = params.arguments ?? {}
    if (!isJsonObject(args)) {
      throw new McpProtocolError(
        JSON_RPC_INVALID_PARAMS,
        'Az arguments mezőnek objektumnak kell lennie.',
      )
    }
    if (tool.write && !allowWrite) {
      return toolError(WRITE_DISABLED_MESSAGE, {
        category: 'write_disabled',
        status: null,
        retryable: false,
        traceId: null,
        fields: [],
      })
    }
    try {
      const output = await tool.run(args, context)
      const data = plainJson(output.data)
      return {
        content: [
          { type: 'text', text: output.summary },
          { type: 'text', text: JSON.stringify(data, null, 2) },
        ],
        structuredContent: data,
        isError: false,
      }
    } catch (error) {
      const { text, info } = describeError(error)
      return toolError(text, info)
    }
  }

  const modern = async (request: McpRequest): Promise<JsonObject> => {
    const meta = { [META_SERVER_INFO]: SERVER_INFO }
    switch (request.method) {
      case 'server/discover':
        return {
          resultType: 'complete',
          supportedVersions: [...MCP_SUPPORTED_VERSIONS],
          capabilities: { tools: {} },
          instructions: INSTRUCTIONS,
          ttlMs: LIST_TTL_MS,
          cacheScope: 'private',
          _meta: meta,
        }
      case 'tools/list':
        return {
          resultType: 'complete',
          ...listTools(request.params),
          ttlMs: LIST_TTL_MS,
          cacheScope: 'private',
          _meta: meta,
        }
      case 'tools/call':
        return { resultType: 'complete', ...(await callTool(request.params)), _meta: meta }
      default:
        throw new McpProtocolError(
          JSON_RPC_METHOD_NOT_FOUND,
          `Ismeretlen metódus: ${request.method}`,
        )
    }
  }

  const initialize = (request: McpRequest, session: Session): JsonObject => {
    const requested = request.params.protocolVersion
    if (typeof requested !== 'string') {
      throw new McpProtocolError(JSON_RPC_INVALID_PARAMS, 'Hiányzik a protocolVersion mező.')
    }
    const version = MCP_LEGACY_VERSIONS.includes(requested)
      ? requested
      : (MCP_LEGACY_VERSIONS[0] ?? requested)
    session.legacyVersion = version
    return {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    }
  }

  const legacy = async (request: McpRequest, session: Session): Promise<JsonObject> => {
    if (request.method === 'ping') return {}
    if (session.legacyVersion === undefined) {
      throw new McpProtocolError(
        JSON_RPC_INVALID_PARAMS,
        `Hiányzik a kötelező _meta["${META_PROTOCOL_VERSION}"] mező. 2026-07-28 előtti protokollnál előbb initialize kérést kell küldeni.`,
      )
    }
    if (request.method === 'tools/list') return listTools(request.params)
    if (request.method === 'tools/call') return callTool(request.params)
    throw new McpProtocolError(JSON_RPC_METHOD_NOT_FOUND, `Ismeretlen metódus: ${request.method}`)
  }

  const respond = async (request: McpRequest, session: Session): Promise<JsonRpcResponse> => {
    try {
      if (request.method === 'initialize') return success(request.id, initialize(request, session))
      const version = modernVersionOf(request.params)
      const result = version === undefined ? await legacy(request, session) : await modern(request)
      return success(request.id, result)
    } catch (error) {
      if (error instanceof McpProtocolError) {
        return failure(request.id, error.code, error.message, error.data)
      }
      return failure(request.id, JSON_RPC_INTERNAL_ERROR, 'Belső hiba a tárca MCP szerverben.')
    }
  }

  const handleSingle = async (
    message: unknown,
    session: Session,
  ): Promise<JsonRpcResponse | undefined> => {
    try {
      const parsed = parseMcpMessage(message)
      if (parsed.kind !== 'request') return undefined
      return await respond(parsed, session)
    } catch (error) {
      if (error instanceof McpProtocolError) return protocolFailure(error)
      return failure(null, JSON_RPC_INTERNAL_ERROR, 'Belső hiba a tárca MCP szerverben.')
    }
  }

  return {
    tools: TARCA_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      write: tool.write,
    })),
    allowWrite,
    hasConfirmationSecret: options.confirmationSecret !== undefined,
    connect(connectOptions = {}) {
      const requested = connectOptions.protocolVersion
      const session: Session = {
        legacyVersion:
          requested !== undefined && MCP_LEGACY_VERSIONS.includes(requested)
            ? requested
            : undefined,
      }
      const handle = async (
        message: unknown,
      ): Promise<JsonRpcResponse | readonly JsonRpcResponse[] | undefined> => {
        if (!Array.isArray(message)) return handleSingle(message, session)
        if (message.length === 0) {
          return failure(null, JSON_RPC_INVALID_REQUEST, 'Az üres batch érvénytelen.')
        }
        const responses: JsonRpcResponse[] = []
        for (const entry of message) {
          const response = await handleSingle(entry, session)
          if (response) responses.push(response)
        }
        return responses.length === 0 ? undefined : responses
      }
      return {
        handle,
        async handleLine(line) {
          const trimmed = line.trim()
          if (trimmed === '') return undefined
          let message: unknown
          try {
            message = JSON.parse(trimmed)
          } catch {
            return JSON.stringify(failure(null, JSON_RPC_PARSE_ERROR, 'Érvénytelen JSON.'))
          }
          const response = await handle(message)
          return response === undefined ? undefined : JSON.stringify(response)
        },
      }
    },
  }
}
