import type { SpecOverride } from './spec-overrides.mjs'

export declare const SWAGGERHUB_API: string
export declare const MIN_SPEC_VERSION: string
export declare const HTTP_METHODS: readonly string[]
export interface SpecOperation {
  readonly id: string
  readonly method: string
  readonly path: string
}
export declare function compareVersions(a: string, b: string): number
export declare function registryVersions(registry: unknown): string[]
export declare function trackedVersions(
  versions: readonly string[],
  defaultVersion: string,
): string[]
export declare function specOperations(spec: unknown): SpecOperation[]
export interface MergedSpec {
  readonly info: { readonly version: string }
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> }
}
export interface OverrideResult {
  readonly spec: MergedSpec
  readonly problems: readonly string[]
}
export declare function mergeRawSpecs(specs: readonly unknown[]): MergedSpec
export declare function mergeSpecs(
  specs: readonly unknown[],
  overrides?: readonly SpecOverride[],
): MergedSpec
export declare function specOverrideProblems(
  specs: readonly unknown[],
  overrides?: readonly SpecOverride[],
): readonly string[]
export declare function applySpecOverrides(
  spec: unknown,
  overrides: readonly SpecOverride[],
): OverrideResult
export declare function describeOverride(override: SpecOverride): string
export declare function canonicalJson(value: unknown): string
