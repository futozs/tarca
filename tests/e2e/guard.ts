import type { Tarca } from '../../src/client'

export const E2E_NAME_PREFIX = 'TARCA-E2E'

export async function assertTestProfile(tarca: Tarca, expectedTaxCode: string): Promise<void> {
  const organization = await tarca.organization.get()
  if (organization.hasNavConnection !== false) {
    throw new Error(
      `A szervezetnek van NAV kapcsolata (has_nav_connection: ${String(organization.hasNavConnection)}). ` +
        'Ez éles profil lehet, a futás leáll. Csak Billingo fejlesztői teszt profil kulcsával futtasd az e2e-t.',
    )
  }
  if (!expectedTaxCode || organization.taxCode !== expectedTaxCode) {
    throw new Error(
      `A kulcs nem a várt teszt szervezethez tartozik (adószám: ${String(organization.taxCode)}, várt: ${expectedTaxCode || 'nincs megadva'}). ` +
        'Állítsd be a BILLINGO_E2E_TAX_CODE értékét a teszt profil adószámára.',
    )
  }
}
