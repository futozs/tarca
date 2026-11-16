import { createTarca } from 'tarcajs'

const tarca = createTarca()

const partner = await tarca.partners.create({
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  emails: ['vevo@example.hu'],
  taxcode: '12345678-2-42',
  taxType: 'HAS_TAX_NUMBER',
})

console.log('azonosító:', partner.id)
console.log('ország:', partner.address.countryCode)
console.log('adózási típus:', partner.taxType)
console.log('telefon:', JSON.stringify(partner.phone))
console.log('fizetési határidő:', partner.customBillingSettings?.dueDays)
