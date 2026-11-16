import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Havi karbantartás', quantity: 1, netUnitPrice: 45_000, vat: 27 }],
  comment: 'Novemberi díj.',
})

const masolat = await tarca.documents.copy(szamla.id ?? 0)

console.log(masolat.id, masolat.type, `„${masolat.invoiceNumber}”`, masolat.comment)
console.log(masolat.items?.map((tetel) => tetel.name))

await tarca.documents.deleteDraft(masolat.id ?? 0)
