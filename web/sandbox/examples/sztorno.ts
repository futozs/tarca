import { createTarca } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Tanácsadás', quantity: 2, unit: 'óra', netUnitPrice: 20_000, vat: 27 }],
})

const sztorno = await tarca.documents.cancel(szamla.id ?? 0, {
  reason: 'A vevő elállt a vásárlástól.',
})

const eredeti = await tarca.documents.get(szamla.id ?? 0)

console.log('sztornó:', sztorno.invoiceNumber, sztorno.type, sztorno.grossTotal)
console.log('az eredeti számla sztornózva:', eredeti.cancelled)
