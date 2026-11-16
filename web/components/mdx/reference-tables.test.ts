import { isValidElement } from 'react'
import { describe, expect, test } from 'vitest'
import { withInlineCode } from './reference-tables'

describe('referenciatáblák', () => {
  test('a backtickek közötti részből kód lesz, a többi szöveg marad', () => {
    const parts = withInlineCode('A `retryAfterMs` a `Retry-After` fejlécből jön.')

    expect(parts.filter((part) => typeof part === 'string')).toEqual([
      'A ',
      ' a ',
      ' fejlécből jön.',
    ])
    const codes = parts.flatMap((part) =>
      isValidElement<{ children: string }>(part) ? [part.props.children] : [],
    )
    expect(codes).toEqual(['retryAfterMs', 'Retry-After'])
  })

  test('backtick nélküli szöveg változatlan', () => {
    expect(withInlineCode('Nincs ilyen erőforrás.')).toEqual(['Nincs ilyen erőforrás.'])
  })
})
