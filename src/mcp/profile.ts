import { todayInBudapest } from '../core/dates'
import type { Feature, OrganizationData } from '../generated/billingo'

export type ProfileStatus = 'ok' | 'warn' | 'fail' | 'skip'

export type ProfileKind = 'live' | 'test' | 'live-without-nav'

export interface ProfileFinding {
  readonly id: 'profile' | 'nav' | 'subscription'
  readonly status: ProfileStatus
  readonly message: string
}

export interface ProfileSummary {
  readonly kind: ProfileKind
  readonly hasNavConnection: boolean
  readonly features: readonly Feature[]
  readonly apiLimit: Feature | undefined
  readonly expirationDate: string | undefined
  readonly daysLeft: number | undefined
  readonly taxCodeMatches: boolean | undefined
}

export interface ProfileOptions {
  readonly now: Date
  readonly taxCode?: string | undefined
}

export const SUBSCRIPTION_WARN_DAYS = 14

const DAY_MS = 86_400_000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function dayNumber(date: string): number | undefined {
  const match = DATE_PATTERN.exec(date)
  if (!match) return undefined
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS
}

function digits(value: string): string {
  return value.replace(/\D/g, '')
}

function taxCodeMatches(
  given: string | undefined,
  stored: string | undefined,
): boolean | undefined {
  if (given === undefined) return undefined
  const wanted = digits(given)
  const actual = digits(stored ?? '')
  if (wanted.length === 0 || actual.length === 0) return false
  return wanted.length === 8 ? actual.startsWith(wanted) : actual === wanted
}

export function summarizeProfile(
  organization: OrganizationData,
  options: ProfileOptions,
): ProfileSummary {
  const hasNavConnection = organization.hasNavConnection === true
  const features = organization.subscription?.features ?? []
  const expirationDate = organization.subscription?.expirationDate || undefined
  const expires = expirationDate === undefined ? undefined : dayNumber(expirationDate)
  const today = dayNumber(todayInBudapest(options.now))
  return {
    kind: hasNavConnection ? 'live' : features.length === 0 ? 'test' : 'live-without-nav',
    hasNavConnection,
    features,
    apiLimit: features.find((feature) => feature.startsWith('api_limit_')),
    expirationDate,
    daysLeft: expires === undefined || today === undefined ? undefined : expires - today,
    taxCodeMatches: taxCodeMatches(options.taxCode, organization.taxCode),
  }
}

function profileFinding(summary: ProfileSummary): ProfileFinding {
  const taxCode = summary.taxCodeMatches === true ? ' Az adószám egyezik a megadottal.' : ''
  if (summary.taxCodeMatches === false) {
    return {
      id: 'profile',
      status: 'fail',
      message:
        'Profil: a kulcs cégének adószáma nem egyezik a megadottal, a kulcs másik Billingo céghez tartozik.',
    }
  }
  if (summary.kind === 'live') {
    return {
      id: 'profile',
      status: 'ok',
      message: `Profil: éles profil NAV-kapcsolattal, a kiállított bizonylatok valódiak, a Billingo jelenti őket a NAV-nak.${taxCode}`,
    }
  }
  if (summary.kind === 'test') {
    return {
      id: 'profile',
      status: 'ok',
      message: `Profil: valószínűleg fejlesztői teszt profil (nincs NAV-kapcsolat, nincs előfizetett funkció). A Billingónak nincs teszt jelzője, ez becslés.${taxCode}`,
    }
  }
  return {
    id: 'profile',
    status: 'warn',
    message: `Profil: vannak előfizetett funkciók, de nincs NAV-kapcsolat. Ez éles profil NAV-összekötés nélkül? A kiállított bizonylatok így is valódiak.${taxCode}`,
  }
}

function navFinding(summary: ProfileSummary): ProfileFinding {
  if (summary.hasNavConnection) {
    return { id: 'nav', status: 'ok', message: 'NAV: az Online Számla összekötés be van állítva.' }
  }
  if (summary.kind === 'test') {
    return {
      id: 'nav',
      status: 'ok',
      message:
        'NAV: nincs kapcsolat, teszt profilon ez várható (az adószám-ellenőrzés itt nav_unavailable hibát ad).',
    }
  }
  return {
    id: 'nav',
    status: 'warn',
    message:
      'NAV: éles profilnak látszik, de nincs NAV Online Számla összekötés. A Billingo felületén kell beállítani (technikai felhasználóval), különben a számlák nem jutnak el a NAV-hoz.',
  }
}

function subscriptionFinding(summary: ProfileSummary): ProfileFinding {
  const { expirationDate, daysLeft } = summary
  const tier = summary.apiLimit === undefined ? '' : ` API-keret: ${summary.apiLimit}.`
  if (expirationDate === undefined || daysLeft === undefined) {
    return {
      id: 'subscription',
      status: 'warn',
      message: `Előfizetés: a Billingo nem adott lejárati dátumot.${tier}`,
    }
  }
  if (daysLeft < 0) {
    return {
      id: 'subscription',
      status: 'fail',
      message: `Előfizetés: ${expirationDate}-n lejárt, az írások (kiállítás, sztornó) 402-es hibát kapnak.${tier}`,
    }
  }
  if (summary.kind !== 'test' && summary.apiLimit === undefined) {
    return {
      id: 'subscription',
      status: 'warn',
      message: `Előfizetés: érvényes ${expirationDate}-ig, de a funkciók között nincs api_limit_* tétel. Az „API + Tömeges” kiegészítő meglétét olvasással nem lehet bizonyítani: ha hiányzik, az első írás 402-es hibát kap.`,
    }
  }
  if (summary.hasNavConnection && daysLeft <= SUBSCRIPTION_WARN_DAYS) {
    return {
      id: 'subscription',
      status: 'warn',
      message: `Előfizetés: ${daysLeft} nap múlva (${expirationDate}) lejár, utána az írások 402-es hibát kapnak.${tier}`,
    }
  }
  return {
    id: 'subscription',
    status: 'ok',
    message: `Előfizetés: érvényes ${expirationDate}-ig.${tier}`,
  }
}

export function profileFindings(summary: ProfileSummary): ProfileFinding[] {
  return [profileFinding(summary), navFinding(summary), subscriptionFinding(summary)]
}
