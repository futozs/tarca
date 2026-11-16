import { createTarca } from 'tarcajs'

const tarca = createTarca()

const partner = {
  name: 'Vevő Kft.',
  address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
}

for (const orak of [2, 4, 6]) {
  await tarca.documents.create({
    partner,
    items: [{ name: 'Tanácsadás', quantity: orak, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
  })
}

const oldal = await tarca.documents.list({ paymentStatus: 'outstanding', perPage: 2 })

console.log(oldal.total, oldal.currentPage, oldal.lastPage)
console.log(oldal.data.map((szamla) => szamla.invoiceNumber))

let osszesen = 0
for await (const szamla of tarca.documents.all({ type: 'invoice' })) {
  osszesen += szamla.grossTotal ?? 0
}

console.log('a számlák bruttó összege:', osszesen)
