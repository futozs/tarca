import { createTarca, isBillingoError } from 'tarcajs'

const tarca = createTarca()

const szamla = await tarca.documents.create({
  partner: {
    name: 'Vevő Kft.',
    address: { postCode: '1111', city: 'Budapest', address: 'Fő utca 1.' },
  },
  items: [{ name: 'Webfejlesztés', quantity: 10, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
})

const modosito = await tarca.documents.createModification(szamla.id ?? 0, {
  items: [{ name: 'Webfejlesztés', quantity: -2, unit: 'óra', netUnitPrice: 15_000, vat: 27 }],
  comment: 'Két óra jóváírása.',
})

const eredeti = await tarca.documents.get(szamla.id ?? 0)

console.log('módosító:', modosito.invoiceNumber, modosito.type, modosito.grossTotal)
console.log('az eredeti:', eredeti.invoiceNumber, eredeti.correctionType)

try {
  await tarca.documents.cancel(szamla.id ?? 0)
} catch (error) {
  if (!isBillingoError(error)) throw error
  console.log('sztornó a módosító után:', error.status, error.category, error.apiMessage)
}
