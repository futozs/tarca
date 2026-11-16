import { describe, expect, it } from 'vitest'
import { isNavLinkActive } from './site'

describe('isNavLinkActive', () => {
  it('a Dokumentáció aktív a docs oldalakon, a recepteken nem', () => {
    expect(isNavLinkActive('/docs', '/docs')).toBe(true)
    expect(isNavLinkActive('/docs/alapok/telepites', '/docs')).toBe(true)
    expect(isNavLinkActive('/docs/receptek/stripe', '/docs')).toBe(false)
  })

  it('a Receptek és a Sandbox csak a saját útvonalán aktív', () => {
    expect(isNavLinkActive('/docs/receptek', '/docs/receptek')).toBe(true)
    expect(isNavLinkActive('/docs/receptek/stripe', '/docs/receptek')).toBe(true)
    expect(isNavLinkActive('/sandbox', '/sandbox')).toBe(true)
    expect(isNavLinkActive('/sandboxok', '/sandbox')).toBe(false)
  })
})
