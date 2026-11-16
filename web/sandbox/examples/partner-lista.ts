import { createTarca } from 'tarcajs'

const tarca = createTarca()

const cim = { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' }
await tarca.partners.create({ name: 'Vevő Kft.', address: cim, taxcode: '12345678-2-42' })
await tarca.partners.create({ name: 'Minta Bt.', address: cim })

const szoEleje = await tarca.partners.list({ query: 'vev' })
const szoKozepe = await tarca.partners.list({ query: 'evő' })
const adoszam = await tarca.partners.list({ query: '12345678' })

console.log(
  'vev:',
  szoEleje.total,
  szoEleje.data.map((partner) => partner.name),
)
console.log('evő:', szoKozepe.total)
console.log('adószám:', adoszam.total)

for await (const partner of tarca.partners.all()) {
  console.log(partner.id, partner.name)
}
