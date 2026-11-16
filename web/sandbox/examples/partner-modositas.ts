import { createTarca } from 'tarcajs'

const tarca = createTarca()

const uj = await tarca.partners.create({
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['vevo@example.hu'],
  phone: '+36 1 234 5678',
})
const partnerId = uj.id ?? 0

const { id: _, ...partner } = await tarca.partners.get(partnerId)
const koltozott = await tarca.partners.update(partnerId, {
  ...partner,
  address: { ...partner.address, postCode: '1052', address: 'Váci utca 10.' },
})
console.log('teljes partnerrel:', koltozott.address.address, koltozott.phone, koltozott.emails)

const csonka = await tarca.partners.update(partnerId, {
  name: 'Vevő Kft.',
  address: { postCode: '1052', city: 'Budapest', address: 'Váci utca 10.' },
})
console.log('csak névvel és címmel:', JSON.stringify(csonka.phone), csonka.emails)
