import { createTarca } from 'tarcajs'

const tarca = createTarca()

const adatok = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['vevo@ceg.hu'],
  taxcode: '12345676-2-41',
}

const elso = await tarca.partners.findOrCreate(adatok)
const ugyanaz = await tarca.partners.findOrCreate(adatok)
const koltozott = await tarca.partners.findOrCreate({
  ...adatok,
  address: { postCode: '1052', city: 'Budapest', address: 'Váci utca 10.' },
})

console.log('első:', elso.created, elso.partner.id)
console.log('ugyanazok az adatok:', ugyanaz.created, ugyanaz.partner.id)
console.log('új cím:', koltozott.created, koltozott.partner.id)
