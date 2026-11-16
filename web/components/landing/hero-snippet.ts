import { createTarca } from 'tarcajs'

const tarca = createTarca()
const szamla = await tarca.documents.create({
  partner: { name: 'Vevő Kft.', address },
  items: [{ name: 'Webfejlesztés', vat: 27,
    quantity: 10, unit: 'óra',
    netUnitPrice: 15_000 }],
})

declare const address: import('tarcajs').PartnerAddressInput

export { szamla }
