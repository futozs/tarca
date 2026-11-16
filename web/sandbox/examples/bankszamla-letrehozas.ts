import { createTarca } from 'tarcajs'

const tarca = createTarca()

const forint = await tarca.bankAccounts.create({
  name: 'Fő számla',
  accountNumber: '11111111-22222222-33333333',
  currency: 'HUF',
})
console.log('forint:', forint.id, JSON.stringify(forint.accountNumberIban), forint.needQr)

const euro = await tarca.bankAccounts.create({
  name: 'Euró számla',
  accountNumber: '11111111-22222222-44444444',
  accountNumberIban: 'HU00111111112222222244444444',
  swift: 'ABCDHUHB',
  currency: 'EUR',
})
console.log('euró:', euro.id, euro.swift)

const szamla = await tarca.documents.create({
  bankAccountId: euro.id ?? 0,
  currency: 'EUR',
  conversionRate: 390,
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 1, netUnitPrice: 400, vat: 27 }],
})
console.log('számla bankszámlája:', szamla.organization?.bankAccount?.id)
