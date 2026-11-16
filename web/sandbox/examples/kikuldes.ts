import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

const kikuldve = await tarca.documents.send(szamla.id ?? 0, {
  emails: ['vevo@example.hu', 'konyveles@example.hu'],
})
const emlekeztetok = await tarca.documents.reminders(szamla.id ?? 0)

console.log('címzettek:', kikuldve.emails)
console.log('emlékeztetők:', emlekeztetok)
