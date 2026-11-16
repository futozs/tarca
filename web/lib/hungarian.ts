export function withArticle(count: number): string {
  const digits = String(count)
  const vowelStart = digits.startsWith('5') || count === 1 || (count >= 1000 && count < 2000)
  return `${vowelStart ? 'az' : 'a'} ${digits}`
}

const ONES_ACCUSATIVE = ['', 'et', 't', 'at', 'et', 'öt', 'ot', 'et', 'at', 'et'] as const
const TENS_ACCUSATIVE = ['', 'et', 'at', 'at', 'et', 'et', 'at', 'et', 'at', 'et'] as const

export function accusativeSuffix(count: number): string {
  const ones = count % 10
  if (ones !== 0) return ONES_ACCUSATIVE[ones] ?? 'et'
  const tens = Math.floor(count / 10) % 10
  if (tens !== 0) return TENS_ACCUSATIVE[tens] ?? 'et'
  return count % 1000 === 0 ? 'et' : 'at'
}

export function withAccusative(count: number): string {
  return `${count}-${accusativeSuffix(count)}`
}
