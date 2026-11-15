export interface OperationCounts {
  readonly total: number
  readonly article: 'a' | 'az'
  readonly undocumented: number
}

export function hungarianArticle(count: number): 'a' | 'az'

export function loadOperationCounts(): Promise<OperationCounts>
