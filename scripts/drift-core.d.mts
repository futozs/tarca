export interface DriftChange {
  readonly name: string
  readonly kind: 'new' | 'changed' | 'missing'
  readonly detail: string
}
export interface KnownOperation {
  readonly id: string
  readonly method: string
  readonly path: string
  readonly spec?: string
}
export declare function sha256(content: string): string
export declare function changelogVersions(html: string): string[]
export declare function sourceOperations(operationsSource: string): KnownOperation[]
export declare function probePath(path: string): string
export declare function routeExists(status: number): boolean
export declare function compareSnapshots(
  locked: Record<string, unknown>,
  current: Record<string, unknown>,
): DriftChange[]
export declare function consistencyProblems(input: {
  readonly specOperations: readonly KnownOperation[]
  readonly knownOperations: readonly KnownOperation[]
  readonly missingRoutes: readonly string[]
}): string[]
export declare function renderReport(
  changes: readonly DriftChange[],
  problems: readonly string[],
): string
