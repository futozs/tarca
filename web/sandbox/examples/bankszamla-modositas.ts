import { createTarca } from 'tarcajs'

const tarca = createTarca()

const uj = await tarca.bankAccounts.create({
  name: 'Euró számla',
  accountNumber: '11111111-22222222-44444444',
  accountNumberIban: 'HU00111111112222222244444444',
  currency: 'EUR',
})
const bankszamlaId = uj.id ?? 0

const { id: _, ...bankszamla } = await tarca.bankAccounts.get(bankszamlaId)
const teljes = await tarca.bankAccounts.update(bankszamlaId, { ...bankszamla, swift: 'ABCDHUHB' })
console.log('teljes bankszámlával:', teljes.accountNumberIban, teljes.swift)

const csonka = await tarca.bankAccounts.update(bankszamlaId, {
  name: 'Euró számla',
  accountNumber: '11111111-22222222-44444444',
  currency: 'EUR',
})
console.log(
  'csak a kötelezőkkel:',
  JSON.stringify(csonka.accountNumberIban),
  JSON.stringify(csonka.swift),
)
