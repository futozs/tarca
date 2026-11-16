import { describe, expect, it } from 'vitest'
import { withAccusative, withArticle } from './hungarian'

describe('withArticle', () => {
  it('magánhangzóval kezdődő számnév elé „az” kerül', () => {
    expect(withArticle(1)).toBe('az 1')
    expect(withArticle(5)).toBe('az 5')
    expect(withArticle(57)).toBe('az 57')
    expect(withArticle(512)).toBe('az 512')
    expect(withArticle(1200)).toBe('az 1200')
  })

  it('mássalhangzóval kezdődő számnév elé „a” kerül', () => {
    expect(withArticle(2)).toBe('a 2')
    expect(withArticle(11)).toBe('a 11')
    expect(withArticle(60)).toBe('a 60')
    expect(withArticle(150)).toBe('a 150')
    expect(withArticle(2000)).toBe('a 2000')
  })
})

describe('withAccusative', () => {
  it('a számnév utolsó tagjához illeszti a tárgyragot', () => {
    expect(withAccusative(57)).toBe('57-et')
    expect(withAccusative(2)).toBe('2-t')
    expect(withAccusative(3)).toBe('3-at')
    expect(withAccusative(5)).toBe('5-öt')
    expect(withAccusative(6)).toBe('6-ot')
    expect(withAccusative(50)).toBe('50-et')
    expect(withAccusative(60)).toBe('60-at')
    expect(withAccusative(100)).toBe('100-at')
    expect(withAccusative(1000)).toBe('1000-et')
  })
})
