import { createTarca, type Tarca } from '../src/client'
import type {
  JsonRpcResponse,
  McpConnection,
  TarcaMcpServer,
  TarcaMcpServerOptions,
} from '../src/mcp'
import { createTarcaMcpServer } from '../src/mcp'
import {
  createFakeBillingoFetch,
  type FakeBillingo,
  type FakeBillingoOptions,
} from '../src/testing'
import { TEST_API_KEY } from './helpers'

export const MCP_NOW = (): Date => new Date('2026-11-16T09:00:00.000Z')

export const MCP_TODAY = '2026-11-16'

export const MCP_SECRET = 'tarca-teszt-titok'

export const MODERN_META: Readonly<Record<string, unknown>> = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'tarca-teszt', version: '1.0.0' },
}

export interface McpToolErrorBlock {
  readonly category: string
  readonly status: number | null
  readonly retryable: boolean
  readonly traceId: string | null
  readonly fields: readonly string[]
}

export interface McpCallResult {
  readonly isError: boolean
  readonly summary: string
  readonly text: string
  readonly data: Record<string, unknown>
  readonly error: McpToolErrorBlock | undefined
  readonly structured: boolean
  readonly blocks: number
}

export interface McpHarness {
  readonly billingo: FakeBillingo
  readonly tarca: Tarca
  readonly server: TarcaMcpServer
  readonly connection: McpConnection
  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse>
  call(name: string, args?: Record<string, unknown>): Promise<McpCallResult>
  writes(): number
}

let nextId = 1

interface RawToolResult {
  readonly isError: boolean
  readonly content: readonly { readonly text: string }[]
  readonly structuredContent?: Record<string, unknown>
}

export function toolResultOf(response: JsonRpcResponse): McpCallResult {
  if (!('result' in response)) throw new Error(`Protokollhiba: ${response.error.message}`)
  const result = response.result as unknown as RawToolResult
  const second = result.content[1]?.text
  return {
    isError: result.isError,
    summary: result.content[0]?.text ?? '',
    text: result.content.map((block) => block.text).join('\n'),
    data: result.structuredContent ?? {},
    error:
      result.isError && second !== undefined
        ? (JSON.parse(second) as { error: McpToolErrorBlock }).error
        : undefined,
    structured: result.structuredContent !== undefined,
    blocks: result.content.length,
  }
}

export function mcpHarness(
  options: Partial<TarcaMcpServerOptions> = {},
  fakeOptions: FakeBillingoOptions = {},
): McpHarness {
  const billingo = createFakeBillingoFetch({ now: MCP_NOW, ...fakeOptions })
  const server = createTarcaMcpServer({
    apiKey: TEST_API_KEY,
    fetch: billingo.fetch,
    retryDelayMs: 0,
    recoveryDelayMs: 0,
    now: MCP_NOW,
    confirmationSecret: MCP_SECRET,
    ...options,
  })
  const tarca = createTarca({ apiKey: TEST_API_KEY, fetch: billingo.fetch, retryDelayMs: 0 })
  const connection = server.connect()
  const request = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<JsonRpcResponse> => {
    const response = await connection.handle({
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params: { ...params, _meta: MODERN_META },
    })
    if (response === undefined || Array.isArray(response)) {
      throw new Error('Egyetlen JSON-RPC választ vártunk.')
    }
    return response as JsonRpcResponse
  }
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<McpCallResult> =>
    toolResultOf(await request('tools/call', { name, arguments: args }))
  const writes = (): number =>
    billingo.requests.filter((entry) => entry.method !== 'GET' && entry.method !== 'HEAD').length
  return { billingo, tarca, server, connection, request, call, writes }
}

export interface ListedTool {
  readonly name: string
  readonly inputSchema: { readonly type: string }
  readonly annotations: Readonly<Record<string, boolean | string>>
}

export function toolsOf(response: JsonRpcResponse): readonly ListedTool[] {
  if (!('result' in response)) throw new Error(`Protokollhiba: ${response.error.message}`)
  const tools = response.result.tools
  if (!Array.isArray(tools)) throw new Error('A válaszban nincs tools tömb.')
  return tools as readonly ListedTool[]
}
