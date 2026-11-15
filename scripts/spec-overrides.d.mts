export type SpecOverrideSource = 'probe' | 'mcp' | 'e2e' | 'route-probe'

export interface SpecOverrideEvidence {
  readonly source: SpecOverrideSource
  readonly ref: string
  readonly date: string
}

interface SpecOverrideBase {
  readonly reason: string
  readonly evidence: readonly SpecOverrideEvidence[]
}

export interface NullableOverride extends SpecOverrideBase {
  readonly kind: 'nullable'
  readonly schema: string
  readonly properties: readonly string[]
}

export interface RequiredOverride extends SpecOverrideBase {
  readonly kind: 'required'
  readonly schema: string
  readonly properties: readonly string[]
}

export interface RenameOverride extends SpecOverrideBase {
  readonly kind: 'rename'
  readonly schema: string
  readonly from: string
  readonly to: string
}

export interface StatusOverride extends SpecOverrideBase {
  readonly kind: 'status'
  readonly operation: string
  readonly from: string
  readonly to: string
}

export interface ResponseOverride extends SpecOverrideBase {
  readonly kind: 'response'
  readonly operation: string
  readonly status: string
  readonly response: Readonly<Record<string, unknown>>
}

export interface ContentOverride extends SpecOverrideBase {
  readonly kind: 'content'
  readonly operation: string
  readonly status: string
  readonly mediaType: string
  readonly schema: Readonly<Record<string, unknown>>
  readonly replaces?: string
}

export interface SchemaOverride extends SpecOverrideBase {
  readonly kind: 'schema'
  readonly name: string
  readonly basedOn?: string
  readonly schema: Readonly<Record<string, unknown>>
}

export interface OperationOverride extends SpecOverrideBase {
  readonly kind: 'operation'
  readonly path: string
  readonly method: string
  readonly operation: Readonly<Record<string, unknown>> & { readonly operationId: string }
}

export type SpecOverride =
  | NullableOverride
  | RequiredOverride
  | RenameOverride
  | StatusOverride
  | ResponseOverride
  | ContentOverride
  | SchemaOverride
  | OperationOverride

export declare const SPEC_OVERRIDES: readonly SpecOverride[]
