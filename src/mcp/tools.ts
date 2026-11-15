import type { McpTool } from './tool-kit'
import { ACTION_TOOLS } from './tools-actions'
import { DOCUMENT_TOOLS } from './tools-documents'
import { LOOKUP_TOOLS } from './tools-lookup'
import { RECEIPT_TOOLS } from './tools-receipts'

export const TARCA_MCP_TOOLS: readonly McpTool[] = [
  ...DOCUMENT_TOOLS,
  ...RECEIPT_TOOLS,
  ...ACTION_TOOLS,
  ...LOOKUP_TOOLS,
]
