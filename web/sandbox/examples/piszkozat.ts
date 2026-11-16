import { createTarca, isBillingoError } from 'tarcajs'

const tarca = createTarca()

const szamla = {
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
}

const piszkozat = await tarca.documents.create({ ...szamla, type: 'draft' })
console.log('piszkozat:', piszkozat.id, piszkozat.type, `„${piszkozat.invoiceNumber}”`)

const veglegesitett = await tarca.documents.finalizeDraft(piszkozat.id ?? 0, szamla)
console.log('számla:', veglegesitett.id, veglegesitett.type, veglegesitett.invoiceNumber)

const felesleges = await tarca.documents.create({ ...szamla, type: 'draft' })
await tarca.documents.deleteDraft(felesleges.id ?? 0)

try {
  await tarca.documents.get(felesleges.id ?? 0)
} catch (error) {
  if (!isBillingoError(error)) throw error
  console.log('a törölt piszkozat:', error.status, error.category)
}
