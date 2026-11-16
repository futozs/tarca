import { createTarca } from 'tarcajs'

const tarca = createTarca()

const ervenyes = await tarca.verifyCredentials()
const szervezet = await tarca.organization.get()

console.log('a kulcs érvényes:', ervenyes)
console.log('NAV kapcsolat:', szervezet.hasNavConnection)
console.log('előfizetés lejárata:', szervezet.subscription?.expirationDate)
