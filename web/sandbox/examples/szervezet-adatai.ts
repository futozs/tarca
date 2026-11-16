import { createTarca } from 'tarcajs'

const tarca = createTarca()

const ervenyes = await tarca.verifyCredentials()
const szervezet = await tarca.organization.get()

console.log('A kulcs érvényes:', ervenyes)
console.log(szervezet.taxCode, szervezet.hasNavConnection, szervezet.subscription?.features)
