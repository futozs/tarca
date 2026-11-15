import { describe, expect, test } from 'vitest'
import type { OrganizationData } from '../generated/billingo'
import { profileFindings, summarizeProfile } from './profile'

const NOW = new Date('2026-11-16T09:00:00.000Z')
const TAX_CODE = '12345678-2-42'

function organization(overrides: Partial<OrganizationData> = {}): OrganizationData {
  return {
    taxCode: TAX_CODE,
    hasNavConnection: false,
    subscription: { expirationDate: '2026-11-17', features: [] },
    ...overrides,
  }
}

function live(expirationDate: string, features: OrganizationData['subscription'] = {}) {
  return organization({
    hasNavConnection: true,
    subscription: { expirationDate, features: ['api_limit_standard'], ...features },
  })
}

function findings(data: OrganizationData, taxCode?: string) {
  const summary = summarizeProfile(data, { now: NOW, taxCode })
  return Object.fromEntries(profileFindings(summary).map((entry) => [entry.id, entry]))
}

describe('profil-becslés', () => {
  test('a P:001 teszt profilt (nincs NAV, üres features, holnapi lejárat) teszt profilnak ismeri fel', () => {
    const summary = summarizeProfile(organization(), { now: NOW })
    const result = findings(organization())

    expect(summary).toMatchObject({
      kind: 'test',
      hasNavConnection: false,
      apiLimit: undefined,
      expirationDate: '2026-11-17',
      daysLeft: 1,
      taxCodeMatches: undefined,
    })
    expect(result.profile).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('valószínűleg fejlesztői teszt profil'),
    })
    expect(result.nav).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('nav_unavailable'),
    })
    expect(result.subscription).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('2026-11-17'),
    })
  })

  test('NAV-kapcsolattal éles profil: valódi bizonylatok, az API-keret szintjét kiírja', () => {
    const result = findings(live('2027-06-30'))

    expect(result.profile).toMatchObject({
      status: 'ok',
      message: expect.stringContaining(
        'éles profil NAV-kapcsolattal, a kiállított bizonylatok valódiak',
      ),
    })
    expect(result.nav?.status).toBe('ok')
    expect(result.subscription).toMatchObject({
      status: 'ok',
      message: 'Előfizetés: érvényes 2027-06-30-ig. API-keret: api_limit_standard.',
    })
  })

  test('NAV nélküli, de előfizetett funkciós profilra figyelmeztet', () => {
    const data = organization({
      subscription: { expirationDate: '2027-01-01', features: ['subscription_basic'] },
    })

    const result = findings(data)

    expect(summarizeProfile(data, { now: NOW }).kind).toBe('live-without-nav')
    expect(result.profile?.status).toBe('warn')
    expect(result.nav).toMatchObject({ status: 'warn', message: expect.stringContaining('NAV') })
  })

  test('lejárt előfizetésre hibát ad, mert az írás 402-t kap', () => {
    const result = findings(live('2026-11-15'))

    expect(result.subscription).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('402'),
    })
  })

  test('éles profilon a 14 napon belüli lejáratra figyelmeztet, a 15. napon már nem', () => {
    expect(findings(live('2026-11-30')).subscription).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('14 nap múlva'),
    })
    expect(findings(live('2026-11-16')).subscription).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('0 nap múlva'),
    })
    expect(findings(live('2026-12-01')).subscription?.status).toBe('ok')
    expect(
      findings(organization({ subscription: { expirationDate: '2026-11-17' } })).subscription
        ?.status,
    ).toBe('ok')
  })

  test('éles profilon api_limit funkció nélkül kimondja, hogy csak egy írás 402-je bizonyít', () => {
    const result = findings(live('2027-06-30', { features: ['subscription_pro'] }))

    expect(result.subscription).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('olvasással nem lehet bizonyítani'),
    })
    expect(result.subscription?.message).toContain('402')
  })

  test('hiányzó lejárati dátumra figyelmeztet', () => {
    const result = findings(organization({ subscription: { features: [] } }))

    expect(result.subscription?.status).toBe('warn')
  })

  test('a megadott adószámot összeveti, de egyik üzenetben sem írja ki', () => {
    const match = findings(organization(), '12345678-2-42')
    const prefix = findings(organization(), '12345678')
    const compact = findings(organization(), '12345678242')
    const other = findings(organization(), '87654321-2-42')
    const shortWrong = findings(organization(), '1234')

    expect(match.profile).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('Az adószám egyezik'),
    })
    expect(prefix.profile?.status).toBe('ok')
    expect(compact.profile?.status).toBe('ok')
    expect(other.profile).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('másik Billingo céghez'),
    })
    expect(shortWrong.profile?.status).toBe('fail')
    for (const result of [match, other]) {
      expect(JSON.stringify(result)).not.toContain('12345678')
      expect(JSON.stringify(result)).not.toContain('87654321')
    }
  })

  test('a budapesti napot veszi alapul: éjfél után már a következő nap számít', () => {
    const lateEvening = new Date('2026-11-16T23:30:00.000Z')

    const summary = summarizeProfile(
      organization({ subscription: { expirationDate: '2026-11-17' } }),
      {
        now: lateEvening,
      },
    )

    expect(summary.daysLeft).toBe(0)
  })
})
