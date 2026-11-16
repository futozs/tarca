import { describe, expect, test } from 'vitest'
import {
  ogDescriptionLimit,
  ogRouteLines,
  ogTitleSize,
  tornLeafPath,
  truncateText,
} from './og-image'

describe('OG kép segédfüggvények', () => {
  test('a rövid szöveget változatlanul hagyja', () => {
    expect(truncateText('  Számla kiállítása  ', 40)).toBe('Számla kiállítása')
  })

  test('a hosszú szöveget szóhatáron vágja, írásjel nélkül zárja', () => {
    expect(truncateText('Újrapróbálás, korlátok, Retry-After és a 202-es válasz', 30)).toBe(
      'Újrapróbálás, korlátok…',
    )
  })

  test('szóköz nélküli szövegnél a limitnél vág', () => {
    expect(truncateText('a'.repeat(20), 10)).toBe(`${'a'.repeat(10)}…`)
  })

  test('a cím hosszával csökken a betűméret és a leírás hossza', () => {
    expect(ogTitleSize('Pontosan egyszer')).toBe(72)
    expect(ogTitleSize('Díjbekérőből számla fizetéskor')).toBe(58)
    expect(ogTitleSize('x'.repeat(33))).toBe(46)
    expect(ogDescriptionLimit('Telepítés')).toBeGreaterThan(ogDescriptionLimit('x'.repeat(33)))
  })

  test('az útvonal szakaszonként egy sor, a hosszú szakasz végét levágja', () => {
    expect(ogRouteLines('/docs/alapok/pontosan-egyszer')).toEqual([
      '/docs',
      '/alapok',
      '/pontosan-egyszer',
    ])
    expect(ogRouteLines('/docs/receptek/nagyon-hosszu-recept')).toEqual([
      '/docs',
      '/receptek',
      '/nagyon-hosszu-re…',
    ])
  })

  test('a levél alja cikkcakkos, és a teljes szélességet lefedi', () => {
    expect(tornLeafPath(48, 100)).toBe('M0 0 H48 V88 L36 100 L24 88 L12 100 L0 88 Z')
  })
})
